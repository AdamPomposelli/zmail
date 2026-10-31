import type { AttachmentMeta, MessageView, ThreadDetail, ThreadListItem, Triage, View, Priority } from '../types';
import { SPACE_EXPR, SPACE_JOINS } from './spaces';
import { json, type Database, type SQLInputValue } from '../db';
import type { Address } from '../lib/address';
import { hashId } from '../lib/ids';
import { buildReplyTree, groupConversations, type TreeNode } from './reply-tree';
import { evaluateAuth } from './auth';

export type { SQLInputValue };

export type IncomingMessage = {
  accountId: string;
  mailboxId: string;
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  from: Address;
  to: Address[];
  cc: Address[];
  replyTo: string | null;
  deliveredTo: string | null;
  date: number;
  text: string;
  html: string;
  attachments: AttachmentMeta[];
  unread: boolean;
  starred: boolean;
  listUnsubscribe: string | null;
  listUnsubscribePost: string | null;
  listId: string | null;
  precedence: string | null;
  autoSubmitted: string | null;
  spamHeader: string | null;
  authResults?: string | null;
  size: number;
  isNew: boolean;
};

export type MessageRow = {
  id: string;
  account_id: string;
  mailbox_id: string;
  uid: number;
  message_id: string | null;
  thread_id: string;
  in_reply_to: string | null;
  refs: string;
  subject: string;
  from_name: string;
  from_email: string;
  to_json: string;
  cc_json: string;
  reply_to: string | null;
  delivered_to: string | null;
  date: number;
  snippet: string;
  text_body: string;
  html_body: string;
  attachments: string;
  unread: number;
  starred: number;
  list_unsubscribe: string | null;
  list_unsubscribe_post: string | null;
  list_id: string | null;
  precedence: string | null;
  auto_submitted: string | null;
  spam_header: string | null;
  auth_results: string | null;
  size: number;
  is_new: number;
};

export type TriageRow = {
  message_id: string;
  business_id: string | null;
  priority: number;
  tags: string;
  spam: number;
  spam_reason: string | null;
  otp: string | null;
  opportunity: number;
  opportunity_reason: string | null;
  newsletter: number;
  unsubscribe: string | null;
  summary: string;
  engine: string;
  user_override: number;
  rules_applied: string;
};

export const messagePk = (accountId: string, mailboxId: string, uidvalidity: string, uid: number) =>
  hashId('m', accountId, mailboxId, uidvalidity, uid);

export const normalizeSubject = (subject: string) =>
  subject.replace(/^\s*((re|fw|fwd|tr|aw|wg|sv|vs)\s*(\[\d+\])?\s*:\s*)+/i, '').trim();

export const makeSnippet = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 220);

export function toTriage(row: TriageRow | undefined | null): Triage | null {
  if (!row) return null;
  return {
    businessId: row.business_id,
    priority: Math.max(0, Math.min(3, row.priority)) as Priority,
    tags: json<string[]>(row.tags, []),
    spam: row.spam === 1,
    spamReason: row.spam_reason,
    otp: row.otp,
    opportunity: row.opportunity === 1,
    opportunityReason: row.opportunity_reason,
    newsletter: row.newsletter === 1,
    unsubscribe: json(row.unsubscribe, null),
    summary: row.summary,
    engine: row.engine,
    userOverride: row.user_override === 1,
    rulesApplied: json<string[]>(row.rules_applied, []),
  };
}

/** Mails of a category marked « Masquer de la boîte de réception » stay out of the inbox. */
const NOT_HIDDEN_FROM_INBOX = `NOT EXISTS (SELECT 1 FROM json_each(COALESCE(t.tags, '[]')) hj JOIN tags ht ON ht.id = hj.value WHERE ht.hide_from_inbox = 1)`;

