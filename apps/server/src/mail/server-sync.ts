import type { EngineContext } from '../context';
import type { Triage } from '../types';
import { toTriage, type MessageRow } from './store';
import { bus } from '../lib/events';
import { log } from '../lib/log';

/**
 * What ZMail writes back to the mail server.
 * - `manual`: only what you do yourself (archive, delete, spam, read, star, tags, business).
 * - `all`: the AI's sorting too — its tags and business become Gmail labels (IMAP keywords
 *   elsewhere) and the mail it judges as spam goes to the server's Junk folder.
 */
export type ServerSyncMode = 'manual' | 'all';

/** The AI earns trust after this long without much correcting. */
export const TRUST_DAYS = 14;
export const TRUST_MAX_CORRECTION_RATE = 0.05;
export const TRUST_MIN_DECISIONS = 30;

/** User actions that mean the AI got something wrong. */
const CORRECTIONS = ['notSpam', 'spam', 'removeTag', 'setBusiness'] as const;

const DAY = 86_400_000;
export const LABEL_ROOT = 'ZMail';

type Located = MessageRow & { special_use: string | null; path: string };

export type SyncReport = { at: number; labelled: number; movedToJunk: number; failed: number; reason: 'backfill' | 'live' };

export class ServerSync {
  constructor(private readonly ctx: EngineContext) {}

  mode(): ServerSyncMode {
    return this.ctx.db.getSetting<ServerSyncMode>('serverSync.mode', 'manual');
  }

