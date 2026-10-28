import { CornerUpLeft, Paperclip, Star } from 'lucide-react';
import type { Outputs } from '@/lib/trpc';
import { cn, displayName, formatFullDate, formatListDate } from '@/lib/utils';
import { t } from '@/lib/i18n';

export type ReplyNode = Outputs['mail']['replyTree'][number];

/** Width of one level of the tree; beyond MAX_LEVELS the indent stops growing (long chains stay readable). */
const STEP = 16;
const MAX_LEVELS = 7;

/**
 * A conversation drawn as Betterbird draws it: each reply under the mail it answers, with the
 * branch lines (├ └ │) showing replies of replies. Used unfolded in the list and in the reader.
 */
export function ReplyTree({ nodes, activeId, onSelect, className }: { nodes: ReplyNode[]; activeId?: string | null; onSelect: (node: ReplyNode) => void; className?: string }) {
  return (
    <div role="tree" className={className}>
      {nodes.map((node, i) => (
        <ReplyTreeRow key={node.id} node={node} hasReplies={nodes[i + 1]?.parentId === node.id} active={node.id === activeId} onSelect={() => onSelect(node)} />
      ))}
    </div>
  );
}

function ReplyTreeRow({ node, hasReplies, active, onSelect }: { node: ReplyNode; hasReplies: boolean; active: boolean; onSelect: () => void }) {
  const depth = Math.min(node.depth, MAX_LEVELS);
  // Deep chains: keep the innermost guides, the outer ones scroll off to the left.
  const guides = node.guides.slice(Math.max(0, node.guides.length - (depth - 1)));

  return (
    <div
      role="treeitem"
      aria-level={node.depth + 1}
      aria-selected={active}
      tabIndex={-1}
      onClick={(e) => (e.stopPropagation(), onSelect())}
      title={`${displayName(node.from)} · ${formatFullDate(node.date)}`}
      className={cn('group/reply flex h-8 cursor-default items-center gap-2 rounded-md pr-2.5 pl-1.5 text-[12.5px] transition-colors', active ? 'bg-muted' : 'hover:bg-muted/60')}
    >
      {/* Branch lines and marker are flush (no gap) so each line leaves from its parent's marker. */}
      <span className="relative -mr-2 flex h-full shrink-0 self-stretch" style={{ width: depth * STEP }} aria-hidden>
        {guides.map((line, i) => (line ? <span key={i} className="bg-border absolute inset-y-0 w-px" style={{ left: i * STEP + STEP / 2 }} /> : null))}
        {depth > 0 ? (
          <>
            {/* The elbow: down from the parent, then right towards this reply. */}
            <span className={cn('bg-border absolute top-0 w-px', node.last ? 'h-1/2' : 'h-full')} style={{ left: (depth - 1) * STEP + STEP / 2 }} />
            <span className="bg-border absolute top-1/2 h-px" style={{ left: (depth - 1) * STEP + STEP / 2, width: STEP / 2 + 2 }} />
          </>
        ) : null}
      </span>
      <span className="relative flex h-full w-4 shrink-0 items-center justify-center">
        {/* A mail that was answered: its line goes down to its first reply. */}
        {hasReplies && depth < MAX_LEVELS ? <span className="bg-border absolute bottom-0 left-1/2 h-[calc(50%-8px)] w-px" aria-hidden /> : null}
        {node.isReply ? (
          <CornerUpLeft className={cn('size-3.5', node.unread ? 'text-primary' : 'text-ai')} aria-label={t('Réponse')} />
        ) : (
          <span className={cn('size-1.5 rounded-full', node.unread ? 'bg-primary' : 'bg-muted-foreground/50')} />
        )}
      </span>
      <span className={cn('min-w-0 shrink truncate', node.unread ? 'text-foreground font-semibold' : 'text-foreground/85')}>{displayName(node.from)}</span>
      {node.mailbox === 'sent' ? <span className="bg-primary/10 text-primary shrink-0 rounded-sm px-1 text-[10px] font-medium">{t('Envoyé')}</span> : null}
      <span className="text-muted-foreground min-w-0 flex-1 truncate">{node.subject}</span>
      {node.hasAttachments ? <Paperclip className="text-muted-foreground size-3 shrink-0" /> : null}
      {node.starred ? <Star className="fill-warning text-warning size-3 shrink-0" /> : null}
      <time className={cn('shrink-0 text-[11.5px] tabular-nums', node.unread ? 'text-foreground/80 font-medium' : 'text-muted-foreground')}>{formatListDate(node.date)}</time>
    </div>
  );
}
