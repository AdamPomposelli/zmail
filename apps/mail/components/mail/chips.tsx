import { Flame, KeyRound, Sparkles } from 'lucide-react';
import type { Business, Tag } from '@/lib/trpc';
import { cn, colorFor, initials } from '@/lib/utils';
import { TagIcon } from '@/lib/tag-icons';
import { t } from '@/lib/i18n';

/** Avatar fill is derived from the sender address (data colour), so the initials stay white on it. */
export function SenderAvatar({ name, email, size = 32, className }: { name?: string; email: string; size?: number; className?: string }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white select-none', className)}
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, ${colorFor(email)}, ${colorFor(email + 'x')})` }}
      aria-hidden
    >
      {initials(name, email)}
    </span>
  );
}

export function TagChip({ tag, size = 'sm', onRemove }: { tag: Tag; size?: 'sm' | 'md'; onRemove?: () => void }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-[160px] shrink-0 items-center gap-1.5 rounded-md border border-transparent font-medium whitespace-nowrap',
        size === 'sm' ? 'h-5 px-1.5 text-[11px]' : 'h-6 px-2 text-xs',
      )}
      style={{ backgroundColor: `${tag.color}1A`, color: tag.color }}
    >
      {tag.icon ? <TagIcon icon={tag.icon} color={tag.color} className={size === 'sm' ? 'size-3' : 'size-3.5'} /> : <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />}
      <span className="truncate">{t(tag.name)}</span>
      {onRemove ? (
        <button type="button" onClick={onRemove} className="-mr-0.5 opacity-60 hover:opacity-100" aria-label={t('Retirer {name}', { name: t(tag.name) })}>
          ×
        </button>
      ) : null}
    </span>
  );
}

export function BusinessBadge({ business, compact }: { business: Business; compact?: boolean }) {
  return (
    <span
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium whitespace-nowrap"
      style={{ backgroundColor: `${business.color}1F`, color: business.color }}
      title={business.name}
    >
      {business.emoji ? <span className="text-[11px] leading-none">{business.emoji}</span> : <span className="size-1.5 rounded-full" style={{ backgroundColor: business.color }} />}
      {compact ? null : <span className="max-w-[110px] truncate">{business.name}</span>}
    </span>
  );
}

/** Priority is a status, so it maps to theme tokens: `dot` for the bullet, `badge` for the tinted pill. */
export const PRIORITY_META = [
  { label: t('Basse'), dot: 'bg-muted-foreground', badge: 'bg-muted text-muted-foreground' },
  { label: t('Normale'), dot: 'bg-primary', badge: 'bg-primary/10 text-primary' },
  { label: t('Haute'), dot: 'bg-warning', badge: 'bg-warning/10 text-warning' },
  { label: t('Urgente'), dot: 'bg-destructive', badge: 'bg-destructive/10 text-destructive' },
] as const;

export function PriorityBadge({ priority }: { priority: number }) {
  if (priority < 2) return null;
  const meta = PRIORITY_META[priority]!;
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold', meta.badge)}>
      <Flame className="size-3" strokeWidth={2.4} />
      {meta.label}
    </span>
  );
}

export function OtpChip({ code, onCopy }: { code: string; onCopy?: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onCopy?.();
      }}
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md bg-ai/10 px-1.5 font-mono text-[11px] font-semibold tracking-wider text-ai transition hover:bg-ai/20"
      title={t('Copier le code')}
    >
      <KeyRound className="size-3" />
      {code}
    </button>
  );
}

export function AiSummary({ text, className }: { text: string; className?: string }) {
  if (!text) return null;
  return (
    <p className={cn('text-muted-foreground flex min-w-0 items-center gap-1.5 text-[12.5px]', className)}>
      <Sparkles className="size-3 shrink-0 text-ai/80" />
      <span className="truncate">{text}</span>
    </p>
  );
}
