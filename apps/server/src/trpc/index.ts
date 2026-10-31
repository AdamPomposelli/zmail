import { initTRPC, TRPCError } from '@trpc/server';
import { messageDetails, messageSource } from '../mail/details';
import { PRESET_IDS, PRESET_MEASURES } from '../ai/presets';
import { isIconValue } from '../lib/icons';
import superjson from 'superjson';
import { z } from 'zod';
import type { EngineContext } from '../context';
import { VIEWS } from '../types';
import { PRESETS, detectPreset } from '../mail/presets';
import { discoverServers } from '../mail/discovery';
import { publicAccount } from '../mail/accounts';
import { isZmailFolder } from '../mail/imap';
import { type ProviderConfig } from '../ai/providers';
import { CAPABILITIES, CAPABILITY_IDS, type Capability } from '../ai/capabilities';
import { PROVIDER_KINDS, type ProviderKind } from '../ai/catalog';
import { BENCHMARKS, rankBenchmarks } from '../ai/recommendations';
import { appleGuidance } from '../ai/apple';
import { callsPerDay, mailVolume, monthlyCost, tokensPerCall } from '../ai/forecast';
import { RuleInputSchema } from '../rules/engine';
import { newId } from '../lib/ids';
import { SCOPES } from '../developer/keys';
import { developerInfo } from '../developer/info';
import { MCP_CLIENTS, installClient, listClients } from '../developer/install';
import { t } from '../lib/i18n';

export type TrpcContext = { engine: EngineContext };

const trpc = initTRPC.context<TrpcContext>().create({ transformer: superjson });
const router = trpc.router;
const procedure = trpc.procedure.use(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: (error as Error).message, cause: error });
  }
});

const threadIds = z.object({ threadIds: z.array(z.string()).min(1) });
const priority = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

const accountFields = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  provider: z.string(),
  imapHost: z.string().min(1),
  imapPort: z.number().int(),
  imapSecure: z.boolean(),
  smtpHost: z.string().min(1),
  smtpPort: z.number().int(),
  smtpSecure: z.boolean(),
  username: z.string().min(1),
  password: z.string().min(1),
  color: z.string().optional(),
  businessId: z.string().nullable().optional(),
  kind: z.enum(['business', 'personal']).nullable().optional(),
  aliases: z.array(z.string()).optional(),
  syncDays: z.number().int().min(1).max(3650).optional(),
});

/** The account worker that owns a folder. */
const workerOfMailbox = (engine: EngineContext, mailboxId: string) => {
  const box = engine.db.get<{ account_id: string }>('SELECT account_id FROM mailboxes WHERE id = ?', mailboxId);
  if (!box) throw new TRPCError({ code: 'NOT_FOUND', message: t('Dossier introuvable') });
  return engine.accounts.worker(box.account_id);
};