  /** How the AI has done so far: enough history, and how often you had to fix it. */
  trust() {
    const now = Date.now();
    const first = this.ctx.db.get<{ at: number | null }>(`SELECT MIN(processed_at) AS at FROM triage WHERE engine != 'user'`)?.at ?? null;
    const since = Math.max(first ?? now, now - 30 * DAY);
    const decisions = this.ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM triage WHERE engine != 'user' AND processed_at >= ?`, since)?.n ?? 0;
    const rows = this.ctx.db.all<{ action: string; n: number }>(
      `SELECT action, COUNT(*) AS n FROM action_log WHERE at >= ? AND action IN (${CORRECTIONS.map(() => '?').join(',')}) GROUP BY action`,
      since,
      ...CORRECTIONS,
    );
    const byAction = Object.fromEntries(CORRECTIONS.map((a) => [a, rows.find((r) => r.action === a)?.n ?? 0])) as Record<(typeof CORRECTIONS)[number], number>;
    const corrections = Object.values(byAction).reduce((a, b) => a + b, 0);
    const days = first ? Math.floor((now - first) / DAY) : 0;
    const rate = decisions ? corrections / decisions : 0;
    const ready = days >= TRUST_DAYS && decisions >= TRUST_MIN_DECISIONS && rate <= TRUST_MAX_CORRECTION_RATE;
    return { days, decisions, corrections, byAction, rate, ready, daysLeft: Math.max(0, TRUST_DAYS - days) };
  }

  lastReport(): SyncReport | null {
    return this.ctx.db.getSetting<SyncReport | null>('serverSync.lastReport', null);
  }

  async setMode(mode: ServerSyncMode) {
    this.ctx.db.setSetting('serverSync.mode', mode);
    // Mail sorted before the switch gets the same treatment as what arrives next.
    if (mode === 'all') void this.backfill().catch((error) => log.warn('server-sync', 'backfill failed', (error as Error).message));
  }

  /** Label names for a triage: one per tag, one for the business. */
  labelsFor(triage: Pick<Triage, 'tags' | 'businessId'>): string[] {
    const tags = this.ctx.catalog.tags();
    const labels = triage.tags.map((id) => tags.find((t) => t.id === id)?.name ?? id).map((name) => `${LABEL_ROOT}/${name}`);
    const business = triage.businessId ? this.ctx.catalog.businesses().find((b) => b.id === triage.businessId) : undefined;
    if (business) labels.push(`${LABEL_ROOT}/Business/${business.name}`);
    return labels;
  }

  /** A user changed a thread's tags or business: mirror the difference, whatever the mode. */
  async userCategorised(threadIds: string[], before: Map<string, Triage>) {
    let labelled = 0;
    for (const threadId of threadIds) {
      for (const msg of this.ctx.store.threadMessages(threadId)) {
        const previous = before.get(msg.id);
        const current = toTriage(this.ctx.store.triage(msg.id));
        if (!previous || !current) continue;
        labelled += await this.applyLabels(msg, this.labelsFor(previous), this.labelsFor(current));
      }
    }
    return labelled;
  }

  /** The pipeline sorted a new mail. Only mirrored once the user trusts the AI. */
  async aiSorted(messageId: string, triage: Triage, previous: Triage | null = null) {
    if (this.mode() !== 'all' || triage.userOverride) return;
    const report = await this.mirrorAi([messageId], previous ? new Map([[messageId, previous]]) : undefined);
    if (report.labelled || report.movedToJunk || report.failed) this.saveReport({ ...report, reason: 'live' });
  }

  /** Applies the AI's sorting of the last 30 days to the server. */
  async backfill() {
    const ids = this.ctx.db
      .all<{ id: string }>(
        `SELECT m.id FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id JOIN triage t ON t.message_id = m.id
         WHERE mb.special_use IN ('inbox', 'archive', 'all') AND m.uid > 0 AND m.date >= ? ORDER BY m.date DESC LIMIT 2000`,
        Date.now() - 30 * DAY,
      )
      .map((r) => r.id);
    const report = { ...(await this.mirrorAi(ids)), reason: 'backfill' as const };
    this.saveReport(report);
    return report;
  }

  /** `previous` lets a re-sort drop the labels of its earlier verdict. */
  private async mirrorAi(ids: string[], previous?: Map<string, Triage>) {
    let labelled = 0;
    let failed = 0;
    const spamThreads = new Set<string>();
    for (const id of ids) {
      const msg = this.ctx.store.message(id);
      const triage = toTriage(this.ctx.store.triage(id));
      if (!msg || !triage || msg.uid <= 0) continue;
      if (triage.spam && msg.special_use === 'inbox') {
        spamThreads.add(msg.thread_id);
        continue;
      }
      try {
        const before = previous?.get(id);
        labelled += await this.applyLabels(msg, before ? this.labelsFor(before) : [], this.labelsFor(triage));
      } catch {
        failed++;
      }
    }
    let movedToJunk = 0;
    if (spamThreads.size) {
      try {
        movedToJunk = await this.ctx.actions.moveSpamToJunk([...spamThreads]);
      } catch (error) {
        failed += spamThreads.size;
        log.warn('server-sync', 'junk move failed', (error as Error).message);
      }
    }
    return { at: Date.now(), labelled, movedToJunk, failed };
  }

  /** Adds/removes labels on one message; returns 1 when something changed on the server. */
  private async applyLabels(msg: Located, previous: string[], next: string[]) {
    const add = next.filter((l) => !previous.includes(l));
    const remove = previous.filter((l) => !next.includes(l));
    if ((!add.length && !remove.length) || msg.uid <= 0) return 0;
    try {
      const done = await this.ctx.accounts.worker(msg.account_id).setLabels([{ mailboxId: msg.mailbox_id, uid: msg.uid }], add, remove);
      return done ? 1 : 0;
    } catch (error) {
      log.warn('server-sync', msg.id, (error as Error).message);
      throw error;
    }
  }

  private saveReport(report: SyncReport) {
    const previous = this.lastReport();
    // Live updates accumulate into the running total shown in settings.
    const merged =
      previous && report.reason === 'live'
        ? { ...report, labelled: previous.labelled + report.labelled, movedToJunk: previous.movedToJunk + report.movedToJunk, failed: previous.failed + report.failed }
        : report;
    this.ctx.db.setSetting('serverSync.lastReport', merged);
    bus.emitEvent({ type: 'mail', reason: 'changed', threadIds: [] });
  }
}
