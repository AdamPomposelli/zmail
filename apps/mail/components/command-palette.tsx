import { useMutation, useQuery } from '@tanstack/react-query';
import { Command as CommandPrimitive } from 'cmdk';
import { Bot, Briefcase, CornerDownLeft, Flame, Inbox, Newspaper, PenSquare, Search, Settings, Sparkles, Star } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { MentionChip, MentionIcon, dropTrigger, mentionContext, mentionKey, mentionLabel, parseTrigger, useMentionSuggestions, type Mention } from '@/components/smart/mentions';
import { SenderAvatar } from '@/components/mail/chips';
import { useCatalog } from '@/hooks/use-catalog';
import { TagIcon } from '@/lib/tag-icons';
import { useTRPC } from '@/lib/trpc';
import { cn, formatListDate } from '@/lib/utils';
import { t } from '@/lib/i18n';

const VIEWS = [
  { to: '/mail/inbox', label: t('Boîte de réception'), icon: Inbox, shortcut: 'G I' },
  { to: '/mail/inbox?tag=important', label: t('Important'), icon: Flame, shortcut: 'G P' },
  { to: '/mail/inbox?tag=opportunity', label: t('Opportunités'), icon: Sparkles, shortcut: 'G O' },
  { to: '/mail/starred', label: t('Favoris'), icon: Star },
  { to: '/subscriptions', label: t('Abonnements'), icon: Newspaper },
];

const SETTINGS = [
  ['/settings/accounts', t('Comptes mail')],
  ['/settings/signatures', t('Signatures')],
  ['/settings/accounts#business', t('Business')],
  ['/settings/tags', t('Catégories')],
  ['/settings/rules', t('Règles & suggestions')],
  ['/settings/notifications', t('Notifications')],
  ['/settings/ai', t('IA')],
  ['/settings/activity', t('Journal d’activité')],
] as const;

type Row = { key: string; group: string; icon: ReactNode; label: ReactNode; hint?: ReactNode; shortcut?: string; run: () => void; mention?: Mention };

/**
 * ⌘K: one bar to do everything. Type to search every account; Tab turns what is typed into a
 * filter (a sender, `#category`, `@account`), or a highlighted mail into a reference; `@agent`
 * (or `@ia`) sends the rest to the AI chat with those references, without opening it first.
 */
