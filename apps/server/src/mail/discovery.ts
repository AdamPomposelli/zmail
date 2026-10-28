import { connect as tcpConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { domainOf } from '../lib/address';
import { PRESETS, detectPreset, type ServerSettings } from './presets';
import { t } from '../lib/i18n';

export type DiscoveryStep = { label: string; status: 'ok' | 'miss' | 'skip'; detail?: string };

export type Discovery = {
  found: boolean;
  presetId: string;
  providerName: string;
  imap: ServerSettings | null;
  smtp: ServerSettings | null;
  /** How the mail server expects the login: the full address or only what comes before @. */
  username: 'email' | 'localpart';
  source: 'preset' | 'ispdb' | 'autoconfig' | 'probe' | 'none';
  /** What the agent tried, in order, for the UI. */
  steps: DiscoveryStep[];
};

type AutoconfigServer = ServerSettings & { username: 'email' | 'localpart' };

/** Reads a Mozilla autoconfig document (ISPDB or the domain's own). */
export function parseAutoconfig(xml: string): { imap: AutoconfigServer | null; smtp: AutoconfigServer | null; name: string | null } {
  const block = (tag: string, type: string) => {
    const re = new RegExp(`<${tag}[^>]*type=["']${type}["'][^>]*>([\\s\\S]*?)</${tag}>`, 'i');
    const body = xml.match(re)?.[1];
    if (!body) return null;
    const get = (name: string) => body.match(new RegExp(`<${name}>([^<]*)</${name}>`, 'i'))?.[1]?.trim();
    const host = get('hostname');
    const port = Number(get('port'));
    const socket = (get('socketType') ?? '').toUpperCase();
    if (!host || !port || host.includes('%')) return null;
    return { host, port, secure: socket === 'SSL', username: (get('username') ?? '%EMAILADDRESS%').includes('%EMAILLOCALPART%') ? 'localpart' : 'email' } as AutoconfigServer;
  };
  return { imap: block('incomingServer', 'imap'), smtp: block('outgoingServer', 'smtp'), name: xml.match(/<displayName>([^<]*)<\/displayName>/i)?.[1] ?? null };
}

async function fetchText(url: string) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** Does something answer on host:port the way a mail server would (TLS or plain greeting)? */
export function probe(host: string, port: number, secure: boolean, timeoutMs = 3500): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    const socket = secure ? tlsConnect({ host, port, servername: host, timeout: timeoutMs }) : tcpConnect({ host, port, timeout: timeoutMs });
    socket.once('data', (data) => finish(/^\* OK|^220/i.test(data.toString())));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * Finds IMAP/SMTP settings for an address like a mail client would: known providers,
 * Mozilla's ISPDB, the domain's own autoconfig, then live probing of the usual hostnames.
 */
export async function discoverServers(email: string, options: { probe?: typeof probe } = {}): Promise<Discovery> {
  const domain = domainOf(email);
  const check = options.probe ?? probe;
  const steps: DiscoveryStep[] = [];
  const detected = await detectPreset(email);

  if (detected.preset.id !== 'custom') {
    steps.push({ label: t('Fournisseur reconnu : {name}', { name: detected.preset.name }), status: 'ok' });
    return {
      found: true,
      presetId: detected.preset.id,
      providerName: detected.preset.name,
      imap: detected.preset.imap,
      smtp: detected.preset.smtp,
      username: detected.preset.localPartUsername ? 'localpart' : 'email',
      source: 'preset',
      steps,
    };
  }
  steps.push({ label: t('Fournisseur connu'), status: 'miss', detail: t('{domain} n’est pas un fournisseur public', { domain }) });

  const sources = [
    { source: 'ispdb' as const, label: t('Annuaire Mozilla (ISPDB)'), urls: [`https://autoconfig.thunderbird.net/v1.1/${domain}`] },
    {
      source: 'autoconfig' as const,
      label: t('Configuration publiée par {domain}', { domain }),
      urls: [`https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}`, `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`],
    },
  ];
  for (const { source, label, urls } of sources) {
    for (const url of urls) {
      const xml = await fetchText(url);
      const config = xml ? parseAutoconfig(xml) : null;
      if (config?.imap && config.smtp) {
        steps.push({ label, status: 'ok', detail: config.imap.host });
        const { username, ...imap } = config.imap;
        const { username: _u, ...smtp } = config.smtp;
        return { found: true, presetId: 'custom', providerName: config.name ?? domain, imap, smtp, username, source, steps };
      }
    }
    steps.push({ label, status: 'miss' });
  }

  // Last resort: try the hostnames mail servers usually live on.
  const imapCandidates: ServerSettings[] = [`imap.${domain}`, `mail.${domain}`, domain].flatMap((host) => [
    { host, port: 993, secure: true },
    { host, port: 143, secure: false },
  ]);
  const smtpCandidates: ServerSettings[] = [`smtp.${domain}`, `mail.${domain}`, domain].flatMap((host) => [
    { host, port: 465, secure: true },
    { host, port: 587, secure: false },
  ]);
  const firstAnswering = async (candidates: ServerSettings[]) => {
    for (const c of candidates) if (await check(c.host, c.port, c.secure)) return c;
    return null;
  };
  const [imap, smtp] = await Promise.all([firstAnswering(imapCandidates), firstAnswering(smtpCandidates)]);
  steps.push({ label: t('Test des serveurs habituels'), status: imap && smtp ? 'ok' : 'miss', detail: imap ? `${imap.host}:${imap.port}` : t('aucun serveur IMAP ne répond') });

  return {
    found: Boolean(imap && smtp),
    presetId: 'custom',
    providerName: domain,
    imap,
    smtp,
    username: 'email',
    source: imap && smtp ? 'probe' : 'none',
    steps,
  };
}

export const providerName = (id: string) => PRESETS.find((p) => p.id === id)?.name ?? id;
