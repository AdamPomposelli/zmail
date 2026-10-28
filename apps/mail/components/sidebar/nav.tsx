import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useEffect, useRef, useState, type PointerEventHandler, type ReactNode } from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

export function NavItem({
  to,
  active,
  icon,
  label,
  count,
  accent,
  actions,
  indent = 0,
  tree,
  iconWrap,
  onPointerDown,
  onClick,
  muted,
  menu,
  onDoubleClick,
  renaming,
}: {
  to: string;
  active: boolean;
  icon: ReactNode;
  label: string;
  count?: number;
  accent?: string;
  /** Buttons revealed on hover, in place of the count. */
  actions?: ReactNode;
  indent?: number;
  /**
   * Tree rows. Depth 0 (an account) has its fold arrow in a column on the left, under the
   * section's arrow. Deeper rows (folders) start at the same column as every other row, so
   * their icons line up with the categories above; each further level shifts by FOLDER_STEP,
   * and a folder's arrow takes its icon's place on hover (no column lost to arrows).
   */
  tree?: { depth: number; open?: boolean; onToggle?: () => void; label?: string };
  /** Makes the icon its own button (e.g. a popover trigger) sitting over the row's link. */
  iconWrap?: (icon: ReactNode) => ReactNode;
  /** Starts a drag (see use-sidebar-drag). */
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  onClick?: () => void;
  muted?: boolean;
  /** The row's own menu (right-click), in place of the WebView's link menu. */
  menu?: ReactNode;
  onDoubleClick?: () => void;
  /** Inline rename: the label becomes a field; null on cancel. */
  renaming?: { value: string; onDone: (value: string | null) => void };
}) {
  const iconNode = (
    <span
      className={cn(
        // Direct children only: nested marks (brand logos, status badges) keep their own size.
        'flex size-4 shrink-0 items-center justify-center [&>svg]:size-4',
        active ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground',
      )}
      style={accent ? { color: accent } : undefined}
    >
      {icon}
    </span>
  );
  const row = (
    <div className="group/item relative" onPointerDown={renaming ? undefined : onPointerDown}>
      <Link
        to={to}
        draggable={false}
        onClick={(e) => (renaming ? e.preventDefault() : onClick?.())}
        onDoubleClick={
          onDoubleClick
            ? (e) => {
                e.preventDefault();
                onDoubleClick();
              }
            : undefined
        }
        style={{ paddingLeft: tree ? (tree.depth === 0 ? 4 : 8 + (tree.depth - 1) * FOLDER_STEP) : 8 + indent * 14 }}
        className={cn(
          'group flex h-8 items-center gap-2.5 rounded-lg pr-2 text-[13px] transition-colors',
          active
            ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
            : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
          muted && !active && 'text-muted-foreground',
        )}
      >
        {tree?.depth === 0 ? <Disclosure {...tree} /> : null}
        {iconWrap ? (
          <span className="size-4 shrink-0" aria-hidden />
        ) : tree && tree.depth > 0 && tree.onToggle ? (
          <span className="relative flex size-4 shrink-0">
            <span className="flex transition-opacity group-hover/item:opacity-0">{iconNode}</span>
            <Disclosure {...tree} overlay />
          </span>
        ) : (
          iconNode
        )}
        {renaming ? <RenameField value={renaming.value} onDone={renaming.onDone} /> : <span className="min-w-0 flex-1 truncate">{label}</span>}
        {count ? (
          <span
            className={cn(
              'text-[11px] tabular-nums',
              actions && 'group-hover/item:opacity-0',
              active ? 'text-foreground/70' : 'text-muted-foreground',
            )}
          >
            {count > 999 ? '999+' : count}
          </span>
        ) : null}
      </Link>
      {iconWrap ? (
        <span className="absolute top-1/2 z-10 flex -translate-y-1/2" style={{ left: 4 + indent * 14 }}>
          {iconWrap(iconNode)}
        </span>
      ) : null}
      {actions ? (
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/item:opacity-100 has-[[data-state=open]]:opacity-100">
          {actions}
        </div>
      ) : null}
    </div>
  );
  if (!menu) return row;
  // Non-modal: a modal menu that opens a dialog can leave the page unclickable (Radix lock).
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>{menu}</ContextMenuContent>
    </ContextMenu>
  );
}

