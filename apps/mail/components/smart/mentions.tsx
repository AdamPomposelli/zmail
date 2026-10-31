import { useQuery } from '@tanstack/react-query';
import { AtSign, Bot, Mail, X } from 'lucide-react';
import { BrandLogo, brandForProvider } from '@/components/brand-logo';
import { useCatalog } from '@/hooks/use-catalog';
import { TagIcon } from '@/lib/tag-icons';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * What the two smart bars (⌘K and the AI chat) can point at: a sender, a category, an account, a
 * precise mail, or the agent itself (⌘K only). Picked with Tab or Enter from what is typed:
 * `@` for the agent, senders, accounts and mails, `#` for categories, or just the start of an
 * address in ⌘K.
 */
export type Mention =
  | { type: 'agent' }
  | { type: 'sender'; email: string; name: string | null }
  | { type: 'tag'; id: string; name: string; icon: string | null; color: string }
  | { type: 'account'; id: string; email: string; provider: string | null }
  | { type: 'thread'; id: string; subject: string; from: string };

export const mentionKey = (m: Mention) => (m.type === 'agent' ? 'agent' : m.type === 'sender' ? `sender:${m.email}` : `${m.type}:${m.id}`);

export const mentionLabel = (m: Mention) =>
  m.type === 'agent' ? t('Agent IA') : m.type === 'sender' ? m.name || m.email : m.type === 'tag' ? m.name : m.type === 'account' ? m.email : m.subject || t('(sans objet)');

/** The context sent with a question to the agent. */
export const mentionContext = (list: Mention[]) => ({
  threadIds: list.flatMap((m) => (m.type === 'thread' ? [m.id] : [])),
  tagIds: list.flatMap((m) => (m.type === 'tag' ? [m.id] : [])),
  senders: list.flatMap((m) => (m.type === 'sender' ? [m.email] : [])),
  accountIds: list.flatMap((m) => (m.type === 'account' ? [m.id] : [])),
});

export function MentionIcon({ mention, className }: { mention: Mention; className?: string }) {
  if (mention.type === 'agent') return <Bot className={cn('text-ai size-3.5', className)} />;
  if (mention.type === 'tag') return <TagIcon icon={mention.icon} color={mention.color} className={cn('size-3.5', className)} />;
  if (mention.type === 'account') {
    const brand = brandForProvider(mention.provider);
    return brand ? <BrandLogo brand={brand} size={13} /> : <AtSign className={cn('size-3.5', className)} />;
  }
  if (mention.type === 'thread') return <Mail className={cn('size-3.5', className)} />;
  return <AtSign className={cn('size-3.5', className)} />;
}

/** A picked mention, as a small removable pill. */
export function MentionChip({ mention, onRemove }: { mention: Mention; onRemove?: () => void }) {
  return (
    <span className={cn('inline-flex h-6 max-w-[220px] shrink-0 items-center gap-1 rounded-md pr-1 pl-1.5 text-[12px] font-medium', mention.type === 'agent' ? 'bg-ai/15 text-ai' : 'bg-accent text-foreground')}>
      <MentionIcon mention={mention} />
      <span className="truncate">{mentionLabel(mention)}</span>
      {onRemove ? (
        <button type="button" onClick={onRemove} className="hover:bg-background/60 flex size-4 shrink-0 items-center justify-center rounded-sm opacity-60 hover:opacity-100" aria-label={t('Retirer {name}', { name: mentionLabel(mention) })}>
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  );
}

/** What is being typed: a trigger (`@`, `#`) and the words after it. */
export function parseTrigger(text: string): { trigger: '@' | '#' | null; term: string } {
  const last = text.match(/(^|\s)([@#])([^\s@#]*)$/);
  if (last) return { trigger: last[2] as '@' | '#', term: last[3]! };
  return { trigger: null, term: text.trim() };
}

/** Removes the `@word` / `#word` being typed, once it became a mention. */
export const dropTrigger = (text: string) => text.replace(/(^|\s)[@#][^\s@#]*$/, '$1').trimEnd();

/**
 * Suggestions for what is typed. `@…`: the agent (when allowed), senders, accounts and mails;
 * `#…`: categories; plain text (⌘K only, `plain`): matching senders, for Tab.
 */
export function useMentionSuggestions(text: string, { agent = false, plain = false, exclude = [] as Mention[] } = {}): Mention[] {
  const trpc = useTRPC();
  const catalog = useCatalog();
  const { trigger, term } = parseTrigger(text);
  const lower = term.toLowerCase();
  const taken = new Set(exclude.map(mentionKey));
  const wantSenders = trigger === '@' || (plain && !trigger && term.length >= 2);
  const { data: senders } = useQuery({ ...trpc.mail.senders.queryOptions({ query: term || '@', limit: trigger ? 5 : 3 }), enabled: wantSenders && (term.length >= 1 || trigger === '@'), staleTime: 30_000 });
  const { data: mails } = useQuery({ ...trpc.mail.list.queryOptions({ view: 'inbox', query: term, limit: 4 }), enabled: trigger === '@' && term.length >= 2, staleTime: 15_000 });

  const out: Mention[] = [];
  if (trigger === '#') {
    for (const tag of catalog.tags) {
      const name = t(tag.name);
      if (!lower || name.toLowerCase().includes(lower) || tag.id.includes(lower)) out.push({ type: 'tag', id: tag.id, name, icon: tag.icon ?? null, color: tag.color });
    }
  } else if (trigger === '@' || (plain && term.length >= 2)) {
    if (agent && trigger === '@' && (!lower || ['agent', 'ia', 'ai', 'assistant', 'chat'].some((w) => w.startsWith(lower)))) out.push({ type: 'agent' });
    for (const s of senders ?? []) out.push({ type: 'sender', email: s.email, name: s.name });
    if (trigger === '@')
      for (const a of catalog.accounts)
        if (!lower || a.email.toLowerCase().includes(lower) || (a.label ?? '').toLowerCase().includes(lower)) out.push({ type: 'account', id: a.id, email: a.email, provider: a.provider ?? null });
    for (const m of mails?.items ?? []) out.push({ type: 'thread', id: m.id, subject: m.subject, from: m.from.name || m.from.email });
  }
  return out.filter((m) => !taken.has(mentionKey(m))).slice(0, 10);
}
