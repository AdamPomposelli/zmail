import { solar } from '@/components/ui/solar-icon';

const ArrowLeft = solar('_back');
const PenSquare = solar('_compose');
const Search = solar('_search');
const Settings = solar('_settings');
const Sparkles = solar('_ai');
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { SETTINGS_PAGES, searchSettings } from '@/components/settings/search';
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { MailNav } from '@/components/sidebar/mail-nav';
import { SpaceCarousel, SpaceSwitcher } from '@/components/sidebar/spaces';
import { NavItem } from '@/components/sidebar/nav';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { spaceInboxInput } from '@/components/mail/thread-list';
import { useMailRoute } from '@/hooks/use-mail-route';
import { GESTURE_EVENT, type Gesture } from '@/lib/track';
import { useCatalog } from '@/hooks/use-catalog';
import { useHotkeys } from 'react-hotkeys-hook';
import { useTRPC, type View } from '@/lib/trpc';
import { useSpaces } from '@/hooks/use-space';
import { cn, isMac } from '@/lib/utils';
import { num, t, tp } from '@/lib/i18n';
import { useAccountsProgress } from '@/components/settings/account-progress';
import { UpdateStatus, showsUpdate } from '@/components/sidebar/update-status';
import { useAppUpdate } from '@/hooks/use-app-update';

type Counts = {
  views: Partial<Record<View, number>>;
  businesses: Record<string, number>;
  mailboxes?: Record<string, number>;
  tags: Record<string, number>;
  accounts: Record<string, number>;
  spaces?: Record<string, number>;
};

/** Where "back to mail" returns: the last mail view the user was on. */
let lastMailPath = '/mail/inbox';

function SettingsNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = searchSettings(query);
  useEffect(() => setCursor(0), [query]);
  useHotkeys(
    'mod+f',
    (e) => (e.preventDefault(), input.current?.focus(), input.current?.select()),
    { preventDefault: true, enableOnFormTags: true },
  );

  const open = (href: string) => {
    navigate(href);
    setQuery('');
    input.current?.blur();
  };

  return (
    <>
      {/* Takes the slot of "Nouveau message": entering settings moves nothing on screen. */}
      <div className="px-3">
        <label className="bg-card text-card-foreground border-border focus-within:border-ring focus-within:ring-ring/50 flex h-9 w-full items-center gap-2 rounded-lg border px-3 text-[13px] shadow-xs transition focus-within:ring-2">
          <Search className="text-muted-foreground size-4 shrink-0" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery(''), e.currentTarget.blur();
              else if (e.key === 'ArrowDown')
                e.preventDefault(), setCursor((c) => Math.min(c + 1, results.length - 1));
              else if (e.key === 'ArrowUp')
                e.preventDefault(), setCursor((c) => Math.max(c - 1, 0));
              else if (e.key === 'Enter' && results[cursor]) open(results[cursor].href);
            }}
            placeholder={t('Rechercher un réglage')}
            className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none"
            aria-label={t('Rechercher dans les réglages')}
          />
          {query ? null : (
            <kbd className="text-muted-foreground font-sans text-[11px]">
              {isMac ? '⌘' : 'Ctrl'} F
            </kbd>
          )}
        </label>
      </div>

      <nav className="scrollbar-none mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {query ? (
          results.length ? (
            <div className="space-y-px" role="listbox">
              {results.map((r, i) => (
                <button
                  key={r.href + r.title}
                  role="option"
                  aria-selected={i === cursor}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => open(r.href)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                    i === cursor
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent/60',
                  )}
                >
                  <r.icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{r.title}</span>
                    <span className="text-muted-foreground block truncate text-[11.5px]">
                      {r.pageLabel} · {r.hint}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground px-2 py-3 text-[12.5px] leading-relaxed">
              {t('Aucun réglage pour « {query} ».', { query })}
              <br />
              {t('Essayez « mot de passe », « clé API », « thème »…')}
            </p>
          )
        ) : (
          <div className="space-y-px">
            {SETTINGS_PAGES.map((p) => (
              <NavItem
                key={p.id}
                to={`/settings/${p.id}`}
                active={pathname === `/settings/${p.id}`}
                icon={<p.icon />}
                label={p.label}
              />
            ))}
          </div>
        )}
      </nav>
    </>
  );
}

