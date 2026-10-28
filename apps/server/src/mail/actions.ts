import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import type { EngineContext } from '../context';
import type { UserAction } from '../rules/patterns';
import type { MessageRow } from './store';
import type { SpecialUse } from './imap';
import type { Priority, Triage } from '../types';
import { smtpTransport } from './accounts';
import { toTriage } from './store';
import { bus } from '../lib/events';
import { log } from '../lib/log';
import { t } from '../lib/i18n';

type Located = MessageRow & { special_use: string | null; path: string };

/** Who asked: user actions are learned from, rule and agent actions are not. */
export type ActionSource = 'user' | 'rule' | 'agent';

export type OutgoingMail = {
  accountId: string;
  fromAlias?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text?: string;
  inReplyToMessageId?: string | null;
  threadId?: string | null;
  attachments?: { filename: string; contentType: string; base64: string }[];
};

const FOLDER_NAMES: Record<SpecialUse, string> = {
  inbox: 'INBOX',
  archive: 'Archive',
  all: 'Archive',
  trash: 'Trash',
  junk: 'Junk',
  sent: 'Sent',
  drafts: 'Drafts',
};

export class MailActions {
  constructor(private readonly ctx: EngineContext) {}

  private messages(threadIds: string[], filter?: (m: Located) => boolean): Located[] {
    return threadIds.flatMap((id) => this.ctx.store.threadMessages(id)).filter((m) => !filter || filter(m));
  }

  /** The message whose sender/triage describes the thread for learning purposes. */
  private representative(threadId: string) {
    const all = this.ctx.store.threadMessages(threadId);
    const incoming = all.filter((m) => m.special_use !== 'sent' && m.special_use !== 'drafts');
    return (incoming.length ? incoming : all).at(-1);
  }

  private learn(action: UserAction, threadIds: string[], source: ActionSource, meta: Record<string, unknown> = {}) {
    if (source !== 'user') return;
    for (const threadId of threadIds) {
      const msg = this.representative(threadId);
      if (!msg) continue;
      const triage = toTriage(this.ctx.store.triage(msg.id));
      this.ctx.patterns.log({
        action,
        threadId,
        messageId: msg.id,
        accountId: msg.account_id,
        fromEmail: msg.from_email,
        businessId: triage?.businessId ?? null,
        tags: triage?.tags ?? [],
        listId: msg.list_id,
        newsletter: triage?.newsletter ?? false,
        subject: msg.subject,
        meta,
      });
    }
  }

  private changed(threadIds: string[]) {
    bus.emitEvent({ type: 'mail', reason: 'changed', threadIds });
  }

  /** Moves messages locally first (UI stays instant), then on the IMAP server. */
  private async moveTo(messages: Located[], special: SpecialUse) {
    const byAccount = Map.groupBy(messages, (m) => m.account_id);
    for (const [accountId, items] of byAccount) {
      const worker = this.ctx.accounts.worker(accountId);
      const target = await worker.ensureMailbox(special, FOLDER_NAMES[special]);
      const toMove = items.filter((m) => m.mailbox_id !== target.id);
      if (toMove.length === 0) continue;
      this.ctx.db.tx(() => {
        for (const m of toMove) this.ctx.db.run('UPDATE messages SET mailbox_id = ?, uid = ? WHERE id = ?', target.id, -m.uid, m.id);
      });
      try {
        const moved = await worker.move(toMove.map((m) => ({ mailboxId: m.mailbox_id, uid: m.uid })), target);
        this.ctx.db.tx(() => {
          for (const m of toMove) {
            const newUid = moved.get(m.mailbox_id)?.get(m.uid);
            const clash = newUid ? this.ctx.db.get('SELECT 1 FROM messages WHERE mailbox_id = ? AND uid = ?', target.id, newUid) : undefined;
            if (newUid && !clash) this.ctx.db.run('UPDATE messages SET uid = ? WHERE id = ?', newUid, m.id);
            else this.ctx.store.deleteMessages([m.id]);
          }
        });
      } catch (error) {
        log.error('actions', 'move failed, restoring', (error as Error).message);
        this.ctx.db.tx(() => {
          for (const m of toMove) this.ctx.db.run('UPDATE messages SET mailbox_id = ?, uid = ? WHERE id = ?', m.mailbox_id, m.uid, m.id);
        });
        throw error;
      }
    }
  }

  private async flag(messages: Located[], flag: '\\Seen' | '\\Flagged', on: boolean) {
    const column = flag === '\\Seen' ? 'unread' : 'starred';
    const value = flag === '\\Seen' ? (on ? 0 : 1) : on ? 1 : 0;
    const targets = messages.filter((m) => (m as unknown as Record<string, number>)[column] !== value);
    if (targets.length === 0) return;
    this.ctx.db.tx(() => targets.forEach((m) => this.ctx.db.run(`UPDATE messages SET ${column} = ? WHERE id = ?`, value, m.id)));
    for (const [accountId, items] of Map.groupBy(targets.filter((m) => m.uid > 0), (m) => m.account_id)) {
      await this.ctx.accounts.worker(accountId).setFlags(items.map((m) => ({ mailboxId: m.mailbox_id, uid: m.uid })), flag, on);
    }
  }

