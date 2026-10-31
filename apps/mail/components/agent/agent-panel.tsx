import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Check, Loader2, Plus, X, XCircle } from 'lucide-react';
import { solar } from '@/components/ui/solar-icon';

const Bot = solar('_ai');
const Sparkles = solar('_ai');
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { useNavigate } from 'react-router';
import { SenderAvatar } from '@/components/mail/chips';
import { useTRPC, type Outputs } from '@/lib/trpc';
import { cn, displayName, formatListDate } from '@/lib/utils';
import { BrandLogo, brandForModel } from '@/components/brand-logo';
import { FreeBadge } from '@/components/ui/free-badge';
import { CleanupView } from './cleanup-view';
import { MentionChip, MentionIcon, dropTrigger, mentionContext, mentionKey, mentionLabel, parseTrigger, useMentionSuggestions, type Mention } from '@/components/smart/mentions';
import { t } from '@/lib/i18n';

type Reply = Outputs['ai']['chat'];
type Turn = { role: 'user'; content: string; mentions?: Mention[] } | { role: 'assistant'; content: string; reply?: Reply };

const EXAMPLES = [
  t('Quels sont mes mails importants ?'),
  t('Notifie-moi de tous les chargebacks'),
  t('Archive automatiquement tout ce qui vient de {domain}', { domain: '@devpulse.test' }),
  t('Crée une catégorie Fournisseurs pour les factures de mes fournisseurs'),
];

const STORAGE_KEY = 'zmail.agent.tabs';

/** One tab of the AI chat: a discussion, or a run of the cleaning agent. */
type Tab = { id: string; title: string; kind: 'chat' | 'cleanup'; turns: Turn[]; runId?: string | null; unread?: boolean };

/** What another screen asks the chat to open: a question, a new cleaning run, or an existing one. */
export type AgentRequest = { kind: 'ask'; text: string; mentions?: Mention[]; at: number } | { kind: 'cleanup'; at: number } | { kind: 'run'; runId: string; at: number };

const newTab = (kind: Tab['kind'] = 'chat', extra: Partial<Tab> = {}): Tab => ({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title: kind === 'cleanup' ? t('Tri IA') : t('Nouvelle discussion'), kind, turns: [], ...extra });

function loadTabs(): { tabs: Tab[]; active: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { tabs: Tab[]; active: string } | null;
    if (saved?.tabs?.length) return saved;
  } catch {
    // unreadable storage: start fresh
  }
  const tab = newTab();
  return { tabs: [tab], active: tab.id };
}

