import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ApiError, DeveloperApi, type ThreadAction } from '../developer/api';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ThreadDetail, ThreadListItem } from '../types';
import type { ApiKey } from '../developer/keys';
import type { EngineContext } from '../context';
import { VIEWS } from '../types';
import { z } from 'zod';
import { t } from '../lib/i18n';

const VERSION = '0.1.0';
const MAX_BODY = 20_000;

/** What a model needs from a thread row, without the UI-only fields. */
const compactItem = (t: ThreadListItem) => ({
  thread_id: t.id,
  subject: t.subject,
  from: t.from.name ? `${t.from.name} <${t.from.email}>` : t.from.email,
  date: new Date(t.date).toISOString(),
  account: t.accountEmail,
  unread: t.unread,
  starred: t.starred,
  messages: t.count,
  priority: t.priority,
  tags: t.tags,
  business_id: t.businessId,
  summary: t.summary || undefined,
  snippet: t.snippet,
  latest_message_id: t.latestMessageId,
});

const compactThread = (thread: ThreadDetail) => ({
  thread_id: thread.id,
  subject: thread.subject,
  account: thread.accountEmail,
  account_id: thread.accountId,
  tags: thread.tags,
  business_id: thread.businessId,
  summary: thread.summary || undefined,
  messages: thread.messages.map((m) => ({
    message_id: m.id,
    from: m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email,
    to: m.to.map((a) => a.email),
    cc: m.cc.map((a) => a.email),
    date: new Date(m.date).toISOString(),
    subject: m.subject,
    folder: m.mailbox,
    attachments: m.attachments.filter((a) => !a.inline).map((a) => a.filename),
    text: m.text.length > MAX_BODY ? `${m.text.slice(0, MAX_BODY)}\n${t('[… tronqué]')}` : m.text,
  })),
});

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string) => ({
  content: [{ type: 'text' as const, text: message }],
  isError: true,
});

async function run(fn: () => unknown | Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (error) {
    if (error instanceof ApiError || error instanceof z.ZodError) return fail(error.message);
    return fail(t('Erreur ZMail : {message}', { message: (error as Error).message }));
  }
}

const threadIdsArg = {
  thread_ids: z.array(z.string()).min(1).describe('Conversation ids (thread_id)'),
};

/**
 * One MCP server per request (stateless Streamable HTTP): tools are those the key's scopes
 * allow, so a read-only key never even sees the write tools.
 */
