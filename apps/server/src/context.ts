import { join } from 'node:path';
import { log } from './lib/log';
import { backfillAuthResults } from './mail/details';
import { MicrosoftOAuth } from './mail/oauth';
import { Database } from './db';
import { Secrets } from './lib/secrets';
import { NativeBridge } from './native/bridge';
import { MailStore } from './mail/store';
import { Catalog } from './mail/catalog';
import { AccountManager } from './mail/accounts';
import { MailActions } from './mail/actions';
import { ServerSync } from './mail/server-sync';
import { Spaces } from './mail/spaces';
import { PromptStore } from './ai/prompt-config';
import { PromptLab } from './ai/prompt-lab';
import { jevQuestionTexts } from './ai/jev';
import { Subscriptions } from './mail/subscriptions';
import { Signatures } from './mail/signatures';
import { AiRouter } from './ai/providers';
import { TriagePipeline } from './ai/pipeline';
import { MailAgent } from './ai/agent';
import { InboxCleaner } from './ai/cleanup';
import { ComposeAssistant } from './ai/compose-assist';
import { RuleStore } from './rules/engine';
import { PatternDetector } from './rules/patterns';
import { BehaviorAnalytics } from './rules/behavior';
import { Notifier } from './notify';
import { bus } from './lib/events';
import { ApiKeys } from './developer/keys';
import { setLocaleSource, systemLocale, t, type Locale } from './lib/i18n';

/** Every service of the engine, wired once and passed around. */
export class EngineContext {
  readonly store: MailStore;
  readonly catalog: Catalog;
  readonly accounts: AccountManager;
  readonly actions: MailActions;
  readonly subscriptions: Subscriptions;
  readonly signatures: Signatures;
  readonly ai: AiRouter;
  readonly pipeline: TriagePipeline;
  readonly agent: MailAgent;
  readonly cleaner: InboxCleaner;
  readonly oauth: MicrosoftOAuth;
  readonly composeAssistant: ComposeAssistant;
  readonly rules: RuleStore;
  readonly patterns: PatternDetector;
  readonly behavior: BehaviorAnalytics;
  readonly notifier: Notifier;
  readonly serverSync: ServerSync;
  readonly spaces: Spaces;
  readonly prompts: PromptStore;
  readonly lab: PromptLab;
  readonly apiKeys: ApiKeys;
  /** Port actually listened on (set by main.ts / tests); null until the server is up. */
  port: number | null = null;

  constructor(
    readonly db: Database,
    readonly secrets: Secrets,
    readonly bridge: NativeBridge,
    readonly dataDir: string,
  ) {
    setLocaleSource(() => db.getSetting<Locale | null>('locale', null) ?? systemLocale());
    this.store = new MailStore(db);
    // Conversations split by an older ZMail (a reply synced before the mail it answers) are joined once.
    if (db.getSetting('threading', 0) < 2) {
      this.store.repairThreads();
      db.setSetting('threading', 2);
    }
    this.catalog = new Catalog(db);
    this.signatures = new Signatures(db);
    this.rules = new RuleStore(db);
    this.patterns = new PatternDetector(db, this.rules);
    this.behavior = new BehaviorAnalytics(db, this.rules);
    this.patterns.behavior = this.behavior;
    this.notifier = new Notifier(db, bridge);
    this.ai = new AiRouter(db, secrets, bridge);
    // In « Gratuit », sorting relies on free cloud models; when the last one turns paid, mails are
    // sorted without AI. Tell the user (once a week at most) rather than let quality drop silently.
    this.ai.onNoModel = (capability, preset) => {
      if (capability !== 'triage') return;
      const last = db.getSetting<number>('ai:noTriageModel:notifiedAt', 0);
      if (Date.now() - last < 7 * 86_400_000) return;
      db.setSetting('ai:noTriageModel:notifiedAt', Date.now());
      void this.notifier
        .send({
          kind: 'info',
          title: t('Vos mails sont triés sans IA'),
          body:
            preset === 'free'
              ? t('Le mode Gratuit n’a plus de modèle gratuit pour le tri (il est devenu payant) : seules les règles locales trient. Passez en mode Business dans Réglages → IA pour retrouver le tri par IA.')
              : t('Aucun modèle de votre service d’IA ne peut trier les mails : seules les règles locales trient. Vérifiez Réglages → IA.'),
        })
        .catch(() => undefined);
    };
    this.prompts = new PromptStore(db, jevQuestionTexts);
    this.accounts = new AccountManager(this);
    this.actions = new MailActions(this);
    this.serverSync = new ServerSync(this);
    this.spaces = new Spaces(this);
    this.lab = new PromptLab(this);
    this.subscriptions = new Subscriptions(this);
    this.pipeline = new TriagePipeline(this);
    this.agent = new MailAgent(this);
    this.cleaner = new InboxCleaner(this);
    this.oauth = new MicrosoftOAuth(this);
    this.composeAssistant = new ComposeAssistant(this);
    this.apiKeys = new ApiKeys(db);
    this.catalog.seed();
    // Reading, archiving or a new mail changes the unread count; so does changing the badge settings.
    bus.onEvent((event) => event.type === 'mail' && this.scheduleBadge());
    db.onSettingChanged = (key) => key === 'ui' && this.scheduleBadge();
  }

  static async create(dataDir: string, options: { bridge?: NativeBridge; secrets?: Secrets; dbFile?: string } = {}) {
    const bridge = options.bridge ?? new NativeBridge();
    const secrets = options.secrets ?? (await Secrets.load(dataDir, bridge));
    const db = new Database(options.dbFile ?? join(dataDir, 'zmail.db'));
    const ctx = new EngineContext(db, secrets, bridge, dataDir);
    // Older mails: read their authentication results from the raw files, once, after startup.
    setTimeout(() => void backfillAuthResults(ctx).catch((error) => log.warn('auth', 'backfill failed', error)), 8000).unref();
    return ctx;
  }

  /** Called by account workers after a sync stored new messages. */
  async onMessagesStored(ids: string[]) {
    this.pipeline.enqueue(ids);
  }

  /**
   * Dock badge: unread conversations in the inbox, summed over the accounts the user counts
   * (Réglages → Notifications). The app shows at most "99+".
   */
  async refreshBadge() {
    const badge = this.db.getSetting<{ badge?: { enabled?: boolean; excludedAccounts?: string[] } }>('ui', {}).badge ?? {};
    if (badge.enabled === false) return this.bridge.setBadge(0);
    const excluded = new Set(badge.excludedAccounts ?? []);
    const perAccount = this.store.counts().accounts;
    const unread = Object.entries(perAccount).reduce((sum, [id, n]) => (excluded.has(id) ? sum : sum + n), 0);
    await this.bridge.setBadge(unread);
  }

  private badgeTimer: NodeJS.Timeout | null = null;
  /** Coalesces bursts (a sync, a bulk action) into one badge update. */
  scheduleBadge() {
    if (this.badgeTimer) return;
    this.badgeTimer = setTimeout(() => {
      this.badgeTimer = null;
      void this.refreshBadge().catch(() => undefined);
    }, 400);
  }
}