  async open(threadId: string, source: ActionSource = 'user') {
    this.learn('open', [threadId], source);
    await this.markRead([threadId], true, 'agent');
  }

  async markRead(threadIds: string[], read: boolean, source: ActionSource = 'user') {
    this.learn(read ? 'markRead' : 'markUnread', threadIds, source);
    await this.flag(this.messages(threadIds), '\\Seen', read);
    this.changed(threadIds);
  }

  async star(threadIds: string[], on: boolean, source: ActionSource = 'user') {
    this.learn(on ? 'star' : 'unstar', threadIds, source);
    const msgs = this.messages(threadIds);
    const latest = threadIds.map((id) => this.representative(id)).filter((m): m is Located => Boolean(m));
    await this.flag(on ? latest : msgs, '\\Flagged', on);
    this.changed(threadIds);
  }

  async archive(threadIds: string[], source: ActionSource = 'user') {
    this.learn('archive', threadIds, source);
    await this.moveTo(this.messages(threadIds, (m) => m.special_use === 'inbox'), 'archive');
    this.changed(threadIds);
  }

  async trash(threadIds: string[], source: ActionSource = 'user') {
    this.learn('trash', threadIds, source);
    await this.moveTo(this.messages(threadIds, (m) => m.special_use !== 'trash' && m.special_use !== 'drafts'), 'trash');
    this.changed(threadIds);
  }

  /** One message of a conversation, not the whole conversation (the reader's message menu). */
  async archiveMessage(id: string) {
    const msg = this.ctx.store.message(id);
    if (!msg) return;
    await this.moveTo([msg as unknown as Located].filter((m) => m.special_use === 'inbox'), 'archive');
    this.changed([msg.thread_id]);
  }

  async trashMessage(id: string) {
    const msg = this.ctx.store.message(id);
    if (!msg) return;
    // Gmail keeps a copy per label: every copy of this mail goes, not the rest of the conversation.
    const copies = this.messages([msg.thread_id], (m) => (m.message_id ? m.message_id === msg.message_id : m.id === id) && m.special_use !== 'trash');
    await this.moveTo(copies, 'trash');
    this.changed([msg.thread_id]);
  }

  async restore(threadIds: string[], source: ActionSource = 'user') {
    this.learn('restore', threadIds, source);
    const msgs = this.messages(threadIds, (m) => ['trash', 'junk', 'archive', 'all'].includes(m.special_use ?? ''));
    await this.moveTo(msgs.filter((m) => !this.isOwnMessage(m)), 'inbox');
    await this.moveTo(msgs.filter((m) => this.isOwnMessage(m) && m.special_use === 'trash'), 'sent');
    this.ctx.store.patchThreadTriage(threadIds, { spam: false, spamReason: null }, source === 'user');
    this.changed(threadIds);
  }

  async spam(threadIds: string[], source: ActionSource = 'user') {
    this.learn('spam', threadIds, source);
    this.ctx.store.patchThreadTriage(threadIds, { spam: true, spamReason: source === 'user' ? t('Signalé par vous') : t('Règle automatique'), priority: 0 }, source === 'user');
    if (source === 'user') await this.moveTo(this.messages(threadIds, (m) => m.special_use === 'inbox'), 'junk');
    this.changed(threadIds);
  }

  async notSpam(threadIds: string[], source: ActionSource = 'user') {
    this.learn('notSpam', threadIds, source);
    this.ctx.store.patchThreadTriage(threadIds, { spam: false, spamReason: null, priority: 1 }, true);
    await this.moveTo(this.messages(threadIds, (m) => m.special_use === 'junk'), 'inbox');
    this.changed(threadIds);
  }

  async deleteForever(threadIds: string[]) {
    const msgs = this.messages(threadIds, (m) => m.special_use === 'trash' || m.special_use === 'junk');
    for (const [accountId, items] of Map.groupBy(msgs.filter((m) => m.uid > 0), (m) => m.account_id)) {
      await this.ctx.accounts.worker(accountId).expunge(items.map((m) => ({ mailboxId: m.mailbox_id, uid: m.uid })));
    }
    this.ctx.store.deleteMessages(msgs.map((m) => m.id));
    this.changed(threadIds);
  }

  /** Triage of every message in the threads, kept to mirror category changes to the server. */
  private snapshot(threadIds: string[]) {
    const before = new Map<string, Triage>();
    for (const threadId of threadIds) {
      for (const msg of this.ctx.store.threadMessages(threadId)) {
        const triage = toTriage(this.ctx.store.triage(msg.id));
        if (triage) before.set(msg.id, triage);
      }
    }
    return before;
  }