const accountsRouter = router({
  /** Sidebar group (drag & drop): personal also unlinks the account from its business. */
  setKind: procedure.input(z.object({ id: z.string(), kind: z.enum(['business', 'personal']).nullable() })).mutation(({ ctx, input }) => {
    ctx.engine.accounts.setKind(input.id, input.kind);
    if (input.kind === 'personal' && ctx.engine.accounts.get(input.id)?.businessId) {
      ctx.engine.catalog.setAccountBusiness(input.id, null);
      ctx.engine.spaces.syncBusinesses([input.id]);
    }
  }),
  setIcon: procedure.input(z.object({ id: z.string(), icon: z.string().max(400_000).nullable() })).mutation(({ ctx, input }) => ctx.engine.accounts.setIcon(input.id, input.icon)),
  siteLogo: procedure.input(z.object({ domain: z.string().max(253) })).mutation(({ ctx, input }) => ctx.engine.accounts.siteLogo(input.domain)),
  /** « Se connecter avec Microsoft » (Outlook.com, Hotmail, Microsoft 365: passwords are refused). */
  microsoftClientId: procedure.query(({ ctx }) => ctx.engine.oauth.clientId()),
  setMicrosoftClientId: procedure.input(z.object({ clientId: z.string().trim().regex(/^[0-9a-f-]{36}$/i, 'ID d’application invalide (format 00000000-0000-0000-0000-000000000000)') })).mutation(({ ctx, input }) => ctx.engine.oauth.setClientId(input.clientId)),
  checkMicrosoftClientId: procedure.input(z.object({ clientId: z.string().trim().regex(/^[0-9a-f-]{36}$/i) })).mutation(({ ctx, input }) => ctx.engine.oauth.checkClientId(input.clientId)),
  /** Back to ZMail's own app ID. */
  resetMicrosoftClientId: procedure.mutation(({ ctx }) => ctx.engine.oauth.setClientId(null)),
  microsoftStart: procedure.input(z.object({ email: z.string().optional() })).mutation(({ ctx, input }) => ctx.engine.oauth.start(input.email)),
  microsoftStatus: procedure.input(z.object({ state: z.string() })).query(({ ctx, input }) => ctx.engine.oauth.status(input.state)),
  progress: procedure.query(({ ctx }) => ctx.engine.accounts.progress()),
  list: procedure.query(({ ctx }) => ctx.engine.accounts.list().map(publicAccount)),
  presets: procedure.query(() => PRESETS),
  detect: procedure.input(z.object({ email: z.string() })).query(({ input }) => detectPreset(input.email)),
  discover: procedure.input(z.object({ email: z.string().email() })).mutation(({ input }) => discoverServers(input.email)),
  test: procedure
    .input(accountFields.pick({ imapHost: true, imapPort: true, imapSecure: true, smtpHost: true, smtpPort: true, smtpSecure: true, username: true, password: true }))
    .mutation(({ ctx, input }) => ctx.engine.accounts.test(input)),
  testExisting: procedure
    .input(z.object({ id: z.string(), patch: accountFields.pick({ imapHost: true, imapPort: true, imapSecure: true, smtpHost: true, smtpPort: true, smtpSecure: true, username: true }).partial().extend({ password: z.string().optional() }) }))
    .mutation(({ ctx, input }) => ctx.engine.accounts.testExisting(input.id, input.patch)),
  create: procedure.input(accountFields).mutation(async ({ ctx, input }) => publicAccount(await ctx.engine.accounts.create(input))),
  update: procedure
    .input(z.object({ id: z.string(), patch: accountFields.partial().extend({ signature: z.string().optional(), password: z.string().optional(), label: z.string().max(60).nullable().optional() }) }))
    .mutation(async ({ ctx, input }) => {
      const patch = { ...input.patch };
      if (!patch.password) delete patch.password;
      const account = publicAccount(await ctx.engine.accounts.update(input.id, patch));
      // The account's business, as chosen in its settings, decides for its mail (« Personnel » = none).
      if (input.patch.businessId !== undefined) {
        ctx.engine.catalog.setAccountBusiness(input.id, input.patch.businessId);
        ctx.engine.spaces.syncBusinesses([input.id]);
        // Linked to a business: under « Business » in the sidebar; « Personnel » otherwise.
        ctx.engine.accounts.setKind(input.id, input.patch.businessId ? 'business' : 'personal');
      }
      return account;
    }),
  remove: procedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => ctx.engine.accounts.remove(input.id)),
  resync: procedure.input(z.object({ id: z.string().optional() })).mutation(({ ctx, input }) => ctx.engine.accounts.resync(input.id)),
  /** Every account's server folders and Gmail labels, except ZMail's own tag mirror. */
  folders: procedure.query(({ ctx }) =>
    ctx.engine.db
      .all<{ id: string; account_id: string; path: string; name: string; special_use: string | null; delimiter: string | null }>(
        'SELECT id, account_id, path, name, special_use, delimiter FROM mailboxes ORDER BY path COLLATE NOCASE',
      )
      .filter((m) => !isZmailFolder(m.path, m.delimiter))
      .map((m) => ({ id: m.id, accountId: m.account_id, path: m.path, name: m.name, specialUse: m.special_use, delimiter: m.delimiter })),
  ),
  syncFolder: procedure.input(z.object({ accountId: z.string(), mailboxId: z.string() })).mutation(({ ctx, input }) => ctx.engine.accounts.worker(input.accountId).syncFolder(input.mailboxId)),
  /** Moves a folder under another one (or to the top level), on the server too. */
  /** Folder management, mirrored on the server: move, rename, create, delete, mark all read. */
  moveFolder: procedure
    .input(z.object({ mailboxId: z.string(), parentId: z.string().nullable() }))
    .mutation(({ ctx, input }) => workerOfMailbox(ctx.engine, input.mailboxId).moveFolder(input.mailboxId, input.parentId)),
  renameFolder: procedure
    .input(z.object({ mailboxId: z.string(), name: z.string().min(1).max(200) }))
    .mutation(({ ctx, input }) => workerOfMailbox(ctx.engine, input.mailboxId).renameFolder(input.mailboxId, input.name)),
  createFolder: procedure
    .input(z.object({ accountId: z.string(), parentId: z.string().nullable(), name: z.string().min(1).max(200) }))
    .mutation(({ ctx, input }) => ctx.engine.accounts.worker(input.accountId).createFolder(input.parentId, input.name)),
  deleteFolder: procedure
    .input(z.object({ mailboxId: z.string(), toTrash: z.boolean().default(true) }))
    .mutation(({ ctx, input }) => workerOfMailbox(ctx.engine, input.mailboxId).deleteFolder(input.mailboxId, { toTrash: input.toTrash })),
  markFolderRead: procedure.input(z.object({ mailboxId: z.string() })).mutation(({ ctx, input }) => workerOfMailbox(ctx.engine, input.mailboxId).markFolderRead(input.mailboxId)),
  /** What deleting a folder would remove: the folder, its subfolders, the mails ZMail has of them. */
  folderContents: procedure.input(z.object({ mailboxId: z.string() })).query(({ ctx, input }) => {
    const box = ctx.engine.db.get<{ path: string; delimiter: string | null; account_id: string }>('SELECT path, delimiter, account_id FROM mailboxes WHERE id = ?', input.mailboxId);
    if (!box) throw new TRPCError({ code: 'NOT_FOUND', message: t('Dossier introuvable') });
    const prefix = `${box.path}${box.delimiter ?? '/'}`;
    const ids = ctx.engine.db
      .all<{ id: string; path: string }>('SELECT id, path FROM mailboxes WHERE account_id = ?', box.account_id)
      .filter((m) => m.path === box.path || m.path.startsWith(prefix))
      .map((m) => m.id);
    const mails = ctx.engine.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM messages WHERE mailbox_id IN (${ids.map(() => '?').join(',')})`, ...ids)?.n ?? 0;
    return { subfolders: ids.length - 1, mails };
  }),
  loadOlder: procedure.input(z.object({ mailboxId: z.string() })).mutation(({ ctx, input }) => {
    const box = ctx.engine.db.get<{ account_id: string }>('SELECT account_id FROM mailboxes WHERE id = ?', input.mailboxId);
    if (!box) throw new TRPCError({ code: 'NOT_FOUND', message: 'Dossier introuvable' });
    return ctx.engine.accounts.worker(box.account_id).loadOlder(input.mailboxId);
  }),
});

const mailRouter = router({
  list: procedure
    .input(
      z.object({
        view: z.enum(VIEWS).default('inbox'),
        businessId: z.string().nullish(),
        tagId: z.string().nullish(),
        accountId: z.string().nullish(),
        mailboxId: z.string().nullish(),
        spaceId: z.string().nullish(),
        query: z.string().nullish(),
        sort: z.enum(['smart', 'date']).default('smart'),
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(200).default(50),
      }),
    )
    .query(({ ctx, input }) => {
      const page = ctx.engine.store.listThreads({ ...input, offset: input.cursor ?? 0 });
      return { items: page.items, nextCursor: page.nextOffset };
    }),
  counts: procedure.input(z.object({ spaceId: z.string().nullish() }).optional()).query(({ ctx, input }) => ctx.engine.store.counts(input?.spaceId)),
  senders: procedure.input(z.object({ query: z.string().max(200), limit: z.number().min(1).max(20).default(6) })).query(({ ctx, input }) => (input.query.trim() ? ctx.engine.store.senders(input.query, input.limit) : [])),
  thread: procedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const thread = ctx.engine.store.getThread(input.id);
    if (!thread) throw new TRPCError({ code: 'NOT_FOUND', message: t('Conversation introuvable') });
    return { ...thread, spaceId: ctx.engine.spaces.spaceOf(input.id) };
  }),
  moveToSpace: procedure.input(threadIds.extend({ spaceId: z.string() })).mutation(({ ctx, input }) => ctx.engine.actions.moveToSpace(input.threadIds, input.spaceId)),
  replyTree: procedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => ctx.engine.store.replyTree(input.id)),
  open: procedure.input(z.object({ threadId: z.string() })).mutation(({ ctx, input }) => ctx.engine.actions.open(input.threadId)),
  markRead: procedure.input(threadIds.extend({ read: z.boolean() })).mutation(({ ctx, input }) => ctx.engine.actions.markRead(input.threadIds, input.read)),
  star: procedure.input(threadIds.extend({ on: z.boolean() })).mutation(({ ctx, input }) => ctx.engine.actions.star(input.threadIds, input.on)),
  archive: procedure.input(threadIds).mutation(({ ctx, input }) => ctx.engine.actions.archive(input.threadIds)),
  moveToFolder: procedure.input(threadIds.extend({ mailboxId: z.string() })).mutation(({ ctx, input }) => ctx.engine.actions.moveToFolder(input.threadIds, input.mailboxId)),
  trash: procedure.input(threadIds).mutation(({ ctx, input }) => ctx.engine.actions.trash(input.threadIds)),
  restore: procedure.input(threadIds).mutation(({ ctx, input }) => ctx.engine.actions.restore(input.threadIds)),
  spam: procedure.input(threadIds).mutation(({ ctx, input }) => ctx.engine.actions.spam(input.threadIds)),
  notSpam: procedure.input(threadIds).mutation(({ ctx, input }) => ctx.engine.actions.notSpam(input.threadIds)),
  deleteForever: procedure.input(threadIds).mutation(({ ctx, input }) => ctx.engine.actions.deleteForever(input.threadIds)),
  setTags: procedure
    .input(threadIds.extend({ add: z.array(z.string()).default([]), remove: z.array(z.string()).default([]) }))
    .mutation(({ ctx, input }) => ctx.engine.actions.setTags(input.threadIds, input.add, input.remove)),
  setBusiness: procedure.input(threadIds.extend({ businessId: z.string().nullable() })).mutation(({ ctx, input }) => ctx.engine.actions.setBusiness(input.threadIds, input.businessId)),
  setPriority: procedure.input(threadIds.extend({ priority })).mutation(({ ctx, input }) => ctx.engine.actions.setPriority(input.threadIds, input.priority)),
  reclassify: procedure.input(threadIds).mutation(async ({ ctx, input }) => {
    const ids = input.threadIds.flatMap((id) => ctx.engine.store.threadMessages(id).map((m) => m.id));
    for (const id of ids) await ctx.engine.pipeline.process(id, true);
    return ctx.engine.store.getThread(input.threadIds[0]!);
  }),
  unsubscribe: procedure.input(z.object({ threadId: z.string() })).mutation(({ ctx, input }) => ctx.engine.subscriptions.unsubscribe(input.threadId)),
  subscriptions: procedure.input(z.object({ spaceId: z.string().nullish() }).optional()).query(({ ctx, input }) => ctx.engine.subscriptions.list(input?.spaceId)),
  details: procedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => messageDetails(ctx.engine, input.id)),
  source: procedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const raw = await messageSource(ctx.engine, input.id);
    // Up to 2 MB as text; the full file stays downloadable (.eml).
    return raw ? { text: raw.subarray(0, 2 * 1024 * 1024).toString('utf8'), truncated: raw.length > 2 * 1024 * 1024 } : null;
  }),
  archiveMessage: procedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => ctx.engine.actions.archiveMessage(input.id)),
  trashMessage: procedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => ctx.engine.actions.trashMessage(input.id)),
  senderMails: procedure
    .input(z.object({ senders: z.array(z.object({ accountId: z.string(), fromEmail: z.string() })).max(50) }))
    .query(({ ctx, input }) => input.senders.map((s) => ({ ...s, mails: ctx.engine.subscriptions.senderMails(s.accountId, s.fromEmail) }))),
  trashFromSender: procedure
    .input(z.object({ accountId: z.string(), fromEmail: z.string() }))
    .mutation(({ ctx, input }) => ctx.engine.subscriptions.trashFromSender(input.accountId, input.fromEmail)),
  send: procedure
    .input(
      z.object({
        accountId: z.string(),
        fromAlias: z.string().optional(),
        to: z.array(z.string().email()).min(1),
        cc: z.array(z.string().email()).optional(),
        bcc: z.array(z.string().email()).optional(),
        subject: z.string(),
        html: z.string(),
        text: z.string().optional(),
        inReplyToMessageId: z.string().nullish(),
        attachments: z.array(z.object({ filename: z.string(), contentType: z.string(), base64: z.string() })).optional(),
      }),
    )
    .mutation(({ ctx, input }) => ctx.engine.actions.send(input)),
});

const businessInput = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  color: z.string(),
  emoji: z.string().nullable(),
  description: z.string().default(''),
  matchers: z.array(z.object({ type: z.enum(['account', 'address', 'domain', 'sender']), value: z.string() })),
});

const catalogRouter = router({
  businesses: procedure.query(({ ctx }) => ctx.engine.catalog.businesses()),
  saveBusiness: procedure.input(businessInput).mutation(({ ctx, input }) => ctx.engine.catalog.saveBusiness(input)),
  removeBusiness: procedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => ctx.engine.catalog.removeBusiness(input.id)),
  /** Re-runs business assignment on stored mail after matchers changed. */
  reassignBusinesses: procedure.mutation(({ ctx }) => ctx.engine.catalog.reassignBusinesses()),
  tags: procedure.query(({ ctx }) => ctx.engine.catalog.tags()),
  saveTag: procedure
    .input(z.object({ id: z.string().optional(), name: z.string().min(1), color: z.string(), description: z.string().default(''), icon: z.string().refine((v) => isIconValue(v), 'Icône invalide').nullish(), spaceId: z.string().nullish(), hideFromInbox: z.boolean().optional() }))
    .mutation(({ ctx, input }) => ctx.engine.catalog.saveTag(input)),
  setHideFromInbox: procedure.input(z.object({ id: z.string(), hide: z.boolean() })).mutation(({ ctx, input }) => ctx.engine.catalog.setHideFromInbox(input.id, input.hide)),
  removeTag: procedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => ctx.engine.catalog.removeTag(input.id)),
  hiddenTags: procedure.query(({ ctx }) => ctx.engine.catalog.hiddenTags()),
  restoreTag: procedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => ctx.engine.catalog.restoreTag(input.id)),
  usage: procedure.query(({ ctx }) => ctx.engine.catalog.usage()),
  setUsage: procedure.input(z.object({ usage: z.enum(['personal', 'business', 'both']) })).mutation(({ ctx, input }) => ctx.engine.catalog.applyUsage(input.usage)),
  packs: procedure.query(({ ctx }) => ctx.engine.catalog.packs()),
  addPack: procedure.input(z.object({ id: z.enum(['personal', 'business']) })).mutation(({ ctx, input }) => ctx.engine.catalog.addPack(input.id)),
});

const rulesRouter = router({
  list: procedure.query(({ ctx }) => ctx.engine.rules.list()),
  create: procedure.input(RuleInputSchema).mutation(({ ctx, input }) => ctx.engine.rules.create(input, 'user')),
  update: procedure.input(z.object({ id: z.string(), patch: RuleInputSchema.partial() })).mutation(({ ctx, input }) => ctx.engine.rules.update(input.id, input.patch)),
  remove: procedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => ctx.engine.rules.remove(input.id)),
  applyNow: procedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const rule = ctx.engine.rules.get(input.id);
    if (!rule) throw new TRPCError({ code: 'NOT_FOUND' });
    return ctx.engine.pipeline.applyRuleToExisting(rule);
  }),
  suggestions: procedure.query(({ ctx }) => ctx.engine.patterns.pending()),
  suggestionSamples: procedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => ctx.engine.patterns.samples(input.id)),
  allSuggestions: procedure.query(({ ctx }) => ctx.engine.patterns.all()),
  acceptSuggestion: procedure
    .input(z.object({ id: z.string(), applyToExisting: z.boolean().default(true), rule: RuleInputSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      const suggestion = ctx.engine.patterns.suggestion(input.id);
      if (!suggestion) throw new TRPCError({ code: 'NOT_FOUND' });
      const rule = ctx.engine.rules.create(input.rule ?? suggestion.rule, 'suggestion');
      ctx.engine.patterns.decide(input.id, 'accepted');
      const applied = input.applyToExisting ? await ctx.engine.pipeline.applyRuleToExisting(rule) : 0;
      if (rule.actions.some((a) => a.type === 'unsubscribe')) ctx.engine.pipeline.unsubscribeSenders(rule);
      return { rule, applied };
    }),
  dismissSuggestion: procedure
    .input(z.object({ id: z.string(), forever: z.boolean().default(true) }))
    .mutation(({ ctx, input }) => ctx.engine.patterns.decide(input.id, input.forever ? 'dismissed' : 'snoozed')),
});

const activityRouter = router({
  list: procedure.input(z.object({ limit: z.number().default(100), offset: z.number().default(0) })).query(({ ctx, input }) => ctx.engine.patterns.history(input.limit, input.offset)),
  stats: procedure.query(({ ctx }) => ctx.engine.patterns.stats()),
  /** The habits analysis: probability tables per sender, domain, list, category…, habits, graph. */
  analytics: procedure
    .input(z.object({ days: z.number().int().min(7).max(365).default(90), threshold: z.number().min(0.5).max(1).optional(), minSupport: z.number().int().min(2).max(50).optional() }))
    .query(({ ctx, input }) => ctx.engine.behavior.analyze(input)),
  /** Gestures only the app sees: reading time and depth, links, attachments, copied codes, searches. */
  track: procedure
    .input(
      z.object({
        action: z.enum(['view', 'openLink', 'downloadAttachment', 'copyOtp', 'search']),
        threadId: z.string().nullish(),
        ms: z.number().min(0).max(6 * 3600_000).optional(),
        meta: z.record(z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).optional(),
      }),
    )
    .mutation(({ ctx, input }) => void ctx.engine.actions.track(input)),
  unsubscribes: procedure.query(({ ctx }) => ctx.engine.subscriptions.history()),
});

const notificationsRouter = router({
  list: procedure.query(({ ctx }) => ctx.engine.notifier.list()),
  markAllRead: procedure.mutation(({ ctx }) => ctx.engine.notifier.markAllRead()),
  /** macOS permission for ZMail's notifications: authorized, denied, notDetermined, or null outside the app. */
  permission: procedure.query(async ({ ctx }) => (await ctx.engine.bridge.health())?.notifications ?? null),
  settings: procedure.query(({ ctx }) => ctx.engine.notifier.settings()),
  saveSettings: procedure
    .input(
      z.object({
        enabled: z.boolean(),
        otp: z.boolean(),
        urgent: z.boolean(),
        high: z.boolean(),
        opportunity: z.boolean(),
        rules: z.boolean(),
        unsubscribeFailed: z.boolean(),
        mutedBusinesses: z.array(z.string()),
      }),
    )
    .mutation(({ ctx, input }) => ctx.engine.notifier.saveSettings(input)),
  test: procedure.input(z.object({ kind: z.enum(['otp', 'priority', 'opportunity', 'info']) })).mutation(({ ctx, input }) =>
    ctx.engine.notifier.send(
      input.kind === 'otp'
        ? { kind: 'otp', title: 'Code 482913', subtitle: t('Test ZMail'), body: t('Votre code de vérification — touchez « Copier le code »'), otp: '482913' }
        : { kind: input.kind, title: t('Notification de test'), body: t('Les notifications ZMail fonctionnent.') },
    ),
  ),
});

const capability = z.enum(['triage', 'chat', 'unsubscribe']);
const providerKind = z.enum(['zenmux', 'openrouter', 'openai', 'ollama', 'custom']);

const aiRouter = router({
  status: procedure.query(async ({ ctx }) => {
    const ai = ctx.engine.ai;
    const settings = ai.settings();
    const apple = await ai.appleStatus(true);
    const volume = mailVolume(ctx.engine.db);
    const forecastSettings = { chatPerDay: ctx.engine.db.getSetting('ai.chatPerDay', 10), mailsPerDay: ctx.engine.db.getSetting<number | null>('ai.mailsPerDay', null) };
    const connections = settings.providers.filter((p) => p.type === 'openai');
    // Daily-cached model lists and prices (fetched on first view after a connection is added).
    await Promise.all(connections.map((p) => ai.catalog.models(p.kind ?? 'custom', p.baseUrl ?? '', ai.apiKey(p))));

    // Every model the user could pick, with its measured quality and what it would cost here.
    const options = connections.flatMap((provider) =>
      ai.catalog.cached(provider.kind ?? 'custom', provider.baseUrl ?? '').map((m) => ({ providerId: provider.id, providerName: provider.name, ...m })),
    );
    const benchmarkFor = (providerId: string, model: string, cap: Capability) => {
      const provider = settings.providers.find((p) => p.id === providerId);
      return BENCHMARKS.results.find((r) => r.kind === provider?.kind && r.model === model && r.capability === cap) ?? null;
    };

    const capabilities = await Promise.all(
      CAPABILITY_IDS.map(async (cap) => {
        const plan = await ai.plan(cap);
        const describe = (c: (typeof plan.candidates)[number]) => {
          const model = options.find((o) => o.providerId === c.providerId && o.id === c.model);
          const price = c.providerId === 'apple' ? { inputPrice: 0, outputPrice: 0 } : model;
          return {
            ...c,
            name: c.providerId === 'apple' ? t('Apple Intelligence (sur le Mac)') : (model?.name ?? c.model),
            inputPrice: price?.inputPrice ?? null,
            outputPrice: price?.outputPrice ?? null,
            monthlyCost: price ? monthlyCost(price, cap, volume, forecastSettings) : null,
            benchmark: c.providerId === 'apple' ? null : benchmarkFor(c.providerId, c.model, cap),
          };
        };
        return {
          id: cap,
          ...CAPABILITIES[cap],
          callsPerDay: callsPerDay(cap, volume, forecastSettings),
          tokens: tokensPerCall(cap),
          override: settings.overrides[cap] ?? null,
          disabled: settings.disabled.includes(cap),
          active: plan.candidates[0] ? describe(plan.candidates[0]) : null,
          fallbacks: plan.candidates.slice(1).map(describe),
          ranking: connections.flatMap((provider) =>
            rankBenchmarks(provider.kind ?? 'custom', cap).map((r) => ({
              providerId: provider.id,
              model: r.model,
              score: r.score,
              latencyP50: r.latencyP50,
              monthlyCost: (() => {
                const m = options.find((o) => o.providerId === provider.id && o.id === r.model);
                return m ? monthlyCost(m, cap, volume, forecastSettings) : null;
              })(),
            })),
          ),
        };
      }),
    );

    return {
      apple: { available: apple.available, reason: apple.reason, diagnostics: apple.diagnostics ?? null, guidance: apple.available ? null : appleGuidance(apple.reason, apple.diagnostics) },
      bridge: ctx.engine.bridge.connected,
      connections: connections.map(({ apiKey, model: _legacy, ...p }) => ({ ...p, hasKey: Boolean(apiKey), models: options.filter((o) => o.providerId === p.id).length })),
      appleEnabled: settings.providers.find((p) => p.type === 'apple')?.enabled ?? true,
      kinds: Object.entries(PROVIDER_KINDS).map(([id, k]) => ({ id: id as ProviderKind, ...k })),
      capabilities,
      options: options.map((o) => ({
        ...o,
        monthly: Object.fromEntries(CAPABILITY_IDS.map((cap) => [cap, monthlyCost(o, cap, volume, forecastSettings)])) as Record<Capability, number | null>,
        scores: Object.fromEntries(CAPABILITY_IDS.map((cap) => [cap, benchmarkFor(o.providerId, o.id, cap)?.score ?? null])) as Record<Capability, number | null>,
      })),
      volume,
      chatPerDay: forecastSettings.chatPerDay,
      mailsPerDay: forecastSettings.mailsPerDay,
      usage: ai.usageSummary(30),
      benchmarkedAt: BENCHMARKS.generatedAt,
      preset: ai.preset(),
      presets: await Promise.all(
        PRESET_IDS.map(async (id) => {
          const plan = await ai.plan('triage', id);
          // No model left for sorting (e.g. the free model became paid): the local engine does it all,
          // and the card shows that precision, not the measured mode's.
          const localOnly = plan.candidates.length === 0 && !plan.consensus;
          const measured = PRESET_MEASURES.presets[id] ?? null;
          const measure = localOnly && measured ? { ...measured, score: PRESET_MEASURES.localTriageScore ?? measured.score, latencyP50: 50, costPer1k: 0 } : measured;
          const mailsPerDay = callsPerDay('triage', volume, forecastSettings);
          const paidService = connections.length > 0;
          // What the mode needs on this Mac, in plain words.
          const missing = id === 'free' ? (!apple.available && !paidService ? t('Connectez ZenMux pour trier avec ses modèles gratuits') : null) : !paidService ? t('Connectez ZenMux (une clé suffit)') : null;
          const names = (plan.consensus ? [...plan.consensus.pair, ...(plan.consensus.arbiter ? [plan.consensus.arbiter] : [])] : plan.candidates).map((c) =>
            c.providerId === 'apple' ? 'Apple Intelligence' : (options.find((o) => o.providerId === c.providerId && o.id === c.model)?.name ?? c.model).replace(/^[^:]{2,20}:\s*/, ''),
          );
          const chat = (await ai.plan('chat', id)).candidates[0];
          return {
            id,
            chatModel: chat ? (chat.providerId === 'apple' ? 'Apple Intelligence' : (options.find((o) => o.providerId === chat.providerId && o.id === chat.model)?.name ?? chat.model).replace(/^[^:]{2,20}:\s*/, '')) : null,
            measure,
            monthlyCost: measure ? (measure.costPer1k * mailsPerDay * 30) / 1000 : null,
            models: names,
            doubleCheck: Boolean(plan.consensus),
            missing,
            localOnly,
          };
        }),
      ),
      presetsMeasuredAt: PRESET_MEASURES.generatedAt,
    };
  }),
  saveConnection: procedure
    .input(z.object({ id: z.string().optional(), kind: providerKind, name: z.string().optional(), baseUrl: z.string().optional(), apiKey: z.string().optional(), enabled: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      const ai = ctx.engine.ai;
      const settings = ai.settings();
      const id = input.id ?? newId('ai');
      const previous = settings.providers.find((p) => p.id === id);
      const kind = PROVIDER_KINDS[input.kind];
      const baseUrl = kind.editableUrl ? (input.baseUrl ?? previous?.baseUrl ?? kind.baseUrl) : kind.baseUrl;
      const provider: ProviderConfig = {
        id,
        type: 'openai',
        kind: input.kind,
        name: input.name || kind.name,
        baseUrl,
        enabled: input.enabled,
        apiKey: input.apiKey ? ctx.engine.secrets.encrypt(input.apiKey) : previous?.apiKey,
      };
      const providers = previous ? settings.providers.map((p) => (p.id === id ? provider : p)) : [...settings.providers, provider];
      ai.saveSettings({ ...settings, providers });
      await ai.catalog.models(input.kind, baseUrl, ai.apiKey(provider), true);
      return { id };
    }),
  setAppleEnabled: procedure.input(z.object({ enabled: z.boolean() })).mutation(({ ctx, input }) => {
    const settings = ctx.engine.ai.settings();
    ctx.engine.ai.saveSettings({ ...settings, providers: settings.providers.map((p) => (p.type === 'apple' ? { ...p, enabled: input.enabled } : p)) });
  }),
  removeConnection: procedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    const settings = ctx.engine.ai.settings();
    if (input.id === 'apple') throw new TRPCError({ code: 'BAD_REQUEST', message: t('Apple Intelligence peut être désactivé mais pas supprimé.') });
    const overrides = Object.fromEntries(Object.entries(settings.overrides).filter(([, o]) => o?.providerId !== input.id));
    ctx.engine.ai.saveSettings({ ...settings, providers: settings.providers.filter((p) => p.id !== input.id), overrides });
  }),
  testConnection: procedure
    .input(z.object({ id: z.string().optional(), kind: providerKind, baseUrl: z.string().optional(), apiKey: z.string().optional() }))
    .mutation(({ ctx, input }) => {
      const previous = input.id ? ctx.engine.ai.settings().providers.find((p) => p.id === input.id) : undefined;
      const kind = PROVIDER_KINDS[input.kind];
      return ctx.engine.ai.test({
        id: input.id ?? 'test',
        type: 'openai',
        kind: input.kind,
        name: kind.name,
        baseUrl: kind.editableUrl ? (input.baseUrl ?? kind.baseUrl) : kind.baseUrl,
        enabled: true,
        apiKey: input.apiKey ? ctx.engine.secrets.encrypt(input.apiKey) : previous?.apiKey,
      });
    }),
  setOverride: procedure
    .input(z.object({ capability, override: z.object({ providerId: z.string(), model: z.string() }).nullable() }))
    .mutation(({ ctx, input }) => {
      const settings = ctx.engine.ai.settings();
      const overrides = { ...settings.overrides };
      if (input.override) overrides[input.capability] = input.override;
      else delete overrides[input.capability];
      ctx.engine.ai.saveSettings({ ...settings, overrides });
    }),
  setDisabled: procedure.input(z.object({ capability, disabled: z.boolean() })).mutation(({ ctx, input }) => {
    const settings = ctx.engine.ai.settings();
    const disabled = new Set(settings.disabled);
    if (input.disabled) disabled.add(input.capability);
    else disabled.delete(input.capability);
    ctx.engine.ai.saveSettings({ ...settings, disabled: [...disabled] });
  }),
  setPreset: procedure.input(z.object({ preset: z.enum(['free', 'balanced', 'max']) })).mutation(({ ctx, input }) => ctx.engine.ai.setPreset(input.preset)),
  setMailsPerDay: procedure.input(z.object({ value: z.number().min(0).max(100000).nullable() })).mutation(({ ctx, input }) => ctx.engine.db.setSetting('ai.mailsPerDay', input.value)),
  setChatPerDay: procedure.input(z.object({ value: z.number().min(0).max(1000) })).mutation(({ ctx, input }) => ctx.engine.db.setSetting('ai.chatPerDay', input.value)),
  chat: procedure
    .input(
      z.object({
        message: z.string().min(1),
        history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).default([]),
        // What the user mentioned (@mail, #category, a sender, an account): the agent works on those.
        context: z
          .object({ threadIds: z.array(z.string()).max(20).default([]), tagIds: z.array(z.string()).max(20).default([]), senders: z.array(z.string()).max(20).default([]), accountIds: z.array(z.string()).max(10).default([]) })
          .optional(),
      }),
    )
    .mutation(({ ctx, input }) => ctx.engine.agent.chat(input.message, input.history, input.context)),
  retriageAll: procedure.mutation(({ ctx }) => ctx.engine.pipeline.retriageAll()),
  retriageStatus: procedure.query(({ ctx }) => ctx.engine.pipeline.retriageStatus()),
  cancelRetriage: procedure.mutation(({ ctx }) => ctx.engine.pipeline.cancelRetriage()),
});

const promptAction = z.enum(['triage', 'chat', 'unsubscribe']);
const promptFormat = z.enum(['llm', 'jev']);
const jevSetup = z.object({
  questions: z.record(z.object({ instructions: z.string(), yes: z.string(), no: z.string() })),
  thresholds: z.object({ yes: z.number(), lean: z.number() }),
});
const routeInput = z.object({ providerId: z.string(), model: z.string() }).nullable().optional();

/** Advanced AI settings: editable instructions per action, measured before they go live. */
const promptsRouter = router({
  setup: procedure.query(({ ctx }) => ctx.engine.lab.setup()),
  report: procedure.input(z.object({ days: z.number().default(30) }).optional()).query(({ ctx, input }) => ctx.engine.lab.report(input?.days ?? 30)),
  save: procedure
    .input(z.object({ action: promptAction, format: promptFormat, llm: z.string().optional(), jev: jevSetup.optional(), note: z.string().default('') }))
    .mutation(({ ctx, input }) => {
      ctx.engine.prompts.save(input.action, input.format, input.format === 'jev' ? input.jev! : input.llm!, { by: 'user', note: input.note });
      return ctx.engine.lab.setup();
    }),
  reset: procedure.input(z.object({ action: promptAction, format: promptFormat })).mutation(({ ctx, input }) => (ctx.engine.prompts.reset(input.action, input.format), ctx.engine.lab.setup())),
  restore: procedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => (ctx.engine.prompts.restore(input.id), ctx.engine.lab.setup())),
  /** Measures the given (unsaved) triage instructions, or the current ones. */
  evaluate: procedure
    .input(z.object({ llm: z.string().optional(), jev: jevSetup.optional(), route: routeInput, reference: z.boolean().default(true) }))
    .mutation(({ ctx, input }) => {
      const current = ctx.engine.prompts.get();
      const prompts = { ...current, triage: { llm: input.llm ?? current.triage.llm, jev: input.jev ?? current.triage.jev } };
      return ctx.engine.lab.evaluate({ prompts, route: input.route ?? null, reference: input.reference });
    }),
  improve: procedure.input(z.object({ goal: z.string().optional(), route: routeInput })).mutation(({ ctx, input }) => ctx.engine.lab.improve({ goal: input.goal, by: 'user', route: input.route ?? null })),
  applyDraft: procedure.mutation(({ ctx }) => (ctx.engine.lab.applyDraft('user'), ctx.engine.lab.setup())),
  discardDraft: procedure.mutation(({ ctx }) => (ctx.engine.prompts.setDraft(null), ctx.engine.lab.setup())),
});

const settingsRouter = router({
  get: procedure.query(({ ctx }) => ctx.engine.db.getSetting<Record<string, unknown>>('ui', {})),
  /** The UI's language: the engine writes notifications, tags and AI summaries in it. */
  setLocale: procedure.input(z.object({ locale: z.enum(['fr', 'en']) })).mutation(({ ctx, input }) => {
    ctx.engine.db.setSetting('locale', input.locale);
  }),
  save: procedure.input(z.record(z.unknown())).mutation(({ ctx, input }) => {
    ctx.engine.db.setSetting('ui', { ...ctx.engine.db.getSetting<Record<string, unknown>>('ui', {}), ...input });
  }),
});

const composeRouter = router({
  /** The composer's assistant: an instruction (often dictated) becomes a complete draft. */
  assist: procedure
    .input(
      z.object({
        instruction: z.string().min(1).max(4000),
        accountId: z.string().nullish(),
        threadId: z.string().nullish(),
        draft: z.object({ to: z.array(z.string()).optional(), cc: z.array(z.string()).optional(), subject: z.string().optional(), body: z.string().max(20_000).optional() }).optional(),
      }),
    )
    .mutation(({ ctx, input }) => ctx.engine.composeAssistant.draft(input)),
  /** Content of a file the assistant proposed, to attach it. */
  attachment: procedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => ctx.engine.composeAssistant.readOffered(input.id)),
});

const signaturesRouter = router({
  list: procedure.query(({ ctx }) => ctx.engine.signatures.settings()),
  save: procedure.input(z.object({ id: z.string().optional(), name: z.string().max(80), html: z.string().max(200_000) })).mutation(({ ctx, input }) => ctx.engine.signatures.save(input)),
  remove: procedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => ctx.engine.signatures.remove(input.id)),
  setDefaults: procedure
    .input(z.object({ accountId: z.string(), newMail: z.string().nullable(), reply: z.string().nullable() }))
    .mutation(({ ctx, input }) => ctx.engine.signatures.setDefaults(input.accountId, { newMail: input.newMail, reply: input.reply })),
});

const serverSyncRouter = router({
  status: procedure.query(({ ctx }) => {
    const sync = ctx.engine.serverSync;
    const accounts = ctx.engine.accounts.list().map((a) => ({ id: a.id, email: a.email, provider: a.provider, labels: ['gmail', 'google-workspace'].includes(a.provider) ? ('labels' as const) : ('keywords' as const) }));
    return { mode: sync.mode(), trust: sync.trust(), report: sync.lastReport(), accounts };
  }),
  setMode: procedure.input(z.object({ mode: z.enum(['manual', 'all']) })).mutation(({ ctx, input }) => ctx.engine.serverSync.setMode(input.mode)),
});

const scopes = z.array(z.enum(SCOPES)).min(1);

const developerRouter = router({
  info: procedure.query(({ ctx }) => developerInfo(ctx.engine)),
  list: procedure.query(({ ctx }) => ctx.engine.apiKeys.list()),
  /** The full key is in this response only; the engine keeps its hash. */
  create: procedure.input(z.object({ name: z.string().trim().min(1).max(80), scopes })).mutation(({ ctx, input }) => ctx.engine.apiKeys.create(input.name, input.scopes)),
  revoke: procedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    if (!ctx.engine.apiKeys.revoke(input.id)) throw new TRPCError({ code: 'NOT_FOUND', message: t('Clé introuvable') });
  }),
  clients: procedure.query(() => listClients()),
  install: procedure
    .input(z.object({ client: z.enum(MCP_CLIENTS), scopes: scopes.default(['read', 'write']) }))
    .mutation(({ ctx, input }) => installClient(ctx.engine, input.client, input.scopes)),
});

const cleanupRouter = router({
  savings: procedure.query(({ ctx }) => ctx.engine.cleaner.savings()),
  trackShortcut: procedure.mutation(({ ctx }) => ctx.engine.cleaner.trackShortcut()),
  remaining: procedure.input(z.object({ spaceId: z.string().nullish() }).optional()).query(({ ctx, input }) => ctx.engine.cleaner.remaining(input?.spaceId)),
  run: procedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => ctx.engine.cleaner.run(input.id)),
  latest: procedure.query(({ ctx }) => ctx.engine.cleaner.latest()),
  recap: procedure.input(z.object({ spaceId: z.string().nullish() }).optional()).query(({ ctx, input }) => ctx.engine.cleaner.recap(input?.spaceId)),
  reply: procedure
    .input(z.object({ runId: z.string(), threadId: z.string(), action: z.enum(['send', 'rewrite', 'skip', 'archive']), text: z.string().max(20000).optional(), instruction: z.string().max(1000).optional() }))
    .mutation(({ ctx, input }) => ctx.engine.cleaner.reply(input)),
  start: procedure.input(z.object({ notify: z.boolean().optional(), spaceId: z.string().nullish() }).optional()).mutation(({ ctx, input }) => ctx.engine.cleaner.start(input)),
  resolve: procedure
    .input(z.object({ runId: z.string(), threadId: z.string(), decision: z.enum(['archive', 'keep', 'trash']), remember: z.boolean().optional(), context: z.string().max(2000).optional() }))
    .mutation(({ ctx, input }) => ctx.engine.cleaner.resolve(input)),
  undo: procedure.input(z.object({ runId: z.string() })).mutation(({ ctx, input }) => ctx.engine.cleaner.undo(input.runId)),
});

/** Spaces (as in Arc): each has its own inbox, favourites, subscriptions and categories. */
const spacesRouter = router({
  list: procedure.query(({ ctx }) => ctx.engine.spaces.list()),
  save: procedure
    .input(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1).max(60),
        icon: z.string().refine((v) => isIconValue(v), 'Icône invalide').nullish(),
        color: z.string(),
        accountIds: z.array(z.string()).optional(),
        businessIds: z.array(z.string()).optional(),
      }),
    )
    .mutation(({ ctx, input }) => ctx.engine.spaces.save(input)),
  remove: procedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => ctx.engine.spaces.remove(input.id)),
  reorder: procedure.input(z.object({ ids: z.array(z.string()) })).mutation(({ ctx, input }) => ctx.engine.spaces.reorder(input.ids)),
  createPerBusiness: procedure.mutation(({ ctx }) => ctx.engine.spaces.createPerBusiness()),
  moveAccount: procedure.input(z.object({ accountId: z.string(), spaceId: z.string() })).mutation(({ ctx, input }) => ctx.engine.spaces.moveAccount(input.accountId, input.spaceId)),
});

export const appRouter = router({
  spaces: spacesRouter,
  cleanup: cleanupRouter,
  developer: developerRouter,
  serverSync: serverSyncRouter,
  accounts: accountsRouter,
  mail: mailRouter,
  catalog: catalogRouter,
  rules: rulesRouter,
  activity: activityRouter,
  notifications: notificationsRouter,
  ai: aiRouter,
  prompts: promptsRouter,
  settings: settingsRouter,
  signatures: signaturesRouter,
  compose: composeRouter,
});

export type AppRouter = typeof appRouter;
