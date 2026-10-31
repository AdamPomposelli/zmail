import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Eye, EyeOff, FolderInput, Inbox, Layers, MailOpen, Reply, Send, ShieldBan, Sparkles, Star, Tag, Trash2, UserMinus, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Card, GhostButton, SettingsPage } from '@/components/settings/ui';
import { useTRPC, type Outputs } from '@/lib/trpc';
import { cn, formatListDate } from '@/lib/utils';
import { t, tp } from '@/lib/i18n';

type Analytics = Outputs['activity']['analytics'];
type Outcome = keyof Analytics['overview']['shares'];
type Dimension = keyof Analytics['dimensions'];
type Habit = Analytics['habits'][number];

const ACTIONS: Record<string, { label: string; icon: LucideIcon }> = {
  open: { label: t('Ouvert'), icon: Eye },
  markRead: { label: t('Marqué comme lu'), icon: MailOpen },
  markUnread: { label: t('Marqué non lu'), icon: MailOpen },
  star: { label: t('Suivi'), icon: Star },
  unstar: { label: t('Plus suivi'), icon: Star },
  archive: { label: t('Archivé'), icon: Archive },
  trash: { label: t('Supprimé'), icon: Trash2 },
  deleteForever: { label: t('Supprimé définitivement'), icon: Trash2 },
  spam: { label: t('Spam'), icon: ShieldBan },
  notSpam: { label: t('Pas un spam'), icon: Inbox },
  restore: { label: t('Restauré'), icon: Inbox },
  addTag: { label: t('Tag ajouté'), icon: Tag },
  removeTag: { label: t('Tag retiré'), icon: Tag },
  setBusiness: { label: t('Business changé'), icon: Tag },
  moveToSpace: { label: t('Déplacé vers un espace'), icon: Layers },
  moveToFolder: { label: t('Rangé dans un dossier'), icon: FolderInput },
  setPriority: { label: t('Priorité changée'), icon: Tag },
  unsubscribe: { label: t('Désinscription'), icon: UserMinus },
  reply: { label: t('Réponse'), icon: Reply },
  send: { label: t('Nouveau mail'), icon: Send },
  openLink: { label: t('Lien ouvert'), icon: Eye },
  downloadAttachment: { label: t('Pièce jointe'), icon: Eye },
  copyOtp: { label: t('Code copié'), icon: Eye },
};

/** Gestures whose « opened first / read for » context is worth showing. */
const DECIDED = new Set(['archive', 'trash', 'deleteForever', 'spam', 'moveToFolder', 'moveToSpace', 'addTag', 'setBusiness', 'setPriority', 'unsubscribe', 'star', 'reply']);

/** One colour per outcome, the same in the bars, the legend and the graph. */
const OUTCOMES: { key: Outcome; label: string; color: string }[] = [
  { key: 'archive', label: t('Archivés'), color: '#3B82F6' },
  { key: 'trash', label: t('Supprimés'), color: '#EF4444' },
  { key: 'spam', label: t('Spam'), color: '#F97316' },
  { key: 'folder', label: t('Rangés dans un dossier'), color: '#8B5CF6' },
  { key: 'space', label: t('Déplacés vers un espace'), color: '#06B6D4' },
  { key: 'tag', label: t('Catégorisés'), color: '#EC4899' },
  { key: 'read', label: t('Lus, rien décidé'), color: '#10B981' },
  { key: 'markRead', label: t('Marqués lus sans ouvrir'), color: '#84CC16' },
  { key: 'untouched', label: t('Laissés tels quels'), color: '#71717A' },
];
const COLOR = Object.fromEntries(OUTCOMES.map((o) => [o.key, o.color])) as Record<Outcome, string>;
const LABEL = Object.fromEntries(OUTCOMES.map((o) => [o.key, o.label])) as Record<Outcome, string>;

const TABLES: { key: Dimension; label: string }[] = [
  { key: 'category', label: t('Catégories') },
  { key: 'sender', label: t('Expéditeurs') },
  { key: 'domain', label: t('Domaines') },
  { key: 'list', label: t('Listes') },
  { key: 'business', label: t('Business') },
  { key: 'account', label: t('Comptes') },
  { key: 'space', label: t('Espaces') },
];