export function CommandPalette({ open, onOpenChange, onCompose, onAgent }: { open: boolean; onOpenChange: (open: boolean) => void; onCompose: () => void; onAgent: () => void }) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const [text, setText] = useState('');
  const [chips, setChips] = useState<Mention[]>([]);
  const [active, setActive] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const track = useMutation(trpc.cleanup.trackShortcut.mutationOptions());
  useEffect(() => {
    if (open) return;
    setText('');
    setChips([]);
  }, [open]);

  const agent = chips.some((c) => c.type === 'agent');
  const sender = chips.find((c) => c.type === 'sender');
  const tag = chips.find((c) => c.type === 'tag');
  const account = chips.find((c) => c.type === 'account');
  const scoped = Boolean(sender || tag || account);
  const { trigger } = parseTrigger(text);
  const suggestions = useMentionSuggestions(text, { agent: !agent, plain: !agent, exclude: chips });
  const words = trigger ? dropTrigger(text).trim() : text.trim();
  const query = [sender ? `from:${sender.email}` : '', words].filter(Boolean).join(' ');
  const { data: mails } = useQuery({
    ...trpc.mail.list.queryOptions({ view: 'inbox', query: query || null, tagId: tag?.id ?? null, accountId: account?.id ?? null, limit: 6 }),
    enabled: !agent && (scoped || words.length >= 2) && trigger === null,
    placeholderData: (prev) => prev,
  });

  const close = () => onOpenChange(false);
  const go = (to: string) => (close(), navigate(to));
  const add = (m: Mention) => {
    setChips((prev) => (prev.some((c) => mentionKey(c) === mentionKey(m)) ? prev : [...prev, m]));
    setText((v) => (parseTrigger(v).trigger ? dropTrigger(v) : '') + (parseTrigger(v).trigger && dropTrigger(v) ? ' ' : ''));
    requestAnimationFrame(() => input.current?.focus());
  };
  const ask = () => {
    const question = text.trim();
    if (!question) return;
    track.mutate();
    close();
    window.dispatchEvent(new CustomEvent('zmail:ask-agent', { detail: { text: question, mentions: chips.filter((c) => c.type !== 'agent') } }));
  };
  const searchAll = () => {
    if (scoped) track.mutate();
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (tag) params.set('tag', tag.id);
    if (account) params.set('account', account.id);
    go(`/mail/inbox?${params}`);
  };

  const matches = (label: string) => !words || label.toLowerCase().includes(words.toLowerCase());
  const rows: Row[] = [];
  for (const m of suggestions)
    rows.push({
      key: `mention:${mentionKey(m)}`,
      group: t('Raccourcis'),
      icon: <MentionIcon mention={m} />,
      label: m.type === 'agent' ? t('Demander à l’agent IA') : mentionLabel(m),
      hint: m.type === 'sender' ? (m.name ? m.email : t('Expéditeur')) : m.type === 'tag' ? t('Catégorie') : m.type === 'account' ? t('Compte') : m.type === 'thread' ? m.from : t('Écrivez votre demande ensuite'),
      shortcut: 'Tab',
      mention: m,
      run: () => add(m),
    });
  if (agent) {
    rows.push({ key: 'ask', group: t('Agent IA'), icon: <Bot className="text-ai" />, label: words ? t('Demander : « {text} »', { text: words }) : t('Écrivez votre demande…'), shortcut: '↵', run: ask });
  } else if (trigger === null) {
    for (const m of mails?.items ?? [])
      rows.push({
        key: `thread:${m.id}`,
        group: t('Mails'),
        icon: <SenderAvatar name={m.from.name} email={m.from.email} size={18} />,
        label: <span className="truncate">{m.subject || t('(sans objet)')}</span>,
        hint: `${m.from.name || m.from.email} · ${formatListDate(m.date)}`,
        mention: { type: 'thread', id: m.id, subject: m.subject, from: m.from.name || m.from.email },
        run: () => {
          if (scoped) track.mutate();
          go(`/mail/inbox?thread=${m.id}`);
        },
      });
    if (words || scoped) rows.push({ key: 'search', group: t('Mails'), icon: <Search />, label: words ? t('Tous les résultats pour « {text} »', { text: words }) : t('Tous les mails filtrés'), shortcut: '↵', run: searchAll });
    if (!scoped) {
      const actions: Row[] = [
        { key: 'compose', group: t('Actions'), icon: <PenSquare />, label: t('Nouveau message'), shortcut: 'C', run: () => (close(), onCompose()) },
        { key: 'agent', group: t('Actions'), icon: <Bot />, label: t('Ouvrir le chat IA'), shortcut: '⌘J', run: () => (close(), onAgent()) },
        ...VIEWS.map((v) => ({ key: v.to, group: t('Vues'), icon: <v.icon />, label: v.label, shortcut: v.shortcut, run: () => go(v.to) })),
        ...catalog.businesses.map((b) => ({ key: `business:${b.id}`, group: t('Business'), icon: b.emoji ? <span className="w-4 text-center text-[13px]">{b.emoji}</span> : <Briefcase />, label: b.name, run: () => go(`/mail/inbox?business=${b.id}`) })),
        ...(words ? catalog.tags.map((tg) => ({ key: `tag:${tg.id}`, group: t('Catégories'), icon: <TagIcon icon={tg.icon} color={tg.color} />, label: t(tg.name), run: () => go(`/mail/inbox?tag=${tg.id}`) })) : []),
        ...(words ? SETTINGS.map(([to, label]) => ({ key: to, group: t('Réglages'), icon: <Settings />, label, run: () => go(to) })) : []),
      ];
      rows.push(...actions.filter((r) => typeof r.label !== 'string' || matches(r.label)));
    }
  }
  const groups = [...new Set(rows.map((r) => r.group))];
  const highlighted = rows.find((r) => r.key === active) ?? rows[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showOverlay className="top-[18%] w-full max-w-[560px] translate-y-0 gap-0 overflow-hidden rounded-xl border p-0 shadow-2xl [&>button:last-child]:hidden">
        <DialogTitle className="sr-only">{t('Recherche et commandes')}</DialogTitle>
        <DialogDescription className="sr-only">{t('Rechercher un mail, une vue, un réglage…')}</DialogDescription>
        <CommandPrimitive shouldFilter={false} value={active} onValueChange={setActive} loop className="flex flex-col">
          <div className="border-border flex min-h-11 flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
            <Search className="text-muted-foreground size-4 shrink-0" />
            {chips.map((c) => (
              <MentionChip key={mentionKey(c)} mention={c} onRemove={() => setChips((prev) => prev.filter((x) => mentionKey(x) !== mentionKey(c)))} />
            ))}
            <CommandPrimitive.Input
              ref={input}
              value={text}
              onValueChange={setText}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !text && chips.length) {
                  e.preventDefault();
                  setChips((prev) => prev.slice(0, -1));
                }
                if (e.key === 'Tab' && !e.shiftKey) {
                  // Tab: the highlighted shortcut or mail becomes a chip; else the first shortcut.
                  const pick = highlighted?.mention ?? rows.find((r) => r.mention)?.mention;
                  if (pick) {
                    e.preventDefault();
                    add(pick);
                  }
                }
              }}
              placeholder={agent ? t('Votre demande à l’agent… (@mail, #catégorie pour préciser)') : chips.length ? t('Affiner…') : t('Rechercher partout, @agent, #catégorie…')}
              className="placeholder:text-muted-foreground/70 h-8 min-w-[140px] flex-1 bg-transparent text-[14px] outline-none"
            />
          </div>
          <CommandPrimitive.List className="max-h-[min(380px,60vh)] overflow-y-auto p-1.5">
            {rows.length === 0 ? <CommandPrimitive.Empty className="text-muted-foreground py-6 text-center text-[13px]">{t('Aucun résultat.')}</CommandPrimitive.Empty> : null}
            {groups.map((group) => (
              <CommandPrimitive.Group key={group} heading={group} className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium">
                {rows
                  .filter((r) => r.group === group)
                  .map((r) => (
                    <CommandPrimitive.Item
                      key={r.key}
                      value={r.key}
                      onSelect={r.run}
                      className="data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground flex h-8 cursor-default items-center gap-2.5 rounded-md px-2 text-[13px] outline-none select-none [&_svg]:size-4 [&_svg]:shrink-0"
                    >
                      <span className="text-muted-foreground flex size-4 shrink-0 items-center justify-center">{r.icon}</span>
                      <span className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span className="min-w-0 truncate">{r.label}</span>
                        {r.hint ? <span className="text-muted-foreground min-w-0 truncate text-[11.5px]">{r.hint}</span> : null}
                      </span>
                      {r.shortcut ? <kbd className="text-muted-foreground bg-muted shrink-0 rounded px-1.5 py-px font-sans text-[10.5px]">{r.shortcut}</kbd> : null}
                    </CommandPrimitive.Item>
                  ))}
              </CommandPrimitive.Group>
            ))}
          </CommandPrimitive.List>
          <div className="border-border text-muted-foreground flex items-center gap-3 border-t px-3 py-1.5 text-[11px]">
            <span className="flex items-center gap-1">
              <kbd className="bg-muted rounded px-1 font-sans">Tab</kbd> {t('filtrer / mentionner')}
            </span>
            <span>
              <kbd className="bg-muted rounded px-1 font-sans">@</kbd> {t('agent, expéditeur, compte, mail')}
            </span>
            <span>
              <kbd className="bg-muted rounded px-1 font-sans">#</kbd> {t('catégorie')}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <CornerDownLeft className="size-3" /> {t('ouvrir')}
            </span>
          </div>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}
