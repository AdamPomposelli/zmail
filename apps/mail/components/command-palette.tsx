import { Bot, Briefcase, Flame, Inbox, Newspaper, Star, PenSquare, Search, Settings, Sparkles, Tag } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { useCatalog } from '@/hooks/use-catalog';
import { TagIcon } from '@/lib/tag-icons';
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
  ['/settings/businesses', t('Business')],
  ['/settings/tags', t('Catégories')],
  ['/settings/rules', t('Règles & suggestions')],
  ['/settings/notifications', t('Notifications')],
  ['/settings/ai', t('Intelligence artificielle')],
  ['/settings/activity', t('Journal d’activité')],
] as const;

export function CommandPalette({ open, onOpenChange, onCompose, onAgent }: { open: boolean; onOpenChange: (open: boolean) => void; onCompose: () => void; onAgent: () => void }) {
  const navigate = useNavigate();
  const catalog = useCatalog();
  const [query, setQuery] = useState('');
  const go = (to: string) => {
    onOpenChange(false);
    setQuery('');
    navigate(to);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder={t('Rechercher un mail, une vue, un réglage…')} value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{t('Aucun résultat.')}</CommandEmpty>
        {query.trim() ? (
          <CommandGroup heading={t('Recherche')}>
            <CommandItem value={`search ${query}`} onSelect={() => go(`/mail/inbox?q=${encodeURIComponent(query.trim())}`)}>
              <Search />
              {t('Chercher « {query} » dans tous les comptes', { query: query.trim() })}
            </CommandItem>
          </CommandGroup>
        ) : null}
        <CommandGroup heading={t('Actions')}>
          <CommandItem onSelect={() => (onOpenChange(false), onCompose())}>
            <PenSquare />
            {t('Nouveau message')}
            <CommandShortcut>C</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => (onOpenChange(false), onAgent())}>
            <Bot />
            {t('Ouvrir le chat IA')}
            <CommandShortcut>⌘J</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading={t('Vues')}>
          {VIEWS.map((v) => (
            <CommandItem key={v.to} onSelect={() => go(v.to)}>
              <v.icon />
              {v.label}
              {v.shortcut ? <CommandShortcut>{v.shortcut}</CommandShortcut> : null}
            </CommandItem>
          ))}
        </CommandGroup>
        {catalog.businesses.length ? (
          <CommandGroup heading={t('Business')}>
            {catalog.businesses.map((b) => (
              <CommandItem key={b.id} value={`business ${b.name}`} onSelect={() => go(`/mail/inbox?business=${b.id}`)}>
                {b.emoji ? <span className="w-4 text-center">{b.emoji}</span> : <Briefcase />}
                {b.name}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        <CommandGroup heading={t('Catégories')}>
          {catalog.tags.map((tag) => (
            <CommandItem key={tag.id} value={`tag ${t(tag.name)}`} onSelect={() => go(`/mail/inbox?tag=${tag.id}`)}>
              <TagIcon icon={tag.icon} color={tag.color} />
              {t(tag.name)}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading={t('Réglages')}>
          {SETTINGS.map(([to, label]) => (
            <CommandItem key={to} onSelect={() => go(to)}>
              <Settings />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
