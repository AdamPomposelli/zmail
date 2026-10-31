import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowDownWideNarrow, ArrowRight, CheckCheck, Inbox, ListChecks, Loader2, Rows2, Rows4, Search, ShieldBan, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Link } from 'react-router';
import { useHotkeys } from 'react-hotkeys-hook';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ThreadRow } from './thread-row';
import { ReplyTree } from './reply-tree';
import { BusinessBadge, TagChip } from './chips';
import { useCatalog } from '@/hooks/use-catalog';
import { useMailRoute, VIEW_TITLES } from '@/hooks/use-mail-route';
import { useThreadActions, type ThreadAction } from '@/hooks/use-thread-actions';
import { MailDragGhost, startMailDrag } from '@/lib/mail-drag';
import { useTRPC, type ThreadItem } from '@/lib/trpc';
import { useSpaces } from '@/hooks/use-space';
import { flushViews, trackGesture } from '@/lib/track';
import { cn, isMac } from '@/lib/utils';
import { t, tp } from '@/lib/i18n';
import { bootDone } from '@/lib/boot';
import { SuitePromoRow } from '@/components/zippy/suite-promo';
import { useCategoryFlow } from '@/components/sidebar/mail-nav';

const EMPTY: Record<string, { title: string; body: string }> = {
  inbox: { title: t('Inbox zéro'), body: t('Tout est trié. Profitez de votre deep work.') },
  priority: { title: t('Rien d’urgent'), body: t('Aucun mail prioritaire en attente.') },
  opportunities: { title: t('Pas encore d’opportunité'), body: t('Les demandes de devis et partenariats apparaîtront ici.') },
  otp: { title: t('Aucun code'), body: t('Les codes de vérification reçus s’afficheront ici.') },
  spam: { title: t('Aucun spam'), body: t('L’IA n’a rien trouvé de suspect.') },
};

