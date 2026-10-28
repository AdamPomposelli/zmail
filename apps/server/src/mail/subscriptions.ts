import type { EngineContext } from '../context';
import type { UnsubscribeInfo } from '../types';
import type { ActionSource } from './actions';
import { UnsubscribeAgent, type UnsubscribeOutcome } from '../ai/unsubscribe';
import { smtpTransport } from './accounts';
import { json } from '../db';
import { bus } from '../lib/events';
import { newId } from '../lib/ids';
import { t } from '../lib/i18n';

export type SubscriptionRow = {
  fromEmail: string;
  fromName: string;
  total: number;
  opened: number;
  unread: number;
  lastAt: number;
  accountId: string;
  threadId: string;
  canUnsubscribe: boolean;
  status: 'subscribed' | 'success' | 'failed' | 'pending';
  detail: string | null;
};

export class Subscriptions {
  constructor(private readonly ctx: EngineContext) {}

  private agentFor(accountId: string) {
    return new UnsubscribeAgent(this.ctx.ai, async (to, subject, body) => {
      const account = this.ctx.accounts.get(accountId);
      if (!account) throw new Error(t('Compte introuvable'));
      await smtpTransport(account, this.ctx.secrets.decrypt(account.secret)).sendMail({
        from: account.email,
        to,
        subject,
        text: body,
      });
    }, () => this.ctx.prompts.get().unsubscribe.llm);
  }

  /** Unsubscribes from the list behind a thread; notifies when the agent cannot finish. */
  async unsubscribe(threadId: string, source: ActionSource = 'user'): Promise<UnsubscribeOutcome & { id: string }> {
    const thread = this.ctx.store.getThread(threadId);
    if (!thread) throw new Error(t('Conversation introuvable'));
    const latest = [...thread.messages].reverse().find((m) => m.mailbox !== 'sent') ?? thread.messages.at(-1)!;
    const info: UnsubscribeInfo | null = thread.unsubscribe ?? latest.triage?.unsubscribe ?? null;
    const account = this.ctx.accounts.get(latest.accountId);
    const id = newId('uns');

    this.ctx.db.run(
      `INSERT INTO unsubscribes (id, at, account_id, from_email, list_id, method, target, status) VALUES (?, ?, ?, ?, ?, 'none', '', 'pending')`,
      id,
      Date.now(),
      latest.accountId,
      latest.from.email,
      this.ctx.store.message(latest.id)?.list_id ?? null,
    );

    const outcome: UnsubscribeOutcome = info
      ? await this.agentFor(latest.accountId).run(info, account?.email ?? latest.to[0]?.email ?? '')
      : { status: 'failed', method: 'none', target: '', detail: t('Aucun lien de désinscription trouvé dans ce mail.') };

    this.ctx.db.run(
      'UPDATE unsubscribes SET method = ?, target = ?, status = ?, detail = ? WHERE id = ?',
      outcome.method,
      outcome.manualUrl ?? outcome.target,
      outcome.status,
      outcome.detail,
      id,
    );
    if (source === 'user') {
      this.ctx.patterns.log({
        action: 'unsubscribe',
        threadId,
        messageId: latest.id,
        accountId: latest.accountId,
        fromEmail: latest.from.email,
        newsletter: true,
        subject: latest.subject,
        meta: { status: outcome.status, method: outcome.method },
      });
    }
    bus.emitEvent({ type: 'unsubscribe', id, status: outcome.status, fromEmail: latest.from.email });
    if (outcome.status === 'failed' && this.ctx.notifier.allows('unsubscribe_failed')) {
      await this.ctx.notifier.send({
        kind: 'unsubscribe_failed',
        title: t('Désinscription impossible'),
        subtitle: latest.from.name ?? latest.from.email,
        body: t('ZMail n’a pas réussi à vous désinscrire de {sender}. {detail}', { sender: latest.from.email, detail: outcome.detail }),
        threadId,
      });
    }
    return { ...outcome, id };
  }

  /**
   * One row per mailbox and sender: the same newsletter received on two accounts is two
   * subscriptions (each unsubscribes on its own). A mail Gmail keeps in several folders
   * (Inbox, All Mail…) counts once.
   */
  list(): SubscriptionRow[] {
    const senders = this.ctx.db.all<{
      from_email: string;
      from_name: string;
      total: number;
      opened: number;
      unread: number;
      last_at: number;
      account_id: string;
      thread_id: string;
      unsub: string | null;
    }>(
      `WITH copies AS (
         SELECT m.account_id, m.from_email, m.from_name, m.date, m.thread_id, m.unread, t.unsubscribe,
           COALESCE(m.message_id, m.id) AS mail
         FROM messages m JOIN triage t ON t.message_id = m.id JOIN mailboxes mb ON mb.id = m.mailbox_id
         WHERE t.newsletter = 1 AND mb.special_use IN ('inbox', 'archive', 'all', 'trash')
       ), mails AS (
         SELECT account_id, from_email, mail, MAX(from_name) AS from_name, MAX(date) AS date, MIN(unread) AS unread,
           MAX(unsubscribe) AS unsubscribe, MAX(thread_id) AS thread_id
         FROM copies GROUP BY account_id, from_email, mail
       )
       SELECT account_id, from_email, MAX(from_name) AS from_name, COUNT(*) AS total,
         SUM(CASE WHEN unread = 0 THEN 1 ELSE 0 END) AS opened, SUM(unread) AS unread, MAX(date) AS last_at,
         (SELECT x.thread_id FROM mails x WHERE x.account_id = mails.account_id AND x.from_email = mails.from_email ORDER BY x.date DESC LIMIT 1) AS thread_id,
         MAX(unsubscribe) AS unsub
       FROM mails GROUP BY account_id, from_email ORDER BY total DESC LIMIT 400`,
    );
    // Latest attempt per mailbox and sender (older rows without an account apply to all of them).
    const attempts = this.ctx.db.all<{ account_id: string | null; from_email: string; status: string; detail: string }>(
      'SELECT account_id, from_email, status, detail FROM unsubscribes ORDER BY at ASC',
    );
    const latestStatus = new Map<string, { status: string; detail: string }>();
    for (const a of attempts) latestStatus.set(`${a.account_id ?? '*'}|${a.from_email}`, a);
    return senders.map((s) => {
      const status = latestStatus.get(`${s.account_id}|${s.from_email}`) ?? latestStatus.get(`*|${s.from_email}`);
      return {
        fromEmail: s.from_email,
        fromName: s.from_name,
        total: s.total,
        opened: s.opened,
        unread: s.unread,
        lastAt: s.last_at,
        accountId: s.account_id,
        threadId: s.thread_id,
        canUnsubscribe: json(s.unsub, null) !== null,
        status: (status?.status as SubscriptionRow['status']) ?? 'subscribed',
        detail: status?.detail ?? null,
      };
    });
  }

  history() {
    return this.ctx.db.all<{ id: string; at: number; from_email: string; method: string; target: string; status: string; detail: string }>(
      'SELECT id, at, from_email, method, target, status, detail FROM unsubscribes ORDER BY at DESC LIMIT 100',
    );
  }
}
