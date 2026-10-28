import type { Database } from '../db';
import { CAPABILITIES, CAPABILITY_IDS, type Capability } from './capabilities';
import { costUsd, type CatalogModel } from './catalog';
import { BENCHMARKS } from './recommendations';

export type MailVolume = {
  /** Received mails per day, averaged over the observed window. */
  perDay: number;
  windowDays: number;
  newsletterShare: number;
  accounts: { id: string; email: string; perDay: number }[];
};

const DAY = 86400_000;

/** How much mail actually comes in, from the synced mailboxes (last 30 days). */
export function mailVolume(db: Database): MailVolume {
  const since = Date.now() - 30 * DAY;
  const rows = db.all<{ id: string; email: string; n: number; first: number | null }>(
    `SELECT a.id, a.email, COUNT(m.id) AS n, MIN(m.date) AS first
     FROM accounts a
     LEFT JOIN messages m ON m.account_id = a.id AND m.date > ?
       AND m.mailbox_id IN (SELECT id FROM mailboxes WHERE special_use IN ('inbox', 'junk', 'archive', 'all', 'trash'))
     GROUP BY a.id ORDER BY a.created_at`,
    since,
  );
  const first = Math.min(...rows.map((r) => r.first ?? Date.now()));
  const windowDays = Math.max(1, Math.min(30, Math.ceil((Date.now() - first) / DAY)));
  const newsletters = db.get<{ n: number; total: number }>(
    `SELECT SUM(t.newsletter) AS n, COUNT(*) AS total FROM triage t JOIN messages m ON m.id = t.message_id WHERE m.date > ?`,
    since,
  );
  const accounts = rows.map((r) => ({ id: r.id, email: r.email, perDay: r.n / windowDays }));
  return {
    perDay: accounts.reduce((sum, a) => sum + a.perDay, 0),
    windowDays,
    newsletterShare: newsletters?.total ? (newsletters.n ?? 0) / newsletters.total : 0,
    accounts,
  };
}

/** Typical prompt/completion sizes per call: measured by the benchmark, else the declared defaults. */
export function tokensPerCall(capability: Capability) {
  const measured = BENCHMARKS.results.filter((r) => r.capability === capability && r.promptTokens > 0);
  if (measured.length) {
    const avg = (pick: (r: (typeof measured)[number]) => number) => measured.reduce((s, r) => s + pick(r), 0) / measured.length;
    return { promptTokens: Math.round(avg((r) => r.promptTokens)), completionTokens: Math.round(avg((r) => r.completionTokens)) };
  }
  return { promptTokens: CAPABILITIES[capability].promptTokens, completionTokens: CAPABILITIES[capability].completionTokens };
}

/** `mailsPerDay` overrides the observed volume to simulate more (or fewer) mailboxes. */
export type ForecastSettings = { chatPerDay: number; mailsPerDay: number | null };

/** Calls per day each capability will make for this mail volume. */
export function callsPerDay(capability: Capability, volume: MailVolume, settings: ForecastSettings) {
  switch (capability) {
    case 'triage':
      return settings.mailsPerDay ?? volume.perDay;
    case 'chat':
      return settings.chatPerDay;
    case 'unsubscribe':
      // Only pages that are neither confirmed nor obviously failed reach the model.
      return (settings.mailsPerDay ?? volume.perDay) * volume.newsletterShare * 0.05;
  }
}

export function monthlyCost(model: Pick<CatalogModel, 'inputPrice' | 'outputPrice'>, capability: Capability, volume: MailVolume, settings: ForecastSettings) {
  const tokens = tokensPerCall(capability);
  const perCall = costUsd(model, tokens.promptTokens, tokens.completionTokens);
  return perCall === null ? null : perCall * callsPerDay(capability, volume, settings) * 30;
}

export const forecastCapabilities = CAPABILITY_IDS;