export function AppSidebar({
  onCompose,
  onAgent,
  agentOpen,
}: {
  onCompose: () => void;
  onAgent: () => void;
  agentOpen: boolean;
}) {
  const trpc = useTRPC();
  const { pathname } = useLocation();
  const [search, setSearch] = useSearchParams();
  const catalog = useCatalog();
  // What the cleaning agent still waits for: its questions and the replies it drafted.
  const { data: agentRun } = useQuery(trpc.cleanup.latest.queryOptions());
  const waiting = agentRun ? agentRun.questions.filter((q) => !q.resolved).length + (agentRun.replies?.filter((r) => r.status === 'ready' || r.status === 'failed').length ?? 0) : 0;
  const openAgent = () => {
    // With something waiting, the IA button opens it directly.
    if (waiting && agentRun && !agentOpen) setSearch((prev) => (prev.set('agent', agentRun.id), prev));
    else onAgent();
  };
  const { spaceId } = useSpaces();
  const sidebar = useSidebarWidth();
  useGestureTracker();
  const { data: counts } = useQuery({
    ...trpc.mail.counts.queryOptions({ spaceId }),
    refetchInterval: 20_000,
  }) as { data?: Counts };
  const { data: suggestions } = useQuery(trpc.rules.suggestions.queryOptions());

  const syncing = catalog.accounts.some((a) => a.status === 'syncing');
  const syncingAccount = catalog.accounts.find((a) => a.status === 'syncing');
  // Mails still waiting for the AI (an imported mailbox), all accounts together.
  const progress = useAccountsProgress();
  const aiPending = progress.reduce((n, p) => n + p.ai.pending, 0);
  const aiTotal = progress.filter((p) => p.ai.pending).reduce((n, p) => n + p.ai.total, 0);
  const aiDone = aiTotal - aiPending;
  const failing = catalog.accounts.filter((a) => a.status === 'error');
  // The app updating itself takes the status line: progress, then "Restart to update".
  const { update, install, check } = useAppUpdate();
  const inSettings = pathname.startsWith('/settings');
  useEffect(() => {
    if (!inSettings) lastMailPath = pathname + (search.size ? `?${search}` : '');
  }, [inSettings, pathname, search]);

  return (
    <aside ref={sidebar.ref} style={{ width: sidebar.width }} className="bg-sidebar relative flex h-dvh shrink-0 select-none flex-col">
      {/* Room for the macOS traffic lights: they end about 21 pt down, the buttons start 13 pt
          under them, a little more than the lights' own margin to the top edge, so the glow of
          the AI button never touches them. */}
      <div data-drag-region className="h-[34px] shrink-0" />

      {inSettings ? (
        <SettingsNav />
      ) : (
        <>
          {/* The two actions used most, side by side: write, and hand it to the AI. */}
          <div className="flex gap-1.5 px-3">
            <button
              onClick={onCompose}
              className="bg-foreground text-background hover:bg-foreground/90 focus-visible:ring-ring/50 flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg pr-2.5 pl-3 text-[13px] font-semibold shadow-sm transition focus-visible:ring-2 focus-visible:outline-none"
            >
              <PenSquare className="size-4 shrink-0" />
              <span className="truncate">{t('Nouveau message')}</span>
              <kbd className="text-background/60 ml-auto font-sans text-[11px]">C</kbd>
            </button>
            <button
              type="button"
              onClick={openAgent}
              data-open={agentOpen}
              aria-pressed={agentOpen}
              aria-label={waiting ? tp(waiting, 'Chat IA : {n} chose vous attend', 'Chat IA : {n} choses vous attendent') : t('Chat IA')}
              title={waiting ? tp(waiting, '{n} chose vous attend dans le chat IA', '{n} choses vous attendent dans le chat IA') : `${t('Chat IA')} (${isMac ? '⌘' : 'Ctrl'} J)`}
              className="zm-ai-btn"
            >
              <span>{t('IA')}</span>
              {waiting ? <b className="zm-ai-badge">{waiting > 9 ? '9+' : waiting}</b> : null}
            </button>
          </div>

          {/* Swiping with two fingers slides the spaces past, each with its real lists. */}
          <SpaceCarousel panel={SpacePanel} />
        </>
      )}

      {/* The spaces, at the bottom like in Arc: one per business, one for personal mail… */}
      {inSettings ? null : <SpaceSwitcher unread={counts?.spaces} />}
      <div className="border-sidebar-border/60 space-y-px border-t px-3 py-2">
        {suggestions?.length ? (
          <div className="bg-ai/10 text-ai mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px]">
            <Sparkles className="size-3.5" />
            {tp(suggestions.length, '{n} règle suggérée', '{n} règles suggérées')}
          </div>
        ) : null}
        {/* Leave settings the way you came in: the same button turns into the way back. */}
        {inSettings ? (
          <NavItem to={lastMailPath} active={false} icon={<ArrowLeft />} label={t('Retour aux mails')} />
        ) : (
          <NavItem to="/settings/accounts" active={false} icon={<Settings />} label={t('Réglages')} />
        )}
        {showsUpdate(update) ? (
          <UpdateStatus update={update} onInstall={install} onCheck={check} />
        ) : (
          <Link to="/settings/accounts" className="text-muted-foreground hover:text-foreground flex min-h-7 flex-col justify-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors">
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  failing.length
                    ? 'bg-destructive'
                    : syncing
                      ? 'bg-warning animate-pulse'
                      : aiPending
                        ? 'bg-ai animate-pulse'
                        : catalog.accounts.length
                          ? 'bg-success'
                          : 'bg-muted-foreground',
                )}
              />
              <span className="truncate">
                {failing.length
                  ? tp(failing.length, '{n} compte en erreur', '{n} comptes en erreur')
                  : syncing
                    ? t('Récupération des mails de {email}…', { email: syncingAccount?.label || syncingAccount?.email || '' })
                    : aiPending
                      ? t('Tri IA : {done} sur {total}', { done: num(aiDone), total: num(aiTotal) })
                      : catalog.accounts.length
                        ? tp(catalog.accounts.length, '{n} compte à jour', '{n} comptes à jour')
                        : t('Aucun compte')}
              </span>
            </span>
            {!failing.length && !syncing && aiPending ? (
              <span className="bg-sidebar-accent ml-3.5 h-1 overflow-hidden rounded-full">
                <span className="bg-ai block h-full rounded-full transition-all duration-700" style={{ width: `${Math.floor((aiDone / Math.max(aiTotal, 1)) * 100)}%` }} />
              </span>
            ) : null}
          </Link>
        )}
      </div>
      {sidebar.handle}
    </aside>
  );
}