  /** What you categorise yourself is always mirrored; rules follow the AI setting. */
  private mirrorCategories(threadIds: string[], before: Map<string, Triage>, source: ActionSource) {
    if (source === 'rule' && this.ctx.serverSync.mode() !== 'all') return;
    void this.ctx.serverSync.userCategorised(threadIds, before).catch((error) => log.warn('actions', 'label sync failed', (error as Error).message));
  }

  /** AI-detected spam, once the user trusts the AI with the server: same move as « Spam ». */
  async moveSpamToJunk(threadIds: string[]) {
    const msgs = this.messages(threadIds, (m) => m.special_use === 'inbox' && m.uid > 0);
    await this.moveTo(msgs, 'junk');
    this.changed(threadIds);
    return new Set(msgs.map((m) => m.thread_id)).size;
  }

  setTags(threadIds: string[], add: string[], remove: string[], source: ActionSource = 'user') {
    for (const tag of add) this.learn('addTag', threadIds, source, { tag });
    for (const tag of remove) this.learn('removeTag', threadIds, source, { tag });
    const before = this.snapshot(threadIds);
    for (const threadId of threadIds) {
      for (const msg of this.ctx.store.threadMessages(threadId)) {
        const triage = toTriage(this.ctx.store.triage(msg.id));
        if (!triage) continue;
        const tags = [...new Set([...triage.tags.filter((t) => !remove.includes(t)), ...add])];
        this.ctx.store.saveTriage(msg.id, { ...triage, tags, userOverride: triage.userOverride || source === 'user' });
      }
    }
    this.mirrorCategories(threadIds, before, source);
    this.changed(threadIds);
  }

  setBusiness(threadIds: string[], businessId: string | null, source: ActionSource = 'user') {
    this.learn('setBusiness', threadIds, source, { businessId });
    const before = this.snapshot(threadIds);
    this.ctx.store.patchThreadTriage(threadIds, { businessId }, source === 'user');
    this.mirrorCategories(threadIds, before, source);
    this.changed(threadIds);
  }

  setPriority(threadIds: string[], priority: Priority, source: ActionSource = 'user') {
    this.learn('setPriority', threadIds, source, { priority });
    this.ctx.store.patchThreadTriage(threadIds, { priority }, source === 'user');
    this.changed(threadIds);
  }

  patchTriage(threadIds: string[], patch: Partial<Triage>) {
    this.ctx.store.patchThreadTriage(threadIds, patch, false);
    this.changed(threadIds);
  }

  private isOwnMessage(m: Located) {
    const account = this.ctx.accounts.get(m.account_id);
    return Boolean(account && (m.from_email === account.email || account.aliases.includes(m.from_email)));
  }

  async send(mail: OutgoingMail, source: ActionSource = 'user') {
    const account = this.ctx.accounts.get(mail.accountId);
    if (!account) throw new Error(t('Compte d’envoi introuvable'));
    const parent = mail.inReplyToMessageId ? this.ctx.store.message(mail.inReplyToMessageId) : undefined;
    const parentRefs = parent ? [...JSON.parse(parent.refs as string), parent.message_id].filter(Boolean) : [];
    const fromAddress = mail.fromAlias && account.aliases.includes(mail.fromAlias) ? mail.fromAlias : account.email;

    const message = {
      from: { name: account.name, address: fromAddress },
      to: mail.to,
      cc: mail.cc,
      bcc: mail.bcc,
      subject: mail.subject,
      // The composer places the chosen signature itself (above the quoted mail, like Gmail).
      html: mail.html,
      text: mail.text,
      inReplyTo: parent?.message_id ?? undefined,
      references: parentRefs.length ? parentRefs.join(' ') : undefined,
      attachments: mail.attachments?.map((a) => ({ filename: a.filename, contentType: a.contentType, content: Buffer.from(a.base64, 'base64') })),
    };
    const raw = await new MailComposer(message).compile().build();
    await smtpTransport(account, this.ctx.secrets.decrypt(account.secret)).sendMail({ envelope: { from: fromAddress, to: [...mail.to, ...(mail.cc ?? []), ...(mail.bcc ?? [])] }, raw });

    // Gmail files sent mail itself; other servers need the copy appended to Sent.
    const worker = this.ctx.accounts.worker(account.id);
    if (!['gmail', 'google-workspace'].includes(account.provider)) {
      await worker.append('sent', raw, ['\\Seen']).catch((error) => log.warn('send', 'append to Sent failed', (error as Error).message));
    }
    if (parent && source === 'user') this.learn('reply', [parent.thread_id], source);
    void worker.sync({ only: ['sent'] }).catch(() => undefined);
    return { ok: true };
  }
}
