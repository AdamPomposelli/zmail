import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  Bot,
  Briefcase,
  Building2,
  Check,
  CircleDashed,
  Cloud,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  HelpCircle,
  Inbox,
  KeyRound,
  Leaf,
  Loader2,
  Lock,
  Mail,
  PencilLine,
  Send,
  Server,
  ServerCog,
  ShieldCheck,
  Sparkles,
  User,
  UserRound,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BrandLogo, brandForProvider } from '@/components/brand-logo';
import { InfoHint } from '@/components/ui/info-hint';
import { ZMailLogo } from '@/components/zmail-logo';
import { useTRPC, type Outputs } from '@/lib/trpc';
import { useCatalog } from '@/hooks/use-catalog';
import type { Brand } from '@/lib/brand-logos';
import { Input } from '@/components/ui/input';
import { openExternal } from '@/lib/native';
import { useNavigate } from 'react-router';
import { cn, PALETTE } from '@/lib/utils';
import { t } from '@/lib/i18n';

type Server = { host: string; port: number; secure: boolean };
type Discovery = Outputs['accounts']['discover'];
type StepId = 'provider' | 'sender' | 'email' | 'password' | 'servers' | 'business' | 'connect';

/** Display data for each provider tile; the server settings themselves come from the engine. */
const PROVIDERS: { id: string; name: string; hint: string; icon: LucideIcon; brand?: Brand }[] = [
  { id: 'gmail', name: 'Gmail', hint: t('Adresse en @gmail.com'), icon: Mail, brand: 'gmail' },
  {
    id: 'google-workspace',
    name: 'Google Workspace',
    hint: t('Votre domaine, hébergé chez Google'),
    icon: Building2,
    brand: 'google',
  },
  { id: 'icloud', name: 'iCloud', hint: '@icloud.com, @me.com', icon: Cloud, brand: 'icloud' },
  {
    id: 'outlook',
    name: 'Outlook / Microsoft 365',
    hint: t('@outlook.com, @hotmail.com, pro'),
    icon: Inbox,
    brand: 'outlook',
  },
  {
    id: 'mailbox-org',
    name: 'mailbox.org',
    hint: t('Messagerie chiffrée européenne'),
    icon: Leaf,
    brand: 'mailbox-org',
  },
  { id: 'namecheap', name: 'Namecheap', hint: 'Private Email', icon: Globe, brand: 'namecheap' },
  {
    id: 'fastmail',
    name: 'Fastmail',
    hint: t('Fastmail et domaines perso'),
    icon: Zap,
    brand: 'fastmail',
  },
  { id: 'ovh', name: 'OVHcloud', hint: t('Hébergement mail OVH'), icon: Server, brand: 'ovh' },
  { id: 'zoho', name: 'Zoho Mail', hint: 'Zoho Workplace', icon: Briefcase, brand: 'zoho' },
  {
    id: 'custom',
    name: t('Serveur perso / VPS'),
    hint: 'Mailcow, Dovecot, cPanel…',
    icon: ServerCog,
  },
];

const STEPS: { id: StepId; label: string; icon: LucideIcon }[] = [
  { id: 'provider', label: t('Fournisseur'), icon: Inbox },
  { id: 'sender', label: t('Nom d’expéditeur'), icon: UserRound },
  { id: 'email', label: t('Adresse'), icon: AtSign },
  { id: 'password', label: t('Mot de passe'), icon: KeyRound },
  { id: 'servers', label: t('Serveurs'), icon: ServerCog },
  { id: 'business', label: 'Business', icon: Briefcase },
  { id: 'connect', label: t('Connexion'), icon: ShieldCheck },
];

/**
 * Where the user creates the password a mail client needs. The first step is always the
 * button that opens the provider's page; `pattern` recognises a pasted code so the wizard
 * can move on by itself.
 */
type PasswordGuide = {
  title: string;
  subtitle: string;
  open: string;
  cta: string;
  url: string;
  brand: Brand;
  steps: string[];
  /** Shown under the steps when the provider's page refuses to create the password. */
  note?: { text: string; link: string; url: string };
  pattern?: RegExp;
  /** How the recognised code is described once pasted. */
  format?: string;
  /** Normalises a pasted code (Google shows its codes in groups of four). */
  clean?: (v: string) => string;
};

const GOOGLE_GUIDE: PasswordGuide = {
  title: t('Créez un code pour ZMail'),
  subtitle: t(
    'Google refuse votre mot de passe habituel dans une app de messagerie. Il vous donne à la place un code dédié de 16 lettres : ça prend 30 secondes.',
  ),
  open: t('Ouvrez la page Google des mots de passe d’application.'),
  cta: t('Ouvrir la page Google'),
  url: 'https://myaccount.google.com/apppasswords',
  brand: 'google',
  steps: [
    t(
      'Connectez-vous si Google le demande, tapez « ZMail » dans le champ « App name », puis cliquez sur « Create ».',
    ),
    t(
      'Copiez le code de 16 lettres affiché par Google et collez-le ci-dessous : ZMail passe tout seul à la suite.',
    ),
  ],
  note: {
    text: t(
      'Google indique que ce réglage n’est pas disponible ? Activez d’abord la validation en deux étapes, puis revenez.',
    ),
    link: t('Activer la validation en deux étapes'),
    url: 'https://myaccount.google.com/signinoptions/twosv',
  },
  pattern: /^[a-z]{16}$/,
  format: t('Code Google reconnu'),
  clean: (v) => v.replace(/\s+/g, '').toLowerCase(),
};