/** One space's lists in the sidebar, with its own unread counts (the neighbours' are cached). */
/**
 * One space's lists in the sidebar, with its own unread counts. A neighbour (only seen while
 * sliding) also loads its space's inbox ahead, so landing there shows mail at once.
 * Memoised: when a slide ends and the strip recentres, the panels move without redrawing.
 */
const SpacePanel = memo(function SpacePanel({ spaceId }: { spaceId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { spaceId: current } = useSpaces();
  const { sort } = useMailRoute();
  const here = spaceId === current;
  const { data: counts } = useQuery({
    ...trpc.mail.counts.queryOptions({ spaceId }),
    refetchInterval: here ? 20_000 : false,
    staleTime: here ? 0 : 60_000,
  }) as { data?: Counts };
  useEffect(() => {
    if (here) return;
    void queryClient.prefetchInfiniteQuery({
      ...trpc.mail.list.infiniteQueryOptions(spaceInboxInput(spaceId, sort), { getNextPageParam: (last) => last.nextCursor ?? undefined }),
      staleTime: 30_000,
    });
  }, [here, spaceId, sort, queryClient, trpc]);
  return <MailNav counts={counts} />;
});

const WIDTH_KEY = 'zmail.sidebar.width';
const DEFAULT_WIDTH = 272;
const MIN_WIDTH = 220;
const MAX_WIDTH = 420;

/**
 * The sidebar's width: drag its right edge (double-click puts it back), kept per Mac. While
 * dragging, the width is set on the element directly so the pointer never waits for React.
 */
function useSidebarWidth() {
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      return saved >= MIN_WIDTH && saved <= MAX_WIDTH ? saved : DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  });
  const [dragging, setDragging] = useState(false);
  const commit = (w: number) => {
    setWidth(w);
    try {
      localStorage.setItem(WIDTH_KEY, String(w));
    } catch {
      // private mode: the width lasts until the window closes
    }
  };
  const handle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('Largeur de la barre latérale')}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      title={t('Glisser pour élargir ; double-clic pour la largeur d’origine')}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const start = ref.current?.offsetWidth ?? width;
        let w = start;
        setDragging(true);
        const move = (ev: PointerEvent) => {
          w = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, start + ev.clientX - startX)));
          if (ref.current) ref.current.style.width = `${w}px`;
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          setDragging(false);
          commit(w);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
      onDoubleClick={() => commit(DEFAULT_WIDTH)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') commit(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width + (e.key === 'ArrowRight' ? 16 : -16))));
      }}
      tabIndex={0}
      className="group/resize absolute inset-y-0 -right-1.5 z-30 w-3 cursor-col-resize focus-visible:outline-none"
    >
      <span className={cn('bg-ring/70 absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 opacity-0 transition-opacity group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100', dragging && 'opacity-100')} />
    </div>
  );
  return { ref, width, handle };
}

/** Sends the gestures fired with `trackGesture` (lib/track) to the engine's activity log. */
function useGestureTracker() {
  const trpc = useTRPC();
  const track = useMutation(trpc.activity.track.mutationOptions());
  const send = useRef(track.mutate);
  send.current = track.mutate;
  useEffect(() => {
    const onGesture = (e: Event) => send.current((e as CustomEvent<Gesture>).detail);
    window.addEventListener(GESTURE_EVENT, onGesture);
    return () => window.removeEventListener(GESTURE_EVENT, onGesture);
  }, []);
}
