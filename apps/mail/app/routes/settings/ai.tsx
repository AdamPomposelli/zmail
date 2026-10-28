import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Apple, Check, Lock, CloudUpload, Hand, ShieldCheck, CheckCircle2, ChevronsUpDown, Cpu, ExternalLink, Gauge, KeyRound, Loader2, Plus, RotateCcw, Sparkles, Trash2, XCircle, Target, Zap, Coins } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Card, GhostButton, PrimaryButton, SettingsPage } from '@/components/settings/ui';
import { openExternal } from '@/lib/native';
import { useTRPC, type Outputs } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { intlLocale, locale, num, t, tp } from '@/lib/i18n';
import { BrandLogo, brandForModel, brandForProvider, brandForService } from '@/components/brand-logo';
import { FreeBadge } from '@/components/ui/free-badge';

type Status = Outputs['ai']['status'];
type CapabilityRow = Status['capabilities'][number];
type Kind = Status['kinds'][number]['id'];

const money = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '—';
  if (v === 0) return t('gratuit');
  // Providers bill in dollars; small amounts keep two significant digits (0,032 $) so models stay comparable.
  if (v < 0.001) return `< ${usd(num(0.001))}`;
  if (v < 1) return usd(num(v, { maximumSignificantDigits: 2 }));
  return usd(num(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
};
/** Dollar amount already formatted for the language: "0,03 $" in French, "$0.03" in English. */
const usd = (formatted: string) => (locale === 'en' ? `$${formatted}` : `${formatted} $`);
/** "Google: Gemini 2.5 Flash Lite" → "Gemini 2.5 Flash Lite" (the service is shown elsewhere). */
const modelName = (name: string) => name.replace(/^[^:]{2,20}:\s*/, '');
const perDay = (v: number) => (v >= 10 ? Math.round(v).toString() : num(v, { maximumFractionDigits: 1 }));

function ScoreBadge({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) return <span className="text-muted-foreground text-xs">{t('non mesuré')}</span>;
  const tone = score >= 95 ? 'bg-success/10 text-success' : score >= 85 ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive';
  return <span className={cn('inline-flex h-5 items-center rounded-md px-1.5 text-[11.5px] font-semibold tabular-nums', tone)}>{score}/100</span>;
}

export default function AiSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: status } = useQuery(trpc.ai.status.queryOptions());
  const [adding, setAdding] = useState(false);
  const [customize, setCustomize] = useState(false);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: trpc.ai.status.queryKey() });
  const setApple = useMutation(trpc.ai.setAppleEnabled.mutationOptions({ onSuccess: invalidate }));
  const removeConnection = useMutation(trpc.ai.removeConnection.mutationOptions({ onSuccess: invalidate }));
  const setOverride = useMutation(trpc.ai.setOverride.mutationOptions({ onSuccess: invalidate }));
  const setChatPerDay = useMutation(trpc.ai.setChatPerDay.mutationOptions({ onSuccess: invalidate }));
  const setMailsPerDay = useMutation(trpc.ai.setMailsPerDay.mutationOptions({ onSuccess: invalidate }));
  const setPreset = useMutation(
    trpc.ai.setPreset.mutationOptions({
      onSuccess: (_, { preset }) => {
        invalidate();
        toast.success(t('Mode « {label} » activé', { label: PRESET_TEXT[preset].label }), { description: t('Il s’applique aux prochains mails. « Reclasser tous les mails » l’applique aussi aux anciens.') });
      },
    }),
  );
  const retriage = useMutation(trpc.ai.retriageAll.mutationOptions({ onSuccess: (n) => toast.success(tp(n, '{n} mail en cours de reclassement', '{n} mails en cours de reclassement')) }));
  if (!status) return null;

  const monthly = status.capabilities.reduce((sum, c) => sum + (c.active?.monthlyCost ?? 0), 0);
  const hasOverrides = status.capabilities.some((c) => c.override);

  return (
    <SettingsPage
      title={t('Intelligence artificielle')}
      description={t('ZMail choisit lui-même le meilleur modèle pour chaque tâche, d’après ses benchmarks. Vous connectez un service, il s’occupe du reste.')}
      actions={<GhostButton onClick={() => retriage.mutate()}>{retriage.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}{t('Reclasser tous les mails')}</GhostButton>}
    >
      <PresetPicker status={status} onChange={(preset) => setPreset.mutate({ preset })} pending={setPreset.isPending} />

      <Card id="apple-intelligence">
        <div className="flex items-start gap-4">
          <BrandLogo brand="apple-intelligence" tile size={44} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[14px] font-semibold">
              Apple Intelligence
              <FreeBadge />
              <span className={cn('rounded-sm px-1.5 text-[11px] font-medium', status.apple.available ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
                {status.apple.available ? t('Disponible') : t('Indisponible')}
              </span>
            </p>
            <p className="text-muted-foreground mt-0.5 text-[12.5px]">{t('Modèle on-device de macOS : gratuit, privé, prioritaire dès qu’il est disponible.')}</p>
            {status.apple.guidance ? <AppleWarning guidance={status.apple.guidance} reason={status.apple.reason} /> : null}
          </div>
          <Switch checked={status.appleEnabled} onCheckedChange={(enabled) => setApple.mutate({ enabled })} />
        </div>
      </Card>

      <Card
        title={t('Services connectés')}
        description={t('Une clé suffit : pas de modèle à choisir.')}
        action={
          <PrimaryButton onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            {t('Connecter')}
          </PrimaryButton>
        }
      >
        {status.connections.length ? (
          <ul className="-my-1 divide-y divide-border">
            {status.connections.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2.5">
                <BrandLogo brand={brandForService(c.kind)} tile size={32} fallback={c.name} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium">{c.name}</p>
                  <p className="text-muted-foreground truncate text-[12px]">
                    {tp(c.models, '{n} modèle disponible', '{n} modèles disponibles')} · {c.hasKey ? t('clé enregistrée (chiffrée)') : t('sans clé')}
                  </p>
                </div>
                <GhostButton className="hover:text-destructive" onClick={() => window.confirm(t('Déconnecter {name} ?', { name: c.name })) && removeConnection.mutate({ id: c.id })}>
                  <Trash2 className="size-3.5" />
                </GhostButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-[13px]">{t('Aucun service. Sans IA disponible, ZMail trie avec son moteur local (score 93/100 sur nos benchmarks).')}</p>
        )}
      </Card>

      <Card
        title={t('Orchestration des modèles')}
        description={status.benchmarkedAt ? t('Choix automatique d’après nos benchmarks du {date} : qualité d’abord, puis coût et rapidité.', { date: new Date(status.benchmarkedAt).toLocaleDateString(intlLocale) }) : t('Choix automatique.')}
        action={
          <label className="text-muted-foreground flex items-center gap-2 text-[12.5px] whitespace-nowrap">
            {t('Personnaliser')}
            <Switch checked={customize || hasOverrides} onCheckedChange={setCustomize} />
          </label>
        }
      >
        <div className="text-muted-foreground -mx-1 mb-1 grid grid-cols-[1fr_1.9fr_76px_60px_84px] gap-3 px-1 text-[11px] font-medium tracking-wide uppercase">
          <span>{t('Capacité')}</span>
          <span>{t('Modèle utilisé')}</span>
          <span>{t('Qualité')}</span>
          <span>{t('Latence')}</span>
          <span className="text-right">{t('Coût / mois')}</span>
        </div>
        <div className="divide-y divide-border">
          {status.capabilities.map((cap) => (
            <CapabilityLine key={cap.id} cap={cap} status={status} customize={customize || hasOverrides} onPick={(override) => setOverride.mutate({ capability: cap.id, override })} />
          ))}
        </div>
      </Card>

      <ServerSyncCard />

      <ForecastCard status={status} monthly={monthly} onChatPerDay={(value) => setChatPerDay.mutate({ value })} onMailsPerDay={(value) => setMailsPerDay.mutate({ value })} onUse={(capability, override) => setOverride.mutate({ capability, override })} />

      {status.usage.length ? (
        <Card title={t('Consommation réelle (30 derniers jours)')}>
          <div className="text-muted-foreground grid grid-cols-[1fr_1.6fr_80px_100px_90px] gap-3 text-[11px] font-medium tracking-wide uppercase">
            <span>{t('Capacité')}</span>
            <span>{t('Modèle')}</span>
            <span className="text-right">{t('Appels')}</span>
            <span className="text-right">{t('Jetons')}</span>
            <span className="text-right">{t('Coût')}</span>
          </div>
          {status.usage.map((u) => (
            <div key={`${u.capability}-${u.model}`} className="grid grid-cols-[1fr_1.6fr_80px_100px_90px] gap-3 py-1.5 text-[13px]">
              <span>{status.capabilities.find((c) => c.id === u.capability)?.label ?? u.capability}</span>
              <span className="flex min-w-0 items-center gap-1.5">
                <BrandLogo brand={brandForModel(u.model)} size={14} />
                <span className="truncate font-mono text-[12px]">{u.model}</span>
              </span>
              <span className="text-right tabular-nums">{u.calls}</span>
              <span className="text-right tabular-nums">{num(u.prompt + u.completion)}</span>
              <span className="text-right tabular-nums">{money(u.cost)}</span>
            </div>
          ))}
        </Card>
      ) : null}

      <AdvancedAiCard status={status} onPick={(capability, override) => setOverride.mutate({ capability, override })} />

      <ConnectDialog open={adding} onOpenChange={setAdding} kinds={status.kinds} onDone={invalidate} />
    </SettingsPage>
  );
}

function AppleWarning({ guidance, reason }: { guidance: NonNullable<Status['apple']['guidance']>; reason: string | null }) {
  return (
    <div className="mt-3 bg-warning/10 ring-warning/30 rounded-xl p-3.5 ring-1">
      <p className="flex items-start gap-2 text-warning text-[13.5px] font-semibold">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        {guidance.title}
      </p>
      <p className="text-foreground/85 mt-1.5 pl-6 text-[13px] leading-relaxed">{guidance.message}</p>
      {guidance.steps.length ? (
        <ol className="text-foreground/80 mt-2 list-decimal space-y-1 pl-11 text-[12.5px] leading-relaxed marker:text-warning">
          {guidance.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3 pl-6">
        {guidance.settingsUrl ? (
          <button onClick={() => openExternal(guidance.settingsUrl!)} className="flex h-8 items-center gap-1.5 bg-warning text-warning-foreground hover:bg-warning/90 rounded-lg px-3 text-[12.5px] font-medium transition">
            {t('Ouvrir les Réglages Système')}
            <ExternalLink className="size-3.5" />
          </button>
        ) : null}
        <span className="text-muted-foreground text-[11.5px]">
          {guidance.detected ? t('Cause vérifiée par ZMail') : t('Cause probable : macOS ne la précise pas')} · {t('code macOS : {reason}', { reason: reason ?? '' })}
        </span>
      </div>
    </div>
  );
}

function CapabilityLine({ cap, status, customize, onPick }: { cap: CapabilityRow; status: Status; customize: boolean; onPick: (o: { providerId: string; model: string } | null) => void }) {
  const active = cap.active;
  return (
    <div className="grid grid-cols-[1fr_1.9fr_76px_60px_84px] items-center gap-3 py-3">
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium">{cap.label}</p>
        <p className="text-muted-foreground text-[11.5px] leading-snug">{cap.description}</p>
      </div>
      <div className="min-w-0">
        {customize ? (
          <ModelPicker cap={cap} status={status} onPick={onPick} />
        ) : active ? (
          <p className="flex min-w-0 items-center gap-1.5 text-[13px]">
            <BrandLogo brand={active.source === 'apple' ? 'apple-intelligence' : brandForModel(active.model)} tile size={22} fallback={active.name} />
            <span className="truncate font-medium">{modelName(active.name)}</span>
            {active.source === 'apple' ? <FreeBadge /> : <span className="bg-ai/10 text-ai shrink-0 rounded-sm px-1 text-[10.5px]">auto</span>}
          </p>
        ) : (
          <p className="text-muted-foreground text-[13px]">{t('Moteur local')}</p>
        )}
        {active && !customize ? <p className="text-muted-foreground truncate text-[11.5px]">{active.providerName}{cap.fallbacks.length ? ` · ${t('relais : {models}', { models: cap.fallbacks.map((f) => modelName(f.name)).join(', ') })}` : ''}</p> : null}
      </div>
      <ScoreBadge score={active?.benchmark?.score ?? (active?.source === 'apple' ? null : undefined)} />
      <span className="text-muted-foreground text-[12.5px] tabular-nums">{active?.benchmark ? `${(active.benchmark.latencyP50 / 1000).toFixed(1)} s` : '—'}</span>
      <span className="text-right text-[13px] font-medium tabular-nums">{active ? money(active.monthlyCost) : t('gratuit')}</span>
    </div>
  );
}

function ModelPicker({ cap, status, onPick }: { cap: CapabilityRow; status: Status; onPick: (o: { providerId: string; model: string } | null) => void }) {
  const [open, setOpen] = useState(false);
  const options = useMemo(
    () =>
      [...status.options].sort((a, b) => {
        const sa = a.scores[cap.id];
        const sb = b.scores[cap.id];
        if (sa !== null && sb !== null) return sb - sa;
        if (sa !== null) return -1;
        if (sb !== null) return 1;
        return (a.monthly[cap.id] ?? Infinity) - (b.monthly[cap.id] ?? Infinity);
      }),
    [status.options, cap.id],
  );
  const current = cap.override ? options.find((o) => o.providerId === cap.override!.providerId && o.id === cap.override!.model) : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] ring-border hover:bg-accent/50 ring-1">
        <span className="min-w-0 flex-1 truncate">{current ? modelName(current.name) : <span>{t('Automatique')} <span className="text-muted-foreground">— {cap.active ? modelName(cap.active.name) : t('moteur local')}</span></span>}</span>
        <ChevronsUpDown className="text-muted-foreground size-3.5 shrink-0" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[480px] p-0">
        <Command>
          <CommandInput placeholder={t('Rechercher un modèle…')} />
          <CommandList className="max-h-[340px]">
            <CommandEmpty>{t('Aucun modèle.')}</CommandEmpty>
            <CommandGroup heading={t('Recommandé')}>
              <CommandItem value="auto automatique" onSelect={() => (onPick(null), setOpen(false))}>
                <Sparkles className="text-ai" />
                <span className="flex-1">{t('Automatique (recommandé)')}</span>
                {!cap.override ? <Check className="size-3.5" /> : null}
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading={t('Modèles — qualité mesurée et coût pour vos {n} appels/jour', { n: perDay(cap.callsPerDay) })}>
              {options.map((o) => (
                <CommandItem key={`${o.providerId}/${o.id}`} value={`${o.id} ${o.name}`} onSelect={() => (onPick({ providerId: o.providerId, model: o.id }), setOpen(false))}>
                  <BrandLogo brand={brandForModel(o.id)} tile size={26} fallback={o.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{modelName(o.name)}</span>
                    <span className="text-muted-foreground block truncate font-mono text-[11px]">{o.id}</span>
                  </span>
                  <ScoreBadge score={o.scores[cap.id]} />
                  <span className="w-20 text-right text-[12px] tabular-nums">{t('{cost}/mois', { cost: money(o.monthly[cap.id]) })}</span>
                  {current?.id === o.id ? <Check className="size-3.5" /> : <span className="size-3.5" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** What ZMail writes back to the mail servers: your own actions always, the AI's sorting once trusted. */
function ServerSyncCard() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data } = useQuery(trpc.serverSync.status.queryOptions());
  const setMode = useMutation(
    trpc.serverSync.setMode.mutationOptions({
      onSuccess: (_, { mode }) => {
        void queryClient.invalidateQueries({ queryKey: trpc.serverSync.status.queryKey() });
        if (mode === 'all') toast.success(t('L’IA range maintenant vos mails partout'), { description: t('Les mails des 30 derniers jours sont mis à jour en arrière-plan.') });
      },
    }),
  );
  if (!data) return null;
  const { trust, mode, report } = data;
  const pct = (v: number) => t('{n} %', { n: num(v * 100, { maximumFractionDigits: 1 }) });
  const criteria = [
    { ok: trust.days >= 14, label: trust.days >= 14 ? tp(trust.days, '{n} jour d’utilisation', '{n} jours d’utilisation') : tp(trust.days, '{n} jour sur 14 d’utilisation', '{n} jours sur 14 d’utilisation') },
    {
      ok: trust.decisions >= 30,
      label:
        trust.decisions >= 30
          ? tp(trust.decisions, '{n} mail trié par l’IA', '{n} mails triés par l’IA')
          : tp(trust.decisions, '{n} mail trié par l’IA (30 minimum)', '{n} mails triés par l’IA (30 minimum)'),
    },
    { ok: trust.decisions > 0 && trust.rate <= 0.05, label: tp(trust.corrections, '{n} correction de votre part · {rate} (5 % maximum)', '{n} corrections de votre part · {rate} (5 % maximum)', { rate: pct(trust.rate) }) },
  ];
  const choose = (next: 'manual' | 'all') => {
    if (next === mode) return;
    if (next === 'all' && !trust.ready && !window.confirm(t('On n’a pas encore vérifié que l’IA se trompe rarement chez vous (2 semaines avec peu de corrections sont conseillées). La laisser ranger vos mails partout quand même ?'))) return;
    setMode.mutate({ mode: next });
  };

  return (
    <Card
      title={t('Qui peut ranger vos mails partout ?')}
      description={t('Vos mails sont rangés chez Gmail, mailbox.org, Namecheap… C’est ce que voient aussi votre téléphone et vos autres apps. Ici, vous décidez si l’IA a le droit d’y toucher, ou si elle range seulement dans ZMail.')}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <SyncOption
          selected={mode === 'manual'}
          onClick={() => choose('manual')}
          icon={Hand}
          title={t('Seulement moi')}
          badge={mode === 'manual' && !trust.ready ? t('Conseillé pour l’instant') : undefined}
          hint={t('Quand vous archivez, supprimez ou classez un mail, c’est fait partout, sur votre téléphone aussi. Le tri de l’IA, lui, reste dans ZMail : si elle se trompe, rien ne bouge ailleurs.')}
        />
        <SyncOption
          selected={mode === 'all'}
          onClick={() => choose('all')}
          icon={CloudUpload}
          title={t('Moi et l’IA')}
          badge={trust.ready ? t('L’IA est prête') : undefined}
          hint={t('L’IA range aussi vos mails partout : ses catégories apparaissent comme libellés « ZMail/… » dans Gmail ou vos autres apps, et le spam qu’elle repère part dans votre dossier Spam. À choisir quand elle ne se trompe presque plus.')}
        />
      </div>

      <div className="mt-4 bg-muted ring-border rounded-xl p-4 ring-1">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className={cn('size-4', trust.ready ? 'text-success' : 'text-warning')} />
          <p className="text-[13px] font-medium">
            {trust.ready
              ? t('L’IA ne se trompe presque jamais chez vous : vous pouvez la laisser ranger partout.')
              : tp(trust.daysLeft, 'On vérifie d’abord que l’IA ne se trompe pas : encore {n} jour conseillé', 'On vérifie d’abord que l’IA ne se trompe pas : encore {n} jours conseillés')}
          </p>
        </div>
        <div className="mb-3 h-1.5 overflow-hidden bg-foreground/10 rounded-full">
          <div className={cn('h-full rounded-full transition-all', trust.ready ? 'bg-success' : 'bg-warning')} style={{ width: `${Math.min(100, (trust.days / 14) * 100)}%` }} />
        </div>
        <ul className="space-y-1.5 text-[12.5px]">
          {criteria.map((c) => (
            <li key={c.label} className="flex items-center gap-2">
              {c.ok ? <CheckCircle2 className="text-success size-3.5" /> : <span className="size-3.5 ring-input rounded-full ring-1 ring-inset" />}
              <span className={c.ok ? '' : 'text-muted-foreground'}>{c.label}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground mt-3 text-[11.5px] leading-relaxed">
          {t('Une correction, c’est quand vous défaites un choix de l’IA : vous sortez un mail du spam, vous en signalez un, vous retirez une catégorie ou vous changez le business.')}
        </p>
      </div>

      <div className="text-muted-foreground mt-4 space-y-1.5 text-[12px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {data.accounts.map((a) => (
            <span key={a.id} className="flex items-center gap-1.5">
              <BrandLogo brand={brandForProvider(a.provider)} size={14} fallback={a.email} />
              <span className="text-foreground">{a.email}</span> · {a.labels === 'labels' ? t('libellés Gmail') : t('mots-clés IMAP')}
            </span>
          ))}
        </div>
        {report ? (
          <p>
            {t('{when} : {labelled}, {moved}{failed}.', {
              when: report.reason === 'backfill' ? t('Dernière mise à jour') : t('Depuis l’activation'),
              labelled: tp(report.labelled, '{n} mail étiqueté', '{n} mails étiquetés'),
              moved: tp(report.movedToJunk, '{n} spam déplacé', '{n} spams déplacés'),
              failed: report.failed ? tp(report.failed, ', {n} échec', ', {n} échecs') : '',
            })}
          </p>
        ) : null}
        <p>{t('Revenir à « Seulement moi » n’efface pas les libellés déjà ajoutés.')}</p>
      </div>
    </Card>
  );
}

function SyncOption({ selected, onClick, icon: Icon, title, hint, badge }: { selected: boolean; onClick: () => void; icon: typeof Hand; title: string; hint: string; badge?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex flex-col gap-2 rounded-xl p-3.5 text-left ring-1 transition',
        selected ? 'bg-primary/5 ring-primary ring-2' : 'ring-border hover:bg-accent/50',
      )}
    >
      <span className="flex items-center gap-2">
        <span className={cn('flex size-7 items-center justify-center rounded-lg', selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
          <Icon className="size-3.5" />
        </span>
        <span className="text-[13.5px] font-medium">{title}</span>
        {selected ? <Check className="text-primary ml-auto size-4" /> : null}
      </span>
      <span className="text-muted-foreground text-[12px] leading-relaxed">{hint}</span>
      {badge ? <span className="bg-success/10 text-success w-fit rounded-sm px-1.5 py-0.5 text-[11px] font-medium">{badge}</span> : null}
    </button>
  );
}

function ForecastCard({ status, monthly, onChatPerDay, onMailsPerDay, onUse }: { status: Status; monthly: number; onChatPerDay: (v: number) => void; onMailsPerDay: (v: number | null) => void; onUse: (cap: CapabilityRow['id'], o: { providerId: string; model: string } | null) => void }) {
  const triage = status.capabilities.find((c) => c.id === 'triage')!;
  const ranking = triage.ranking.slice(0, 8);
  const [chat, setChat] = useState(status.chatPerDay);
  const [mails, setMails] = useState(Math.round(status.mailsPerDay ?? status.volume.perDay));
  return (
    <Card
      title={t('Prévisionnel')}
      description={t('Calculé sur votre trafic réel : {perDay} mails reçus par jour en moyenne (observé sur {days}, {accounts}). Modifiez le volume pour simuler d’autres boîtes.', {
        perDay: perDay(status.volume.perDay),
        days: tp(status.volume.windowDays, '{n} jour', '{n} jours'),
        accounts: tp(status.volume.accounts.length, '{n} compte', '{n} comptes'),
      })}
    >
      <div className="mb-4 flex flex-wrap gap-1.5">
        {status.volume.accounts.map((a) => (
          <span key={a.id} className="bg-muted rounded-md px-2 py-0.5 text-[12px]">
            {a.email} <span className="text-muted-foreground tabular-nums">· {t('{n}/j', { n: perDay(a.perDay) })}</span>
          </span>
        ))}
      </div>
      <div className="text-muted-foreground grid grid-cols-[1.2fr_90px_110px_90px_100px] gap-3 text-[11px] font-medium tracking-wide uppercase">
        <span>{t('Capacité')}</span>
        <span className="text-right">{t('Appels / jour')}</span>
        <span className="text-right">{t('Jetons / appel')}</span>
        <span className="text-right">{t('Coût / jour')}</span>
        <span className="text-right">{t('Coût / mois')}</span>
      </div>
      {status.capabilities.map((c) => (
        <div key={c.id} className="grid grid-cols-[1.2fr_90px_110px_90px_100px] items-center gap-3 border-border border-b py-2 text-[13px]">
          <span>
            {c.label}
            {c.id === 'triage' ? (
              <span className="text-muted-foreground ml-2 inline-flex items-center gap-1 text-[11.5px]">
                <Input type="number" value={mails} onChange={(e) => setMails(Number(e.target.value))} onBlur={() => onMailsPerDay(Math.max(0, mails))} className="h-6 w-16 px-1.5 text-[12px]" />
                {t('mails/j')}
                {status.mailsPerDay !== null ? (
                  <button onClick={() => (setMails(Math.round(status.volume.perDay)), onMailsPerDay(null))} className="hover:text-foreground underline-offset-2 hover:underline">
                    {t('revenir à l’observé ({n})', { n: perDay(status.volume.perDay) })}
                  </button>
                ) : null}
              </span>
            ) : null}
            {c.id === 'chat' ? (
              <span className="text-muted-foreground ml-2 inline-flex items-center gap-1 text-[11.5px]">
                <Input
                  type="number"
                  value={chat}
                  onChange={(e) => setChat(Number(e.target.value))}
                  onBlur={() => onChatPerDay(Math.max(0, chat))}
                  className="h-6 w-14 px-1.5 text-[12px]"
                />
                {t('demandes/j')}
              </span>
            ) : null}
          </span>
          <span className="text-right tabular-nums">{perDay(c.callsPerDay)}</span>
          <span className="text-muted-foreground text-right tabular-nums">{num(c.tokens.promptTokens + c.tokens.completionTokens)}</span>
          <span className="text-right tabular-nums">{money(c.active ? (c.active.monthlyCost === null ? null : c.active.monthlyCost / 30) : 0)}</span>
          <span className="text-right font-medium tabular-nums">{c.active ? money(c.active.monthlyCost) : t('gratuit')}</span>
        </div>
      ))}
      <div className="flex items-center justify-between pt-3 text-[14px]">
        <span className="font-semibold">{t('Total estimé')}</span>
        <span className="font-semibold tabular-nums">{t('{cost} / mois', { cost: money(monthly) })}</span>
      </div>

      {ranking.length ? (
        <div className="mt-6">
          <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
            <Gauge className="size-3.5" /> {t('Comparatif pour le tri de vos mails')}
          </p>
          <div className="text-muted-foreground grid grid-cols-[1.6fr_80px_70px_100px_90px] gap-3 text-[11px] font-medium tracking-wide uppercase">
            <span>{t('Modèle')}</span>
            <span>{t('Qualité')}</span>
            <span>{t('Latence')}</span>
            <span className="text-right">{t('Coût / mois')}</span>
            <span />
          </div>
          {ranking.map((r) => {
            const inUse = triage.active?.providerId === r.providerId && triage.active?.model === r.model;
            return (
              <div key={`${r.providerId}/${r.model}`} className="grid grid-cols-[1.6fr_80px_70px_100px_90px] items-center gap-3 py-1.5 text-[13px]">
                <span className="flex min-w-0 items-center gap-2">
                  <BrandLogo brand={brandForModel(r.model)} tile size={22} fallback={r.model} />
                  <span className="truncate font-mono text-[12px]">{r.model}</span>
                </span>
                <ScoreBadge score={r.score} />
                <span className="text-muted-foreground tabular-nums">{(r.latencyP50 / 1000).toFixed(1)} s</span>
                <span className="text-right tabular-nums">{money(r.monthlyCost)}</span>
                <span className="text-right">
                  {inUse ? (
                    <span className="text-success text-[12px]">{t('Utilisé')}</span>
                  ) : (
                    <button onClick={() => onUse('triage', { providerId: r.providerId, model: r.model })} className="text-primary text-[12px] hover:underline">
                      {t('Utiliser')}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
          {triage.override ? (
            <button onClick={() => onUse('triage', null)} className="text-muted-foreground hover:text-foreground mt-2 flex items-center gap-1 text-[12px]">
              <RotateCcw className="size-3" /> {t('Revenir au choix automatique')}
            </button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function ConnectDialog({ open, onOpenChange, kinds, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; kinds: Status['kinds']; onDone: () => void }) {
  const trpc = useTRPC();
  const [kind, setKind] = useState<Kind>('zenmux');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const test = useMutation(trpc.ai.testConnection.mutationOptions());
  const save = useMutation(trpc.ai.saveConnection.mutationOptions());
  const meta = kinds.find((k) => k.id === kind)!;
  const reset = () => (setApiKey(''), setBaseUrl(''), test.reset());

  return (
    <Dialog open={open} onOpenChange={(o) => (onOpenChange(o), o ? null : reset())}>
      <DialogContent showOverlay className="max-w-[500px]">
        <DialogTitle>{t('Connecter un service d’IA')}</DialogTitle>
        <DialogDescription>{t('ZMail choisit ensuite le bon modèle pour chaque tâche. La clé est chiffrée localement (AES-256, clé dans le Trousseau macOS).')}</DialogDescription>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {kinds.map((k) => (
              <button
                key={k.id}
                onClick={() => (setKind(k.id), test.reset())}
                className={cn('rounded-xl px-3 py-2.5 text-left text-[13px] ring-1 transition', kind === k.id ? 'bg-muted ring-primary' : 'ring-border hover:bg-accent/50')}
              >
                <span className="flex items-center gap-2 font-medium">
                  <BrandLogo brand={brandForService(k.id)} tile size={24} fallback={k.name} />
                  {k.name}
                </span>
              </button>
            ))}
          </div>
          {meta.editableUrl ? (
            <div className="space-y-1.5">
              <Label>{t('URL de l’API')}</Label>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={meta.baseUrl || 'https://…/v1'} />
            </div>
          ) : null}
          {meta.needsKey || kind === 'custom' ? (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <KeyRound className="size-3.5" /> {t('Clé API')}
                {meta.keyUrl ? (
                  <button type="button" onClick={() => openExternal(meta.keyUrl!)} className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1 text-[12px] font-normal">
                    {t('Obtenir une clé')} <ExternalLink className="size-3" />
                  </button>
                ) : null}
              </Label>
              <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" autoFocus />
            </div>
          ) : null}
          {test.data ? (
            <p className={cn('flex items-start gap-2 text-[13px]', test.data.ok ? 'text-success' : 'text-destructive')}>
              {test.data.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
              {test.data.ok ? t('Connecté : {models} modèles, réponse en {ms} ms.', { models: ('models' in test.data ? test.data.models : undefined) ?? '', ms: test.data.latencyMs ?? '' }) : test.data.error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <GhostButton onClick={() => test.mutate({ kind, apiKey: apiKey || undefined, baseUrl: baseUrl || undefined })} disabled={test.isPending}>
              {test.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t('Tester')}
            </GhostButton>
            <PrimaryButton
              disabled={(meta.needsKey && !apiKey) || (meta.editableUrl && !baseUrl && !meta.baseUrl) || save.isPending}
              onClick={() =>
                save.mutate(
                  { kind, apiKey: apiKey || undefined, baseUrl: baseUrl || undefined },
                  { onSuccess: () => (onOpenChange(false), reset(), onDone(), toast.success(t('{name} connecté', { name: meta.name }), { description: t('Les modèles sont choisis automatiquement.') })) },
                )
              }
            >
              {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t('Connecter')}
            </PrimaryButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Advanced: the instructions of every AI action, editable, measured before they go live.
// ─────────────────────────────────────────────────────────────────────────────

type Setup = Outputs['prompts']['setup'];
type ActionSetup = Setup['actions'][number];
type JevDraft = { questions: Record<string, { instructions: string; yes: string; no: string }>; thresholds: { yes: number; lean: number } };
type LabResult = Outputs['prompts']['evaluate'];

const BY_LABEL: Record<string, string> = { user: t('Vous'), agent: t('Chat IA'), mcp: t('Client MCP'), reset: t('Défaut') };

/** Live progress of a lab run (SSE `lab` events). */
function useLabProgress(active: boolean) {
  const [progress, setProgress] = useState<{ phase: string; done: number; total: number } | null>(null);
  useEffect(() => {
    if (!active) return setProgress(null);
    const source = new EventSource('/api/events');
    source.addEventListener('lab', (e) => setProgress(JSON.parse((e as MessageEvent).data)));
    return () => source.close();
  }, [active]);
  return progress;
}

function AdvancedAiCard({ status, onPick }: { status: Status; onPick: (cap: CapabilityRow['id'], o: { providerId: string; model: string } | null) => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [actionId, setActionId] = useState<ActionSetup['id']>('triage');
  const { data: setup } = useQuery({ ...trpc.prompts.setup.queryOptions(), enabled: open });
  const { data: report } = useQuery({ ...trpc.prompts.report.queryOptions({ days: 30 }), enabled: open });

  return (
    <Card
      id="ia-avancee"
      title={t('Avancé : prompts et modèles par action')}
      description={t('Pour régler l’IA vous-même : le modèle de chaque action, et ce qu’on lui demande. Chaque version se mesure sur vos mails avant d’être appliquée, et l’historique permet de revenir en arrière.')}
      action={
        <label className="text-muted-foreground flex items-center gap-2 text-[12.5px] whitespace-nowrap">
          {t('Afficher')}
          <Switch checked={open} onCheckedChange={setOpen} />
        </label>
      }
    >
      {!open ? (
        <p className="text-muted-foreground text-[12.5px]">
          {t('Tri des mails, chat IA et désinscription : consignes modifiables, test sur vos propres mails, amélioration automatique par le chat IA ou par un client MCP (Claude, Cursor…).')}
        </p>
      ) : !setup ? (
        <p className="text-muted-foreground flex items-center gap-2 text-[13px]">
          <Loader2 className="size-3.5 animate-spin" /> {t('Chargement…')}
        </p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-1.5">
            {setup.actions.map((a) => {
              const custom = a.llm.custom || Boolean(a.jev?.custom);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setActionId(a.id)}
                  className={cn('flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] ring-1 transition', actionId === a.id ? 'bg-primary text-primary-foreground ring-primary' : 'ring-border hover:bg-accent/60')}
                >
                  {a.label}
                  {custom ? <span className={cn('size-1.5 rounded-full', actionId === a.id ? 'bg-primary-foreground' : 'bg-ai')} title={t('Modifié')} /> : null}
                </button>
              );
            })}
          </div>
          <ActionEditor
            key={actionId}
            action={setup.actions.find((a) => a.id === actionId)!}
            cap={status.capabilities.find((c) => c.id === actionId)!}
            status={status}
            setup={setup}
            report={actionId === 'triage' ? report : undefined}
            onPick={(o) => onPick(actionId, o)}
            onChanged={() => void queryClient.invalidateQueries({ queryKey: trpc.prompts.setup.queryKey() })}
          />
        </div>
      )}
    </Card>
  );
}

function ActionEditor({
  action,
  cap,
  status,
  setup,
  report,
  onPick,
  onChanged,
}: {
  action: ActionSetup;
  cap: CapabilityRow;
  status: Status;
  setup: Setup;
  report?: Outputs['prompts']['report'];
  onPick: (o: { providerId: string; model: string } | null) => void;
  onChanged: () => void;
}) {
  const trpc = useTRPC();
  const [format, setFormat] = useState(action.activeFormat);
  // Follows the model: picking Jev shows its questions, picking an LLM shows the prompt.
  useEffect(() => setFormat(action.activeFormat), [action.activeFormat]);
  const [llm, setLlm] = useState(action.llm.prompt);
  const toDraft = (a: ActionSetup): JevDraft | null =>
    a.jev ? { questions: Object.fromEntries(a.jev.questions.map((q) => [q.id, { instructions: q.instructions, yes: q.yes, no: q.no }])), thresholds: a.jev.thresholds } : null;
  const [jev, setJev] = useState<JevDraft | null>(() => toDraft(action));
  useEffect(() => {
    setLlm(action.llm.prompt);
    setJev(toDraft(action));
  }, [action]);

  const dirtyLlm = llm !== action.llm.prompt;
  const dirtyJev = Boolean(jev && JSON.stringify(jev) !== JSON.stringify(toDraft(action)));
  const dirty = format === 'jev' ? dirtyJev : dirtyLlm;
  const missing = action.llm.variables.filter((v) => v.required && !llm.includes(`{{${v.name}}}`));

  const save = useMutation(trpc.prompts.save.mutationOptions({ onSuccess: () => (onChanged(), toast.success(t('Nouvelle version enregistrée'), { description: t('L’ancienne reste dans l’historique.') })) }));
  const reset = useMutation(trpc.prompts.reset.mutationOptions({ onSuccess: () => (onChanged(), toast.success(t('Valeurs par défaut de ZMail rétablies'))) }));
  const restore = useMutation(trpc.prompts.restore.mutationOptions({ onSuccess: () => (onChanged(), toast.success(t('Version restaurée'))) }));
  const evaluate = useMutation(trpc.prompts.evaluate.mutationOptions());
  const baseline = useMutation(trpc.prompts.evaluate.mutationOptions());
  const improve = useMutation(trpc.prompts.improve.mutationOptions({ onSuccess: () => onChanged(), onError: (e) => toast.error(e.message) }));
  const apply = useMutation(trpc.prompts.applyDraft.mutationOptions({ onSuccess: () => (onChanged(), toast.success(t('Proposition appliquée'))) }));
  const discard = useMutation(trpc.prompts.discardDraft.mutationOptions({ onSuccess: onChanged }));
  const running = evaluate.isPending || baseline.isPending || improve.isPending;
  const progress = useLabProgress(running);
  const [goal, setGoal] = useState('');

  const runTest = () => {
    const draft = format === 'jev' ? { jev: jev! } : { llm };
    evaluate.mutate({ ...draft, route: null });
    // Compared with what runs today, when something was changed.
    if (dirty) baseline.mutate({ route: null });
    else baseline.reset();
  };
  const routeModel = action.route[0];
  const history = setup.history.filter((h) => h.action === action.id);
  const draft = action.id === 'triage' ? setup.draft : null;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr]">
        <div>
          <p className="mb-1.5 text-[12px] font-medium">{t('Modèle utilisé')}</p>
          <ModelPicker cap={cap} status={status} onPick={onPick} />
          <p className="text-muted-foreground mt-1.5 text-[11.5px]">{action.route.length > 1
              ? t('Relais si indisponible : {models}', { models: action.route.slice(1).map((r) => r.model).join(', ') })
              : action.route.length
                ? t('Pas de relais : le moteur local prend le relais.')
                : t('Aucun modèle : le moteur local décide.')}</p>
        </div>
        <div className={cn('rounded-lg p-3 text-[12.5px] leading-relaxed ring-1', format === 'jev' ? 'bg-ai/5 ring-ai/25' : 'bg-muted ring-border')}>
          {format === 'jev' ? (
            <>
              <p className="flex items-center gap-1.5 font-medium">
                <Gauge className="text-ai size-3.5" /> {t('Jev répond à des questions, pas à un prompt')}
              </p>
              <p className="text-muted-foreground mt-1">{t('Chaque question est un oui/non avec une probabilité. ZMail combine les réponses pour décider du spam, de la priorité, des tags et du code. Vous réglez les questions et les seuils.')}</p>
            </>
          ) : (
            <>
              <p className="flex items-center gap-1.5 font-medium">
                <Cpu className="size-3.5" /> {t('Un LLM lit des consignes en texte')}
              </p>
              <p className="text-muted-foreground mt-1">{t('Vous éditez les consignes. Le format de réponse, que ZMail lit, reste fixe pour qu’une modification ne casse jamais le tri.')}</p>
            </>
          )}
        </div>
      </div>

      {report && action.id === 'triage' ? <TriageReport report={report} /> : null}

      {action.formats.length > 1 ? (
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1 text-[12.5px]">
          {action.formats.map((f) => (
            <button key={f} type="button" onClick={() => setFormat(f)} className={cn('flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md transition', format === f ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground')}>
              {f === 'jev' ? t('Questions typées (Jev)') : t('Consignes (LLM)')}
              {f === action.activeFormat ? <span className="bg-success/15 text-success rounded-sm px-1 text-[10.5px]">{t('utilisé par {model}', { model: modelLabel(routeModel?.model) })}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {action.formats.length > 1 && format !== action.activeFormat ? (
        <p className="text-muted-foreground -mt-2 text-[12px]">
          {format === 'llm'
            ? t('{model} n’utilise pas ces consignes : elles servent si un LLM prend le relais{fallback} ou si vous choisissez un LLM.', {
                model: modelLabel(routeModel?.model),
                fallback: action.route[1] ? ` (${modelLabel(action.route[1].model)})` : '',
              })
            : t('{model} n’utilise pas ces questions : elles servent si vous choisissez Jev.', { model: modelLabel(routeModel?.model) })}
        </p>
      ) : null}

      {format === 'llm' ? (
        <LlmEditor action={action} value={llm} onChange={setLlm} missing={missing.map((v) => v.name)} />
      ) : jev && action.jev ? (
        <JevEditor action={action} value={jev} onChange={setJev} />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {action.id === 'triage' ? (
          <GhostButton onClick={runTest} disabled={running || (format === 'llm' && missing.length > 0)}>
            {evaluate.isPending ? <Loader2 className="animate-spin" /> : <Gauge />}
            {dirty ? t('Tester cette version') : t('Mesurer la version actuelle')}
          </GhostButton>
        ) : null}
        <PrimaryButton
          disabled={!dirty || save.isPending || (format === 'llm' && missing.length > 0)}
          onClick={() => save.mutate(format === 'jev' ? { action: action.id, format, jev: jev!, note: evaluate.data ? t('Testé : {score}/100', { score: evaluate.data.overall }) : '' } : { action: action.id, format, llm, note: evaluate.data ? t('Testé : {score}/100', { score: evaluate.data.overall }) : '' })}
        >
          <Check className="size-4" /> {t('Enregistrer')}
        </PrimaryButton>
        {dirty ? (
          <GhostButton onClick={() => (setLlm(action.llm.prompt), setJev(toDraft(action)), evaluate.reset(), baseline.reset())}>{t('Annuler les modifications')}</GhostButton>
        ) : null}
        {(format === 'jev' ? action.jev?.custom : action.llm.custom) ? (
          <GhostButton className="ml-auto" onClick={() => window.confirm(t('Revenir aux consignes par défaut de ZMail ? La version actuelle restera dans l’historique.')) && reset.mutate({ action: action.id, format })}>
            <RotateCcw /> {t('Rétablir par défaut')}
          </GhostButton>
        ) : null}
      </div>

      {running && progress ? (
        <div className="space-y-1.5">
          <p className="text-muted-foreground flex items-center gap-2 text-[12px]">
            <Loader2 className="size-3 animate-spin" /> {progress.phase} · {t('{done}/{total} mails', { done: progress.done, total: progress.total })}
          </p>
          <div className="bg-muted h-1 overflow-hidden rounded-full">
            <div className="bg-ai h-full transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
        </div>
      ) : null}
      {evaluate.error ? <p className="text-destructive text-[12.5px]">{evaluate.error.message}</p> : null}
      {evaluate.data ? <LabResultView result={evaluate.data} baseline={baseline.data} label={dirty ? t('Cette version') : t('Version actuelle')} /> : null}

      {action.id === 'triage' ? (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <div>
            <p className="flex items-center gap-1.5 text-[13.5px] font-medium">
              <Sparkles className="text-ai size-4" /> {t('Amélioration automatique')}
            </p>
            <p className="text-muted-foreground mt-0.5 text-[12.5px]">
              {format === 'jev'
                ? t('ZMail relève les erreurs (vos corrections, les spams de votre fournisseur, le jeu de référence), fait rédiger une meilleure version des questions, puis la mesure sur les mêmes mails. Rien n’est appliqué sans vous.')
                : t('ZMail relève les erreurs (vos corrections, les spams de votre fournisseur, le jeu de référence), fait rédiger une meilleure version des consignes, puis la mesure sur les mêmes mails. Rien n’est appliqué sans vous.')}
            </p>
          </div>
          <div className="flex gap-2">
            <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t('Optionnel : « les newsletters de mes fournisseurs ne sont pas du spam »')} className="h-8 text-[13px]" />
            <PrimaryButton disabled={running} onClick={() => improve.mutate({ goal: goal.trim() || undefined, route: null })}>
              {improve.isPending ? <Loader2 className="animate-spin" /> : <Sparkles className="size-4" />}
              {t('Proposer')}
            </PrimaryButton>
          </div>
          {improve.data && !improve.data.draft ? <p className="text-[12.5px]">{improve.data.message}</p> : null}
          {draft ? <DraftView draft={draft} action={action} onApply={() => apply.mutate()} onDiscard={() => discard.mutate()} pending={apply.isPending} /> : null}
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-3 text-[12px]">
            <span>{t('Ou demandez-le au chat IA :')}</span>
            {[t('Quelles erreurs de tri ce mois-ci ?'), t('Améliore le tri de mes mails')].map((q) => (
              <button key={q} type="button" onClick={() => window.dispatchEvent(new CustomEvent('zmail:ask-agent', { detail: q }))} className="text-foreground rounded-md px-2 py-0.5 ring-1 ring-border hover:bg-accent/60">
                {t('« {q} »', { q })}
              </button>
            ))}
          </div>
          <p className="text-muted-foreground text-[12px]">
            {t('Depuis Claude ou Cursor (connecteur MCP de ZMail) :')} <code className="font-mono text-[11.5px]">triage_report</code>, <code className="font-mono text-[11.5px]">get_ai_setup</code>, <code className="font-mono text-[11.5px]">evaluate_triage</code>,{' '}
            <code className="font-mono text-[11.5px]">update_ai_prompt</code>, <code className="font-mono text-[11.5px]">improve_triage</code>.
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground text-[12px]">{t('La mesure sur vos mails concerne le tri ; pour cette action, testez en situation après avoir enregistré.')}</p>
      )}

      {history.length ? (
        <div>
          <p className="mb-1.5 text-[12px] font-medium">{t('Historique')}</p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {history.slice(0, 8).map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
                <span className="text-muted-foreground w-32 shrink-0 tabular-nums">{new Date(h.at).toLocaleString(intlLocale, { dateStyle: 'short', timeStyle: 'short' })}</span>
                <span className="w-20 shrink-0">{BY_LABEL[h.by] ?? h.by}</span>
                <span className="text-muted-foreground min-w-0 flex-1 truncate">
                  {h.format === 'jev' ? t('Questions Jev') : t('Consignes')} · {h.note || t('version précédente')}
                </span>
                <GhostButton onClick={() => restore.mutate({ id: h.id })} title={t('Remettre cette version (l’actuelle est gardée)')}>
                  <RotateCcw /> {t('Restaurer')}
                </GhostButton>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const fr = (n: number | null | undefined) => (n === null || n === undefined ? '—' : num(n, { maximumFractionDigits: 1 }));
const modelLabel = (model?: string | null) => (!model ? t('moteur local') : model.startsWith('typesafe/') ? `Jev ${model.replace(/^typesafe\/jev-/, '')}` : model === 'apple-on-device' ? 'Apple Intelligence' : model.replace(/^[^/]+\//, ''));

function TriageReport({ report }: { report: Outputs['prompts']['report'] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg bg-muted px-3 py-2.5 text-[12.5px]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <ShieldCheck className={cn('size-3.5', report.corrections.length ? 'text-warning' : 'text-success')} />
        <span className="flex-1">
          {t('30 derniers jours :')} <b className="font-medium">{report.sorted}</b> {tp(report.sorted, 'mail trié', 'mails triés')} ({report.engines.map((e) => `${modelLabel(e.engine === 'heuristic' ? null : e.engine)} ${e.n}`).join(', ') || '—'}),{' '}
          <b className="font-medium">{report.corrections.length}</b> {tp(report.corrections.length, 'correction de votre part', 'corrections de votre part')}
          {report.sorted ? ` (${t('{n} %', { n: num(report.errorRate * 100, { maximumFractionDigits: 1 }) })})` : ''}
        </span>
        {report.corrections.length ? <ChevronsUpDown className="text-muted-foreground size-3.5" /> : null}
      </button>
      {open && report.corrections.length ? (
        <ul className="mt-2 space-y-1 border-t border-border pt-2">
          {report.corrections.slice(0, 12).map((c, i) => (
            <li key={i} className="flex gap-2">
              <span className="min-w-0 flex-1 truncate">{t('« {q} »', { q: c.subject })}</span>
              <span className="text-muted-foreground shrink-0">{c.what}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LlmEditor({ action, value, onChange, missing }: { action: ActionSetup; value: string; onChange: (v: string) => void; missing: string[] }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [showContract, setShowContract] = useState(false);
  const insert = (name: string) => {
    const el = ref.current;
    const token = `{{${name}}}`;
    if (!el) return onChange(value + token);
    const at = el.selectionStart ?? value.length;
    onChange(value.slice(0, at) + token + value.slice(el.selectionEnd ?? at));
    requestAnimationFrame(() => el.setSelectionRange(at + token.length, at + token.length));
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-[12px] font-medium">{t('Consignes')}</p>
        {value !== action.llm.defaultPrompt ? <span className="bg-ai/10 text-ai rounded-sm px-1 text-[10.5px]">{t('modifié')}</span> : null}
        <span className="text-muted-foreground ml-auto text-[11.5px] tabular-nums">{t('≈ {n} jetons', { n: num(Math.round(value.length / 3.6)) })}</span>
      </div>
      <Textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} className="min-h-[260px] font-mono text-[12px] leading-relaxed" />
      {action.llm.variables.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
          <span className="text-muted-foreground">{t('Variables :')}</span>
          {action.llm.variables.map((v) => (
            <button key={v.name} type="button" onClick={() => insert(v.name)} title={v.description} className={cn('rounded-md px-1.5 py-0.5 font-mono ring-1 hover:bg-accent/60', missing.includes(v.name) ? 'text-destructive ring-destructive/40' : 'ring-border')}>
              {`{{${v.name}}}`}
            </button>
          ))}
          {missing.length ? <span className="text-destructive">{t('Obligatoire : {vars}', { vars: missing.map((m) => `{{${m}}}`).join(', ') })}</span> : null}
        </div>
      ) : null}
      <button type="button" onClick={() => setShowContract((v) => !v)} className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-[12px]">
        <Lock className="size-3" /> {t('Format de réponse imposé par ZMail')} {showContract ? '▴' : '▾'}
      </button>
      {showContract ? <pre className="bg-muted text-muted-foreground max-h-48 overflow-auto rounded-lg p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{action.llm.contract}</pre> : null}
    </div>
  );
}

function JevEditor({ action, value, onChange }: { action: ActionSetup; value: JevDraft; onChange: (v: JevDraft) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const defaults = action.jev!;
  const groups = useMemo(() => Map.groupBy(defaults.questions, (q) => q.group), [defaults.questions]);
  const setQ = (id: string, patch: Partial<JevDraft['questions'][string]>) => onChange({ ...value, questions: { ...value.questions, [id]: { ...value.questions[id]!, ...patch } } });
  const threshold = (key: 'yes' | 'lean', label: string, hint: string) => (
    <label className="flex items-center gap-3 text-[12.5px]">
      <span className="w-28 shrink-0 font-medium">{label}</span>
      <input type="range" min={key === 'yes' ? 0.5 : 0.3} max={0.95} step={0.05} value={value.thresholds[key]} onChange={(e) => onChange({ ...value, thresholds: { ...value.thresholds, [key]: Number(e.target.value) } })} className="accent-primary flex-1" />
      <span className="w-10 text-right tabular-nums">{value.thresholds[key].toFixed(2)}</span>
      <span className="text-muted-foreground hidden w-56 text-[11.5px] md:block">{hint}</span>
    </label>
  );
  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-border p-3">
        {threshold('yes', t('Seuil « oui »'), t('Au-dessus, une réponse compte comme oui (spam, arnaque…). TypeSafe conseille 0,70.'))}
        {threshold('lean', t('Seuil « plutôt oui »'), t('Pour les signaux où rater un oui coûte plus cher (urgences, livraisons…).'))}
      </div>
      {[...groups.entries()].map(([group, questions]) => (
        <div key={group}>
          <p className="text-muted-foreground mb-1.5 text-[11px] font-medium tracking-wide uppercase">{group}</p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {questions.map((q) => {
              const current = value.questions[q.id]!;
              const changed = JSON.stringify(current) !== JSON.stringify({ instructions: q.instructions, yes: q.yes, no: q.no });
              const isOpen = openId === q.id;
              return (
                <li key={q.id}>
                  <button type="button" onClick={() => setOpenId(isOpen ? null : q.id)} className="hover:bg-accent/40 flex w-full items-start gap-2 px-3 py-2 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px]">{current.instructions}</span>
                      <span className="text-muted-foreground block truncate text-[11.5px]">{q.use}</span>
                    </span>
                    {changed || q.custom ? <span className="bg-ai/10 text-ai mt-0.5 shrink-0 rounded-sm px-1 text-[10.5px]">{t('modifié')}</span> : null}
                    <ChevronsUpDown className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                  </button>
                  {isOpen ? (
                    <div className="space-y-2 px-3 pb-3">
                      <p className="text-muted-foreground font-mono text-[10.5px]">{q.id}</p>
                      <Field label={t('Question')}>
                        <Input value={current.instructions} onChange={(e) => setQ(q.id, { instructions: e.target.value })} className="h-8 text-[13px]" />
                      </Field>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Field label={t('Compte comme « oui »')}>
                          <Textarea value={current.yes} onChange={(e) => setQ(q.id, { yes: e.target.value })} className="min-h-[56px] text-[12.5px]" />
                        </Field>
                        <Field label={t('Compte comme « non »')}>
                          <Textarea value={current.no} onChange={(e) => setQ(q.id, { no: e.target.value })} className="min-h-[56px] text-[12.5px]" />
                        </Field>
                      </div>
                      <p className="text-muted-foreground text-[11.5px]">{t('Conseil TypeSafe : une seule idée par question, un « oui » et un « non » décrits comme des situations concrètes, en anglais de préférence (la langue que Jev maîtrise le mieux).')}</p>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11.5px] font-medium">{label}</span>
      {children}
    </label>
  );
}

function LabResultView({ result, baseline, label }: { result: LabResult; baseline?: LabResult; label: string }) {
  const [showAll, setShowAll] = useState(false);
  const delta = baseline ? Math.round((result.overall - baseline.overall) * 10) / 10 : null;
  const failures = [
    ...result.yours.failures.map((f) => ({ key: `${f.messageId}-${f.because}`, where: f.source === 'provider-spam' ? t('Spam fournisseur') : t('Votre correction'), subject: f.subject, detail: `${f.because} — ${t('obtenu : {got}', { got: f.got })}` })),
    ...result.reference.mistakes.map((m) => ({ key: m.id, where: m.control ? t('Contrôle') : t('Référence'), subject: m.subject, detail: m.mistakes.join(t(' ; ')) })),
  ];
  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={label} value={`${fr(result.overall)}/100`} hint={delta !== null ? t('{delta} vs actuelle ({base})', { delta: `${delta >= 0 ? '+' : ''}${fr(delta)}`, base: fr(baseline!.overall) }) : modelLabel(result.model)} tone={delta === null ? undefined : delta >= 0 ? 'good' : 'bad'} />
        <Stat label={t('Jeu de référence')} value={`${fr(result.reference.score)}/100`} hint={t('{cases} mails · contrôle {control}', { cases: result.reference.cases, control: fr(result.reference.control) })} />
        <Stat label={t('Vos corrections')} value={result.yours.total ? `${result.yours.passed}/${result.yours.total}` : '—'} hint={result.yours.total ? t('respectées') : t('aucune correction encore')} />
        <Stat label={t('Par mail')} value={`${(result.latencyP50 / 1000).toFixed(1)} s`} hint={result.costPer1k === null ? t('{n} jetons', { n: result.tokensPerMail }) : t('{cost} / 1 000 mails', { cost: money(result.costPer1k) })} />
      </div>
      {failures.length ? (
        <div>
          <p className="mb-1 text-[12px] font-medium">{tp(failures.length, '{n} erreur', '{n} erreurs')}</p>
          <ul className="space-y-1 text-[12px]">
            {(showAll ? failures : failures.slice(0, 6)).map((f) => (
              <li key={f.key} className="flex gap-2">
                <span className="text-muted-foreground w-28 shrink-0">{f.where}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{t('« {q} »', { q: f.subject })}</span> <span className="text-muted-foreground">{f.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          {failures.length > 6 ? (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="text-muted-foreground hover:text-foreground mt-1 text-[12px]">
              {showAll ? t('Réduire') : t('Voir les {n} autres', { n: failures.length - 6 })}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-success flex items-center gap-1.5 text-[12.5px]">
          <CheckCircle2 className="size-3.5" /> {t('Aucune erreur sur les mails mesurés.')}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-lg bg-muted px-3 py-2">
      <p className="text-muted-foreground text-[11px]">{label}</p>
      <p className="text-[16px] font-semibold tabular-nums">{value}</p>
      <p className={cn('truncate text-[11px]', tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-destructive' : 'text-muted-foreground')}>{hint}</p>
    </div>
  );
}

function DraftView({ draft, action, onApply, onDiscard, pending }: { draft: NonNullable<Setup['draft']>; action: ActionSetup; onApply: () => void; onDiscard: () => void; pending: boolean }) {
  // Better overall AND not worse on the control mails the writer never saw.
  const better = draft.after > draft.before && (draft.controlAfter ?? 0) >= (draft.controlBefore ?? 0);
  const changed =
    draft.format === 'jev' && action.jev
      ? Object.entries((draft.value as JevDraft).questions).filter(([id, q]) => {
          const cur = action.jev!.questions.find((x) => x.id === id);
          return cur && (cur.instructions !== q.instructions || cur.yes !== q.yes || cur.no !== q.no);
        })
      : [];
  return (
    <div className={cn('space-y-2 rounded-lg p-3 ring-1', better ? 'bg-success/5 ring-success/30' : 'bg-warning/5 ring-warning/30')}>
      <p className="flex items-center gap-2 text-[13px] font-medium">
        {draft.by === 'user' ? t('Proposition :') : t('Proposition ({by}) :', { by: BY_LABEL[draft.by] ?? draft.by })} {fr(draft.before)} → <span className={better ? 'text-success' : 'text-warning'}>{fr(draft.after)}/100</span>
        <span className="text-muted-foreground ml-auto text-[11.5px] font-normal">{t('rédigée par {model}', { model: modelLabel(draft.model) })}</span>
      </p>
      {draft.controlBefore !== undefined && draft.controlBefore !== null ? (
        <p className="text-[12px]">
          {t('Mails de contrôle, jamais montrés au rédacteur :')} {fr(draft.controlBefore)} → <b className={(draft.controlAfter ?? 0) >= draft.controlBefore ? 'text-success' : 'text-destructive'}>{fr(draft.controlAfter)}</b>
          {' — '}
          {(draft.controlAfter ?? 0) < draft.controlBefore ? t('la proposition a sans doute appris les exemples par cœur.') : t('elle généralise.')}
        </p>
      ) : null}
      {draft.rationale ? <p className="text-muted-foreground text-[12.5px]">{draft.rationale}</p> : null}
      {draft.format === 'llm' ? (
        <pre className="bg-background max-h-56 overflow-auto rounded-md p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap ring-1 ring-border">{draft.value as string}</pre>
      ) : (
        <ul className="space-y-1.5 text-[12px]">
          {changed.map(([id, q]) => (
            <JevChange key={id} before={action.jev!.questions.find((x) => x.id === id)!} after={q} />
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <PrimaryButton onClick={onApply} disabled={pending}>
          <Check className="size-4" /> {t('Appliquer')}
        </PrimaryButton>
        <GhostButton onClick={onDiscard}>{t('Ignorer')}</GhostButton>
        {!better ? <span className="text-warning self-center text-[12px]">{t('À éviter : ne fait pas mieux, ou baisse sur les mails de contrôle.')}</span> : null}
      </div>
    </div>
  );
}

/** One changed Jev question: only the parts that changed, old struck through above the new. */
function JevChange({ before, after }: { before: { id: string; instructions: string; yes: string; no: string }; after: { instructions: string; yes: string; no: string } }) {
  const parts = (['instructions', 'yes', 'no'] as const).filter((k) => before[k] !== after[k]);
  const label = { instructions: t('Question'), yes: t('« Oui »'), no: t('« Non »') };
  return (
    <li className="space-y-1 rounded-md bg-background p-2 ring-1 ring-border">
      <p className="text-muted-foreground font-mono text-[10.5px]">{before.id}</p>
      {parts.map((k) => (
        <div key={k}>
          <p className="text-muted-foreground text-[10.5px] font-medium">{label[k]}</p>
          <p className="text-muted-foreground line-through">{before[k]}</p>
          <p>{after[k]}</p>
        </div>
      ))}
    </li>
  );
}

const PRESET_TEXT = {
  free: { label: 'Free', tagline: t('Ne coûte rien. Très précis, un peu plus lent.'), icon: Hand },
  balanced: { label: 'Business', tagline: t('Le meilleur rapport qualité-prix, très rapide.'), icon: Gauge },
  max: { label: 'Ultra', tagline: t('Deux IA vérifient chaque mail. Le plus fiable.'), icon: ShieldCheck },
} as const;

/** The one-click choice: how much the AI may cost to sort the mail, and how carefully. */
function PresetPicker({ status, onChange, pending }: { status: Status; onChange: (p: Status['preset']) => void; pending: boolean }) {
  const perDayMails = perDay(status.mailsPerDay ?? status.volume.perDay);
  return (
    <Card
      id="mode-ia"
      title={t('Comment l’IA range vos mails')}
      description={t('Un choix suffit : ZMail s’occupe du reste (Apple Intelligence, ZenMux, quels modèles et comment ils travaillent ensemble). Précision mesurée sur 85 mails tests ; coût calculé pour vos {n} mails par jour.', { n: perDayMails })}
    >
      <div className="grid gap-2.5 sm:grid-cols-3">
        {status.presets.map((p) => {
          const text = PRESET_TEXT[p.id];
          const selected = status.preset === p.id;
          const Icon = text.icon;
          return (
            <button
              key={p.id}
              type="button"
              disabled={pending}
              onClick={() => !selected && onChange(p.id)}
              className={cn('relative flex flex-col gap-2 rounded-xl p-3.5 text-left ring-1 transition', selected ? 'bg-primary/[0.06] ring-2 ring-primary' : 'ring-border hover:bg-accent/50')}
            >
              <span className="flex items-center gap-2">
                <span className={cn('flex size-7 items-center justify-center rounded-lg', selected ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                  <Icon className="size-3.5" />
                </span>
                <span className="text-[14px] font-semibold">{text.label}</span>
                {selected ? <Check className="text-primary ml-auto size-4" /> : null}
              </span>
              <span className="text-muted-foreground text-[12.5px] leading-snug">{text.tagline}</span>
              {p.measure ? (
                <span className="mt-1 grid gap-1">
                  <Metric icon={Target} tone="text-success" value={t('{n} %', { n: num(p.measure.score, { maximumFractionDigits: 1 }) })} label={t('précision')} strong />
                  <Metric icon={Zap} tone="text-warning" value={`${num(p.measure.latencyP50 / 1000, { maximumFractionDigits: 1 })} s`} label={t('par mail')} />
                  <Metric icon={Coins} tone="text-ai" value={p.monthlyCost ? `${money(p.monthlyCost)}` : t('gratuit')} label={p.monthlyCost ? t('par mois') : t('toujours')} />
                </span>
              ) : (
                <span className="text-muted-foreground text-[11.5px]">{t('Pas encore mesuré.')}</span>
              )}
              {/* What matters is precision, speed and price; which models do the work is ZMail's business. */}
              {p.missing ? <span className="text-warning mt-auto text-[11.5px] leading-snug">{p.missing}</span> : null}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/** One figure of a mode, readable at a glance: the icon says what it is (precision, speed, price). */
function Metric({ icon: Icon, tone, value, label, strong }: { icon: typeof Target; tone: string; value: string; label: string; strong?: boolean }) {
  return (
    <span className="bg-muted flex items-center gap-2 rounded-md px-2.5 py-1.5" title={label}>
      <Icon className={cn('size-4 shrink-0', tone)} aria-hidden />
      <span className={cn('text-[13px] whitespace-nowrap tabular-nums', strong ? 'font-semibold' : 'font-medium')}>{value}</span>
      <span className="text-muted-foreground ml-auto truncate text-[11px]">{label}</span>
    </span>
  );
}
