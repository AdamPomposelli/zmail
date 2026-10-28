import { solar } from '@/components/ui/solar-icon';

const ArrowLeft = solar('_back');
const PenSquare = solar('_compose');
const Search = solar('_search');
const Settings = solar('_settings');
const Sparkles = solar('_ai');
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { SETTINGS_PAGES, searchSettings } from '@/components/settings/search';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MailNav } from '@/components/sidebar/mail-nav';
import { NavItem } from '@/components/sidebar/nav';
import { useQuery } from '@tanstack/react-query';
import { useCatalog } from '@/hooks/use-catalog';
import { useHotkeys } from 'react-hotkeys-hook';
import { useTRPC, type View } from '@/lib/trpc';
import { cn, isMac } from '@/lib/utils';
import { t, tp } from '@/lib/i18n';

type Counts = {
  views: Partial<Record<View, number>>;
  businesses: Record<string, number>;
  mailboxes?: Record<string, number>;
  tags: Record<string, number>;
  accounts: Record<string, number>;
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
      <div className="px-3 pt-1">
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
  const [search] = useSearchParams();
  const catalog = useCatalog();
  const { data: counts } = useQuery({
    ...trpc.mail.counts.queryOptions(),
    refetchInterval: 20_000,
  }) as { data?: Counts };
  const { data: suggestions } = useQuery(trpc.rules.suggestions.queryOptions());

  const syncing = catalog.accounts.some((a) => a.status === 'syncing');
  const failing = catalog.accounts.filter((a) => a.status === 'error');
  const inSettings = pathname.startsWith('/settings');
  useEffect(() => {
    if (!inSettings) lastMailPath = pathname + (search.size ? `?${search}` : '');
  }, [inSettings, pathname, search]);

  return (
    <aside className="bg-sidebar flex h-dvh w-[252px] shrink-0 select-none flex-col">
      {/* Leaves room for the macOS traffic lights. */}
      <div data-drag-region className="h-12 shrink-0" />

      {inSettings ? (
        <SettingsNav />
      ) : (
        <>
          {/* The two actions used most, side by side: write, and hand it to the AI. */}
          <div className="flex gap-1.5 px-3 pt-1">
            <button
              onClick={onCompose}
              className="bg-foreground text-background hover:bg-foreground/90 focus-visible:ring-ring/50 flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg pr-2.5 pl-3 text-[13px] font-semibold shadow-sm transition focus-visible:ring-2 focus-visible:outline-none"
            >
              <PenSquare className="size-4 shrink-0" />
              <span className="truncate">{t('Nouveau message')}</span>
              <kbd className="text-background/60 ml-auto font-sans text-[11px]">C</kbd>
            </button>
            <button type="button" onClick={onAgent} data-open={agentOpen} aria-pressed={agentOpen} aria-label={t('Chat IA')} title={`${t('Chat IA')} (${isMac ? '⌘' : 'Ctrl'} J)`} className="zm-ai-btn">
              <span>{t('IA')}</span>
            </button>
          </div>

          <nav className="scrollbar-none mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            <MailNav counts={counts} />
          </nav>
        </>
      )}

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
        <div className="text-muted-foreground flex h-7 items-center gap-2 px-2 text-[11px]">
          <span
            className={cn(
              'size-1.5 rounded-full',
              failing.length
                ? 'bg-destructive'
                : syncing
                  ? 'bg-warning animate-pulse'
                  : catalog.accounts.length
                    ? 'bg-success'
                    : 'bg-muted-foreground',
            )}
          />
          {failing.length
            ? tp(failing.length, '{n} compte en erreur', '{n} comptes en erreur')
            : syncing
              ? t('Synchronisation…')
              : catalog.accounts.length
                ? tp(catalog.accounts.length, '{n} compte à jour', '{n} comptes à jour')
                : t('Aucun compte')}
        </div>
      </div>
    </aside>
  );
}
