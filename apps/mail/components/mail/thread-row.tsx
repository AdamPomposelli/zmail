import { Archive, ChevronRight, MailOpen, Paperclip, Star, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { toast } from 'sonner';
import { AiSummary, BusinessBadge, OtpChip, SenderAvatar, TagChip } from './chips';
import type { ThreadAction } from '@/hooks/use-thread-actions';
import type { Business, Tag, ThreadItem } from '@/lib/trpc';
import { cn, displayName, formatListDate } from '@/lib/utils';
import { copyText } from '@/lib/native';
import { TagIcon } from '@/lib/tag-icons';
import { t } from '@/lib/i18n';

const PRIORITY_BAR = ['', '', 'bg-warning', 'bg-destructive'];

type Props = {
  thread: ThreadItem;
  selected: boolean;
  focused: boolean;
  checked: boolean;
  showAccount: boolean;
  tagById: Map<string, Tag>;
  business?: Business;
  onOpen: (id: string) => void;
  onToggleCheck: (id: string, range: boolean) => void;
  onAction: (action: ThreadAction, id: string) => void;
  /** Conversation unfolded into its tree of replies, under the row. */
  expanded?: boolean;
  onToggleExpand?: (id: string) => void;
  /** `compact`: one line per conversation, Betterbird-like, to see many more at once. */
  density?: 'normal' | 'compact';
};

export const ThreadRow = memo(function ThreadRow(props: Props) {
  return props.density === 'compact' ? <CompactRow {...props} /> : <NormalRow {...props} />;
});

function NormalRow({ thread, selected, focused, checked, showAccount, tagById, business, onOpen, onToggleCheck, onAction, expanded = false, onToggleExpand }: Props) {
  const tags = thread.tags.map((id) => tagById.get(id)).filter((t): t is Tag => Boolean(t) && t!.id !== 'important');
  const visibleTags = tags.slice(0, 2);

  return (
    <div className="px-1.5 py-[1px]" data-thread-id={thread.id}>
      <div
        role="button"
        tabIndex={-1}
        onClick={(e) => (e.metaKey || e.ctrlKey || e.shiftKey ? onToggleCheck(thread.id, e.shiftKey) : onOpen(thread.id))}
        className={cn(
          'group relative flex cursor-default items-start gap-3 rounded-lg px-3 py-2.5 transition-colors',
          selected ? 'bg-muted' : checked ? 'bg-primary/10' : 'hover:bg-muted/70',
          focused && !selected && 'ring-1 ring-border ring-inset',
        )}
      >
        {thread.priority >= 2 ? <span className={cn('absolute top-3 bottom-3 left-0.5 w-[3px] rounded-full', PRIORITY_BAR[thread.priority])} /> : null}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCheck(thread.id, e.shiftKey);
          }}
          className="group/check relative mt-0.5 shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={checked ? t('Désélectionner') : t('Sélectionner')}
          aria-pressed={checked}
        >
          {checked ? (
            // Checked: the avatar turns into a disc that pops in, the tick draws itself and a ripple
            // goes out, so the change is visible even under the cursor and on blue avatars.
            <span className="zm-check relative flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background shadow-sm">
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path className="zm-check-tick" d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
          ) : (
            <span className="relative block">
              <SenderAvatar name={thread.from.name} email={thread.from.email} />
              {/* Hover: hint that the avatar is a checkbox. */}
              <span className="bg-background/70 absolute inset-0 flex items-center justify-center rounded-full opacity-0 ring-2 ring-primary/60 backdrop-blur-[1px] transition-opacity group-hover/check:opacity-100" aria-hidden>
                <span className="border-primary size-4 rounded-full border-2" />
              </span>
            </span>
          )}
          {thread.unread ? <span className="ring-background absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-primary ring-2" /> : null}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('truncate text-[13.5px]', thread.unread ? 'font-semibold text-foreground' : 'text-foreground/85')}>{displayName(thread.from)}</span>
            {thread.count > 1 ? <FoldToggle thread={thread} expanded={expanded} onToggle={onToggleExpand} /> : null}
            {business ? <BusinessBadge business={business} compact /> : null}
            {showAccount ? <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: thread.accountColor }} title={thread.accountEmail} /> : null}
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {thread.hasAttachments ? <Paperclip className="text-muted-foreground size-3" /> : null}
              {thread.starred ? <Star className="size-3 fill-warning text-warning" /> : null}
              <time className={cn('text-[11.5px] tabular-nums group-hover:opacity-0', thread.unread ? 'text-foreground/80 font-medium' : 'text-muted-foreground')}>{formatListDate(thread.date)}</time>
            </span>
          </div>

          <div className="mt-0.5 flex items-center gap-2">
            <p className={cn('min-w-0 flex-1 truncate text-[13px]', thread.unread ? 'text-foreground' : 'text-foreground/70')}>{thread.subject || t('(sans objet)')}</p>
          </div>

          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            {thread.otp ? <OtpChip code={thread.otp} onCopy={() => void copyText(thread.otp!).then(() => toast.success(t('Code {code} copié', { code: thread.otp! })))} /> : null}
            {visibleTags.map((tag) => (
              <TagChip key={tag.id} tag={tag} />
            ))}
            {tags.length > 2 ? <span className="text-muted-foreground text-[11px]">+{tags.length - 2}</span> : null}
            <AiSummary text={thread.summary || thread.snippet} className="ml-0.5 flex-1" />
          </div>
        </div>

        <div className="bg-popover/95 text-popover-foreground border-border absolute top-2 right-2 hidden items-center gap-0.5 rounded-lg border p-0.5 shadow-sm backdrop-blur group-hover:flex">
          {[
            { action: thread.mailbox === 'archive' || thread.mailbox === 'all' ? null : ('archive' as const), icon: Archive, label: t('Archiver (E)') },
            { action: thread.unread ? ('read' as const) : ('unread' as const), icon: MailOpen, label: thread.unread ? t('Marquer comme lu') : t('Marquer comme non lu') },
            { action: thread.starred ? ('unstar' as const) : ('star' as const), icon: Star, label: t('Ajouter aux favoris (S)') },
            { action: thread.mailbox === 'trash' ? ('deleteForever' as const) : ('trash' as const), icon: Trash2, label: t('Supprimer (#)') },
          ]
            .filter((b) => b.action)
            .map(({ action, icon: Icon, label }) => (
              <button
                key={label}
                type="button"
                title={label}
                onClick={(e) => {
                  e.stopPropagation();
                  onAction(action!, thread.id);
                }}
                className={cn('text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded-md hover:bg-accent', action === 'trash' && 'hover:text-destructive')}
              >
                <Icon className={cn('size-3.5', action === 'unstar' && 'fill-warning text-warning')} />
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

/** The conversation's message count, as a button unfolding its tree of replies. */
function FoldToggle({ thread, expanded, onToggle }: { thread: ThreadItem; expanded: boolean; onToggle?: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => (e.stopPropagation(), onToggle?.(thread.id))}
      aria-expanded={expanded}
      aria-label={expanded ? t('Replier la conversation') : t('Déplier les {n} messages de la conversation', { n: thread.count })}
      title={expanded ? t('Replier (←)') : t('Voir qui répond à qui (→)')}
      className={cn(
        'text-muted-foreground hover:text-foreground hover:bg-accent -my-0.5 flex h-5 shrink-0 items-center gap-0.5 rounded-md pr-1.5 pl-0.5 text-[11px] font-medium tabular-nums transition-colors',
        expanded && 'bg-accent text-foreground',
      )}
    >
      <ChevronRight className={cn('size-3 transition-transform duration-200', expanded && 'rotate-90')} />
      {thread.count}
    </button>
  );
}

/**
 * One line per conversation (like Betterbird's table): check box / unread dot, star, sender,
 * subject with its first category, attachment, date. Twice as many conversations on screen.
 */
function CompactRow({ thread, selected, focused, checked, showAccount, tagById, onOpen, onToggleCheck, onAction, expanded = false, onToggleExpand }: Props) {
  const tag = thread.tags.map((id) => tagById.get(id)).find((t): t is Tag => Boolean(t) && t!.id !== 'important');
  return (
    <div className="px-1.5" data-thread-id={thread.id}>
      <div
        role="button"
        tabIndex={-1}
        onClick={(e) => (e.metaKey || e.ctrlKey || e.shiftKey ? onToggleCheck(thread.id, e.shiftKey) : onOpen(thread.id))}
        className={cn(
          'group relative flex h-8 cursor-default items-center gap-2 rounded-md pr-2 pl-2 text-[13px] transition-colors',
          selected ? 'bg-muted' : checked ? 'bg-primary/10' : 'hover:bg-muted/70',
          focused && !selected && 'ring-1 ring-border ring-inset',
        )}
      >
        {thread.priority >= 2 ? <span className={cn('absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full', PRIORITY_BAR[thread.priority])} /> : null}
        <button
          type="button"
          onClick={(e) => (e.stopPropagation(), onToggleCheck(thread.id, e.shiftKey))}
          className="relative flex size-4 shrink-0 items-center justify-center rounded-[5px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={checked ? t('Désélectionner') : t('Sélectionner')}
          aria-pressed={checked}
        >
          {checked ? (
            <span className="zm-check bg-primary text-primary-foreground flex size-4 items-center justify-center rounded-[5px]">
              <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path className="zm-check-tick" d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
          ) : (
            <>
              <span className={cn('size-2 rounded-full transition-opacity group-hover:opacity-0', thread.unread ? 'bg-primary' : 'bg-transparent')} />
              <span className="border-muted-foreground/50 absolute inset-0 rounded-[5px] border opacity-0 transition-opacity group-hover:opacity-100" />
            </>
          )}
        </button>
        <button
          type="button"
          onClick={(e) => (e.stopPropagation(), onAction(thread.starred ? 'unstar' : 'star', thread.id))}
          className={cn('flex size-4 shrink-0 items-center justify-center', !thread.starred && 'opacity-0 group-hover:opacity-60 hover:!opacity-100')}
          aria-label={thread.starred ? t('Retirer des favoris') : t('Ajouter aux favoris')}
        >
          <Star className={cn('size-3.5', thread.starred ? 'fill-warning text-warning' : 'text-muted-foreground')} />
        </button>
        <span className={cn('w-[24%] max-w-[160px] min-w-[72px] shrink-0 truncate', thread.unread ? 'text-foreground font-semibold' : 'text-foreground/80')}>
          {displayName(thread.from)}
        </span>
        {thread.count > 1 ? <FoldToggle thread={thread} expanded={expanded} onToggle={onToggleExpand} /> : null}
        {/* The subject keeps the room; the category shrinks to its icon first. */}
        <span className={cn('min-w-[22%] flex-1 truncate', thread.unread ? 'text-foreground font-medium' : 'text-foreground/70')}>{thread.subject || t('(sans objet)')}</span>
        {thread.otp ? <OtpChip code={thread.otp} onCopy={() => void copyText(thread.otp!).then(() => toast.success(t('Code {code} copié', { code: thread.otp! })))} /> : null}
        {tag ? (
          <span className="@container min-w-5 max-w-[120px] shrink" title={t(tag.name)}>
            <span className="hidden @[56px]:block">
              <TagChip tag={tag} />
            </span>
            <span className="flex size-5 items-center justify-center rounded-md @[56px]:hidden" style={{ backgroundColor: `${tag.color}1A` }}>
              <TagIcon icon={tag.icon} color={tag.color} className="size-3" />
            </span>
          </span>
        ) : null}
        {showAccount ? <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: thread.accountColor }} title={thread.accountEmail} /> : null}
        {thread.hasAttachments ? <Paperclip className="text-muted-foreground size-3 shrink-0" /> : null}
        <time className={cn('min-w-12 shrink-0 text-right text-[11.5px] whitespace-nowrap tabular-nums group-hover:opacity-0', thread.unread ? 'text-foreground/80 font-medium' : 'text-muted-foreground')}>
          {formatListDate(thread.date)}
        </time>
        <div className="bg-popover/95 border-border absolute top-1/2 right-1 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border p-0.5 shadow-sm backdrop-blur group-hover:flex">
          {(
            [
              thread.mailbox === 'archive' || thread.mailbox === 'all' ? null : (['archive', Archive, t('Archiver (E)')] as const),
              [thread.unread ? 'read' : 'unread', MailOpen, thread.unread ? t('Marquer comme lu') : t('Marquer comme non lu')] as const,
              [thread.mailbox === 'trash' ? 'deleteForever' : 'trash', Trash2, t('Supprimer (#)')] as const,
            ].filter(Boolean) as [ThreadAction, typeof Archive, string][]
          ).map(([action, Icon, label]) => (
            <button
              key={label}
              type="button"
              title={label}
              onClick={(e) => (e.stopPropagation(), onAction(action, thread.id))}
              className={cn('text-muted-foreground hover:text-foreground hover:bg-accent flex size-6 items-center justify-center rounded', action === 'trash' && 'hover:text-destructive')}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
