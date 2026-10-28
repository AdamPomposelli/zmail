import { publicAccount } from '../mail/accounts';
import type { EngineContext } from '../context';
import type { ThreadListItem } from '../types';
import { VIEWS } from '../types';
import { z } from 'zod';
import { t } from '../lib/i18n';

/**
 * Operations exposed to developers (REST /api/v1 and MCP). Thin adapters over the engine
 * services (store, actions, catalog) so both surfaces behave exactly like the app.
 * Actions run as `agent`: they are applied but never learned from as user habits.
 */

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 500,
    message: string,
  ) {
    super(message);
  }
}

export const ListThreadsInput = z.object({
  view: z.enum(VIEWS).default('inbox'),
  tagId: z.string().nullish(),
  businessId: z.string().nullish(),
  accountId: z.string().nullish(),
  mailboxId: z.string().nullish(),
  query: z.string().nullish(),
  unreadOnly: z.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.coerce.number().int().min(0).nullish(),
});
export type ListThreadsInput = z.input<typeof ListThreadsInput>;

export const SendInput = z
  .object({
    accountId: z.string().min(1),
    to: z.array(z.string().email()).min(1),
    cc: z.array(z.string().email()).default([]),
    bcc: z.array(z.string().email()).default([]),
    subject: z.string(),
    html: z.string().optional(),
    text: z.string().optional(),
    inReplyToMessageId: z.string().nullish(),
  })
  .refine(
    (v) => v.html !== undefined || v.text !== undefined,
    () => ({ message: t('html ou text est requis') }),
  );
export type SendInput = z.input<typeof SendInput>;

export const THREAD_ACTIONS = [
  'archive',
  'read',
  'unread',
  'star',
  'unstar',
  'trash',
  'spam',
  'notSpam',
  'tag',
  'untag',
] as const;
export type ThreadAction = (typeof THREAD_ACTIONS)[number];

export const ActionInput = z
  .object({
    threadIds: z.array(z.string().min(1)).min(1).max(500),
    action: z.enum(THREAD_ACTIONS),
    tagId: z.string().optional(),
  })
  .refine(
    (v) => (v.action !== 'tag' && v.action !== 'untag') || Boolean(v.tagId),
    () => ({ message: t('tagId est requis pour tag/untag'), path: ['tagId'] }),
  );
export type ActionInput = z.input<typeof ActionInput>;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textToHtml = (text: string) => `<div>${escapeHtml(text).replace(/\r?\n/g, '<br>')}</div>`;

export class DeveloperApi {
  constructor(private readonly engine: EngineContext) {}

  accounts() {
    return this.engine.accounts.list().map((a) => {
      const {
        imapHost: _ih,
        imapPort: _ip,
        imapSecure: _is,
        smtpHost: _sh,
        smtpPort: _sp,
        smtpSecure: _ss,
        username: _u,
        signature: _sig,
        ...account
      } = publicAccount(a);
      return account;
    });
  }

  tags() {
    return this.engine.catalog.tags();
  }

  businesses() {
    return this.engine.catalog.businesses();
  }

  threads(input: ListThreadsInput) {
    const filters = ListThreadsInput.parse(input);
    // The dedicated view is exact (and paginates correctly); other views are filtered after.
    const view = filters.unreadOnly && filters.view === 'inbox' ? 'unread' : filters.view;
    const page = this.engine.store.listThreads({
      ...filters,
      view,
      sort: 'date',
      offset: filters.cursor ?? 0,
    });
    const items = filters.unreadOnly ? page.items.filter((t) => t.unread) : page.items;
    return { items, nextCursor: page.nextOffset };
  }

  thread(id: string) {
    const thread = this.engine.store.getThread(id);
    if (!thread) throw new ApiError(404, t('Conversation introuvable'));
    return thread;
  }

  /** Full-text search across inbox, archive and sent mail, newest first. */
  search(query: string, limit = 25) {
    const q = query.trim();
    if (!q) throw new ApiError(400, t('Paramètre q requis'));
    const found = new Map<string, ThreadListItem>();
    for (const view of ['inbox', 'archive', 'sent'] as const) {
      for (const item of this.engine.store.listThreads({ view, query: q, sort: 'date', limit })
        .items) {
        if (!found.has(item.id)) found.set(item.id, item);
      }
    }
    return { items: [...found.values()].sort((a, b) => b.date - a.date).slice(0, limit) };
  }

  async send(input: SendInput) {
    const mail = SendInput.parse(input);
    if (!this.engine.accounts.get(mail.accountId))
      throw new ApiError(404, t('Compte d’envoi introuvable'));
    if (mail.inReplyToMessageId && !this.engine.store.message(mail.inReplyToMessageId))
      throw new ApiError(404, t('Message de réponse introuvable'));
    await this.engine.actions.send(
      {
        ...mail,
        html: mail.html ?? textToHtml(mail.text ?? ''),
        text: mail.text ?? undefined,
        cc: mail.cc,
        bcc: mail.bcc,
      },
      'agent',
    );
    return { ok: true };
  }

  async act(input: ActionInput) {
    const { threadIds: requested, action, tagId } = ActionInput.parse(input);
    const threadIds = [...new Set(requested)].filter(
      (id) => this.engine.store.threadMessages(id).length > 0,
    );
    const missing = requested.filter((id) => !threadIds.includes(id));
    if (threadIds.length === 0) throw new ApiError(404, t('Aucune conversation trouvée'));
    const actions = this.engine.actions;
    switch (action) {
      case 'archive':
        await actions.archive(threadIds, 'agent');
        break;
      case 'read':
      case 'unread':
        await actions.markRead(threadIds, action === 'read', 'agent');
        break;
      case 'star':
      case 'unstar':
        await actions.star(threadIds, action === 'star', 'agent');
        break;
      case 'trash':
        await actions.trash(threadIds, 'agent');
        break;
      case 'spam':
        await actions.spam(threadIds, 'agent');
        break;
      case 'notSpam':
        await actions.notSpam(threadIds, 'agent');
        break;
      case 'tag':
      case 'untag': {
        const tag = this.engine.catalog.findTag(tagId!);
        if (!tag) throw new ApiError(404, t('Tag introuvable : {id}', { id: tagId ?? '' }));
        actions.setTags(
          threadIds,
          action === 'tag' ? [tag.id] : [],
          action === 'untag' ? [tag.id] : [],
          'agent',
        );
        break;
      }
    }
    return { ok: true, action, threadIds, missing };
  }
}
