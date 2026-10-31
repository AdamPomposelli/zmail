import { createHash, randomBytes } from 'node:crypto';
import type { EngineContext } from '../context';
import { log } from '../lib/log';
import { t } from '../lib/i18n';

/**
 * « Se connecter avec Microsoft ». Outlook.com, Hotmail, Live and Microsoft 365 refuse passwords
 * (app passwords included) over IMAP and SMTP since 16 September 2024: only OAuth2 works.
 *
 * Authorization code flow with PKCE, the one for desktop apps: the browser opens Microsoft's
 * sign-in page, which comes back to the engine on http://localhost:<port>/oauth/microsoft
 * (Microsoft ignores the port of a localhost redirect). The refresh token is stored encrypted in
 * the account, like a password, and every IMAP/SMTP connection gets a fresh access token from it.
 */
const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const SCOPES = ['offline_access', 'openid', 'email', 'profile', 'https://outlook.office.com/IMAP.AccessAsUser.All', 'https://outlook.office.com/SMTP.Send'];
export const MICROSOFT_REDIRECT_PATH = '/oauth/microsoft';
const CLIENT_ID_KEY = 'oauth.microsoft.clientId';
/**
 * ZMail's own app registration (Microsoft Entra, public client « ZMail »). A desktop app's ID is
 * public, not a secret: it ships with the app so nobody has to register one. Another one can be
 * set with ZMAIL_MS_CLIENT_ID or the `oauth.microsoft.clientId` setting.
 */
const ZMAIL_CLIENT_ID = '5230b5e2-07c5-41b5-9657-2bfb91661209';

/** What an account stores, encrypted, in place of a password. */
type OAuthSecret = { kind: 'oauth2'; provider: 'microsoft'; refreshToken: string; accessToken: string; expiresAt: number };
export type MailAuth = { pass: string } | { accessToken: string };

type Pending = { verifier: string; redirectUri: string; at: number; done?: boolean; error?: string; email?: string; secret?: OAuthSecret };

const base64url = (buffer: Buffer) => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const isOAuthSecret = (plain: string) => plain.startsWith('{"kind":"oauth2"');

export class MicrosoftOAuth {
  private pending = new Map<string, Pending>();

  constructor(private readonly ctx: EngineContext) {}

  /** Microsoft's sign-in comes back to the engine (it ignores the port of a localhost address). */
  private redirectUri() {
    return `http://localhost:${this.ctx.port ?? Number(process.env.ZMAIL_PORT ?? 47812)}${MICROSOFT_REDIRECT_PATH}`;
  }

  /** The app's ID registered with Microsoft (Microsoft Entra); without one, the sign-in cannot start. */
  clientId(): string | null {
    return process.env.ZMAIL_MS_CLIENT_ID || this.ctx.db.getSetting<string | null>(CLIENT_ID_KEY, null) || ZMAIL_CLIENT_ID;
  }

  setClientId(clientId: string | null) {
    this.ctx.db.setSetting(CLIENT_ID_KEY, clientId?.trim() || null);
  }