export function createMcpServer(engine: EngineContext, key: ApiKey) {
  const api = new DeveloperApi(engine);
  const canWrite = key.scopes.includes('write');
  const server = new McpServer(
    { name: 'zmail', title: 'ZMail', version: VERSION },
    {
      instructions:
        'ZMail is the user’s local mail client (several accounts, unified inbox, AI triage). Use search_mail / list_threads to find conversations, read_thread to read one. ' +
        'To improve how ZMail sorts mail: triage_report (mistakes), get_ai_setup (current instructions), evaluate_triage (measure a change), then update_ai_prompt. ' +
        'To understand the user’s habits and propose rules: behavior_analytics (shares per sender, domain, list, category…, habits above a threshold with the rule that would automate each), activity_log for the raw gestures. ' +
        (canWrite
          ? 'Write tools act on the user’s real mailboxes: confirm with the user before sending mail or trashing.'
          : 'This key is read-only.'),
    },
  );
  const read = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    'list_accounts',
    {
      title: t('Comptes'),
      description: 'List the mail accounts connected to ZMail (id, email, name, sync status).',
      annotations: read,
    },
    () =>
      run(() =>
        api
          .accounts()
          .map((a) => ({
            id: a.id,
            email: a.email,
            name: a.name,
            provider: a.provider,
            aliases: a.aliases,
            status: a.status,
            last_error: a.lastError,
          })),
      ),
  );

  server.registerTool(
    'list_tags',
    {
      title: t('Tags'),
      description: 'List tags (id, name, description) and businesses usable as filters.',
      annotations: read,
    },
    () =>
      run(() => ({
        tags: api
          .tags()
          .map((t) => ({ id: t.id, name: t.name, description: t.description, kind: t.kind })),
        businesses: api
          .businesses()
          .map((b) => ({ id: b.id, name: b.name, description: b.description })),
      })),
  );

  server.registerTool(
    'search_mail',
    {
      title: t('Rechercher'),
      description:
        'Full-text search (subject, sender, body) across inbox, archive and sent mail. Returns conversations, newest first.',
      inputSchema: {
        query: z.string().min(1).describe('Words to search, e.g. "facture OVH"'),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: read,
    },
    ({ query, limit }) => run(() => api.search(query, limit).items.map(compactItem)),
  );

  server.registerTool(
    'list_threads',
    {
      title: t('Conversations'),
      description:
        'List conversations of a view (inbox, priority, opportunities, otp, newsletters, unread, starred, sent, drafts, archive, spam, trash), optionally filtered.',
      inputSchema: {
        view: z.enum(VIEWS).default('inbox'),
        tag: z.string().optional().describe('Tag id (see list_tags)'),
        business: z.string().optional().describe('Business id (see list_tags)'),
        account: z.string().optional().describe('Account id (see list_accounts)'),
        unread_only: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(25),
        cursor: z.number().int().min(0).optional().describe('next_cursor of the previous page'),
      },
      annotations: read,
    },
    ({ view, tag, business, account, unread_only, limit, cursor }) =>
      run(() => {
        const page = api.threads({
          view,
          tagId: tag,
          businessId: business,
          accountId: account,
          unreadOnly: unread_only,
          limit,
          cursor,
        });
        return { threads: page.items.map(compactItem), next_cursor: page.nextCursor };
      }),
  );

  server.registerTool(
    'read_thread',
    {
      title: t('Lire'),
      description:
        'Read a whole conversation: every message with sender, recipients, date and plain-text body.',
      inputSchema: { thread_id: z.string() },
      annotations: read,
    },
    ({ thread_id }) => run(() => compactThread(api.thread(thread_id))),
  );

  // ── AI setup: lets an MCP client (Claude, Cursor…) audit and improve ZMail's own sorting ──
  server.registerTool(
    'get_ai_setup',
    {
      title: t('Réglages IA'),
      description:
        'How ZMail’s AI actions are set up: for each action (triage, chat, unsubscribe) the models the route uses, the editable instructions, the fixed reply contract, and for triage the typed questions Jev answers (with how ZMail uses each one) and the decision thresholds. Read this before evaluating or editing.',
      annotations: read,
    },
    () => run(() => engine.lab.setup()),
  );

  server.registerTool(
    'triage_report',
    {
      title: t('Erreurs de tri'),
      description: 'Every correction the user made to the AI’s sorting in the last N days (taken out of spam, tag removed, priority changed…), with the model that had sorted each mail.',
      inputSchema: { days: z.number().int().min(1).max(365).default(30) },
      annotations: read,
    },
    ({ days }) => run(() => engine.lab.report(days)),
  );

  server.registerTool(
    'behavior_analytics',
    {
      title: t('Habitudes'),
      description:
        'The user’s habits as a data analyst would read them, over the last N days. overview: share of conversations opened, decided, archived, deleted, filed, left untouched; share deleted without being opened; median reading time before each decision. ' +
        'dimensions: one probability table per sender, domain, list, category, business, account, space, newsletter and priority (n, opened share, average reading time, share of each outcome, top folder or space). ' +
        'habits: groups where one outcome reaches the threshold (default 70 %) on at least minSupport mails, with a Wilson confidence, the lift against the whole mailbox, whether it is safe to automate and the ready rule (create it with create_rule only after the user agrees). ' +
        'graph: sources and categories linked to outcomes and folders, weighted. Outcomes: archive, trash, spam, folder, space, tag, read (opened, nothing decided), markRead, untouched.',
      inputSchema: {
        days: z.number().int().min(7).max(365).default(90),
        threshold: z.number().min(0.5).max(1).default(0.7).describe('Share of a group above which an outcome counts as a habit.'),
        min_support: z.number().int().min(2).max(50).default(3).describe('Minimum number of mails behind a habit.'),
        dimensions: z.array(z.enum(['sender', 'domain', 'list', 'category', 'business', 'account', 'space', 'newsletter', 'priority'])).optional().describe('Only these probability tables (all by default).'),
        top: z.number().int().min(1).max(200).default(25).describe('Rows per table.'),
      },
      annotations: read,
    },
    ({ days, threshold, min_support, dimensions, top }) =>
      run(() => {
        const a = engine.behavior.analyze({ days, threshold, minSupport: min_support });
        const wanted = dimensions ?? (Object.keys(a.dimensions) as (keyof typeof a.dimensions)[]);
        return { ...a, dimensions: Object.fromEntries(wanted.map((d) => [d, a.dimensions[d].slice(0, top)])) };
      }),
  );

  server.registerTool(
    'activity_log',
    {
      title: t('Journal d’activité'),
      description:
        'The raw gestures, newest first: action (open, view, archive, trash, spam, moveToFolder, moveToSpace, addTag, star, reply, unsubscribe, search, openLink, downloadAttachment, copyOtp…), sender, subject, and the context of each: opened in ZMail before (opened), reading time (dwell_ms: for « view » that reading, otherwise all readings before), age of the mail (age_ms), mailbox it was in, conversations in the same gesture (batch).',
      inputSchema: { limit: z.number().int().min(1).max(1000).default(200), offset: z.number().int().min(0).default(0), include_reads: z.boolean().default(false).describe('Include every « view » and search.') },
      annotations: read,
    },
    ({ limit, offset, include_reads }) => run(() => engine.patterns.history(limit, offset, include_reads)),
  );

  if (!canWrite) return server;

  const jevQuestions = z
    .record(z.object({ instructions: z.string(), yes: z.string(), no: z.string() }))
    .describe('Jev questions to change, by existing id (see get_ai_setup); the others keep their wording.');
  const jevThresholds = z.object({ yes: z.number().min(0.5).max(0.95), lean: z.number().min(0.3).max(0.95) }).describe('Probability above which a Jev answer counts as yes / leaning yes.');

  /** The current instructions with a candidate change applied (nothing is saved). */
  const withChange = (args: { llm_prompt?: string; jev_questions?: Record<string, { instructions: string; yes: string; no: string }>; jev_thresholds?: { yes: number; lean: number } }) => {
    const current = engine.prompts.get();
    return {
      ...current,
      triage: {
        llm: args.llm_prompt ?? current.triage.llm,
        jev: { questions: { ...current.triage.jev.questions, ...(args.jev_questions ?? {}) }, thresholds: args.jev_thresholds ?? current.triage.jev.thresholds },
      },
    };
  };

  server.registerTool(
    'evaluate_triage',
    {
      title: t('Mesurer le tri'),
      description:
        'Measure a version of the triage instructions without saving it: runs it on ZMail’s 85 labelled reference mails and on the user’s own mail (their corrections and their provider’s Spam folder are the truth). Returns the scores, every mistake, latency and cost. Leave all inputs empty to measure the current version. Calls the AI provider (a few cents at most).',
      inputSchema: {
        llm_prompt: z.string().optional().describe('Editable triage instructions for LLMs; must keep {{tags}}.'),
        jev_questions: jevQuestions.optional(),
        jev_thresholds: jevThresholds.optional(),
        provider_id: z.string().optional().describe('Service id (see get_ai_setup route) to test another model; default: the current route.'),
        model: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      run(() =>
        engine.lab.evaluate({ prompts: withChange(args), route: args.provider_id && args.model ? { providerId: args.provider_id, model: args.model } : null }),
      ),
  );

  server.registerTool(
    'update_ai_prompt',
    {
      title: t('Modifier un prompt'),
      description:
        'Save new instructions for an AI action. triage accepts llm_prompt (LLM format) and/or jev_questions + jev_thresholds (Jev format); chat and unsubscribe accept llm_prompt. The previous version stays in the history. Measure with evaluate_triage first and tell the user what changed.',
      inputSchema: {
        action: z.enum(['triage', 'chat', 'unsubscribe']),
        llm_prompt: z.string().optional(),
        jev_questions: jevQuestions.optional(),
        jev_thresholds: jevThresholds.optional(),
        note: z.string().describe('Why, in one sentence (shown in the history).'),
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (args) =>
      run(() => {
        if (args.llm_prompt) engine.prompts.save(args.action, 'llm', args.llm_prompt, { by: 'mcp', note: args.note });
        if (args.action === 'triage' && (args.jev_questions || args.jev_thresholds)) engine.prompts.save('triage', 'jev', withChange(args).triage.jev, { by: 'mcp', note: args.note });
        return engine.lab.setup();
      }),
  );

  server.registerTool(
    'reset_ai_prompt',
    {
      title: t('Rétablir un prompt'),
      description: 'Put an AI action back to ZMail’s default instructions (the current version stays in the history).',
      inputSchema: { action: z.enum(['triage', 'chat', 'unsubscribe']), format: z.enum(['llm', 'jev']).default('llm') },
      annotations: { idempotentHint: true, openWorldHint: false },
    },
    ({ action, format }) => run(() => (engine.prompts.reset(action, action === 'triage' ? format : 'llm'), engine.lab.setup())),
  );

  server.registerTool(
    'improve_triage',
    {
      title: t('Améliorer le tri'),
      description:
        'Let ZMail propose a better version of the triage instructions from its recent mistakes, measured before and after on the same mails. The proposal is kept as a draft; apply it with apply_triage_draft only if the user agrees.',
      inputSchema: { goal: z.string().optional().describe('What the user wants improved, in their words.') },
      annotations: { openWorldHint: true },
    },
    ({ goal }) => run(async () => {
      const r = await engine.lab.improve({ goal, by: 'mcp' });
      return { message: r.message, draft: r.draft, before: r.before.overall, after: r.after?.overall ?? null };
    }),
  );

  server.registerTool(
    'apply_triage_draft',
    {
      title: t('Appliquer la proposition'),
      description: 'Put the pending triage draft (from improve_triage) live. The previous version stays in the history.',
      annotations: { idempotentHint: false, openWorldHint: false },
    },
    () => run(() => (engine.lab.applyDraft('mcp'), engine.lab.setup())),
  );


  server.registerTool(
    'send_mail',
    {
      title: t('Envoyer'),
      description:
        'Send an email from one of the user’s accounts. For a reply, pass in_reply_to_message_id (a message_id from read_thread) so it stays in the thread.',
      inputSchema: {
        account_id: z.string().describe('Sending account id (see list_accounts)'),
        to: z.array(z.string().email()).min(1),
        cc: z.array(z.string().email()).optional(),
        subject: z.string(),
        text: z.string().optional().describe('Plain-text body'),
        html: z
          .string()
          .optional()
          .describe('HTML body (takes precedence over text for rendering)'),
        in_reply_to_message_id: z.string().optional(),
      },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    (args) =>
      run(() =>
        api.send({
          accountId: args.account_id,
          to: args.to,
          cc: args.cc,
          subject: args.subject,
          text: args.text,
          html: args.html,
          inReplyToMessageId: args.in_reply_to_message_id,
        }),
      ),
  );

  const action = (
    name: string,
    title: string,
    description: string,
    toAction: (on: boolean) => ThreadAction,
    toggle?: string,
    destructive = false,
  ) =>
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: toggle
          ? { ...threadIdsArg, [toggle]: z.boolean().default(true) }
          : threadIdsArg,
        annotations: { destructiveHint: destructive, idempotentHint: true, openWorldHint: false },
      },
      (args: Record<string, unknown>) =>
        run(() =>
          api.act({
            threadIds: args.thread_ids as string[],
            action: toAction(toggle ? (args[toggle] as boolean) : true),
          }),
        ),
    );

  action(
    'archive_threads',
    t('Archiver'),
    'Archive conversations (remove them from the inbox).',
    () => 'archive',
  );
  action(
    'mark_read',
    t('Marquer comme lu'),
    'Mark conversations read (read=false to mark unread).',
    (on) => (on ? 'read' : 'unread'),
    'read',
  );
  action(
    'star_threads',
    t('Étoiler'),
    'Star conversations (starred=false to unstar).',
    (on) => (on ? 'star' : 'unstar'),
    'starred',
  );
  action(
    'trash_threads',
    t('Corbeille'),
    'Move conversations to the trash.',
    () => 'trash',
    undefined,
    true,
  );
  action(
    'mark_spam',
    t('Spam'),
    'Mark conversations as spam (spam=false to mark them as not spam).',
    (on) => (on ? 'spam' : 'notSpam'),
    'spam',
  );

  server.registerTool(
    'tag_threads',
    {
      title: t('Taguer'),
      description:
        'Add a tag to conversations (remove=true to remove it). Tag id or name from list_tags.',
      inputSchema: { ...threadIdsArg, tag: z.string(), remove: z.boolean().default(false) },
      annotations: { idempotentHint: true, openWorldHint: false },
    },
    ({ thread_ids, tag, remove }) =>
      run(() => api.act({ threadIds: thread_ids, action: remove ? 'untag' : 'tag', tagId: tag })),
  );

  server.registerTool(
    'ask_inbox',
    {
      title: t('Demander à ZMail'),
      description:
        'Ask ZMail’s built-in mail assistant in natural language (French or English): summaries, important mail, and also standing automations ' +
        '(“notifie-moi des chargebacks”, “archive toujours @medium.com”, unsubscribe). It may create tags, rules or unsubscribe.',
      inputSchema: { question: z.string().min(1) },
      annotations: { openWorldHint: false },
    },
    ({ question }) =>
      run(async () => {
        const reply = await engine.agent.chat(question, []);
        return {
          reply: reply.reply,
          steps: reply.steps,
          threads: reply.threads.map(compactItem),
          engine: reply.engine,
        };
      }),
  );

  return server;
}

/** Handles one Streamable HTTP request (POST JSON-RPC); GET/DELETE have no session to serve. */
export async function handleMcpRequest(
  engine: EngineContext,
  key: ApiKey,
  request: Request,
): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json(
      {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed (stateless server: use POST)' },
        id: null,
      },
      { status: 405, headers: { allow: 'POST' } },
    );
  }
  const server = createMcpServer(engine, key);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, {
      authInfo: { token: key.prefix, clientId: key.id, scopes: key.scopes },
    });
  } finally {
    // JSON responses are complete once returned; release the per-request server.
    void server.close().catch(() => undefined);
  }
}