export function AgentPanel({ onClose, request }: { onClose: () => void; request?: AgentRequest | null }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: status } = useQuery(trpc.ai.status.queryOptions());
  // Several discussions side by side, so an earlier one is never lost; kept across launches.
  const [state, setState] = useState(loadTabs);
  const tab = state.tabs.find((t) => t.id === state.active) ?? state.tabs[0]!;
  const turns = tab.turns;
  const patchTab = (id: string, patch: Partial<Tab> | ((t: Tab) => Partial<Tab>)) =>
    setState((prev) => ({ ...prev, tabs: prev.tabs.map((t) => (t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)) }));
  const setTurns = (update: (prev: Turn[]) => Turn[], id = tab.id) => patchTab(id, (t) => ({ turns: update(t.turns) }));
  const openTab = (next: Tab) => setState((prev) => ({ tabs: [...prev.tabs, next].slice(-12), active: next.id }));
  const closeTab = (id: string) =>
    setState((prev) => {
      const rest = prev.tabs.filter((t) => t.id !== id);
      if (!rest.length) {
        const fresh = newTab();
        return { tabs: [fresh], active: fresh.id };
      }
      const index = prev.tabs.findIndex((t) => t.id === id);
      return { tabs: rest, active: prev.active === id ? rest[Math.max(0, index - 1)]!.id : prev.active };
    });
  const [input, setInput] = useState('');
  // @mail, @sender, @account and #category picked in the input, sent as context with the question.
  const [chips, setChips] = useState<Mention[]>([]);
  const [pickIndex, setPickIndex] = useState(0);
  const suggestions = useMentionSuggestions(input, { exclude: chips });
  const picking = parseTrigger(input).trigger !== null && suggestions.length > 0;
  const track = useMutation(trpc.cleanup.trackShortcut.mutationOptions());
  const pick = (m: Mention) => {
    setChips((prev) => (prev.some((c) => mentionKey(c) === mentionKey(m)) ? prev : [...prev, m]));
    setInput((v) => dropTrigger(v) + (dropTrigger(v) ? ' ' : ''));
    setPickIndex(0);
  };
  const bottom = useRef<HTMLDivElement>(null);
  const chat = useMutation(trpc.ai.chat.mutationOptions());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, tabs: state.tabs.map((t) => ({ ...t, turns: t.turns.slice(-30) })) }));
    } catch {
      // private mode: tabs are not kept
    }
  }, [state]);
  // Braces: a smooth scrollIntoView returns a Promise in recent engines, which React would take
  // for the effect's cleanup and crash on.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, state.active]);

  // Requests from elsewhere, handled once: a question (asked in a new tab when the current one is
  // busy), a new cleaning run, or the run a notification points to.
  const handled = useRef<number | null>(null);
  useEffect(() => {
    if (!request || handled.current === request.at) return;
    handled.current = request.at;
    if (request.kind === 'ask') {
      if (tab.kind === 'chat' && !tab.turns.length) void send(request.text, tab.id, turns, request.mentions);
      else {
        const next = newTab('chat');
        openTab(next);
        void send(request.text, next.id, [], request.mentions);
      }
    } else if (request.kind === 'cleanup') openTab(newTab('cleanup', { runId: null }));
    else {
      const existing = state.tabs.find((t) => t.runId === request.runId);
      if (existing) setState((prev) => ({ ...prev, active: existing.id }));
      else openTab(newTab('cleanup', { runId: request.runId }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const send = async (message: string, tabId = tab.id, previous = turns, mentions: Mention[] = chips) => {
    const text = message.trim();
    if (!text || chat.isPending) return;
    setInput('');
    setChips([]);
    const history = previous.map((t) => ({ role: t.role, content: t.content }));
    setTurns((prev) => [...prev, { role: 'user', content: text, ...(mentions.length ? { mentions } : {}) }], tabId);
    // A question about precise mails or categories spared finding them first: it counts as time saved.
    if (mentions.length) track.mutate();
    // The first question names the tab.
    if (!previous.length) patchTab(tabId, (t) => (t.kind === 'chat' ? { title: text.length > 28 ? `${text.slice(0, 26)}…` : text } : {}));
    try {
      const reply = await chat.mutateAsync({ message: text, history, ...(mentions.length ? { context: mentionContext(mentions) } : {}) });
      setTurns((prev) => [...prev, { role: 'assistant', content: reply.reply || reply.steps.map((s) => s.summary).join('\n'), reply }], tabId);
      if (reply.steps.some((s) => s.ok && s.tool !== 'search_mail' && s.tool !== 'list_important' && s.tool !== 'summarize_inbox')) {
        void queryClient.invalidateQueries({ queryKey: trpc.rules.list.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.catalog.tags.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.catalog.businesses.queryKey() });
      }
    } catch (error) {
      setTurns((prev) => [...prev, { role: 'assistant', content: t('Désolé, une erreur est survenue : {error}', { error: (error as Error).message }) }], tabId);
    }
  };

  const chatModel = status?.capabilities.find((c) => c.id === 'chat')?.active;
  const engine = chatModel?.name.replace(/^[^:]{2,20}:\s*/, '') ?? t('Règles ZMail, sans IA');

  return (
    <div className="flex h-full w-[380px] shrink-0 flex-col">
      <div data-drag-region className="flex h-12 shrink-0 items-center gap-2 border-border border-b px-4">
        <div className="bg-ai/10 text-ai flex size-6 items-center justify-center rounded-md">
          <Bot className="size-3.5" />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] leading-tight font-semibold">{t('Chat IA')}</p>
          <p className="text-muted-foreground flex items-center gap-1 text-[11px] leading-tight">
            {chatModel ? <BrandLogo brand={chatModel.source === 'apple' ? 'apple-intelligence' : brandForModel(chatModel.model)} size={11} /> : null}
            {engine}
            {chatModel?.source === 'apple' ? <FreeBadge className="ml-0.5" /> : null}
          </p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground ml-auto flex size-7 items-center justify-center rounded-md" aria-label={t('Fermer le chat')}>
          <X className="size-4" />
        </button>
      </div>

      <div className="border-border scrollbar-none flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2 py-1.5" role="tablist" aria-label={t('Discussions')}>
        {state.tabs.map((item) => (
          <div
            key={item.id}
            role="tab"
            tabIndex={0}
            aria-selected={item.id === tab.id}
            onClick={() => setState((prev) => ({ ...prev, active: item.id }))}
            onKeyDown={(e) => e.key === 'Enter' && setState((prev) => ({ ...prev, active: item.id }))}
            className={cn(
              'group/tab flex h-7 max-w-[150px] shrink-0 cursor-default items-center gap-1.5 rounded-md pr-1 pl-2 text-[12px] transition-colors',
              item.id === tab.id ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          >
            {item.kind === 'cleanup' ? <Sparkles className="text-ai size-3 shrink-0" /> : null}
            <span className="truncate">{item.title}</span>
            <button
              type="button"
              onClick={(e) => (e.stopPropagation(), closeTab(item.id))}
              className={cn('hover:bg-background/70 flex size-4 shrink-0 items-center justify-center rounded-sm', item.id === tab.id ? 'opacity-70' : 'opacity-0 group-hover/tab:opacity-70')}
              aria-label={t('Fermer {name}', { name: item.title })}
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => openTab(newTab())}
          className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-7 shrink-0 items-center justify-center rounded-md"
          aria-label={t('Nouvelle discussion')}
          title={t('Nouvelle discussion')}
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {tab.kind === 'cleanup' ? (
          <div className="mb-4">
            <CleanupView key={tab.id} runId={tab.runId ?? null} onStarted={(runId) => patchTab(tab.id, { runId })} />
          </div>
        ) : null}
        {tab.kind === 'cleanup' && turns.length === 0 ? null : turns.length === 0 ? (
          <div className="pt-6">
            <div className="bg-ai/10 text-ai mb-4 flex size-11 items-center justify-center rounded-xl">
              <Sparkles className="size-5" />
            </div>
            <h3 className="text-[15px] font-semibold">{t('Parlez à votre boîte mail')}</h3>
            <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">
              {t('Demandez un résumé, retrouvez un mail, ou décrivez une règle en langage naturel : l’agent la crée pour vous.')}
            </p>
            <div className="mt-5 space-y-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  onClick={() => void send(example)}
                  className="text-foreground/85 border-border hover:bg-accent hover:text-accent-foreground w-full rounded-xl border px-3 py-2.5 text-left text-[13px] transition"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {turns.map((turn, i) =>
              turn.role === 'user' ? (
                <div key={i} className="flex flex-col items-end gap-1">
                  {turn.mentions?.length ? (
                    <div className="flex max-w-[85%] flex-wrap justify-end gap-1">
                      {turn.mentions.map((m) => (
                        <MentionChip key={mentionKey(m)} mention={m} />
                      ))}
                    </div>
                  ) : null}
                  <p className="bg-primary text-primary-foreground max-w-[85%] rounded-xl rounded-br-sm px-3.5 py-2 text-[13.5px]">{turn.content}</p>
                </div>
              ) : (
                <div key={i} className="space-y-2">
                  {!turn.reply || turn.reply.reply ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none text-[13.5px] leading-relaxed [&_p]:my-1">
                      <Markdown>{turn.content}</Markdown>
                    </div>
                  ) : null}
                  {turn.reply?.steps.length ? (
                    <div className="space-y-1">
                      {turn.reply.steps.map((step, j) => (
                        <p key={j} className={cn('flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px]', step.ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive')}>
                          {step.ok ? <Check className="mt-0.5 size-3 shrink-0" /> : <XCircle className="mt-0.5 size-3 shrink-0" />}
                          {step.summary}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {turn.reply?.threads.length ? (
                    <div className="border-border overflow-hidden rounded-xl border">
                      {turn.reply.threads.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => navigate(`/mail/inbox?thread=${t.id}`)}
                          className="border-border hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2.5 border-b px-3 py-2 text-left last:border-0"
                        >
                          <SenderAvatar name={t.from.name} email={t.from.email} size={24} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] font-medium">{displayName(t.from)}</span>
                            <span className="text-muted-foreground block truncate text-[12px]">{t.subject}</span>
                          </span>
                          <span className="text-muted-foreground shrink-0 text-[11px]">{formatListDate(t.date)}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ),
            )}
            {chat.isPending ? (
              <p className="text-muted-foreground flex items-center gap-2 text-[13px]">
                <Loader2 className="size-3.5 animate-spin" />
                {t('L’agent réfléchit…')}
              </p>
            ) : null}
            <div ref={bottom} />
          </div>
        )}
      </div>

      <form
        className="p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        {picking ? (
          <div className="border-border bg-popover mb-1.5 overflow-hidden rounded-xl border p-1 shadow-lg" role="listbox" aria-label={t('Mentionner')}>
            {suggestions.map((m, i) => (
              <button
                key={mentionKey(m)}
                type="button"
                role="option"
                aria-selected={i === pickIndex}
                onMouseDown={(e) => (e.preventDefault(), pick(m))}
                onMouseEnter={() => setPickIndex(i)}
                className={cn('flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px]', i === pickIndex ? 'bg-accent text-accent-foreground' : '')}
              >
                <MentionIcon mention={m} />
                <span className="min-w-0 flex-1 truncate">{mentionLabel(m)}</span>
                <span className="text-muted-foreground shrink-0 text-[11px]">{m.type === 'thread' ? t('Mail') : m.type === 'tag' ? t('Catégorie') : m.type === 'account' ? t('Compte') : t('Expéditeur')}</span>
              </button>
            ))}
          </div>
        ) : null}
        {chips.length ? (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {chips.map((c) => (
              <MentionChip key={mentionKey(c)} mention={c} onRemove={() => setChips((prev) => prev.filter((x) => mentionKey(x) !== mentionKey(c)))} />
            ))}
          </div>
        ) : null}
        <div className="bg-muted ring-ring/50 flex items-end gap-2 rounded-xl p-2 focus-within:ring-1">
          <textarea
            value={input}
            onChange={(e) => (setInput(e.target.value), setPickIndex(0))}
            onKeyDown={(e) => {
              if (picking) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setPickIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
                  return;
                }
                if (e.key === 'Tab' || e.key === 'Enter') {
                  e.preventDefault();
                  pick(suggestions[Math.min(pickIndex, suggestions.length - 1)]!);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setInput((v) => dropTrigger(v));
                  return;
                }
              }
              if (e.key === 'Backspace' && !input && chips.length) setChips((prev) => prev.slice(0, -1));
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder={t('Posez votre question… @ pour un mail, # pour une catégorie')}
            className="placeholder:text-muted-foreground max-h-32 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-2 text-[13.5px] outline-none"
          />
          <button type="submit" disabled={!input.trim() || chat.isPending} className="bg-primary text-primary-foreground hover:bg-primary/90 flex size-8 shrink-0 items-center justify-center rounded-lg transition disabled:opacity-30">
            <ArrowUp className="size-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