  /**
   * Checks an app ID before any sign-in, the way Microsoft's own sign-in page does for personal
   * accounts: `ok`; `tenant` (the Directory ID was pasted); `not-personal` (no such app, the
   * Object ID, or an app not open to personal Microsoft accounts); `redirect` (the return address
   * http://localhost/oauth/microsoft is not registered as a public client); `unknown` otherwise.
   */
  async checkClientId(clientId: string): Promise<'ok' | 'tenant' | 'not-personal' | 'redirect' | 'unknown'> {
    const id = clientId.trim().toLowerCase();
    const params = new URLSearchParams({
      client_id: id,
      response_type: 'code',
      redirect_uri: this.redirectUri(),
      scope: SCOPES.join(' '),
      state: 'check',
      code_challenge: base64url(randomBytes(32)),
      code_challenge_method: 'S256',
    });
    try {
      const [page, tenant] = await Promise.all([
        fetch(`https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?${params}`, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) ZMail' }, signal: AbortSignal.timeout(15_000) }).then((r) => r.text()),
        fetch(`https://login.microsoftonline.com/${id}/v2.0/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000) }).then((r) => r.status),
      ]);
      if (tenant === 200) return 'tenant';
      if (/unauthorized_client/.test(page)) return 'not-personal';
      if (/redirect_uri/.test(page) && /invalid_request/.test(page)) return 'redirect';
      if (/"urlPost"|PPFT|loginfmt/.test(page)) return 'ok';
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /** The Microsoft sign-in page to open in the browser, and the state to follow it with. */
  start(email?: string) {
    const clientId = this.clientId();
    if (!clientId) throw new Error(t('Identifiant d’application Microsoft manquant'));
    const state = base64url(randomBytes(16));
    const verifier = base64url(randomBytes(48));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    const redirectUri = this.redirectUri();
    // Old attempts left open are forgotten after 15 minutes.
    for (const [key, value] of this.pending) if (Date.now() - value.at > 15 * 60_000) this.pending.delete(key);
    this.pending.set(state, { verifier, redirectUri, at: Date.now() });
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: SCOPES.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
      ...(email ? { login_hint: email } : {}),
    });
    return { url: `${AUTHORITY}/authorize?${params}`, state };
  }

  /** Microsoft sends the browser back here with a code (or an error). */
  async callback(query: { code?: string; state?: string; error?: string; error_description?: string }) {
    const pending = query.state ? this.pending.get(query.state) : undefined;
    if (!pending) return { ok: false, message: t('Cette connexion a expiré : relancez-la depuis ZMail.') };
    if (query.error || !query.code) {
      pending.done = true;
      pending.error = query.error === 'access_denied' ? t('Connexion annulée sur la page Microsoft.') : (query.error_description ?? query.error ?? t('Microsoft n’a pas renvoyé de code.'));
      return { ok: false, message: pending.error };
    }
    try {
      const tokens = await this.token({ grant_type: 'authorization_code', code: query.code, redirect_uri: pending.redirectUri, code_verifier: pending.verifier });
      pending.secret = this.toSecret(tokens);
      pending.email = emailFromIdToken(tokens.id_token);
      pending.done = true;
      return { ok: true, message: pending.email ?? '' };
    } catch (error) {
      pending.done = true;
      pending.error = (error as Error).message;
      return { ok: false, message: pending.error };
    }
  }

  /** Followed by the wizard while the user signs in in the browser. */
  status(state: string) {
    const pending = this.pending.get(state);
    if (!pending) return { done: true, error: t('Cette connexion a expiré : relancez-la depuis ZMail.'), email: null };
    return { done: Boolean(pending.done), error: pending.error ?? null, email: pending.email ?? null };
  }

  /** The secret to store for an account once its owner signed in (the wizard passes the state). */
  secretFor(state: string): string {
    const secret = this.pending.get(state)?.secret;
    if (!secret) throw new Error(t('Connectez-vous d’abord avec Microsoft.'));
    return JSON.stringify(secret);
  }

  /**
   * How to log in with a stored secret: the password itself, or a valid access token (refreshed
   * when it expires in less than a minute, then saved back to the account).
   */
  async resolve(plain: string, accountId?: string): Promise<MailAuth> {
    if (!isOAuthSecret(plain)) return { pass: plain };
    const secret = JSON.parse(plain) as OAuthSecret;
    if (secret.expiresAt - 60_000 > Date.now()) return { accessToken: secret.accessToken };
    const tokens = await this.token({ grant_type: 'refresh_token', refresh_token: secret.refreshToken });
    const next = this.toSecret(tokens, secret.refreshToken);
    if (accountId) this.ctx.db.run('UPDATE accounts SET secret = ? WHERE id = ?', this.ctx.secrets.encrypt(JSON.stringify(next)), accountId);
    return { accessToken: next.accessToken };
  }

  private toSecret(tokens: TokenReply, previousRefresh?: string): OAuthSecret {
    return {
      kind: 'oauth2',
      provider: 'microsoft',
      accessToken: tokens.access_token,
      // Microsoft rotates refresh tokens; keep the old one if it sends none.
      refreshToken: tokens.refresh_token ?? previousRefresh ?? '',
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    };
  }

  private async token(body: Record<string, string>): Promise<TokenReply> {
    const clientId = this.clientId();
    if (!clientId) throw new Error(t('Identifiant d’application Microsoft manquant'));
    const res = await fetch(`${AUTHORITY}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, scope: SCOPES.join(' '), ...body }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as TokenReply & { error?: string; error_description?: string };
    if (!res.ok || !data.access_token) {
      log.warn('oauth', 'microsoft token failed', data.error ?? res.status);
      // The first line of Microsoft's description is the useful one (« AADSTS… : … »).
      throw new Error(data.error_description?.split('\r\n')[0] ?? data.error ?? t('Microsoft a refusé la connexion.'));
    }
    return data;
  }
}

type TokenReply = { access_token: string; refresh_token?: string; expires_in?: number; id_token?: string };

/** The signed-in address, from the ID token Microsoft returns (not verified: only shown to the user). */
function emailFromIdToken(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1]!, 'base64url').toString()) as { email?: string; preferred_username?: string };
    return (payload.email ?? payload.preferred_username)?.toLowerCase();
  } catch {
    return undefined;
  }
}
