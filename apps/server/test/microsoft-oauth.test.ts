import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EngineContext } from '../src/context';
import { createTestEngine } from './helpers';

/** « Se connecter avec Microsoft »: Outlook/Hotmail/Microsoft 365 refuse passwords since 2024. */
let engine: EngineContext;
const CLIENT = '11111111-2222-3333-4444-555555555555';
const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ preferred_username: email })).toString('base64url')}.y`;

beforeAll(async () => {
  ({ engine } = await createTestEngine());
  engine.port = 47812;
});
afterEach(() => vi.unstubAllGlobals());

describe('Microsoft sign-in', () => {
  it('ships with ZMail’s own app ID, so nobody has to register one', () => {
    expect(engine.oauth.clientId()).toBe('5230b5e2-07c5-41b5-9657-2bfb91661209');
  });

  it('opens Microsoft’s page with PKCE, IMAP + SMTP scopes and a localhost return address', () => {
    engine.oauth.setClientId(CLIENT);
    const { url, state } = engine.oauth.start('adam@outlook.com');
    const params = new URL(url).searchParams;
    expect(url).toMatch(/^https:\/\/login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/authorize\?/);
    expect(params.get('client_id')).toBe(CLIENT);
    expect(params.get('redirect_uri')).toBe('http://localhost:47812/oauth/microsoft');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('scope')).toContain('https://outlook.office.com/IMAP.AccessAsUser.All');
    expect(params.get('scope')).toContain('https://outlook.office.com/SMTP.Send');
    expect(params.get('scope')).toContain('offline_access');
    expect(params.get('login_hint')).toBe('adam@outlook.com');
    expect(params.get('state')).toBe(state);
  });

  it('exchanges the code for tokens, then the mailbox logs in with an access token renewed when it expires', async () => {
    const { state } = engine.oauth.start('adam@outlook.com');
    const calls: URLSearchParams[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: URLSearchParams }) => {
      calls.push(new URLSearchParams(init.body.toString()));
      const refresh = calls.at(-1)!.get('grant_type') === 'refresh_token';
      return new Response(JSON.stringify({ access_token: refresh ? 'AT-2' : 'AT-1', refresh_token: refresh ? 'RT-2' : 'RT-1', expires_in: refresh ? 3600 : 0, id_token: idToken('Adam@Outlook.com') }), { status: 200 });
    });
    expect(engine.oauth.status(state)).toMatchObject({ done: false });
    expect(await engine.oauth.callback({ code: 'CODE', state })).toMatchObject({ ok: true, message: 'adam@outlook.com' });
    expect(calls[0]!.get('code_verifier')).toBeTruthy();
    expect(engine.oauth.status(state)).toMatchObject({ done: true, error: null, email: 'adam@outlook.com' });

    // What the account stores; the first token is already expired (expires_in 0): it gets renewed.
    const secret = engine.oauth.secretFor(state);
    expect(await engine.oauth.resolve(secret)).toEqual({ accessToken: 'AT-2' });
    expect(calls[1]!.get('grant_type')).toBe('refresh_token');
    expect(calls[1]!.get('refresh_token')).toBe('RT-1');
  });

  it('keeps passwords as passwords, and reports a cancelled sign-in', async () => {
    expect(await engine.oauth.resolve('my-password')).toEqual({ pass: 'my-password' });
    const { state } = engine.oauth.start();
    expect(await engine.oauth.callback({ state, error: 'access_denied' })).toMatchObject({ ok: false });
    expect(engine.oauth.status(state).error).toMatch(/annulée/);
  });

  it('checks a pasted app ID with Microsoft and says what is wrong', async () => {
    const answer = (page: string, tenantStatus = 400) =>
      vi.stubGlobal('fetch', async (url: string) => (String(url).includes('openid-configuration') ? new Response('', { status: tenantStatus }) : new Response(page, { status: 200 })));
    answer('<script>var c={"urlPost":"https://login.live.com/ppsecure/post.srf"}</script>');
    expect(await engine.oauth.checkClientId(CLIENT)).toBe('ok');
    answer('error=unauthorized_client: The client does not exist or is not enabled for consumers');
    expect(await engine.oauth.checkClientId(CLIENT)).toBe('not-personal');
    answer('error=invalid_request: The provided value for the input parameter redirect_uri is not valid');
    expect(await engine.oauth.checkClientId(CLIENT)).toBe('redirect');
    answer('error=unauthorized_client', 200);
    expect(await engine.oauth.checkClientId(CLIENT)).toBe('tenant');
  });
});