/** Folder-level scoping of each view; triage-based conditions are added in listThreads. */
const VIEW_SQL: Record<View, string> = {
  inbox: "mb.special_use = 'inbox' AND COALESCE(t.spam, 0) = 0",
  priority: "mb.special_use = 'inbox' AND COALESCE(t.spam, 0) = 0 AND COALESCE(t.priority, 1) >= 2",
  opportunities: "mb.special_use IN ('inbox', 'archive', 'all') AND COALESCE(t.spam, 0) = 0 AND t.opportunity = 1",
  otp: "COALESCE(mb.special_use, '') NOT IN ('trash', 'junk', 'sent', 'drafts') AND COALESCE(t.spam, 0) = 0 AND t.otp IS NOT NULL",
  newsletters: "mb.special_use = 'inbox' AND COALESCE(t.spam, 0) = 0 AND t.newsletter = 1",
  unread: "mb.special_use = 'inbox' AND COALESCE(t.spam, 0) = 0 AND m.unread = 1",
  starred: "COALESCE(mb.special_use, '') NOT IN ('trash', 'junk') AND m.starred = 1",
  sent: "mb.special_use = 'sent'",
  drafts: "mb.special_use = 'drafts'",
  archive: `mb.special_use IN ('archive', 'all') AND NOT EXISTS (
      SELECT 1 FROM messages m2 JOIN mailboxes mb2 ON mb2.id = m2.mailbox_id
      WHERE m2.account_id = m.account_id AND m2.message_id = m.message_id
        AND mb2.special_use IN ('inbox', 'trash', 'junk', 'sent', 'drafts'))`,
  spam: "(mb.special_use = 'junk' OR (mb.special_use = 'inbox' AND t.spam = 1))",
  trash: "mb.special_use = 'trash'",
  // Scoped by the `mailboxId` filter.
  folder: '1 = 1',
};

export type ListFilters = {
  view: View;
  businessId?: string | null;
  tagId?: string | null;
  accountId?: string | null;
  mailboxId?: string | null;
  /** Only this space's mail (see mail/spaces.ts). Server folders (`folder` view) are never scoped. */
  spaceId?: string | null;
  query?: string | null;
  sort?: 'smart' | 'date';
  limit?: number;
  offset?: number;
};

export class MailStore {
  constructor(private readonly db: Database) {}

  /** Senders matching what is typed (name or address), the most frequent first: ⌘K and @ mentions. */
  senders(query: string, limit = 6) {
    const like = `%${query.trim().toLowerCase()}%`;
    return this.db
      .all<{ email: string; name: string | null; n: number; last: number }>(
        `SELECT lower(m.from_email) AS email, MAX(m.from_name) AS name, COUNT(*) AS n, MAX(m.date) AS last
         FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
         WHERE COALESCE(mb.special_use, '') NOT IN ('sent', 'drafts', 'junk', 'trash')
           AND (lower(m.from_email) LIKE ? OR lower(COALESCE(m.from_name, '')) LIKE ?)
         GROUP BY lower(m.from_email) ORDER BY n DESC, last DESC LIMIT ?`,
        like,
        like,
        limit,
      )
      .map((r) => ({ email: r.email, name: r.name || null, count: r.n }));
  }

  findThreadId(accountId: string, messageIds: string[]): string | null {
    const ids = messageIds.filter(Boolean);
    if (ids.length === 0) return null;
    const row = this.db.get<{ thread_id: string }>(
      `SELECT thread_id FROM messages WHERE account_id = ? AND message_id IN (${ids.map(() => '?').join(',')}) LIMIT 1`,
      accountId,
      ...ids,
    );
    return row?.thread_id ?? null;
  }