const PASSWORD_GUIDES: Record<string, PasswordGuide> = {
  gmail: GOOGLE_GUIDE,
  'google-workspace': {
    ...GOOGLE_GUIDE,
    note: {
      text: t(
        'Google indique que ce réglage n’est pas disponible ? Activez la validation en deux étapes ; si ça ne suffit pas, votre administrateur Workspace doit autoriser l’IMAP.',
      ),
      link: t('Activer la validation en deux étapes'),
      url: 'https://myaccount.google.com/signinoptions/twosv',
    },
  },
  icloud: {
    title: t('Créez un code pour ZMail'),
    subtitle: t(
      'Apple refuse le mot de passe de votre identifiant Apple dans une app de messagerie. Il vous donne à la place un code dédié : ça prend 30 secondes.',
    ),
    open: t('Ouvrez votre compte Apple.'),
    cta: t('Ouvrir mon compte Apple'),
    url: 'https://account.apple.com/account/manage',
    brand: 'apple',
    steps: [
      t(
        'Dans « Connexion et sécurité », ouvrez « Mots de passe pour app », cliquez sur « + » et nommez-le « ZMail ».',
      ),
      t(
        'Copiez le code affiché (xxxx-xxxx-xxxx-xxxx) et collez-le ci-dessous : ZMail passe tout seul à la suite.',
      ),
    ],
    pattern: /^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$/,
    format: t('Code Apple reconnu'),
    clean: (v) => v.trim().toLowerCase(),
  },
  outlook: {
    title: t('Le mot de passe de votre compte Microsoft'),
    subtitle: t(
      'Sans validation en deux étapes, votre mot de passe habituel suffit. Avec, Microsoft vous demande un code dédié à ZMail.',
    ),
    open: t('Si la validation en deux étapes est active, ouvrez la sécurité Microsoft.'),
    cta: t('Ouvrir la sécurité Microsoft'),
    url: 'https://account.microsoft.com/security',
    brand: 'microsoft',
    steps: [
      t('« Options de sécurité avancées » → « Mots de passe d’application » → « Créer ».'),
      t(
        'Collez le code ci-dessous, ou votre mot de passe habituel si vous n’avez pas de validation en deux étapes.',
      ),
    ],
    pattern: /^[a-z]{16}$/,
    format: t('Code Microsoft reconnu'),
    clean: (v) => v.replace(/\s+/g, '').toLowerCase(),
  },
  fastmail: {
    title: t('Créez un code pour ZMail'),
    subtitle: t(
      'Fastmail réserve votre mot de passe principal à son site. Il vous donne un code dédié aux apps de messagerie.',
    ),
    open: t('Ouvrez les mots de passe d’application Fastmail.'),
    cta: t('Ouvrir Fastmail'),
    url: 'https://app.fastmail.com/settings/security/apppasswords',
    brand: 'fastmail',
    steps: [
      t(
        'Cliquez sur « Nouveau mot de passe d’application », nommez-le « ZMail » et donnez-lui l’accès « IMAP et SMTP ».',
      ),
      t('Copiez le code et collez-le ci-dessous : ZMail passe tout seul à la suite.'),
    ],
    pattern: /^[a-z0-9]{16}$/,
    format: t('Code Fastmail reconnu'),
    clean: (v) => v.replace(/\s+/g, '').toLowerCase(),
  },
};

const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
const titleCase = (v: string) =>
  v.replace(/[-_.]+/g, ' ').replace(/\b\p{L}/gu, (c) => c.toUpperCase());
const FREE_DOMAINS =
  /^(gmail|googlemail|icloud|me|mac|outlook|hotmail|live|yahoo|gmx|orange|free|laposte|proton|protonmail|mailbox)\./i;

function Field({
  label,
  hint,
  children,
  footer,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-[13px] font-medium">
        {label}
        {hint ? <InfoHint>{hint}</InfoHint> : null}
      </label>
      {children}
      {footer ? (
        <p className="text-muted-foreground text-[12px] leading-relaxed">{footer}</p>
      ) : null}
    </div>
  );
}

function StepHeader({
  icon: Icon,
  title,
  subtitle,
  brand,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  brand?: Brand | null;
}) {
  return (
    <div className="mb-6">
      <div className="mb-4 flex items-center">
        <span className="bg-muted text-muted-foreground ring-border flex size-11 items-center justify-center rounded-xl ring-1">
          <Icon className="size-5" />
        </span>
        {brand ? (
          <BrandLogo brand={brand} tile size={30} className="ring-background -ml-2.5 mt-6 ring-2" />
        ) : null}
      </div>
      <h2 className="text-[22px] font-semibold leading-tight tracking-tight">{title}</h2>
      <p className="text-muted-foreground mt-1.5 text-[14px] leading-relaxed">{subtitle}</p>
    </div>
  );
}

