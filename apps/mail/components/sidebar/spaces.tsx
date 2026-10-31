import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { flushSync } from 'react-dom';
import { useHotkeys } from 'react-hotkeys-hook';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { solar } from '@/components/ui/solar-icon';
import { AccountIcon } from '@/components/account-icon';
import { IconPicker } from '@/components/icon-picker';
import { Checkbox } from '@/components/ui/checkbox';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCatalog } from '@/hooks/use-catalog';
import { MAIN_SPACE, SpaceScope, useSpaces, type Space } from '@/hooks/use-space';
import { TagIcon } from '@/lib/tag-icons';
import { useTRPC } from '@/lib/trpc';
import { cn, PALETTE } from '@/lib/utils';
import { t } from '@/lib/i18n';

const Pencil = solar('_signatures');
const TrashIcon = solar('_trash');
// The main space's own mark: never the Inbox icon, which sits right below it.
const Home = solar('home');

/** A space's icon: its own (emoji, image, library icon), or its initial on its colour. */
export function SpaceIcon({ space, size = 18 }: { space: Pick<Space, 'id' | 'name' | 'icon' | 'color'>; size?: number }) {
  if (space.icon)
    return (
      <span className="flex shrink-0 items-center justify-center [&>*]:!size-full" style={{ width: size, height: size }}>
        <TagIcon icon={space.icon} color={space.color} />
      </span>
    );
  if (space.id === MAIN_SPACE) return <Home className="shrink-0" style={{ width: size, height: size, color: space.color }} />;
  return (
    <span className="flex shrink-0 items-center justify-center rounded-[5px] font-semibold text-white" style={{ width: size, height: size, backgroundColor: space.color, fontSize: size * 0.55 }}>
      {space.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

const spaceName = (space: Pick<Space, 'id' | 'name'>) => (space.id === MAIN_SPACE ? t(space.name) : space.name);

/**
 * Leaving a space: whatever was filtered (a category, a business, an open conversation) belongs
 * to the old one, so the new space opens on the same view, unfiltered.
 */
function useOpenSpace() {
  const { select } = useSpaces();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (id: string) => {
    select(id);
    if (pathname.startsWith('/mail/')) navigate(`/mail/${pathname.split('/')[2] === 'starred' ? 'starred' : 'inbox'}`);
  };
}

/** Set by the carousel while it is on screen: slides to a neighbouring space instead of jumping. */
let slideTo: ((id: string) => boolean) | null = null;

/** How far into a swipe the app already switches to the incoming space. */
const COMMIT_AT = 0.7;

/**
 * The sidebar's lists for the current space, with the spaces on either side drawn next to it.
 * A two-finger swipe scrolls the strip natively (trackpad momentum, rubber band and snapping all
 * run on the compositor, nothing waits for JavaScript), so the next space's categories really
 * slide in, as in Arc.
 *
 * The app does not wait for the slide to end: past 70 % of the way, the incoming space becomes
 * the current one (its mail list shows, from the prefetch or as a skeleton) while the strip
 * keeps gliding. The strip only recentres once it has snapped, by moving the panels it already
 * drew, which costs nothing. Sliding back under 70 % switches back.
 */
export function SpaceCarousel({ panel: Panel }: { panel: ComponentType<{ spaceId: string }> }) {
  const { spaces, spaceId } = useSpaces();
  const open = useOpenSpace();
  const openRef = useRef(open);
  openRef.current = open;
  const strip = useRef<HTMLDivElement>(null);
  // The space at the centre of the strip: follows the current one, except during a slide whose
  // incoming space was made current early (`early`), until the strip has snapped onto it.
  const [shown, setShown] = useState(spaceId);
  const early = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (spaceId !== shown && spaceId !== early.current) setShown(spaceId);
  }, [spaceId, shown]);
  const n = spaces.length;
  const index = spaces.findIndex((s) => s.id === shown);
  const many = n > 1 && index !== -1;
  const prev = many ? spaces[(index - 1 + n) % n]! : null;
  const next = many ? spaces[(index + 1) % n]! : null;
  // Keyed by space, so recentring moves the panels instead of redrawing them (with two spaces
  // both sides show the same one, which then needs its own keys).
  const panels: [string, string, string][] = many
    ? [
        ['prev', prev!.id, n === 2 ? `prev:${prev!.id}` : prev!.id],
        ['cur', shown, shown],
        ['next', next!.id, n === 2 ? `next:${next!.id}` : next!.id],
      ]
    : [['cur', shown, shown]];

  const centre = () => {
    const el = strip.current;
    if (el && many) el.scrollLeft = el.clientWidth;
  };
  // Before paint, whenever the centre changes (end of a slide, click, ⌃1–9) or the sidebar is resized.
  useLayoutEffect(centre, [shown, many, n]);
  useEffect(() => {
    const el = strip.current;
    if (!el || !many) return;
    const resize = new ResizeObserver(centre);
    resize.observe(el);
    // Makes `id` the current space ahead of the snap, or (null) goes back to the one at the centre.
    const switchTo = (id: string | null) => {
      if (early.current === id) return;
      early.current = id;
      openRef.current(id ?? shown);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      const w = el.clientWidth;
      const at = el.scrollLeft / w;
      const k = Math.round(at);
      // Still moving, or a finger holds it between two spaces: wait for the snap.
      if (Math.abs(at - k) * w > 1.5) return;
      if (k === 1) return switchTo(null);
      const target = k === 0 ? prev!.id : next!.id;
      switchTo(target);
      early.current = null;
      flushSync(() => setShown(target));
      el.scrollLeft = w;
      // One space per swipe: the trackpad's momentum after it must not carry on to the next.
      el.style.overflowX = 'hidden';
      calm();
    };
    let calming: ReturnType<typeof setTimeout> | undefined;
    const calm = () => {
      clearTimeout(calming);
      calming = setTimeout(() => (el.style.overflowX = ''), 220);
    };
    const onWheel = () => el.style.overflowX === 'hidden' && calm();
    const onScroll = () => {
      const progress = el.scrollLeft / el.clientWidth - 1;
      if (progress >= COMMIT_AT) switchTo(next!.id);
      else if (progress <= -COMMIT_AT) switchTo(prev!.id);
      // A little below the threshold before switching back, so a hesitating finger does not flicker.
      else if (Math.abs(progress) < COMMIT_AT - 0.1) switchTo(null);
      clearTimeout(timer);
      timer = setTimeout(settle, 80);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('scrollend', settle);
    el.addEventListener('wheel', onWheel, { passive: true });
    slideTo = (id) => {
      if (id !== prev!.id && id !== next!.id) return false;
      // With two spaces both sides show the other one: slide the way the icons are ordered.
      const right = id === next!.id && (id !== prev!.id || spaces.findIndex((s) => s.id === id) > index);
      el.scrollTo({ left: right ? 2 * el.clientWidth : 0, behavior: 'smooth' });
      return true;
    };
    return () => {
      resize.disconnect();
      clearTimeout(timer);
      clearTimeout(calming);
      el.style.overflowX = '';
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('scrollend', settle);
      slideTo = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [many, shown, prev?.id, next?.id, index]);

  return (
    <div ref={strip} className="scrollbar-none mt-3 flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain">
      {panels.map(([pos, id, key]) => {
        const space = spaces.find((s) => s.id === id);
        return (
          <nav
            key={key}
            data-space-panel={pos}
            // The neighbours are only seen while sliding: no focus, no clicks, no screen reader.
            inert={pos !== 'cur'}
            className="scrollbar-none w-full shrink-0 snap-center snap-always overflow-y-auto px-3 pb-4"
          >
            {space && n > 1 ? <SpaceHeader space={space} /> : null}
            <SpaceScope.Provider value={id}>
              <Panel spaceId={id} />
            </SpaceScope.Provider>
          </nav>
        );
      })}
    </div>
  );
}

/**
 * A space's name above its lists. Double-click the name to rename it in place; click the icon to
 * open the space's editor (icon, colour, accounts).
 */
function SpaceHeader({ space }: { space: Space }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const done = useRef(false);
  const save = useMutation(
    trpc.spaces.save.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpc.spaces.list.queryKey() }),
      onError: (e) => toast.error(e.message),
    }),
  );
  const start = () => {
    done.current = false;
    setName(spaceName(space));
    setRenaming(true);
  };
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    setRenaming(false);
    const next = value?.trim();
    if (!next || next === spaceName(space)) return;
    // Only the name: without `accountIds`, the space keeps its accounts as they are.
    save.mutate({ id: space.id, name: next, icon: space.icon, color: space.color });
  };
  return (
    // A pill tinted with the space's colour, like Arc's space title: nothing like a row (no tint)
    // or a section title (small grey capitals), so the space never reads as one of its lists.
    <div
      className="mb-2.5 flex items-center gap-2 rounded-lg border px-2 py-1.5"
      style={{ backgroundColor: `color-mix(in oklab, ${space.color} 14%, transparent)`, borderColor: `color-mix(in oklab, ${space.color} 30%, transparent)`, color: `color-mix(in oklab, ${space.color} 70%, var(--sidebar-foreground))` }}
    >
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="-m-0.5 flex shrink-0 items-center justify-center rounded-md p-0.5 transition hover:bg-black/10 dark:hover:bg-white/10"
        aria-label={t('Modifier l’espace')}
        title={t('Modifier l’espace')}
      >
        <SpaceIcon space={space} size={16} />
      </button>
      {renaming ? (
        <input
          autoFocus
          value={name}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') finish(name);
            if (e.key === 'Escape') finish(null);
          }}
          onBlur={() => finish(name)}
          maxLength={60}
          aria-label={t('Nom de l’espace')}
          className="bg-background text-foreground ring-ring/60 -my-1 h-6 min-w-0 flex-1 rounded-md px-1.5 text-[13px] font-semibold ring-1 outline-none"
        />
      ) : (
        <span onDoubleClick={start} className="min-w-0 flex-1 cursor-default truncate text-[13px] font-semibold tracking-tight select-none" title={t('Double-cliquez pour renommer')}>
          {spaceName(space)}
        </span>
      )}
      <SpaceDialog space={space} open={editing} onOpenChange={setEditing} />
    </div>
  );
}