  /** Inserts (or refreshes the flags of) one message; returns its id and whether it is new. */
  upsert(msg: IncomingMessage, uidvalidity: string): { id: string; inserted: boolean; threadId: string } {
    // Looked up by (mailbox, uid) rather than id: a message moved by ZMail keeps its id and triage.
    const existing = this.db.get<{ id: string; thread_id: string }>(
      'SELECT id, thread_id FROM messages WHERE account_id = ? AND mailbox_id = ? AND uid = ?',
      msg.accountId,
      msg.mailboxId,
      msg.uid,
    );
    if (existing) {
      this.db.run('UPDATE messages SET unread = ?, starred = ? WHERE id = ?', msg.unread ? 1 : 0, msg.starred ? 1 : 0, existing.id);
      return { id: existing.id, inserted: false, threadId: existing.thread_id };
    }
    const id = messagePk(msg.accountId, msg.mailboxId, uidvalidity, msg.uid);

    const lookup = [msg.messageId, msg.inReplyTo, ...msg.references].filter((v): v is string => Boolean(v));
    const root = msg.references[0] ?? msg.inReplyTo ?? msg.messageId ?? `${msg.mailboxId}:${msg.uid}`;
    const threadId = this.findThreadId(msg.accountId, lookup) ?? hashId('t', msg.accountId, root);
    // This message can link two conversations synced apart (a reply seen before the mail it
    // answers, a missing References header): they become one.
    if (lookup.length) {
      const others = this.db
        .all<{ thread_id: string }>(
          `SELECT DISTINCT thread_id FROM messages WHERE account_id = ? AND thread_id != ? AND (message_id IN (${lookup.map(() => '?').join(',')})
             OR in_reply_to IN (${lookup.map(() => '?').join(',')}))`,
          msg.accountId,
          threadId,
          ...lookup,
          ...lookup,
        )
        .map((r) => r.thread_id);
      for (const other of others) this.db.run('UPDATE messages SET thread_id = ? WHERE thread_id = ?', threadId, other);
    }

    this.db.tx(() => {
      this.db.run(
        `INSERT INTO messages (id, account_id, mailbox_id, uid, message_id, thread_id, in_reply_to, refs, subject,
          from_name, from_email, to_json, cc_json, reply_to, delivered_to, date, snippet, text_body, html_body,
          attachments, unread, starred, list_unsubscribe, list_unsubscribe_post, list_id, precedence, auto_submitted,
          spam_header, size, is_new, created_at, auth_results)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id,
        msg.accountId,
        msg.mailboxId,
        msg.uid,
        msg.messageId,
        threadId,
        msg.inReplyTo,
        JSON.stringify(msg.references),
        msg.subject,
        msg.from.name ?? '',
        msg.from.email,
        JSON.stringify(msg.to),
        JSON.stringify(msg.cc),
        msg.replyTo,
        msg.deliveredTo,
        msg.date,
        makeSnippet(msg.text),
        msg.text,
        msg.html,
        JSON.stringify(msg.attachments),
        msg.unread ? 1 : 0,
        msg.starred ? 1 : 0,
        msg.listUnsubscribe,
        msg.listUnsubscribePost,
        msg.listId,
        msg.precedence,
        msg.autoSubmitted,
        msg.spamHeader,
        msg.size,
        msg.isNew ? 1 : 0,
        Date.now(),
        msg.authResults ?? null,
      );
      this.db.run(
        'INSERT INTO messages_fts (message_pk, subject, sender, body) VALUES (?, ?, ?, ?)',
        id,
        msg.subject,
        `${msg.from.name ?? ''} ${msg.from.email}`,
        msg.text.slice(0, 20000),
      );
      // A message already triaged in another folder (Gmail labels) keeps its triage.
      if (msg.messageId) {
        this.db.run(
          `INSERT OR IGNORE INTO triage (message_id, business_id, priority, tags, spam, spam_reason, otp, opportunity,
             opportunity_reason, newsletter, unsubscribe, summary, engine, user_override, rules_applied, processed_at)
           SELECT ?, t.business_id, t.priority, t.tags, t.spam, t.spam_reason, t.otp, t.opportunity, t.opportunity_reason,
             t.newsletter, t.unsubscribe, t.summary, t.engine, t.user_override, t.rules_applied, t.processed_at
           FROM triage t JOIN messages o ON o.id = t.message_id
           WHERE o.account_id = ? AND o.message_id = ? AND o.id != ? LIMIT 1`,
          id,
          msg.accountId,
          msg.messageId,
          id,
        );
      }
    });
    return { id, inserted: true, threadId };
  }

  deleteMessages(ids: string[]) {
    if (ids.length === 0) return;
    this.db.tx(() => {
      for (const id of ids) {
        this.db.run('DELETE FROM messages_fts WHERE message_pk = ?', id);
        this.db.run('DELETE FROM messages WHERE id = ?', id);
      }
    });
  }

  message(id: string) {
    return this.db.get<MessageRow & { special_use: string | null; path: string }>(
      'SELECT m.*, mb.special_use, mb.path FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id WHERE m.id = ?',
      id,
    );
  }

  threadMessages(threadId: string) {
    return this.db.all<MessageRow & { special_use: string | null; path: string }>(
      `SELECT m.*, mb.special_use, mb.path FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
       WHERE m.thread_id = ? ORDER BY m.date ASC`,
      threadId,
    );
  }

  triage(messageId: string) {
    return this.db.get<TriageRow>('SELECT * FROM triage WHERE message_id = ?', messageId);
  }

  saveTriage(messageId: string, triage: Triage) {
    this.db.run(
      `INSERT INTO triage (message_id, business_id, priority, tags, spam, spam_reason, otp, opportunity, opportunity_reason,
         newsletter, unsubscribe, summary, engine, user_override, rules_applied, processed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(message_id) DO UPDATE SET business_id = excluded.business_id, priority = excluded.priority,
         tags = excluded.tags, spam = excluded.spam, spam_reason = excluded.spam_reason, otp = excluded.otp,
         opportunity = excluded.opportunity, opportunity_reason = excluded.opportunity_reason,
         newsletter = excluded.newsletter, unsubscribe = excluded.unsubscribe, summary = excluded.summary,
         engine = excluded.engine, user_override = excluded.user_override, rules_applied = excluded.rules_applied,
         processed_at = excluded.processed_at`,
      messageId,
      triage.businessId,
      triage.priority,
      JSON.stringify(triage.tags),
      triage.spam ? 1 : 0,
      triage.spamReason,
      triage.otp,
      triage.opportunity ? 1 : 0,
      triage.opportunityReason,
      triage.newsletter ? 1 : 0,
      triage.unsubscribe ? JSON.stringify(triage.unsubscribe) : null,
      triage.summary,
      triage.engine,
      triage.userOverride ? 1 : 0,
      JSON.stringify(triage.rulesApplied),
      Date.now(),
    );
  }

  /** Applies a partial triage change to every message of the threads (user corrections). */
  patchThreadTriage(threadIds: string[], patch: Partial<Triage>, markOverride = true) {
    this.db.tx(() => {
      for (const threadId of threadIds) {
        for (const msg of this.threadMessages(threadId)) {
          const current = toTriage(this.triage(msg.id));
          if (!current) continue;
          this.saveTriage(msg.id, { ...current, ...patch, userOverride: markOverride || current.userOverride });
        }
      }
    });
  }

  untriaged(limit: number) {
    return this.db.all<{ id: string }>(
      `SELECT m.id FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
       LEFT JOIN triage t ON t.message_id = m.id
       WHERE t.message_id IS NULL AND mb.special_use IN ('inbox', 'junk', 'archive', 'all')
       ORDER BY m.date DESC LIMIT ?`,
      limit,
    );
  }

  listThreads(filters: ListFilters): { items: ThreadListItem[]; nextOffset: number | null } {
    // A search from the inbox (⌘K « everywhere ») also finds archived and filed mail; never the
    // trash, spam or drafts.
    const searching = filters.view === 'inbox' && Boolean(filters.query?.trim()) && !filters.mailboxId;
    const where: string[] = [searching ? "COALESCE(mb.special_use, '') NOT IN ('trash', 'junk', 'drafts') AND COALESCE(t.spam, 0) = 0" : VIEW_SQL[filters.view]];
    const params: SQLInputValue[] = [];
    if (filters.accountId) {
      where.push('m.account_id = ?');
      params.push(filters.accountId);
    }
    if (filters.mailboxId) {
      where.push('m.mailbox_id = ?');
      params.push(filters.mailboxId);
    } else if (filters.view === 'folder') {
      where.push('0 = 1');
    }
    if (filters.businessId) {
      where.push('t.business_id = ?');
      params.push(filters.businessId);
    }
    // An account or a server folder picked in the sidebar shows all of it, whatever the space.
    if (filters.spaceId && filters.view !== 'folder' && !filters.accountId && !filters.mailboxId) {
      where.push(`${SPACE_EXPR} = ?`);
      params.push(filters.spaceId);
    }
    if (filters.tagId) {
      where.push('EXISTS (SELECT 1 FROM json_each(t.tags) j WHERE j.value = ?)');
      params.push(filters.tagId);
    }
    // The inbox itself (not a category, an account, a folder or a search): a search finds them all.
    else if (filters.view === 'inbox' && !filters.accountId && !filters.mailboxId && !filters.businessId && !filters.query?.trim()) where.push(NOT_HIDDEN_FROM_INBOX);
    // `from:adresse` (typed, or a sender picked in ⌘K) narrows to one sender; the rest is full text.
    const senders: string[] = [];
    const query = filters.query?.replace(/(^|\s)from:(\S+)/gi, (_, space: string, who: string) => (senders.push(who.toLowerCase()), space)).trim();
    if (senders.length) {
      where.push(`(${senders.map(() => '(lower(m.from_email) = ? OR lower(m.from_email) LIKE ?)').join(' OR ')})`);
      for (const who of senders) params.push(who, who.includes('@') ? who : `%${who}%`);
    }
    if (query) {
      const fts = query
        .split(/\s+/)
        .filter(Boolean)
        .map((term) => `"${term.replace(/"/g, '""')}"*`)
        .join(' ');
      where.push('m.id IN (SELECT message_pk FROM messages_fts WHERE messages_fts MATCH ?)');
      params.push(fts);
    }

    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    const now = Date.now();
    const order =
      filters.sort === 'date' || !['inbox', 'unread', 'priority'].includes(filters.view)
        ? 'date DESC'
        : `CASE WHEN thread_priority >= 2 AND (thread_unread = 1 OR date > ${now - 3 * 86400_000}) THEN thread_priority ELSE 0 END DESC, date DESC`;

    const rows = this.db.all<
      MessageRow &
        Partial<TriageRow> & {
          special_use: string | null;
          thread_count: number;
          thread_unread: number;
          thread_priority: number;
          account_email: string;
          account_color: string;
          space_id: string;
        }
    >(
      `WITH scoped AS (
         SELECT m.*, mb.special_use, t.business_id, t.priority, t.tags, t.spam, t.otp, t.opportunity, t.newsletter, t.summary,
           ${SPACE_EXPR} AS space_id
         FROM messages m
         JOIN mailboxes mb ON mb.id = m.mailbox_id
         LEFT JOIN triage t ON t.message_id = m.id
         ${SPACE_JOINS}
         WHERE ${where.join(' AND ')}
       ), ranked AS (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY date DESC) AS rn,
           MAX(unread) OVER (PARTITION BY thread_id) AS thread_unread,
           MAX(COALESCE(priority, 1)) OVER (PARTITION BY thread_id) AS thread_priority
         FROM scoped
       )
       SELECT r.*, a.email AS account_email, a.color AS account_color,
         (SELECT COUNT(DISTINCT COALESCE(x.message_id, x.id)) FROM messages x JOIN mailboxes xb ON xb.id = x.mailbox_id
          WHERE x.thread_id = r.thread_id AND xb.special_use IS NOT 'trash') AS thread_count
       FROM ranked r JOIN accounts a ON a.id = r.account_id
       WHERE r.rn = 1
       ORDER BY ${order}
       LIMIT ? OFFSET ?`,
      ...params,
      limit + 1,
      offset,
    );

    const items = rows.slice(0, limit).map(
      (row): ThreadListItem => ({
        id: row.thread_id,
        accountId: row.account_id,
        accountEmail: row.account_email,
        accountColor: row.account_color,
        spaceId: row.space_id,
        subject: row.subject,
        snippet: row.snippet,
        summary: row.summary ?? '',
        from: { name: row.from_name || undefined, email: row.from_email },
        date: row.date,
        unread: row.thread_unread === 1,
        starred: row.starred === 1,
        count: row.thread_count,
        hasAttachments: json<AttachmentMeta[]>(row.attachments, []).some((a) => !a.inline),
        priority: Math.max(0, Math.min(3, row.thread_priority ?? 1)) as Priority,
        tags: json<string[]>(row.tags, []),
        businessId: row.business_id ?? null,
        spam: row.spam === 1 || row.special_use === 'junk',
        otp: row.otp ?? null,
        opportunity: row.opportunity === 1,
        newsletter: row.newsletter === 1,
        mailbox: row.special_use,
        latestMessageId: row.id,
      }),
    );
    return { items, nextOffset: rows.length > limit ? offset + limit : null };
  }

  /** One copy of each message of a conversation (Gmail shows a mail in several folders), by date. */
  private conversation(threadId: string) {
    const all = this.threadMessages(threadId);

    // Same RFC822 message seen in several folders (Gmail labels): keep the most meaningful copy.
    const rank = (special: string | null) =>
      ({ inbox: 0, sent: 1, drafts: 2, junk: 3, archive: 4, all: 5, trash: 6 })[special ?? ''] ?? 4;
    const byMessageId = new Map<string, (typeof all)[number]>();
    for (const msg of all) {
      const key = msg.message_id ?? msg.id;
      const current = byMessageId.get(key);
      if (!current || rank(msg.special_use) < rank(current.special_use)) byMessageId.set(key, msg);
    }
    let messages = [...byMessageId.values()].sort((a, b) => a.date - b.date);
    const live = messages.filter((m) => m.special_use !== 'trash');
    if (live.length > 0) messages = live;
    return messages;
  }

  /** Who answers whom in a conversation, in reading order; light enough to unfold it in the list. */
  replyTree(threadId: string) {
    const messages = this.conversation(threadId);
    const byId = new Map(messages.map((m) => [m.id, m]));
    return this.tree(messages).map((node) => {
      const m = byId.get(node.id)!;
      return {
        ...node,
        subject: m.subject,
        from: { name: m.from_name || undefined, email: m.from_email },
        date: m.date,
        unread: m.unread === 1,
        starred: m.starred === 1,
        isReply: Boolean(m.in_reply_to) || json<string[]>(m.refs, []).length > 0,
        hasAttachments: json<AttachmentMeta[]>(m.attachments, []).some((a) => !a.inline),
        mailbox: m.special_use,
      };
    });
  }

  private tree(messages: MessageRow[]): TreeNode[] {
    return buildReplyTree(
      messages.map((m) => ({ id: m.id, messageId: m.message_id, inReplyTo: m.in_reply_to, references: json<string[]>(m.refs, []), date: m.date })),
    );
  }

  /**
   * Regroups an account's (or every) conversations from the headers alone. Conversations split
   * by sync order or by an older ZMail are joined; returns how many messages moved.
   */
  repairThreads(accountId?: string) {
    const rows = this.db.all<{ id: string; account_id: string; thread_id: string; message_id: string | null; in_reply_to: string | null; refs: string; date: number }>(
      `SELECT id, account_id, thread_id, message_id, in_reply_to, refs, date FROM messages ${accountId ? 'WHERE account_id = ?' : ''}`,
      ...(accountId ? [accountId] : []),
    );
    let moved = 0;
    const byAccount = new Map<string, typeof rows>();
    for (const r of rows) byAccount.set(r.account_id, [...(byAccount.get(r.account_id) ?? []), r]);
    this.db.tx(() => {
      for (const list of byAccount.values()) {
        const byId = new Map(list.map((r) => [r.id, r]));
        const groups = groupConversations(list.map((r) => ({ id: r.id, messageId: r.message_id, inReplyTo: r.in_reply_to, references: json<string[]>(r.refs, []) })));
        for (const ids of groups) {
          const members = ids.map((id) => byId.get(id)!);
          if (new Set(members.map((m) => m.thread_id)).size < 2) continue;
          // The conversation keeps the id of its first mail, so open links stay valid for most.
          const keep = members.reduce((a, b) => (b.date < a.date ? b : a)).thread_id;
          for (const m of members) if (m.thread_id !== keep) (this.db.run('UPDATE messages SET thread_id = ? WHERE id = ?', keep, m.id), moved++);
        }
      }
    });
    return moved;
  }

  getThread(threadId: string): ThreadDetail | null {
    const messages = this.conversation(threadId);
    if (messages.length === 0) return null;
    const tree = this.tree(messages);
    const node = new Map(tree.map((n) => [n.id, n]));

    const views: MessageView[] = messages.map((m) => ({
      id: m.id,
      messageId: m.message_id,
      accountId: m.account_id,
      mailbox: m.special_use,
      from: { name: m.from_name || undefined, email: m.from_email },
      to: json<Address[]>(m.to_json, []),
      cc: json<Address[]>(m.cc_json, []),
      replyTo: m.reply_to,
      subject: m.subject,
      date: m.date,
      html: m.html_body,
      text: m.text_body,
      attachments: json<AttachmentMeta[]>(m.attachments, []),
      unread: m.unread === 1,
      starred: m.starred === 1,
      references: json<string[]>(m.refs, []),
      parentId: node.get(m.id)?.parentId ?? null,
      deliveredTo: m.delivered_to,
      auth: evaluateAuth(m.auth_results, m.from_email),
      depth: node.get(m.id)?.depth ?? 0,
      triage: toTriage(this.triage(m.id)),
    }));

    const incoming = views.filter((v) => v.mailbox !== 'sent' && v.mailbox !== 'drafts');
    const latest = (incoming.length ? incoming : views).at(-1)!;
    const triages = views.map((v) => v.triage).filter((t): t is Triage => t !== null);
    const account = this.db.get<{ email: string }>('SELECT email FROM accounts WHERE id = ?', latest.accountId);

    return {
      id: threadId,
      accountId: latest.accountId,
      accountEmail: account?.email ?? '',
      subject: normalizeSubject(views[0]!.subject) || views[0]!.subject,
      messages: views,
      tree,
      priority: (triages.length ? Math.max(...triages.map((t) => t.priority)) : 1) as Priority,
      tags: [...new Set(triages.flatMap((t) => t.tags))],
      businessId: latest.triage?.businessId ?? triages.find((t) => t.businessId)?.businessId ?? null,
      spam: latest.triage?.spam ?? false,
      spamReason: latest.triage?.spamReason ?? null,
      otp: latest.triage?.otp ?? null,
      opportunity: triages.some((t) => t.opportunity),
      opportunityReason: triages.find((t) => t.opportunityReason)?.opportunityReason ?? null,
      newsletter: latest.triage?.newsletter ?? false,
      unsubscribe: latest.triage?.unsubscribe ?? null,
      summary: latest.triage?.summary ?? '',
      starred: views.some((v) => v.starred),
      unread: views.some((v) => v.unread),
      mailbox: latest.mailbox,
    };
  }

  /** Unread counts for the sidebar, within one space (and per space, for the space switcher). */
  counts(spaceId?: string | null) {
    const row = (sql: string, ...params: SQLInputValue[]) => this.db.get<{ n: number }>(sql, ...params)?.n ?? 0;
    const scope = spaceId ? ` AND ${SPACE_EXPR} = ?` : '';
    const sp = spaceId ? [spaceId] : [];
    const base = `SELECT COUNT(DISTINCT m.thread_id) AS n FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
                  LEFT JOIN triage t ON t.message_id = m.id ${SPACE_JOINS} WHERE`;
    const views: Partial<Record<View, number>> = {};
    for (const view of ['inbox', 'priority', 'opportunities', 'otp', 'newsletters', 'spam', 'drafts'] as const) {
      views[view] = row(`${base} ${VIEW_SQL[view]} AND m.unread = 1${view === 'inbox' ? ` AND ${NOT_HIDDEN_FROM_INBOX}` : ''}${scope}`, ...sp);
    }
    const byBusiness = this.db.all<{ business_id: string; n: number }>(
      `SELECT t.business_id, COUNT(DISTINCT m.thread_id) AS n FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
       JOIN triage t ON t.message_id = m.id ${SPACE_JOINS} WHERE ${VIEW_SQL.inbox} AND m.unread = 1 AND t.business_id IS NOT NULL${scope}
       GROUP BY t.business_id`,
      ...sp,
    );
    const byTag = this.db.all<{ tag: string; n: number }>(
      `SELECT j.value AS tag, COUNT(DISTINCT m.thread_id) AS n FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
       JOIN triage t ON t.message_id = m.id ${SPACE_JOINS}, json_each(t.tags) j WHERE ${VIEW_SQL.inbox} AND m.unread = 1${scope} GROUP BY j.value`,
      ...sp,
    );
    // Per account, all spaces: clicking an account shows all of it.
    const byAccount = this.db.all<{ account_id: string; n: number }>(
      `SELECT m.account_id, COUNT(DISTINCT m.thread_id) AS n FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
       LEFT JOIN triage t ON t.message_id = m.id WHERE ${VIEW_SQL.inbox} AND m.unread = 1 GROUP BY m.account_id`,
    );
    // Unread inbox per space: the badges of the space switcher.
    const bySpace = this.db.all<{ space: string; n: number }>(
      `SELECT ${SPACE_EXPR} AS space, COUNT(DISTINCT m.thread_id) AS n FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
       LEFT JOIN triage t ON t.message_id = m.id ${SPACE_JOINS} WHERE ${VIEW_SQL.inbox} AND m.unread = 1 GROUP BY space`,
    );
    // Unread per server folder (the user's own folders and labels, shown under each account).
    const byMailbox = this.db.all<{ mailbox_id: string; n: number }>(
      `SELECT m.mailbox_id, COUNT(DISTINCT m.thread_id) AS n FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id
       WHERE mb.special_use IS NULL AND m.unread = 1 GROUP BY m.mailbox_id`,
    );
    return {
      views,
      mailboxes: Object.fromEntries(byMailbox.map((r) => [r.mailbox_id, r.n])),
      businesses: Object.fromEntries(byBusiness.map((r) => [r.business_id, r.n])),
      tags: Object.fromEntries(byTag.map((r) => [r.tag, r.n])),
      accounts: Object.fromEntries(byAccount.map((r) => [r.account_id, r.n])),
      spaces: Object.fromEntries(bySpace.map((r) => [r.space, r.n])),
    };
  }
}