function GuideStep({ n, done, children }: { n: number; done: boolean; children: ReactNode }) {
  return (
    <li className="flex gap-3 text-[13.5px] leading-relaxed">
      <span
        className={cn(
          'mt-px flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold transition',
          done ? 'bg-success text-success-foreground' : 'bg-warning/10 text-warning',
        )}
      >
        {done ? <Check className="size-3.5" /> : n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">{children}</div>
    </li>
  );
}

function Choice({
  selected,
  onClick,
  icon: Icon,
  title,
  hint,
  brand,
}: {
  selected: boolean;
  onClick: () => void;
  icon: LucideIcon;
  title: string;
  hint: string;
  brand?: Brand;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex items-center gap-3 rounded-xl p-3 text-left ring-1 transition',
        selected
          ? 'bg-primary/5 ring-primary ring-2'
          : 'ring-border hover:bg-accent/50 hover:ring-foreground/15',
      )}
    >
      {brand ? (
        <BrandLogo brand={brand} tile size={36} />
      ) : (
        <span className="bg-muted text-muted-foreground ring-border flex size-9 shrink-0 items-center justify-center rounded-lg ring-1">
          <Icon className="size-[18px]" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium">{title}</span>
        <span className="text-muted-foreground block truncate text-[12px]">{hint}</span>
      </span>
      {selected ? <Check className="text-primary absolute right-2 top-2 size-3.5" /> : null}
    </button>
  );
}

export function AccountWizard({
  variant = 'page',
  onDone,
  onCancel,
}: {
  variant?: 'page' | 'dialog';
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const { data: presets } = useQuery(trpc.accounts.presets.queryOptions());

  const [step, setStep] = useState<StepId>('provider');
  const [providerId, setProviderId] = useState<string | null>(null);
  const [identity, setIdentity] = useState<'person' | 'company'>('person');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [guideOpened, setGuideOpened] = useState(false);
  const autoNext = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [imap, setImap] = useState<Server>({ host: '', port: 993, secure: true });
  const [smtp, setSmtp] = useState<Server>({ host: '', port: 465, secure: true });
  const [loginMode, setLoginMode] = useState<'email' | 'other'>('email');
  const [login, setLogin] = useState('');
  const [editServers, setEditServers] = useState(false);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [businessMode, setBusinessMode] = useState<'new' | 'existing' | 'none'>('new');
  const [businessName, setBusinessName] = useState('');
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const discover = useMutation(trpc.accounts.discover.mutationOptions());
  const test = useMutation(trpc.accounts.test.mutationOptions());
  const create = useMutation(trpc.accounts.create.mutationOptions());
  const saveBusiness = useMutation(trpc.catalog.saveBusiness.mutationOptions());
  const reassign = useMutation(trpc.catalog.reassignBusinesses.mutationOptions());

  const provider = PROVIDERS.find((p) => p.id === providerId);
  const preset = presets?.find((p) => p.id === providerId);
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  const index = STEPS.findIndex((s) => s.id === step);
  const guide = providerId ? PASSWORD_GUIDES[providerId] : undefined;
  const ownDomain = domain && !FREE_DOMAINS.test(domain);
  const codeRecognised = Boolean(guide?.pattern?.test(password));

  // Preset providers come with their servers; custom ones are found by the discovery agent.
  useEffect(() => {
    if (preset && preset.id !== 'custom') {
      setImap(preset.imap);
      setSmtp(preset.smtp);
    }
  }, [preset]);

  // A company sender name is the best business name; otherwise the address's domain.
  useEffect(() => {
    if (step !== 'business' || businessName) return;
    if (identity === 'company' && name.trim()) setBusinessName(name.trim());
    else if (ownDomain) setBusinessName(titleCase(domain.split('.').slice(0, -1).join(' ')));
  }, [step, identity, name, ownDomain, domain, businessName]);

  const runDiscovery = async () => {
    const result = await discover.mutateAsync({ email });
    setDiscovery(result);
    if (result.imap) setImap(result.imap);
    if (result.smtp) setSmtp(result.smtp);
    if (result.username === 'localpart') {
      setLoginMode('other');
      setLogin(email.split('@')[0] ?? '');
    }
    if (!result.found) setEditServers(true);
  };

  useEffect(() => {
    if (
      step === 'servers' &&
      providerId === 'custom' &&
      !discovery &&
      !discover.isPending &&
      isEmail(email)
    )
      void runDiscovery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, providerId]);

  const emailWarning = useMemo(() => {
    if (!isEmail(email)) return null;
    if (providerId === 'gmail' && !/^(gmail|googlemail)\.com$/.test(domain))
      return t(
        'Cette adresse n’est pas en @gmail.com : s’il s’agit de votre domaine hébergé chez Google, choisissez plutôt « Google Workspace ».',
      );
    if (providerId === 'icloud' && !/^(icloud|me|mac)\.com$/.test(domain))
      return t('Une adresse iCloud se termine par @icloud.com, @me.com ou @mac.com.');
    return null;
  }, [email, providerId, domain]);

  const canContinue: Record<StepId, boolean> = {
    provider: Boolean(providerId),
    sender: name.trim().length > 1,
    email: isEmail(email),
    password: password.length > 0,
    servers: Boolean(
      imap.host && smtp.host && imap.port && smtp.port && (loginMode === 'email' || login.trim()),
    ),
    business:
      businessMode === 'none' ||
      (businessMode === 'new' ? businessName.trim().length > 1 : Boolean(businessId)),
    connect: false,
  };

  const go = (target: StepId) => {
    clearTimeout(autoNext.current);
    setStep(target);
  };
  const next = () => {
    const nextStep = STEPS[index + 1];
    if (!nextStep) return;
    if (nextStep.id === 'connect') void connect();
    go(nextStep.id);
  };

  const connect = async () => {
    setCreated(null);
    const credentials = {
      imapHost: imap.host,
      imapPort: imap.port,
      imapSecure: imap.secure,
      smtpHost: smtp.host,
      smtpPort: smtp.port,
      smtpSecure: smtp.secure,
      username: loginMode === 'email' ? email : login.trim(),
      password,
    };
    const result = await test.mutateAsync(credentials);
    if (!result.imap.ok || !result.smtp.ok) return;
    const account = await create.mutateAsync({
      ...credentials,
      email,
      name: name.trim(),
      provider: providerId ?? 'custom',
      businessId: businessMode === 'existing' ? businessId : null,
    });
    if (businessMode === 'new') {
      await saveBusiness.mutateAsync({
        name: businessName.trim(),
        emoji: null,
        color: PALETTE[catalog.businesses.length % PALETTE.length]!,
        description: '',
        matchers: [
          { type: 'account', value: account.id },
          ...(ownDomain ? [{ type: 'domain' as const, value: domain }] : []),
        ],
      });
      // Mail synced in the meantime gets its business too.
      void reassign.mutateAsync();
    }
    void queryClient.invalidateQueries({ queryKey: trpc.accounts.list.queryKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.catalog.businesses.queryKey() });
    setCreated(account.email);
  };

  const failed = test.data && (!test.data.imap.ok || !test.data.smtp.ok);
  const connectError = create.error ?? saveBusiness.error;

  const body = (
    // In the dialog every step keeps the same height and sits in its middle (short steps included).
    <div
      className={variant === 'dialog' ? 'flex min-h-[440px] flex-col justify-center' : undefined}
    >
      <div>
        {step === 'provider' ? (
          <>
            <StepHeader
              icon={Inbox}
              title={t('Où est hébergée cette boîte mail ?')}
              subtitle={t(
                'Choisissez le service qui gère l’adresse. ZMail s’occupe ensuite des réglages techniques.',
              )}
            />
            <div className="grid grid-cols-2 gap-2">
              {PROVIDERS.map((p) => (
                <Choice
                  key={p.id}
                  selected={providerId === p.id}
                  onClick={() => setProviderId(p.id)}
                  icon={p.icon}
                  title={p.name}
                  hint={p.hint}
                  brand={p.brand}
                />
              ))}
            </div>
            <p className="text-muted-foreground mt-4 flex items-center gap-1.5 text-[12.5px]">
              <HelpCircle className="size-3.5" />
              {t(
                'Vous ne savez pas ? Choisissez « Serveur perso » : l’agent ZMail trouvera les réglages à partir de l’adresse.',
              )}
            </p>
          </>
        ) : null}

        {step === 'sender' ? (
          <>
            <StepHeader
              icon={UserRound}
              title={t('Comment voulez-vous apparaître ?')}
              subtitle={t(
                'C’est le nom que vos destinataires voient à côté de votre adresse quand vous leur écrivez depuis cette boîte.',
              )}
            />
            <div className="mb-4 grid grid-cols-2 gap-2">
              <Choice
                selected={identity === 'person'}
                onClick={() => setIdentity('person')}
                icon={User}
                title={t('Une personne')}
                hint={t('Boîte personnelle ou nominative')}
              />
              <Choice
                selected={identity === 'company'}
                onClick={() => setIdentity('company')}
                icon={Building2}
                title={t('Une entreprise')}
                hint={t('contact@, support@, facturation@…')}
              />
            </div>
            <Field
              label={t('Nom d’expéditeur')}
              hint={t(
                'Affiché dans la boîte de réception de vos destinataires. Il ne change rien à votre adresse et se modifie à tout moment dans Réglages → Comptes.',
              )}
              footer={
                identity === 'person'
                  ? t('Exemples : « Adam Pomposelli », « Adam — Nordlys Studio ».')
                  : t('Exemples : « Nordlys Studio », « Support Maison Velours ».')
              }
            >
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={identity === 'person' ? t('Prénom Nom') : t('Nom de l’entreprise')}
                autoFocus
                className="h-11 text-[15px]"
              />
            </Field>
            <div className="bg-muted ring-border mt-6 rounded-xl p-3.5 ring-1">
              <p className="text-muted-foreground mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide">
                <Eye className="size-3" /> {t('Aperçu chez votre destinataire')}
              </p>
              <div className="flex items-center gap-3">
                <span className="bg-ai text-ai-foreground flex size-9 items-center justify-center rounded-full text-[13px] font-semibold">
                  {(name.trim()[0] ?? '?').toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold">
                    {name.trim() ||
                      (identity === 'person' ? t('Prénom Nom') : t('Votre entreprise'))}
                  </p>
                  <p className="text-muted-foreground truncate text-[12.5px]">
                    {t('Votre message · il y a 1 min')}
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {step === 'email' ? (
          <>
            <StepHeader
              brand={brandForProvider(providerId)}
              icon={AtSign}
              title={t('Quelle adresse connecter ?')}
              subtitle={
                provider
                  ? t('L’adresse complète de la boîte {provider}.', { provider: provider.name })
                  : t('L’adresse complète de la boîte.')
              }
            />
            <Field
              label={t('Adresse e-mail')}
              hint={t(
                'L’adresse à laquelle vous recevez vos mails. Pour un alias Gmail, connectez la boîte principale : ses alias arrivent dans la même boîte.',
              )}
            >
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value.trim())}
                placeholder={
                  identity === 'company' ? t('contact@entreprise.com') : t('vous@exemple.com')
                }
                autoFocus
                className="h-11 text-[15px]"
              />
            </Field>
            {emailWarning ? (
              <p className="bg-warning/10 text-warning mt-3 rounded-lg px-3 py-2 text-[12.5px]">
                {emailWarning}
              </p>
            ) : null}
          </>
        ) : null}

        {step === 'password' ? (
          <>
            <StepHeader
              brand={brandForProvider(providerId)}
              icon={KeyRound}
              title={guide ? guide.title : t('Le mot de passe de la boîte')}
              subtitle={
                guide
                  ? guide.subtitle
                  : email
                    ? t(
                        'Le mot de passe de {email}, celui que vous utilisez pour lire vos mails en ligne.',
                        { email },
                      )
                    : t(
                        'Le mot de passe de cette boîte, celui que vous utilisez pour lire vos mails en ligne.',
                      )
              }
            />
            {guide ? (
              <ol className="mb-6 space-y-3">
                <GuideStep n={1} done={guideOpened}>
                  <p>{guide.open}</p>
                  <button
                    type="button"
                    onClick={() => {
                      openExternal(guide.url);
                      setGuideOpened(true);
                    }}
                    className={cn(
                      'mt-2.5 flex h-10 items-center gap-2.5 rounded-lg px-4 text-[13.5px] font-medium transition',
                      guideOpened
                        ? 'bg-muted ring-border hover:bg-accent ring-1'
                        : 'bg-card text-card-foreground ring-border hover:bg-accent shadow-xs ring-1',
                    )}
                  >
                    <BrandLogo brand={guide.brand} size={16} />
                    {guideOpened ? t('Rouvrir la page') : guide.cta}
                    <ExternalLink className="size-3.5 opacity-60" />
                  </button>
                </GuideStep>
                {guide.steps.map((s, i) => (
                  <GuideStep key={s} n={i + 2} done={codeRecognised}>
                    <p>{s}</p>
                  </GuideStep>
                ))}
              </ol>
            ) : null}
            <Field
              label={guide ? t('Code d’application') : t('Mot de passe')}
              hint={t(
                'Chiffré en AES-256 avec une clé rangée dans le Trousseau macOS. Il ne sert qu’à se connecter à votre serveur mail et ne quitte jamais votre Mac autrement.',
              )}
            >
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    clearTimeout(autoNext.current);
                    setPassword(e.target.value);
                  }}
                  onPaste={(e) => {
                    if (!guide?.pattern) return;
                    const code = (guide.clean ?? ((v: string) => v))(
                      e.clipboardData.getData('text'),
                    );
                    if (!guide.pattern.test(code)) return;
                    e.preventDefault();
                    setPassword(code);
                    // Let the green check land before moving on.
                    autoNext.current = setTimeout(next, 900);
                  }}
                  placeholder={guide ? t('Collez le code ici') : '••••••••••••'}
                  autoFocus
                  className={cn(
                    'h-11 pr-10 text-[15px]',
                    codeRecognised && 'ring-success/70 focus-visible:ring-success/70 ring-2',
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="text-muted-foreground hover:text-foreground absolute right-3 top-1/2 -translate-y-1/2"
                  aria-label={showPassword ? t('Masquer') : t('Afficher')}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>
            <p
              className={cn(
                'mt-3 flex items-center gap-1.5 text-[12px]',
                codeRecognised ? 'text-success font-medium' : 'text-muted-foreground',
              )}
            >
              {codeRecognised ? (
                <>
                  <Check className="size-3.5" />{' '}
                  {t('{format} · on continue…', { format: guide?.format ?? '' })}
                </>
              ) : (
                <>
                  <Lock className="size-3.5" /> {t('Stocké chiffré sur ce Mac uniquement.')}
                </>
              )}
            </p>
            {guide?.note ? (
              <p className="text-muted-foreground mt-5 flex gap-2 text-[12px] leading-relaxed">
                <HelpCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {guide.note.text}{' '}
                  <button
                    type="button"
                    onClick={() => openExternal(guide.note!.url)}
                    className="text-foreground decoration-foreground/25 underline underline-offset-2 hover:decoration-current"
                  >
                    {guide.note.link}
                  </button>
                </span>
              </p>
            ) : null}
          </>
        ) : null}

        {step === 'servers' ? (
          <>
            <StepHeader
              brand={brandForProvider(providerId)}
              icon={ServerCog}
              title={
                providerId === 'custom'
                  ? t('L’agent cherche vos serveurs')
                  : t('Réglages techniques')
              }
              subtitle={
                providerId === 'custom'
                  ? t(
                      'ZMail interroge les annuaires de configuration et teste les serveurs de votre domaine, comme le ferait un technicien.',
                    )
                  : t('Les serveurs de {provider} sont connus : rien à saisir.', {
                      provider: provider?.name ?? '',
                    })
              }
            />
            {providerId === 'custom' ? (
              <div className="ring-border mb-5 rounded-xl p-4 ring-1">
                <p className="mb-2 flex items-center gap-2 text-[13px] font-medium">
                  <Bot className="text-ai size-4" />
                  {discover.isPending
                    ? t('Recherche en cours…')
                    : discovery?.found
                      ? t('Serveurs trouvés et vérifiés')
                      : discovery
                        ? t('Rien trouvé automatiquement')
                        : t('Prêt à chercher')}
                </p>
                <ul className="space-y-1">
                  {(discovery?.steps ?? []).map((s) => (
                    <li key={s.label} className="flex items-center gap-2 text-[12.5px]">
                      {s.status === 'ok' ? (
                        <Check className="text-success size-3.5" />
                      ) : (
                        <X className="text-muted-foreground size-3.5" />
                      )}
                      <span>{s.label}</span>
                      {s.detail ? (
                        <span className="text-muted-foreground truncate">· {s.detail}</span>
                      ) : null}
                    </li>
                  ))}
                  {discover.isPending ? (
                    <li className="text-muted-foreground flex items-center gap-2 text-[12.5px]">
                      <Loader2 className="size-3.5 animate-spin" />{' '}
                      {t('Interrogation de {domain}…', { domain })}
                    </li>
                  ) : null}
                </ul>
                {discovery && !discovery.found ? (
                  <p className="text-muted-foreground mt-2 text-[12.5px]">
                    {t(
                      'Saisissez les serveurs indiqués par votre hébergeur (souvent dans son espace client, rubrique « configuration d’un client mail »).',
                    )}
                  </p>
                ) : null}
                {discovery ? (
                  <button
                    type="button"
                    onClick={() => void runDiscovery()}
                    className="text-muted-foreground hover:text-foreground mt-2 text-[12px] underline-offset-2 hover:underline"
                  >
                    {t('Relancer la recherche')}
                  </button>
                ) : null}
              </div>
            ) : null}

            {!editServers && imap.host ? (
              <div className="space-y-2">
                {[
                  { icon: Inbox, label: t('Réception (IMAP)'), server: imap },
                  { icon: Send, label: t('Envoi (SMTP)'), server: smtp },
                ].map(({ icon: Icon, label, server }) => (
                  <div
                    key={label}
                    className="ring-border flex items-center gap-3 rounded-xl p-3 ring-1"
                  >
                    <Icon className="text-muted-foreground size-4" />
                    <span className="w-36 text-[13px] font-medium">{label}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
                      {server.host}:{server.port}
                    </span>
                    <span className="text-success flex items-center gap-1 text-[12px]">
                      <Lock className="size-3" /> {server.secure ? 'SSL/TLS' : 'STARTTLS'}
                    </span>
                  </div>
                ))}
                <p className="text-muted-foreground pt-1 text-[12.5px]">
                  {t('Identifiant de connexion : {login}', {
                    login: loginMode === 'email' ? t('votre adresse complète') : login,
                  })}
                </p>
                <button
                  type="button"
                  onClick={() => setEditServers(true)}
                  className="text-muted-foreground hover:text-foreground flex items-center gap-1 pt-1 text-[12.5px]"
                >
                  <PencilLine className="size-3.5" /> {t('Modifier ces réglages')}
                </button>
              </div>
            ) : null}

            {editServers ? (
              <ServerEditor
                imap={imap}
                smtp={smtp}
                setImap={setImap}
                setSmtp={setSmtp}
                loginMode={loginMode}
                setLoginMode={setLoginMode}
                login={login}
                setLogin={setLogin}
                email={email}
              />
            ) : null}
          </>
        ) : null}

        {step === 'business' ? (
          <>
            <StepHeader
              icon={Briefcase}
              title={t('À quelle activité appartient cette boîte ?')}
              subtitle={t(
                'Un business regroupe les mails de vos boîtes dans la barre latérale (ex. votre agence, votre boutique, « Perso »). Les opportunités commerciales sont détectées par business.',
              )}
            />
            <div className="space-y-2">
              <BusinessOption
                selected={businessMode === 'new'}
                onClick={() => setBusinessMode('new')}
                icon={Sparkles}
                title={t('Créer un business pour cette boîte')}
                hint={
                  ownDomain
                    ? t('Tous les mails reçus sur @{domain} y seront rangés automatiquement.', {
                        domain,
                      })
                    : t('Les mails reçus sur cette boîte y seront rangés automatiquement.')
                }
              >
                {businessMode === 'new' ? (
                  <Field
                    label={t('Nom du business')}
                    hint={t(
                      'Visible dans la barre latérale et sur chaque mail. Vous pourrez ajouter une description pour mieux guider l’IA dans Réglages → Business.',
                    )}
                  >
                    <Input
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder={t('Mon agence')}
                      className="h-10"
                      autoFocus
                    />
                  </Field>
                ) : null}
              </BusinessOption>
              {catalog.businesses.length ? (
                <BusinessOption
                  selected={businessMode === 'existing'}
                  onClick={() => setBusinessMode('existing')}
                  icon={Briefcase}
                  title={t('L’ajouter à un business existant')}
                  hint={t(
                    'Pratique pour une deuxième adresse de la même activité (contact@, support@…).',
                  )}
                >
                  {businessMode === 'existing' ? (
                    <div className="flex flex-wrap gap-1.5">
                      {catalog.businesses.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => setBusinessId(b.id)}
                          className={cn(
                            'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] ring-1',
                            businessId === b.id ? 'ring-primary ring-2' : 'ring-border',
                          )}
                        >
                          <span>{b.emoji ?? '•'}</span>
                          {b.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </BusinessOption>
              ) : null}
              <BusinessOption
                selected={businessMode === 'none'}
                onClick={() => setBusinessMode('none')}
                icon={CircleDashed}
                title={t('Pas maintenant')}
                hint={t(
                  'La boîte apparaît dans l’inbox unifiée ; vous pourrez la rattacher plus tard.',
                )}
              />
            </div>
          </>
        ) : null}

        {step === 'connect' ? (
          <ConnectStep
            email={email}
            testing={test.isPending}
            creating={create.isPending || saveBusiness.isPending}
            result={test.data ?? null}
            created={created}
            error={connectError?.message ?? test.error?.message ?? null}
            onFix={(target) => go(target)}
            onRetry={() => void connect()}
            onFinish={() => (onDone ? onDone() : navigate('/mail/inbox'))}
            onAnother={() => {
              setStep('provider');
              setProviderId(null);
              setEmail('');
              setPassword('');
              setName('');
              setDiscovery(null);
              setEditServers(false);
              setCreated(null);
              test.reset();
            }}
          />
        ) : null}
      </div>
    </div>
  );

  const footer =
    step !== 'connect' ? (
      <div
        className={cn(
          'border-border flex items-center gap-2 border-t pt-4',
          variant === 'dialog' && 'mt-6',
        )}
      >
        {index > 0 ? (
          <button
            type="button"
            onClick={() => go(STEPS[index - 1]!.id)}
            className="text-muted-foreground hover:text-foreground flex h-10 items-center gap-1.5 rounded-lg px-3 text-[13.5px]"
          >
            <ArrowLeft className="size-4" /> {t('Retour')}
          </button>
        ) : onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground h-10 px-3 text-[13.5px]"
          >
            {t('Annuler')}
          </button>
        ) : null}
        <span className="text-muted-foreground ml-auto text-[12px] tabular-nums">
          {t('Étape {n} sur {total}', { n: index + 1, total: STEPS.length })}
        </span>
        <button
          type="button"
          disabled={!canContinue[step] || (step === 'servers' && discover.isPending)}
          onClick={next}
          className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs ml-3 flex h-10 items-center gap-2 rounded-lg px-5 text-[14px] font-medium transition disabled:opacity-40"
        >
          {STEPS[index + 1]?.id === 'connect' ? t('Connecter la boîte') : t('Continuer')}
          <ArrowRight className="size-4" />
        </button>
      </div>
    ) : null;

  if (variant === 'dialog') {
    return (
      <div>
        <div className="mb-5 flex gap-1">
          {STEPS.map((s, i) => (
            <span
              key={s.id}
              className={cn('h-1 flex-1 rounded-full', i <= index ? 'bg-primary' : 'bg-muted')}
            />
          ))}
        </div>
        {body}
        {footer}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full">
      <aside className="border-border flex w-[280px] shrink-0 flex-col border-r px-6 pb-8 pt-12">
        <div className="mb-8 flex items-center gap-2.5">
          <ZMailLogo size={36} className="drop-shadow-sm" />
          <div>
            <p className="text-[14px] font-semibold">{t('Bienvenue dans ZMail')}</p>
            <p className="text-muted-foreground text-[12px]">
              {t('Connectons votre première boîte')}
            </p>
          </div>
        </div>
        <ol className="space-y-1">
          {STEPS.map((s, i) => {
            const done = i < index || (s.id === 'connect' && created);
            const current = i === index;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={i > index || Boolean(created)}
                  onClick={() => go(s.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13.5px] transition',
                    current
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground',
                    i < index && 'hover:text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-7 items-center justify-center rounded-full ring-1 transition',
                      done
                        ? 'bg-success text-success-foreground ring-success'
                        : current
                          ? 'bg-primary text-primary-foreground ring-primary'
                          : 'ring-border',
                    )}
                  >
                    {done ? <Check className="size-3.5" /> : <s.icon className="size-3.5" />}
                  </span>
                  {s.label}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="text-muted-foreground mt-auto space-y-2 text-[12px] leading-relaxed">
          <p className="flex gap-2">
            <Sparkles className="text-ai mt-0.5 size-3.5 shrink-0" />{' '}
            {t('Dès la connexion, l’IA trie, priorise et range chaque mail.')}
          </p>
          <p className="flex gap-2">
            <Lock className="mt-0.5 size-3.5 shrink-0" /> {t('Tout reste sur votre Mac.')}
          </p>
        </div>
      </aside>
      {/* A fixed-height column: the step is centred in it and the action bar sits at its foot,
          so Continue stays under the cursor whatever the length of each step. */}
      <div className="flex min-w-0 flex-1 justify-center px-8 py-10">
        <div className="flex h-full max-h-[760px] w-full max-w-[560px] flex-col self-center">
          <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
            <div className="flex min-h-full flex-col justify-center py-6">{body}</div>
          </div>
          <div className="h-[73px] shrink-0">{footer}</div>
        </div>
      </div>
    </div>
  );
}

function BusinessOption({
  selected,
  onClick,
  icon: Icon,
  title,
  hint,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  icon: LucideIcon;
  title: string;
  hint: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-xl ring-1 transition',
        selected ? 'bg-primary/5 ring-primary ring-2' : 'ring-border hover:ring-foreground/15',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        <span className="bg-muted text-muted-foreground ring-border flex size-9 shrink-0 items-center justify-center rounded-lg ring-1">
          <Icon className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium">{title}</span>
          <span className="text-muted-foreground block text-[12px]">{hint}</span>
        </span>
        <span
          className={cn(
            'size-4 rounded-full ring-1',
            selected ? 'border-background bg-primary ring-primary border-[3px]' : 'ring-input',
          )}
        />
      </button>
      {children ? <div className="px-3 pb-3 pl-[60px]">{children}</div> : null}
    </div>
  );
}

function ServerEditor(props: {
  imap: Server;
  smtp: Server;
  setImap: (s: Server) => void;
  setSmtp: (s: Server) => void;
  loginMode: 'email' | 'other';
  setLoginMode: (m: 'email' | 'other') => void;
  login: string;
  setLogin: (v: string) => void;
  email: string;
}) {
  const row = (kind: 'imap' | 'smtp') => {
    const server = kind === 'imap' ? props.imap : props.smtp;
    const set = kind === 'imap' ? props.setImap : props.setSmtp;
    const ports = kind === 'imap' ? { ssl: 993, starttls: 143 } : { ssl: 465, starttls: 587 };
    return (
      <div className="ring-border rounded-xl p-3.5 ring-1">
        <p className="mb-3 flex items-center gap-2 text-[13px] font-medium">
          {kind === 'imap' ? (
            <Inbox className="text-muted-foreground size-4" />
          ) : (
            <Send className="text-muted-foreground size-4" />
          )}
          {kind === 'imap' ? t('Serveur de réception (IMAP)') : t('Serveur d’envoi (SMTP)')}
          <InfoHint>
            {kind === 'imap'
              ? t(
                  'IMAP sert à lire vos mails et à garder vos dossiers synchronisés avec le serveur. Votre hébergeur l’indique souvent sous la forme imap.votre-domaine.com ou mail.votre-domaine.com.',
                )
              : t(
                  'SMTP sert à envoyer vos mails. C’est souvent smtp.votre-domaine.com ou le même serveur que la réception (mail.votre-domaine.com).',
                )}
          </InfoHint>
        </p>
        <div className="grid grid-cols-[1fr_88px] gap-2">
          <Input
            value={server.host}
            onChange={(e) => set({ ...server, host: e.target.value.trim() })}
            placeholder={kind === 'imap' ? t('imap.exemple.com') : t('smtp.exemple.com')}
            className="h-10 font-mono text-[13px]"
          />
          <Input
            value={server.port || ''}
            onChange={(e) => set({ ...server, port: Number(e.target.value) || 0 })}
            placeholder="Port"
            className="h-10 text-center font-mono text-[13px]"
          />
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          {[
            {
              secure: true,
              label: `SSL/TLS · port ${ports.ssl}`,
              tip: t('Connexion chiffrée dès le départ. Le choix le plus sûr, recommandé.'),
            },
            {
              secure: false,
              label: `STARTTLS · port ${ports.starttls}`,
              tip: t(
                'La connexion démarre en clair puis passe en chiffré. À utiliser si votre hébergeur l’indique.',
              ),
            },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() =>
                set({ ...server, secure: o.secure, port: o.secure ? ports.ssl : ports.starttls })
              }
              className={cn(
                'flex h-7 items-center gap-1 rounded-md px-2 text-[12px] ring-1',
                server.secure === o.secure
                  ? 'bg-primary/10 text-primary ring-primary/40'
                  : 'text-muted-foreground ring-border',
              )}
            >
              <Lock className="size-3" />
              {o.label}
            </button>
          ))}
          <InfoHint>
            {t(
              'Le port et le chiffrement vont ensemble : 993/465 pour SSL/TLS, 143/587 pour STARTTLS. Choisir l’option met le port à jour.',
            )}
          </InfoHint>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {row('imap')}
      {row('smtp')}
      <div className="ring-border rounded-xl p-3.5 ring-1">
        <p className="mb-2 flex items-center gap-2 text-[13px] font-medium">
          <User className="text-muted-foreground size-4" />
          {t('Identifiant de connexion')}
          <InfoHint>
            {t(
              'Le nom d’utilisateur que le serveur demande. Dans 95 % des cas c’est l’adresse e-mail complète ; certains hébergeurs n’utilisent que la partie avant le @ ou un identifiant client.',
            )}
          </InfoHint>
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => props.setLoginMode('email')}
            className={cn(
              'h-8 rounded-lg px-2.5 text-[12.5px] ring-1',
              props.loginMode === 'email'
                ? 'bg-primary/10 text-primary ring-primary/40'
                : 'text-muted-foreground ring-border',
            )}
          >
            {t('Mon adresse ({email}) · recommandé', {
              email: props.email || t('adresse complète'),
            })}
          </button>
          <button
            type="button"
            onClick={() => props.setLoginMode('other')}
            className={cn(
              'h-8 rounded-lg px-2.5 text-[12.5px] ring-1',
              props.loginMode === 'other'
                ? 'bg-primary/10 text-primary ring-primary/40'
                : 'text-muted-foreground ring-border',
            )}
          >
            {t('Un autre identifiant')}
          </button>
        </div>
        {props.loginMode === 'other' ? (
          <Input
            value={props.login}
            onChange={(e) => props.setLogin(e.target.value)}
            placeholder={t('identifiant fourni par l’hébergeur')}
            className="mt-2 h-10"
            autoFocus
          />
        ) : null}
      </div>
    </div>
  );
}

function ConnectStep(props: {
  email: string;
  testing: boolean;
  creating: boolean;
  result: {
    imap: { ok: boolean; error: string | null };
    smtp: { ok: boolean; error: string | null };
  } | null;
  created: string | null;
  error: string | null;
  onFix: (step: StepId) => void;
  onRetry: () => void;
  onFinish: () => void;
  onAnother: () => void;
}) {
  const items = [
    {
      label: t('Connexion au serveur de réception'),
      state: props.testing ? 'run' : props.result ? (props.result.imap.ok ? 'ok' : 'ko') : 'wait',
      error: props.result?.imap.error,
    },
    {
      label: t('Connexion au serveur d’envoi'),
      state: props.testing ? 'run' : props.result ? (props.result.smtp.ok ? 'ok' : 'ko') : 'wait',
      error: props.result?.smtp.error,
    },
    {
      label: t('Ajout de la boîte et lancement de la synchronisation'),
      state: props.created ? 'ok' : props.creating ? 'run' : props.error ? 'ko' : 'wait',
      error: props.error,
    },
  ] as const;
  const authFailed =
    props.result &&
    [props.result.imap.error, props.result.smtp.error].some(
      (e) => e && /identifiants|mot de passe|credentials|password/i.test(e),
    );

  if (props.created) {
    return (
      <div className="text-center">
        <span className="bg-success/10 text-success mx-auto mb-5 flex size-14 items-center justify-center rounded-full">
          <Check className="size-7" />
        </span>
        <h2 className="text-[22px] font-semibold tracking-tight">
          {t('{email} est connectée', { email: props.created })}
        </h2>
        <p className="text-muted-foreground mx-auto mt-2 max-w-sm text-[14px] leading-relaxed">
          {t(
            'Vos mails arrivent. L’IA les trie au fur et à mesure : priorités, opportunités, codes OTP, spam écarté.',
          )}
        </p>
        <div className="mt-7 flex justify-center gap-2">
          <button
            type="button"
            onClick={props.onAnother}
            className="ring-border hover:bg-accent hover:text-accent-foreground h-10 rounded-lg px-4 text-[13.5px] ring-1"
          >
            {t('Ajouter une autre boîte')}
          </button>
          <button
            type="button"
            onClick={props.onFinish}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-10 items-center gap-2 rounded-lg px-5 text-[14px] font-medium"
          >
            {t('Ouvrir ma boîte de réception')} <ArrowRight className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <StepHeader
        icon={ShieldCheck}
        title={t('Connexion à votre boîte')}
        subtitle={t('ZMail vérifie l’accès à {email} avant de l’ajouter.', { email: props.email })}
      />
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.label} className="ring-border rounded-xl p-3 ring-1">
            <p className="flex items-center gap-2.5 text-[13.5px]">
              {item.state === 'ok' ? (
                <Check className="text-success size-4" />
              ) : item.state === 'ko' ? (
                <X className="text-destructive size-4" />
              ) : item.state === 'run' ? (
                <Loader2 className="text-primary size-4 animate-spin" />
              ) : (
                <CircleDashed className="text-muted-foreground size-4" />
              )}
              {item.label}
            </p>
            {item.state === 'ko' && item.error ? (
              <p className="pl-6.5 text-destructive mt-1 text-[12.5px]">{item.error}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {props.result && (!props.result.imap.ok || !props.result.smtp.ok) ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {authFailed ? (
            <button
              type="button"
              onClick={() => props.onFix('password')}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium"
            >
              <KeyRound className="size-3.5" /> {t('Corriger le mot de passe')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => props.onFix('servers')}
            className="ring-border hover:bg-accent hover:text-accent-foreground flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] ring-1"
          >
            <ServerCog className="size-3.5" /> {t('Vérifier les serveurs')}
          </button>
          <button
            type="button"
            onClick={props.onRetry}
            className="text-muted-foreground hover:text-foreground h-9 px-3 text-[13px]"
          >
            {t('Réessayer')}
          </button>
        </div>
      ) : null}
    </>
  );
}