/** The row of spaces at the bottom of the sidebar: click, ⌃1–9, swipe, or drop a mail on one. */
export function SpaceSwitcher({ unread }: { unread?: Record<string, number> }) {
  const { spaces, spaceId } = useSpaces();
  const open = useOpenSpace();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Space | 'new' | null>(null);
  const remove = useMutation(
    trpc.spaces.remove.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.spaces.list.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.catalog.tags.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.mail.pathKey() });
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  useHotkeys(
    ['ctrl+1', 'ctrl+2', 'ctrl+3', 'ctrl+4', 'ctrl+5', 'ctrl+6', 'ctrl+7', 'ctrl+8', 'ctrl+9'],
    (e) => {
      const target = spaces[Number(e.key) - 1];
      if (target && !slideTo?.(target.id)) open(target.id);
    },
    { preventDefault: true },
    [spaces],
  );

  return (
    <>
      <div className="flex items-center gap-0.5 px-1.5 pt-1" role="tablist" aria-label={t('Espaces')}>
        {spaces.map((space, i) => {
          const active = space.id === spaceId;
          const count = unread?.[space.id] ?? 0;
          return (
            <ContextMenu key={space.id} modal={false}>
              <Tooltip>
                <ContextMenuTrigger asChild>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-label={spaceName(space)}
                      onClick={() => (active || !slideTo?.(space.id)) && open(space.id)}
                      onDoubleClick={() => setEditing(space)}
                      data-drop-space={space.id}
                      data-drop-label={spaceName(space)}
                      className={cn(
                        'relative flex size-8 items-center justify-center rounded-lg transition',
                        active ? 'bg-sidebar-accent' : 'opacity-55 hover:bg-sidebar-accent/60 hover:opacity-100',
                        'data-[drag-over]:bg-primary/15 data-[drag-over]:ring-primary data-[drag-over]:opacity-100 data-[drag-over]:ring-2',
                      )}
                    >
                      <SpaceIcon space={space} size={active ? 18 : 16} />
                      {count && !active ? <span className="bg-primary ring-sidebar absolute top-1 right-1 size-1.5 rounded-full ring-2" aria-hidden /> : null}
                    </button>
                  </TooltipTrigger>
                </ContextMenuTrigger>
                <TooltipContent side="top">
                  {spaceName(space)}
                  {count ? ` · ${count}` : ''}
                  {i < 9 ? <span className="text-muted-foreground ml-1.5">⌃{i + 1}</span> : null}
                </TooltipContent>
              </Tooltip>
              <ContextMenuContent className="w-52">
                <ContextMenuLabel>{spaceName(space)}</ContextMenuLabel>
                <ContextMenuItem onSelect={() => setTimeout(() => setEditing(space), 0)}>
                  <Pencil /> {t('Modifier l’espace…')}
                </ContextMenuItem>
                {space.id !== MAIN_SPACE ? (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      destructive
                      onSelect={() => {
                        if (!window.confirm(t('Supprimer l’espace « {name} » ? Ses mails retournent dans les autres espaces, rien n’est supprimé.', { name: space.name }))) return;
                        if (active) open(MAIN_SPACE);
                        remove.mutate({ id: space.id }, { onSuccess: () => toast.success(t('Espace « {name} » supprimé', { name: space.name })) });
                      }}
                    >
                      <TrashIcon /> {t('Supprimer')}
                    </ContextMenuItem>
                  </>
                ) : null}
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => setEditing('new')} className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60 ml-auto flex size-8 items-center justify-center rounded-lg transition" aria-label={t('Nouvel espace')}>
              <Plus className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {t('Nouvel espace')}
            {spaces.length > 1 ? <span className="text-muted-foreground ml-1.5">{t('Glissez à deux doigts pour changer')}</span> : null}
          </TooltipContent>
        </Tooltip>
      </div>
      <SpaceDialog space={editing === 'new' ? null : editing} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} onCreated={(id) => open(id)} />
    </>
  );
}

/** Creates or edits a space: name, icon, and which mailboxes feed it (their businesses follow, see Spaces.syncBusinesses). */
export function SpaceDialog({ space, open, onOpenChange, onCreated }: { space: Space | null; open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (id: string) => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const { spaces } = useSpaces();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState(PALETTE[0]!);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(space ? spaceName(space) : '');
    setIcon(space?.icon ?? null);
    setColor(space?.color ?? PALETTE[spaces.length % PALETTE.length]!);
    setAccountIds(space?.accountIds ?? []);
  }, [open, space, spaces.length]);
  const main = space?.id === MAIN_SPACE;
  const save = useMutation(
    trpc.spaces.save.mutationOptions({
      onSuccess: (saved) => {
        void queryClient.invalidateQueries({ queryKey: trpc.spaces.list.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.mail.pathKey() });
        onOpenChange(false);
        if (!space) {
          toast.success(t('Espace « {name} » créé', { name: saved.name }), { description: t('Clic droit sur un mail → « Déplacer vers l’espace », ou glissez-le sur son icône.') });
          onCreated?.(saved.id);
        }
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const preview = { id: space?.id ?? 'new', name: name || '?', icon, color };
  const business = (id: string | null | undefined) => {
    const b = id ? catalog.businesses.find((x) => x.id === id) : null;
    return b ? (
      <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-[11.5px]">
        {b.emoji ?? <span className="inline-block size-1.5 rounded-full" style={{ backgroundColor: b.color }} />} {b.name}
      </span>
    ) : null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showOverlay className="max-w-[460px]">
        <DialogTitle>{space ? t('Modifier l’espace') : t('Nouvel espace')}</DialogTitle>
        <DialogDescription>{t('Chaque espace a sa boîte de réception, ses favoris, ses abonnements et ses catégories. Les mails de ses comptes, et de leurs business, y arrivent tout seuls.')}</DialogDescription>
        <form
          className="mt-2 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ id: space?.id, name: main && name === t(space!.name) ? space!.name : name, icon, color, ...(main ? {} : { accountIds }) });
          }}
        >
          <div className="flex items-center gap-2">
            <Popover open={picking} onOpenChange={setPicking}>
              <PopoverTrigger asChild>
                <button type="button" className="hover:bg-accent flex size-10 shrink-0 items-center justify-center rounded-lg border border-border transition" aria-label={t('Icône de l’espace')}>
                  <SpaceIcon space={preview} size={20} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-3">
                <IconPicker title={name || t('Espace')} value={icon} color={color} fallback={<SpaceIcon space={{ ...preview, icon: null }} size={20} />} onChange={setIcon} onColor={setColor} />
              </PopoverContent>
            </Popover>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Personnel, Brilisse, Hoop Haven…')} className="h-10 text-[14px]" maxLength={60} />
          </div>

          {main ? (
            <p className="text-muted-foreground rounded-lg bg-muted px-3 py-2 text-[12.5px]">{t('L’espace principal reçoit tout ce qui n’est rangé dans aucun autre espace.')}</p>
          ) : (
            <>
              {catalog.accounts.length ? (
                <fieldset className="space-y-1.5">
                  <legend className="mb-1 text-[12.5px] font-medium">{t('Comptes rangés ici')}</legend>
                  {catalog.accounts.map((a) => {
                    // Where its mail goes now: its own space, or its business's; « main » is not « elsewhere ».
                    const other = spaces.find((s) => s.id !== space?.id && s.id !== MAIN_SPACE && (s.accountIds.includes(a.id) || (!!a.businessId && s.businessIds.includes(a.businessId) && !spaces.some((x) => x.accountIds.includes(a.id)))));
                    return (
                      <label key={a.id} className="hover:bg-accent/50 flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px]">
                        <Checkbox checked={accountIds.includes(a.id)} onCheckedChange={() => toggle(accountIds, setAccountIds, a.id)} />
                        <AccountIcon account={a} size={16} />
                        <span className="min-w-0 flex-1 truncate">{a.label || a.email}</span>
                        {business(a.businessId)}
                        {other && !accountIds.includes(a.id) ? <span className="text-muted-foreground text-[11.5px]">{t('dans {space}', { space: spaceName(other) })}</span> : null}
                      </label>
                    );
                  })}
                </fieldset>
              ) : null}
              <p className="text-muted-foreground text-[11.5px]">{t('Le business d’un compte le suit : ses mails arrivent ici, même reçus sur un autre compte. Cocher un compte déjà rangé ailleurs le déplace ici ; un mail déplacé à la main garde son espace.')}</p>
            </>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="hover:bg-accent h-9 rounded-lg px-3 text-[13px]">
              {t('Annuler')}
            </button>
            <button type="submit" disabled={!name.trim() || save.isPending} className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-lg px-4 text-[13px] font-medium disabled:opacity-50">
              {space ? t('Enregistrer') : t('Créer l’espace')}
            </button>
          </div>
          {!space ? <p className="text-muted-foreground text-center text-[11px]">{t('Astuce : ⌃1 à ⌃9 ou un glissement à deux doigts sur la barre latérale pour changer d’espace.')}</p> : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}