/** The label as a text field, Finder-style: Enter or leaving it saves, Escape cancels. */
function RenameField({ value, onDone }: { value: string; onDone: (value: string | null) => void }) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v === null || !v.trim() || v.trim() === value ? null : v.trim());
  };
  return (
    <input
      ref={ref}
      value={text}
      aria-label={t('Nouveau nom')}
      onChange={(e) => setText(e.target.value)}
      onClick={(e) => (e.preventDefault(), e.stopPropagation())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(text);
        if (e.key === 'Escape') finish(null);
      }}
      onBlur={() => finish(text)}
      className="bg-background ring-ring/60 -my-1 h-6 min-w-0 flex-1 rounded-md px-1.5 text-[13px] ring-1 outline-none"
    />
  );
}

/** Indent of one folder level: a child's icon sits just right of its parent's icon. */
const FOLDER_STEP = 18;

/**
 * The fold arrow of a tree row, inside its hover area. A span (the row is a link).
 * `overlay`: drawn over the row's icon, shown on hover (folders).
 */
function Disclosure({ open, onToggle, label, overlay }: { open?: boolean; onToggle?: () => void; label?: string; overlay?: boolean }) {
  if (!onToggle) return <span className="-mr-1 size-4 shrink-0" aria-hidden />;
  const toggle = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle();
  };
  return (
    <span
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={label ? (open ? t('Replier {label}', { label }) : t('Déplier {label}', { label })) : open ? t('Replier') : t('Déplier')}
      onClick={toggle}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggle(e)}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent flex size-4 shrink-0 items-center justify-center rounded-sm transition-colors focus-visible:ring-ring/50 focus-visible:ring-2 focus-visible:outline-none',
        overlay ? 'absolute inset-0 opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100' : '-mr-1',
      )}
    >
      <ChevronRight className={cn('size-3 transition-transform duration-200', open && 'rotate-90')} />
    </span>
  );
}

/** Small icon button used in a row's hover actions. */
export function RowAction({ label, children, ...rest }: { label: string; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  // `rest` carries the click handler, including the one a Popover trigger injects.
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="text-muted-foreground hover:text-sidebar-accent-foreground bg-sidebar hover:bg-sidebar-accent flex size-6 items-center justify-center rounded-md [&_svg]:size-3.5"
      {...rest}
    >
      {children}
    </button>
  );
}

export function Section({
  title,
  children,
  action,
  defaultOpen = true,
  menu,
  onTitleDoubleClick,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  defaultOpen?: boolean;
  menu?: ReactNode;
  onTitleDoubleClick?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-5">
      <div className="group/section mb-1 flex items-center justify-between pr-2 pl-1">
        {/* Same arrow, same place as tree rows: on the left, pointing right when folded. */}
        {(() => {
          const trigger = (
            <CollapsibleTrigger
              onDoubleClick={onTitleDoubleClick ? (e) => (e.preventDefault(), setOpen(true), onTitleDoubleClick()) : undefined}
              className="text-muted-foreground/80 hover:text-foreground flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide"
            >
              <span className="flex size-4 items-center justify-center">
                <ChevronRight className={cn('size-3 transition-transform duration-200', open && 'rotate-90')} />
              </span>
              {title}
            </CollapsibleTrigger>
          );
          return menu ? (
            <ContextMenu modal={false}>
              <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
              <ContextMenuContent>{menu}</ContextMenuContent>
            </ContextMenu>
          ) : (
            trigger
          );
        })()}
        {action}
      </div>
      <CollapsibleContent className="space-y-px">{children}</CollapsibleContent>
    </Collapsible>
  );
}