const pct = (share: number) => `${Math.round(share * 100)} %`;

/** 1,2 s · 45 s · 3 min · 2 h · 3 j */
function duration(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 10_000) return t('{n} s', { n: (ms / 1000).toFixed(1).replace('.0', '') });
  if (ms < 60_000) return t('{n} s', { n: Math.round(ms / 1000) });
  if (ms < 3600_000) return t('{n} min', { n: Math.round(ms / 60_000) });
  if (ms < 86400_000) return t('{n} h', { n: Math.round(ms / 3600_000) });
  return t('{n} j', { n: Math.round(ms / 86400_000) });
}

function habitText(h: Habit) {
  switch (h.outcome) {
    case 'folder':
      return t('rangés dans « {folder} »', { folder: h.targetLabel ?? '' });
    case 'space':
      return t('déplacés vers « {space} »', { space: h.targetLabel ?? '' });
    case 'neverOpened':
      return t('jamais ouverts');
    case 'archive':
      return t('archivés');
    case 'trash':
      return t('supprimés');
    case 'spam':
      return t('mis en spam');
    case 'markRead':
      return t('marqués lus sans être ouverts');
    default:
      return h.outcome;
  }
}

export default function ActivitySettings() {
  const trpc = useTRPC();
  const { data: log } = useQuery(trpc.activity.list.queryOptions({ limit: 150 }));
  const { data: stats } = useQuery(trpc.activity.stats.queryOptions());
  const { data: analytics } = useQuery(trpc.activity.analytics.queryOptions({ days: 90 }));
  return (
    <SettingsPage title={t('Journal d’activité')} description={t('Chaque action est enregistrée localement, avec son contexte : mail ouvert ou non, temps passé dessus, âge du mail. L’agent n’analyse pas ce journal ligne par ligne : il en tire des proportions par type de mail, et une habitude au-dessus de 70 % devient une règle proposée.')}>
      <div className="grid grid-cols-3 gap-2.5">
        {(stats ?? []).slice(0, 6).map((s) => {
          const meta = ACTIONS[s.action];
          return (
            <div key={s.action} className="bg-card border-border rounded-xl border p-3.5">
              <p className="text-[22px] font-semibold tabular-nums">{s.n}</p>
              <p className="text-muted-foreground text-[12px]">{t('{label} · 30 jours', { label: meta?.label ?? s.action })}</p>
            </div>
          );
        })}
      </div>

      {analytics && analytics.overview.threads ? (
        <>
          <Overview analytics={analytics} />
          <Habits habits={analytics.habits} />
          <ProbabilityTables analytics={analytics} />
          <FlowGraph graph={analytics.graph} />
        </>
      ) : null}

      <Card title={t('Dernières actions')}>
        {log?.length ? (
          <ul className="-my-1 divide-y divide-border">
            {log.map((entry) => {
              const meta = ACTIONS[entry.action] ?? { label: entry.action, icon: Tag };
              return (
                <li key={entry.id} className="flex items-center gap-3 py-2 text-[13px]">
                  <meta.icon className="text-muted-foreground size-3.5 shrink-0" />
                  <span className="w-36 shrink-0 font-medium">
                    {meta.label}
                    {entry.batch > 1 ? <span className="text-muted-foreground font-normal"> ×{entry.batch}</span> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-muted-foreground">{entry.from_email}</span> {entry.subject ? `— ${entry.subject}` : ''}
                    {entry.action === 'moveToFolder' && typeof entry.meta.folder === 'string' ? <span className="text-muted-foreground"> → {entry.meta.folder}</span> : null}
                  </span>
                  {/* Opened first or not, and for how long: what the analysis reads. */}
                  {entry.opened === null || !DECIDED.has(entry.action) ? null : entry.opened ? (
                    <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-[11.5px]" title={t('Ouvert avant, lu {time} au total', { time: duration(entry.dwell_ms) })}>
                      <Eye className="size-3" />
                      {entry.dwell_ms ? duration(entry.dwell_ms) : t('ouvert')}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/70 inline-flex shrink-0 items-center gap-1 text-[11.5px]" title={t('Sans l’avoir ouvert')}>
                      <EyeOff className="size-3" />
                      {t('non ouvert')}
                    </span>
                  )}
                  <span className="text-muted-foreground w-20 shrink-0 text-right text-[11.5px]">{formatListDate(entry.at)}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground py-6 text-center text-[13px]">{t('Aucune action enregistrée pour l’instant.')}</p>
        )}
      </Card>
    </SettingsPage>
  );
}

/** A bar split by outcome, with each share on hover. */
function OutcomeBar({ shares, className }: { shares: Record<Outcome, number>; className?: string }) {
  return (
    <div className={cn('bg-muted flex h-2 overflow-hidden rounded-full', className)}>
      {OUTCOMES.filter((o) => shares[o.key] > 0).map((o) => (
        <span key={o.key} title={`${o.label} · ${pct(shares[o.key])}`} style={{ width: `${shares[o.key] * 100}%`, backgroundColor: o.color }} />
      ))}
    </div>
  );
}

function Overview({ analytics }: { analytics: Analytics }) {
  const o = analytics.overview;
  return (
    <Card title={t('Ce que deviennent vos mails')} description={tp(o.threads, '{n} conversation sur {days} jours.', '{n} conversations sur {days} jours.', { days: analytics.days })}>
      <OutcomeBar shares={o.shares} className="h-3" />
      <div className="mt-3 grid grid-cols-3 gap-x-4 gap-y-1.5">
        {OUTCOMES.filter((x) => o.shares[x.key] > 0).map((x) => (
          <span key={x.key} className="flex items-center gap-2 text-[12px]">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: x.color }} />
            <span className="min-w-0 flex-1 truncate">{x.label}</span>
            <span className="text-muted-foreground tabular-nums">{pct(o.shares[x.key])}</span>
          </span>
        ))}
      </div>
      <div className="border-border mt-4 grid grid-cols-3 gap-2.5 border-t pt-4">
        <Kpi value={pct(o.openedShare)} label={t('ouvertes dans ZMail')} />
        <Kpi value={o.deletedUnopenedShare === null ? '—' : pct(o.deletedUnopenedShare)} label={t('des suppressions sans ouvrir')} />
        <Kpi value={duration(o.medianDecisionMs)} label={t('avant de décider (médiane)')} />
      </div>
      {Object.keys(o.medianDwellBefore).length ? (
        <p className="text-muted-foreground mt-3 text-[12px]">
          {t('Temps de lecture médian avant de')}{' '}
          {Object.entries(o.medianDwellBefore)
            .map(([outcome, ms]) => t('{what} : {time}', { what: LABEL[outcome as Outcome].toLowerCase(), time: duration(ms) }))
            .join(' · ')}
        </p>
      ) : null}
    </Card>
  );
}

function Kpi({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-[18px] font-semibold tabular-nums">{value}</p>
      <p className="text-muted-foreground text-[12px]">{label}</p>
    </div>
  );
}

function Habits({ habits }: { habits: Habit[] }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const create = useMutation(
    trpc.rules.create.mutationOptions({
      onSuccess: (rule) => {
        toast.success(t('Règle « {name} » créée', { name: rule.name }));
        void queryClient.invalidateQueries({ queryKey: trpc.activity.analytics.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.rules.list.queryKey() });
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const [all, setAll] = useState(false);
  const shown = all ? habits : habits.slice(0, 8);
  return (
    <Card
      title={t('Habitudes détectées')}
      description={t('Un même geste sur au moins 70 % d’un type de mail, sur 3 mails au moins. La confiance tient compte du nombre de mails : 3 sur 3 est moins sûr que 30 sur 31.')}
    >
      {habits.length ? (
        <ul className="-my-1 divide-y divide-border">
          {shown.map((h) => (
            <li key={h.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px]">
                  <span className="font-medium">{h.dimension === 'domain' ? `@${h.key}` : h.label}</span> <span className="text-muted-foreground">{habitText(h)}</span>
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <div className="bg-muted h-1.5 w-28 overflow-hidden rounded-full">
                    <span className="block h-full rounded-full" style={{ width: `${h.share * 100}%`, backgroundColor: h.outcome === 'neverOpened' ? '#71717A' : COLOR[h.outcome as Outcome] }} />
                  </div>
                  <span className="text-muted-foreground text-[11.5px] tabular-nums">
                    {t('{support} sur {total} · {share} · confiance {confidence}', { support: h.support, total: h.total, share: pct(h.share), confidence: pct(h.confidence) })}
                    {h.lift >= 1.5 ? ` · ${t('×{lift} vs la moyenne', { lift: h.lift.toFixed(1).replace('.0', '') })}` : ''}
                  </span>
                </div>
                {!h.safe && h.reason ? <p className="text-muted-foreground mt-1 text-[11.5px]">{h.reason}</p> : null}
              </div>
              {h.covered ? (
                <span className="text-muted-foreground shrink-0 text-[12px]">{t('Règle active')}</span>
              ) : h.rule ? (
                <GhostButton onClick={() => create.mutate(h.rule!)} disabled={create.isPending}>
                  <Sparkles /> {t('Créer la règle')}
                </GhostButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground py-3 text-[13px]">{t('Aucune habitude assez nette pour l’instant. Elles apparaissent au fil de vos gestes.')}</p>
      )}
      {habits.length > 8 ? (
        <button onClick={() => setAll((v) => !v)} className="text-muted-foreground hover:text-foreground mt-2 text-[12px]">
          {all ? t('Moins') : tp(habits.length - 8, 'Voir {n} autre', 'Voir les {n} autres')}
        </button>
      ) : null}
    </Card>
  );
}

/** One probability table per dimension: for each kind of mail, the share of each outcome. */
function ProbabilityTables({ analytics }: { analytics: Analytics }) {
  const tables = TABLES.filter((tb) => analytics.dimensions[tb.key].length);
  const [tab, setTab] = useState<Dimension>(tables[0]?.key ?? 'category');
  const rows = analytics.dimensions[tab]?.slice(0, 12) ?? [];
  if (!tables.length) return null;
  return (
    <Card title={t('Par type de mail')} description={t('Sur chaque ligne : combien de conversations, la part ouverte, le temps de lecture moyen et ce qu’elles sont devenues.')}>
      <div className="mb-3 flex flex-wrap gap-1">
        {tables.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={cn('rounded-md px-2.5 py-1 text-[12px] transition', tab === tb.key ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground')}
          >
            {tb.label}
          </button>
        ))}
      </div>
      <div className="text-muted-foreground grid grid-cols-[minmax(0,1fr)_40px_56px_56px_minmax(0,1.2fr)] gap-x-3 pb-1.5 text-[11px] uppercase tracking-wide">
        <span />
        <span className="text-right">{t('Mails')}</span>
        <span className="text-right">{t('Ouverts')}</span>
        <span className="text-right">{t('Lecture')}</span>
        <span>{t('Devenir')}</span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((g) => (
          <li key={g.key} className="grid grid-cols-[minmax(0,1fr)_40px_56px_56px_minmax(0,1.2fr)] items-center gap-x-3 py-2 text-[12.5px]">
            <span className="truncate" title={g.label}>
              {g.label}
            </span>
            <span className="text-right tabular-nums">{g.n}</span>
            <span className="text-muted-foreground text-right tabular-nums">{pct(g.openedShare)}</span>
            <span className="text-muted-foreground text-right tabular-nums">{g.avgDwellMs ? duration(g.avgDwellMs) : '—'}</span>
            <span className="flex min-w-0 items-center gap-2">
              <OutcomeBar shares={g.shares} className="flex-1" />
              <span className="text-muted-foreground w-24 shrink-0 truncate text-[11px]" title={g.topTarget?.label}>
                {topOutcome(g.shares, g.topTarget?.label)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function topOutcome(shares: Record<Outcome, number>, target?: string) {
  const [key, share] = (Object.entries(shares) as [Outcome, number][]).sort((a, b) => b[1] - a[1])[0]!;
  return `${pct(share)} ${key === 'folder' && target ? target : LABEL[key].toLowerCase()}`;
}

/**
 * Who sends what, and where it ends: senders (or categories) on the left, outcomes and folders on
 * the right, each link as thick as the number of mails that took it.
 */
function FlowGraph({ graph }: { graph: Analytics['graph'] }) {
  const [by, setBy] = useState<'source' | 'category'>('source');
  const layout = useMemo(() => {
    const edges = graph.edges.filter((e) => e.from.startsWith(`${by}:`));
    const left = [...new Set(edges.map((e) => e.from))]
      .map((id) => ({ id, n: edges.filter((e) => e.from === id).reduce((s, e) => s + e.n, 0) }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 10);
    const kept = edges.filter((e) => left.some((l) => l.id === e.from));
    const right = [...new Set(kept.map((e) => e.to))].map((id) => ({ id, n: kept.filter((e) => e.to === id).reduce((s, e) => s + e.n, 0) })).sort((a, b) => b.n - a.n);
    return { left, right, edges: kept };
  }, [graph, by]);
  const node = (id: string) => graph.nodes.find((n) => n.id === id);
  const label = (id: string) => {
    const n = node(id);
    if (!n) return id;
    return n.kind === 'outcome' ? LABEL[n.label as Outcome] ?? n.label : n.label;
  };
  const color = (id: string) => {
    const n = node(id);
    return n?.kind === 'folder' ? COLOR.folder : n?.kind === 'space' ? COLOR.space : (COLOR[n?.label as Outcome] ?? '#71717A');
  };
  if (!layout.left.length) return null;
  const rowH = 26;
  const height = Math.max(layout.left.length, layout.right.length) * rowH + 8;
  const max = Math.max(...layout.edges.map((e) => e.n), 1);
  const y = (list: { id: string }[], id: string) => list.findIndex((x) => x.id === id) * rowH + rowH / 2 + 4;
  return (
    <Card
      title={t('Graphe des habitudes')}
      description={t('Chaque lien va d’une source vers ce que deviennent ses mails ; plus il est épais, plus il compte de mails.')}
      action={
        <div className="flex gap-1">
          {(['source', 'category'] as const).map((k) => (
            <button key={k} onClick={() => setBy(k)} className={cn('rounded-md px-2.5 py-1 text-[12px] transition', by === k ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground')}>
              {k === 'source' ? t('Expéditeurs') : t('Catégories')}
            </button>
          ))}
        </div>
      }
    >
      <div className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)_minmax(0,170px)] items-start gap-2">
        <ul style={{ height }}>
          {layout.left.map((l) => (
            <li key={l.id} className="flex items-center justify-end gap-1.5 truncate text-right text-[12px]" style={{ height: rowH }} title={label(l.id)}>
              <span className="truncate">{label(l.id)}</span>
              <span className="text-muted-foreground tabular-nums text-[11px]">{l.n}</span>
            </li>
          ))}
        </ul>
        <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} aria-hidden>
          {layout.edges.map((e) => {
            const y1 = y(layout.left, e.from);
            const y2 = y(layout.right, e.to);
            return (
              <path
                key={`${e.from}>${e.to}`}
                d={`M0,${y1} C50,${y1} 50,${y2} 100,${y2}`}
                fill="none"
                stroke={color(e.to)}
                strokeOpacity={0.25 + 0.5 * e.share}
                strokeWidth={1 + (e.n / max) * 9}
                vectorEffect="non-scaling-stroke"
              >
                <title>{`${label(e.from)} → ${label(e.to)} : ${e.n} (${pct(e.share)})`}</title>
              </path>
            );
          })}
        </svg>
        <ul style={{ height }}>
          {layout.right.map((r) => (
            <li key={r.id} className="flex items-center gap-1.5 truncate text-[12px]" style={{ height: rowH }} title={label(r.id)}>
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color(r.id) }} />
              <span className="truncate">{label(r.id)}</span>
              <span className="text-muted-foreground tabular-nums text-[11px]">{r.n}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