export function ThreadList({
  selection,
  setSelection,
  focusIndex,
  setFocusIndex,
  onItems,
  searchRef,
}: {
  selection: string[];
  setSelection: (ids: string[]) => void;
  focusIndex: number;
  setFocusIndex: (i: number) => void;
  onItems: (items: ThreadItem[]) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const trpc = useTRPC();
  const route = useMailRoute();
  const catalog = useCatalog();
  const { run, patchLists } = useThreadActions();
  const lastChecked = useRef<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Density: normal (avatar, subject, summary) or compact (one line, Betterbird-like).
  const { data: ui } = useQuery(trpc.settings.get.queryOptions());
  const saveUi = useMutation(
    trpc.settings.save.mutationOptions({
      onMutate: (patch) => queryClient.setQueryData(trpc.settings.get.queryKey(), (prev: Record<string, unknown> | undefined) => ({ ...prev, ...patch })),
    }),
  );
  const density = ui?.listDensity === 'compact' ? 'compact' : 'normal';

  // Search as you type: the URL follows the field a moment after the last key.
  const [search, setSearch] = useState(route.query);
  const typed = useRef(route.query);
  useEffect(() => {
    if (route.query !== typed.current) (setSearch(route.query), (typed.current = route.query));
  }, [route.query]);
  useEffect(() => {
    if (search === route.query) return;
    const id = setTimeout(() => {
      typed.current = search.trim();
      route.update({ q: search.trim() || null }, true);
    }, 180);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  // Conversations unfolded into their reply tree (Betterbird-style), until the view changes.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });

  // Only the current space's mail (an account or a folder picked in the sidebar shows all of it).
  const { spaceId } = useSpaces();
  const query = useInfiniteQuery(
    trpc.mail.list.infiniteQueryOptions(
      { view: route.view, businessId: route.businessId, tagId: route.tagId, accountId: route.accountId, mailboxId: route.mailboxId, spaceId, query: route.query || null, sort: route.sort, limit: 60 },
      {
        getNextPageParam: (last) => last.nextCursor ?? undefined,
        refetchInterval: 60_000,
        // While typing a search, the previous results stay on screen until the new ones arrive;
        // another space's mail never does: a skeleton shows at once instead (if it was not prefetched).
        placeholderData: (previous, previousQuery) => (spaceOfListKey(previousQuery?.queryKey) === spaceId ? keepPreviousData(previous) : undefined),
      },
    ),
  );
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  // A search that stays (not every keystroke) goes to the habits analysis, with what it found.
  const searched = route.query.trim();
  const found = query.isSuccess && !query.isPlaceholderData ? items.length : null;
  useEffect(() => {
    if (!searched || found === null) return;
    const timer = setTimeout(() => trackGesture({ action: 'search', meta: { query: searched.slice(0, 200), results: found } }), 1500);
    return () => clearTimeout(timer);
  }, [searched, found]);
  // The first page of mails is what the boot skeleton was waiting for.
  useEffect(() => {
    if (query.isSuccess || query.isError) bootDone();
  }, [query.isSuccess, query.isError]);
  useEffect(() => onItems(items), [items, onItems]);

  // A folder keeps its latest mails locally; at the bottom, the older ones come from the server,
  // a page at a time, until the server has no more.
  const loadOlder = useMutation(trpc.accounts.loadOlder.mutationOptions());
  const [serverDone, setServerDone] = useState<Record<string, boolean>>({});
  const olderFolder = route.mailboxId && !route.query ? route.mailboxId : null;
  const canLoadOlder = Boolean(olderFolder) && !query.hasNextPage && !query.isFetching && !serverDone[olderFolder!];
  const fetchOlder = useCallback(() => {
    if (!olderFolder || loadOlder.isPending) return;
    loadOlder.mutate(
      { mailboxId: olderFolder },
      {
        onSuccess: (result) => {
          if (!result.more || result.fetched === 0) setServerDone((prev) => ({ ...prev, [olderFolder]: true }));
          void queryClient.invalidateQueries({ queryKey: trpc.mail.list.pathKey() });
        },
        onError: () => setServerDone((prev) => ({ ...prev, [olderFolder]: true })),
      },
    );
  }, [olderFolder, loadOlder, queryClient, trpc]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
      else if (canLoadOlder) fetchOlder();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [query, canLoadOlder, fetchOlder]);

  // Follows the keyboard (j/k), never a list refresh: new or re-sorted mail must not move the
  // list back to the focused row while the user is scrolling.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => {
    const id = itemsRef.current[focusIndex]?.id;
    if (id) document.querySelector(`[data-thread-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focusIndex]);

  const smart = route.sort === 'smart' && ['inbox', 'unread', 'priority'].includes(route.view);
  const isTop = (t: ThreadItem) => t.priority >= 2 && (t.unread || Date.now() - t.date < 3 * 86400_000);
  const dividerIndex = smart && route.view !== 'priority' ? items.findIndex((t) => !isTop(t)) : -1;

  const toggleCheck = (id: string, range: boolean) => {
    if (range && lastChecked.current) {
      const a = items.findIndex((t) => t.id === lastChecked.current);
      const b = items.findIndex((t) => t.id === id);
      const ids = items.slice(Math.min(a, b), Math.max(a, b) + 1).map((t) => t.id);
      setSelection([...new Set([...selection, ...ids])]);
    } else {
      setSelection(selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]);
    }
    lastChecked.current = id;
  };

  useEffect(() => setExpanded(new Set()), [route.view, route.mailboxId, route.tagId, route.businessId, route.accountId, route.query]);

  // → unfolds the focused conversation, ← folds it.
  useHotkeys('right', () => {
    const t = items[focusIndex];
    if (t && t.count > 1) toggleExpand(t.id, true);
  }, { preventDefault: true }, [items, focusIndex]);
  useHotkeys('left', () => {
    const t = items[focusIndex];
    if (t) toggleExpand(t.id, false);
  }, { preventDefault: true }, [items, focusIndex]);

  // ⌘A / Ctrl+A selects every conversation of the list instead of the page's text (except in a field).
  // Captured before anything else, so the browser's own "select all" never runs here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'a' || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable=""], [contenteditable="true"], [role="dialog"]')) return;
      e.preventDefault();
      e.stopPropagation();
      setSelection(items.map((t) => t.id));
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [items, setSelection]);

  // Drag selection: press anywhere in the list and drag; every conversation the box touches is
  // selected (⌘/Ctrl adds to the current selection). The list scrolls when the pointer nears an edge.
  const [marquee, setMarquee] = useState<{ top: number; height: number } | null>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const box = scroller.current;
      if (!box || event.button !== 0 || (event.target as HTMLElement).closest('button, a, input, [role="treeitem"], [data-no-marquee]')) return;
      const startY = event.clientY - box.getBoundingClientRect().top + box.scrollTop;
      const base = event.metaKey || event.ctrlKey ? selectionRef.current : [];
      // Pressed on a conversation and moved sideways (towards the sidebar): the conversation is
      // dragged onto a folder. Moved up or down: the selection box, as before.
      const rowId = (event.target as HTMLElement).closest<HTMLElement>('[data-thread-id]')?.dataset.threadId ?? null;
      let lastY = event.clientY;
      let active = false;
      let frame = 0;
      const update = () => {
        const rect = box.getBoundingClientRect();
        const y = Math.max(0, Math.min(box.scrollHeight, lastY - rect.top + box.scrollTop));
        const top = Math.min(startY, y);
        const bottom = Math.max(startY, y);
        setMarquee({ top, height: bottom - top });
        const hit: string[] = [];
        for (const row of box.querySelectorAll<HTMLElement>('[data-thread-id]')) {
          const r = row.getBoundingClientRect();
          const rowTop = r.top - rect.top + box.scrollTop;
          if (rowTop < bottom && rowTop + r.height > top) hit.push(row.dataset.threadId!);
        }
        setSelection([...new Set([...base, ...hit])]);
      };
      const tick = () => {
        const rect = box.getBoundingClientRect();
        const edge = lastY < rect.top + 40 ? -1 : lastY > rect.bottom - 40 ? 1 : 0;
        if (edge) (box.scrollBy(0, edge * 12), update());
        frame = requestAnimationFrame(tick);
      };
      const move = (e: PointerEvent) => {
        lastY = e.clientY;
        if (!active) {
          const dx = Math.abs(e.clientX - event.clientX);
          const dy = Math.abs(e.clientY - event.clientY);
          if (dx < 6 && dy < 6) return;
          if (rowId && dx > dy) {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
            dragToFolder.current(rowId, e.clientX, e.clientY);
            return;
          }
          if (dy < 6) return;
          active = true;
          document.body.style.userSelect = 'none';
          frame = requestAnimationFrame(tick);
        }
        e.preventDefault();
        update();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        cancelAnimationFrame(frame);
        document.body.style.userSelect = '';
        if (!active) return;
        setMarquee(null);
        // The click that follows the release must not open the conversation under the pointer.
        const swallow = (e: MouseEvent) => (e.preventDefault(), e.stopPropagation());
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    [setSelection],
  );

  // Drag onto a sidebar folder: the conversation (or the selection it belongs to, same account).
  const moveToFolder = useMutation(trpc.mail.moveToFolder.mutationOptions());
  const moveToSpace = useMutation(trpc.mail.moveToSpace.mutationOptions());
  const dragToFolder = useRef<(rowId: string, x: number, y: number) => void>(() => undefined);
  dragToFolder.current = (rowId, x, y) => {
    const row = items.find((t) => t.id === rowId);
    if (!row) return;
    const ids = selection.includes(rowId) ? items.filter((t) => selection.includes(t.id) && t.accountId === row.accountId).map((t) => t.id) : [rowId];
    startMailDrag({ ids, accountId: row.accountId, subject: row.subject, x, y }, async (target) => {
      setSelection([]);
      const special = { archive: 'archive', trash: 'trash', junk: 'spam', inbox: 'restore', all: 'archive' }[target.special ?? ''] as ThreadAction | undefined;
      if (special) return void run(special, ids);
      if (target.spaceId) {
        // Dropped on a space: the conversations leave this space's list at once.
        const rollback = patchLists(ids, () => null);
        try {
          flushViews(ids);
          await moveToSpace.mutateAsync({ threadIds: ids, spaceId: target.spaceId });
          toast.success(tp(ids.length, 'Déplacé vers l’espace {space}', '{n} conversations déplacées vers l’espace {space}', { space: target.label }));
        } catch (error) {
          rollback();
          toast.error((error as Error).message);
        } finally {
          void queryClient.invalidateQueries({ queryKey: trpc.mail.list.pathKey() });
          void queryClient.invalidateQueries({ queryKey: trpc.mail.counts.queryKey() });
        }
        return;
      }
      if (!target.mailboxId) return;
      // Leaves the current list at once (unless this list is that folder), back if it fails.
      const rollback = route.mailboxId === target.mailboxId ? () => undefined : patchLists(ids, () => null);
      try {
        flushViews(ids);
        await moveToFolder.mutateAsync({ threadIds: ids, mailboxId: target.mailboxId });
        toast.success(tp(ids.length, 'Déplacé dans {folder}', '{n} conversations déplacées dans {folder}', { folder: target.label }));
      } catch (error) {
        rollback();
        toast.error((error as Error).message);
      } finally {
        void queryClient.invalidateQueries({ queryKey: trpc.mail.list.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.mail.counts.queryKey() });
      }
    });
  };

  const { spaceId: countsSpace } = useSpaces();
  const flow = useCategoryFlow(useQuery(trpc.mail.counts.queryOptions({ spaceId: countsSpace })).data);

  const { data: folders } = useQuery({ ...trpc.accounts.folders.queryOptions(), enabled: Boolean(route.mailboxId) });
  const folderName = folders?.find((f) => f.id === route.mailboxId)?.name;
  const title = route.businessId
    ? catalog.businessById.get(route.businessId)?.name
    : route.tagId
      ? t(catalog.tagById.get(route.tagId)?.name ?? '')
      : route.mailboxId
        ? (folderName ?? VIEW_TITLES.folder)
        : route.accountId && route.view !== 'inbox'
          ? VIEW_TITLES[route.view]
          : route.accountId
            ? catalog.accountById.get(route.accountId)?.email
            : VIEW_TITLES[route.view];
  // The search keeps this list's filters: say what it searches (all accounts only in the main inbox).
  const allAccounts = route.view === 'inbox' && !route.businessId && !route.tagId && !route.accountId && !route.mailboxId;
  const account = route.accountId && route.view === 'inbox' && !route.mailboxId && !route.tagId && !route.businessId ? catalog.accountById.get(route.accountId) : undefined;
  const business = route.businessId ? catalog.businessById.get(route.businessId) : undefined;
  const tag = route.tagId ? catalog.tagById.get(route.tagId) : undefined;
  const empty = EMPTY[route.view] ?? { title: t('Rien ici'), body: t('Aucune conversation dans cette vue.') };
  const unreadCount = items.filter((t) => t.unread).length;
  // Where this list sits in the sidebar's reading order (only plain views and categories do).
  const flowKey = route.query || route.businessId || route.accountId || route.mailboxId ? null : route.tagId ? `tag:${route.tagId}` : `view:${route.view}`;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <MailDragGhost />
      <header data-drag-region className="flex shrink-0 flex-col gap-2.5 px-4 pt-3.5 pb-2.5">
        <div className="flex items-center gap-2">
          {business ? <BusinessBadge business={business} compact /> : null}
          {tag ? <span className="size-2.5 rounded-full" style={{ backgroundColor: tag.color }} /> : null}
          <h1 className="truncate text-[15px] font-semibold tracking-tight">{title}</h1>
          {unreadCount ? <span className="text-muted-foreground text-xs tabular-nums">{tp(unreadCount, '{n} non lu', '{n} non lus')}</span> : null}
          <div className="ml-auto flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => route.update({ sort: route.sort === 'smart' ? 'date' : null })}
                  className={cn('text-muted-foreground hover:text-foreground flex h-7 items-center gap-1 rounded-md px-1.5 text-[11.5px] hover:bg-accent hover:text-accent-foreground', route.sort === 'smart' && 'text-foreground')}
                >
                  <ArrowDownWideNarrow className="size-3.5" />
                  {route.sort === 'smart' ? t('Priorité') : t('Date')}
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('Trier par priorité IA ou par date')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => saveUi.mutate({ listDensity: density === 'compact' ? 'normal' : 'compact' })}
                  aria-label={density === 'compact' ? t('Affichage normal') : t('Affichage compact')}
                  aria-pressed={density === 'compact'}
                  className={cn('text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground', density === 'compact' && 'text-foreground')}
                >
                  {density === 'compact' ? <Rows4 className="size-3.5" /> : <Rows2 className="size-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{density === 'compact' ? t('Compact : une ligne par mail. Passer en normal') : t('Normal. Passer en compact (une ligne par mail)')}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {selection.length > 0 ? (
          // Single row that never wraps: labels collapse to icon-only buttons when the
          // list gets narrow (container query on the toolbar itself, not the viewport).
          <div className="@container flex h-9 min-w-0 flex-nowrap items-center gap-1 overflow-hidden rounded-lg bg-primary/10 px-1.5 text-[13px] whitespace-nowrap">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setSelection([])}
                  aria-label={t('Désélectionner (Échap)')}
                  className="hover:bg-accent hover:text-accent-foreground flex size-6 shrink-0 items-center justify-center rounded-md"
                >
                  <X className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('Désélectionner (Échap)')}</TooltipContent>
            </Tooltip>
            <span className="flex min-w-0 shrink-0 items-center gap-1.5 font-medium" aria-live="polite">
              <span className="bg-primary text-primary-foreground inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums">
                {selection.length}
              </span>
              <span className="hidden @min-[22rem]:inline">{tp(selection.length, 'sélectionnée', 'sélectionnées')}</span>
              <span className="sr-only @min-[22rem]:hidden">{tp(selection.length, 'sélectionnée', 'sélectionnées')}</span>
            </span>
            {selection.length < items.length ? (
              <button
                onClick={() => setSelection(items.map((t) => t.id))}
                aria-label={t('Tout sélectionner ({n})', { n: items.length })}
                title={t('Tout sélectionner ({n})', { n: `${isMac ? '⌘' : 'Ctrl+'}A` })}
                className="hover:bg-accent hover:text-accent-foreground text-primary flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium whitespace-nowrap @min-[30rem]:px-2"
              >
                <ListChecks className="size-3.5 shrink-0" />
                <span className="hidden @min-[30rem]:inline">{t('Tout sélectionner')}</span>
                <span className="text-muted-foreground hidden tabular-nums @min-[30rem]:inline">{items.length}</span>
              </button>
            ) : null}
            <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-0.5">
              {[
                { a: 'read' as const, icon: CheckCheck, label: t('Marquer comme lu') },
                { a: 'archive' as const, icon: Archive, label: t('Archiver') },
                { a: 'spam' as const, icon: ShieldBan, label: t('Spam') },
                { a: 'trash' as const, icon: Trash2, label: t('Supprimer') },
              ].map(({ a, icon: Icon, label }) => (
                <Tooltip key={a}>
                  <TooltipTrigger asChild>
                    <button
                      aria-label={label}
                      onClick={() => {
                        void run(a, selection);
                        setSelection([]);
                      }}
                      className="hover:bg-accent hover:text-accent-foreground flex h-7 min-w-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-1.5 text-xs whitespace-nowrap @min-[36rem]:px-2"
                    >
                      <Icon className="size-3.5 shrink-0" />
                      <span className="hidden @min-[36rem]:inline">{label}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{label}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        ) : (
          <label className="bg-muted ring-border flex h-9 items-center gap-2 rounded-lg px-2.5 text-[13px] focus-within:bg-transparent focus-within:ring-1">
            <Search className="text-muted-foreground size-3.5 shrink-0" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={allAccounts ? t('Rechercher dans tous les comptes…') : t('Rechercher dans {scope}…', { scope: account?.label || title || '' })}
              className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none"
              onKeyDown={(e) => {
                // Enter searches at once (no wait) and opens nothing: results are already live.
                if (e.key === 'Enter') (typed.current = search.trim()), route.update({ q: search.trim() || null }, true);
                if (e.key === 'Escape') {
                  setSearch('');
                  typed.current = '';
                  route.update({ q: null });
                  e.currentTarget.blur();
                }
              }}
            />
            {query.isFetching && search.trim() && !query.isFetchingNextPage ? <Loader2 className="text-muted-foreground size-3.5 shrink-0 animate-spin" /> : null}
            {search ? (
              <button onClick={() => (setSearch(''), (typed.current = ''), route.update({ q: null }))} className="text-muted-foreground hover:text-foreground" aria-label={t('Effacer la recherche')}>
                <X className="size-3.5" />
              </button>
            ) : (
              <kbd className="text-muted-foreground font-sans text-[11px]">{isMac ? '⌘' : 'Ctrl'} K</kbd>
            )}
          </label>
        )}

        {tag?.description && tag.kind === 'custom' ? <p className="text-muted-foreground -mt-1 text-xs">{tag.description}</p> : null}
        {business && !route.tagId ? (
          <div className="-mt-0.5 flex flex-wrap gap-1">
            {catalog.tags
              .filter((t) => ['opportunity', 'to-respond', 'finance', 'chargeback'].includes(t.id))
              .map((t) => (
                <button key={t.id} onClick={() => route.update({ tag: t.id })} className="opacity-80 transition hover:opacity-100">
                  <TagChip tag={t} />
                </button>
              ))}
          </div>
        ) : null}
      </header>

      <div
        ref={scroller}
        onPointerDown={onPointerDown}
        className="scrollbar scrollbar-w-1 scrollbar-thumb-border scrollbar-track-transparent relative min-h-0 flex-1 overflow-y-auto pb-6 select-none"
        id="thread-list"
      >
        {marquee ? <div className="bg-primary/10 border-primary/50 pointer-events-none absolute right-1 left-1 z-20 rounded-md border" style={{ top: marquee.top, height: marquee.height }} aria-hidden /> : null}
        {query.isPending ? (
          <ListSkeleton />
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 pb-16 text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-muted">
              <Inbox className="text-muted-foreground size-5" />
            </div>
            <p className="text-[15px] font-medium">{route.query ? t('Aucun résultat') : empty.title}</p>
            <p className="text-muted-foreground max-w-xs text-[13px]">{route.query ? t('Rien ne correspond à « {query} ».', { query: route.query }) : empty.body}</p>
            {!route.query ? <EndOfList flow={flow} current={flowKey} bare /> : null}
          </div>
        ) : (
          <>
            {route.view === 'inbox' && !route.businessId && !route.tagId && !route.accountId && !route.query ? <SuitePromoRow /> : null}
            {dividerIndex > 0 ? <SectionLabel>{t('À traiter en priorité')}</SectionLabel> : null}
            {items.map((thread, index) => (
              <div key={`${thread.id}`}>
                {index === dividerIndex && index > 0 ? <SectionLabel>{t('Tout le reste')}</SectionLabel> : null}
                <ThreadRow
                  thread={thread}
                  selected={route.threadId === thread.id}
                  focused={focusIndex === index}
                  checked={selection.includes(thread.id)}
                  showAccount={!route.accountId && catalog.accounts.length > 1}
                  tagById={catalog.tagById}
                  business={thread.businessId && !route.businessId ? catalog.businessById.get(thread.businessId) : undefined}
                  onOpen={(id) => {
                    setFocusIndex(index);
                    route.update({ thread: id, msg: null });
                  }}
                  onToggleCheck={toggleCheck}
                  onAction={(action, id) => void run(action, [id])}
                  expanded={expanded.has(thread.id)}
                  onToggleExpand={(id) => toggleExpand(id)}
                  density={density}
                />
                {expanded.has(thread.id) ? (
                  <ThreadReplies
                    threadId={thread.id}
                    activeId={route.threadId === thread.id ? route.messageId : null}
                    onOpen={(messageId) => {
                      setFocusIndex(index);
                      route.update({ thread: thread.id, msg: messageId });
                    }}
                  />
                ) : null}
              </div>
            ))}
            <div ref={sentinel} className="flex min-h-10 items-center justify-center px-4 text-center">
              {query.isFetchingNextPage ? (
                <Loader2 className="text-muted-foreground size-4 animate-spin" />
              ) : olderFolder && !query.hasNextPage ? (
                loadOlder.isPending ? (
                  <span className="text-muted-foreground flex items-center gap-2 text-[12px]">
                    <Loader2 className="size-3.5 animate-spin" /> {t('Récupération des mails plus anciens sur le serveur…')}
                  </span>
                ) : serverDone[olderFolder] ? (
                  <span className="text-muted-foreground text-[12px]">{t('Tous les mails de ce dossier sont là.')}</span>
                ) : (
                  <button type="button" onClick={fetchOlder} className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-md px-2.5 py-1 text-[12px]">
                    {t('Charger les mails plus anciens')}
                  </button>
                )
              ) : null}
            </div>
            {!query.hasNextPage && !query.isFetching ? <EndOfList flow={flow} current={flowKey} /> : null}
          </>
        )}
      </div>
    </div>
  );
}

/** The conversation's tree of replies, unfolded under its row. */
function ThreadReplies({ threadId, activeId, onOpen }: { threadId: string; activeId: string | null; onOpen: (messageId: string) => void }) {
  const trpc = useTRPC();
  const { data, isPending } = useQuery(trpc.mail.replyTree.queryOptions({ id: threadId }));
  return (
    <div className="zm-unfold mr-1.5 mb-1 ml-[46px] border-l-0 py-0.5">
      {isPending ? (
        <div className="text-muted-foreground flex h-8 items-center gap-2 pl-2 text-xs">
          <Loader2 className="size-3.5 animate-spin" /> {t('Chargement du fil…')}
        </div>
      ) : (
        <ReplyTree nodes={data ?? []} activeId={activeId} onSelect={(node) => onOpen(node.id)} />
      )}
    </div>
  );
}

/**
 * Bottom of a list: the next view or category (in the sidebar's order) that still has unread
 * mail, one click away, so the whole inbox is gone through category by category. When every
 * following one is done, the Zippy suite is shown instead.
 */
function EndOfList({ flow, current, bare }: { flow: ReturnType<typeof useCategoryFlow>; current: string | null; bare?: boolean }) {
  if (!current) return null;
  const index = flow.findIndex((s) => s.key === current);
  if (index === -1) return null;
  const next = flow.slice(index + 1).find((s) => s.unread > 0);
  if (!next) return bare ? null : <div className="mt-1"><SuitePromoRow /></div>;
  return (
    <div className={cn('px-3', bare ? 'mt-5 w-full max-w-sm' : 'mt-1')} data-no-marquee>
      <Link
        to={next.to}
        className="group border-border hover:bg-muted/70 hover:border-primary/40 flex items-center gap-3 rounded-xl border border-dashed px-3.5 py-3 text-left transition-colors"
      >
        <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4">{next.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="text-muted-foreground block text-[11.5px]">{bare ? t('Rien ici. Ensuite :') : t('Vous avez tout vu ici. Ensuite :')}</span>
          <span className="block truncate text-[13.5px] font-medium">
            {t(next.label)} <span className="text-muted-foreground font-normal">· {tp(next.unread, '{n} non lu', '{n} non lus')}</span>
          </span>
        </span>
        <ArrowRight className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-muted-foreground/80 px-4.5 pt-3 pb-1 text-[11px] font-medium tracking-wide uppercase">{children}</div>;
}

const spaceOfListKey = (key: unknown) => ((key as [unknown, { input?: { spaceId?: string } }?] | undefined)?.[1]?.input?.spaceId ?? null);

/** A space's inbox exactly as the list asks for it, so a prefetch fills the very same cache entry. */
export const spaceInboxInput = (spaceId: string, sort: 'smart' | 'date') =>
  ({ view: 'inbox' as const, businessId: null, tagId: null, accountId: null, mailboxId: null, spaceId, query: null, sort, limit: 60 });

function ListSkeleton() {
  return (
    <div className="space-y-1 px-3 pt-1">
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className="flex gap-3 rounded-lg px-2 py-2.5" style={{ opacity: 1 - i * 0.09 }}>
          <div className="size-8 animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-2 pt-0.5">
            <div className="h-3 w-1/3 animate-pulse rounded-sm bg-muted" />
            <div className="h-3 w-3/4 animate-pulse rounded-sm bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
