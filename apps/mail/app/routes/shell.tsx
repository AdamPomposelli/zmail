import { useEffect, useState } from 'react';
import { RetriageToast } from '@/components/retriage';
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useHotkeys } from 'react-hotkeys-hook';
import { AppSidebar } from '@/components/app-sidebar';
import { AgentPanel, type AgentRequest } from '@/components/agent/agent-panel';
import { CommandPalette } from '@/components/command-palette';
import type { Mention } from '@/components/smart/mentions';
import { ComposeDialog } from '@/components/mail/compose-dialog';
import { Onboarding } from '@/components/onboarding';
import { SuggestionModal } from '@/components/suggestion-modal';
import { useCatalog } from '@/hooks/use-catalog';
import { useEngineEvents } from '@/hooks/use-engine-events';
import { isNativeApp, postNative } from '@/lib/native';
import { cn } from '@/lib/utils';
import { BootScreen } from '@/components/boot-screen';
import { bootDone, bootStep } from '@/lib/boot';
import { ZippySuiteDialog } from '@/components/zippy/suite-dialog';
import { t } from '@/lib/i18n';

function EngineOffline() {
  // The engine restarts (crash, update): same skeleton as at launch, until it answers again.
  return <BootScreen progress={40} label={t('Reconnexion au moteur ZMail')} cap={88} />;
}

/** WKWebView has no CSS drag regions: empty areas marked data-drag-region move the window. */
function useNativeWindowDrag() {
  useEffect(() => {
    if (!isNativeApp()) return;
    const interactive = 'button, a, input, textarea, select, [role="button"], [contenteditable="true"]';
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (e.button !== 0 || !target.closest('[data-drag-region]') || target.closest(interactive)) return;
      postNative(e.detail === 2 ? { type: 'zoomWindow' } : { type: 'startDrag' });
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
}

export default function Shell() {
  useEngineEvents();
  useNativeWindowDrag();
  const navigate = useNavigate();
  // The macOS app routes here (notification clicked, menu bar) without reloading the page.
  useEffect(() => {
    const go = (event: Event) => navigate((event as CustomEvent<string>).detail);
    window.addEventListener('zmail:navigate', go);
    return () => window.removeEventListener('zmail:navigate', go);
  }, [navigate]);
  // Other screens open the chat with a question already asked (« zmail:ask-agent ») or a new
  // cleaning run (« zmail:start-cleanup »); a notification of the cleaning agent opens its run (?agent=).
  const [agentRequest, setAgentRequest] = useState<AgentRequest | null>(null);
  useEffect(() => {
    const onAsk = (e: Event) => {
      setAgent(true);
      // A question (string), or one asked from ⌘K with its @mentions.
      const detail = (e as CustomEvent<string | { text: string; mentions?: Mention[] }>).detail;
      setAgentRequest(typeof detail === 'string' ? { kind: 'ask', text: detail, at: Date.now() } : { kind: 'ask', text: detail.text, mentions: detail.mentions, at: Date.now() });
    };
    const onCleanup = () => {
      setAgent(true);
      setAgentRequest({ kind: 'cleanup', at: Date.now() });
    };
    window.addEventListener('zmail:ask-agent', onAsk);
    window.addEventListener('zmail:start-cleanup', onCleanup);
    return () => {
      window.removeEventListener('zmail:ask-agent', onAsk);
      window.removeEventListener('zmail:start-cleanup', onCleanup);
    };
  }, []);
  const [params, setParams] = useSearchParams();
  const runFromNotification = params.get('agent');
  useEffect(() => {
    if (!runFromNotification) return;
    setAgent(true);
    setAgentRequest({ kind: 'run', runId: runFromNotification, at: Date.now() });
    setParams((prev) => (prev.delete('agent'), prev), { replace: true });
  }, [runFromNotification, setParams]);
  const { pathname } = useLocation();
  const catalog = useCatalog();
  const [compose, setCompose] = useState(false);
  const [palette, setPalette] = useState(false);
  const [agent, setAgent] = useState(false);

  // Zippy menu bar (macOS app): « Nouveau message » and « Chat IA ».
  useEffect(() => {
    const openCompose = () => setCompose(true);
    const openAgent = () => setAgent(true);
    window.addEventListener('zmail:compose', openCompose);
    window.addEventListener('zmail:open-agent', openAgent);
    return () => {
      window.removeEventListener('zmail:compose', openCompose);
      window.removeEventListener('zmail:open-agent', openAgent);
    };
  }, []);

  useHotkeys('mod+k', (e) => (e.preventDefault(), setPalette((v) => !v)), { preventDefault: true, enableOnFormTags: true });
  useHotkeys('mod+j', (e) => (e.preventDefault(), setAgent((v) => !v)), { preventDefault: true, enableOnFormTags: true });
  useHotkeys('c', (e) => (e.preventDefault(), setCompose(true)), { preventDefault: true });
  useHotkeys('g>i', () => navigate('/mail/inbox'), { preventDefault: true });
  useHotkeys('g>p', () => navigate('/mail/inbox?tag=important'), { preventDefault: true });
  useHotkeys('g>o', () => navigate('/mail/inbox?tag=opportunity'), { preventDefault: true });
  useHotkeys('mod+comma', (e) => (e.preventDefault(), navigate('/settings/accounts')), { preventDefault: true });

  // Boot skeleton: mailboxes known → wait for the inbox's mails (ThreadList ends it); other screens end it now.
  useEffect(() => {
    if (!catalog.loaded) return;
    if (pathname.startsWith('/mail/') && catalog.accounts.length > 0) bootStep(92, t('Chargement de vos mails'), 98);
    else bootDone();
  }, [catalog.loaded, catalog.accounts.length, pathname]);

  if (catalog.offline) return <EngineOffline />;
  // Stays on screen after the first mailbox is added, until the user leaves the success step.
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  useEffect(() => {
    if (onboarding === null && catalog.loaded) setOnboarding(catalog.accounts.length === 0);
  }, [onboarding, catalog.loaded, catalog.accounts.length]);
  const needsOnboarding = Boolean(onboarding) && !pathname.startsWith('/settings');

  if (needsOnboarding) {
    return (
      <div className="bg-sidebar flex h-dvh w-full p-[var(--window-gap)]">
        {/* Gap and radius come from --window-gap/--window-radius: concentric with the macOS window corner. */}
        <div data-drag-region className="absolute inset-x-0 top-0 h-8" />
        <div className="bg-background border-border rounded-panel border relative flex min-w-0 flex-1 overflow-hidden">
          <Onboarding onDone={() => (setOnboarding(false), navigate('/mail/inbox'))} />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-sidebar flex h-dvh w-full overflow-hidden">
      <RetriageToast />
      <AppSidebar onCompose={() => setCompose(true)} onAgent={() => setAgent((v) => !v)} agentOpen={agent} />
      <main className="flex min-w-0 flex-1 py-[var(--window-gap)] pr-[var(--window-gap)]">
        <div className="bg-background border-border rounded-panel border relative min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
        {/* box-content: the 1px border sits outside the panel's 380px, so the chat is never clipped.
            Closed, it takes no room at all (no gap, no border): the right margin equals the others. */}
        <div className={cn('bg-background border-border rounded-panel box-content overflow-hidden transition-[width,opacity,margin] duration-200', agent ? 'ml-[var(--window-gap)] w-[380px] border opacity-100' : 'ml-0 w-0 border-0 opacity-0')}>
          {agent ? <AgentPanel onClose={() => setAgent(false)} request={agentRequest} /> : null}
        </div>
      </main>
      <ComposeDialog open={compose} onOpenChange={setCompose} />
      <CommandPalette open={palette} onOpenChange={setPalette} onCompose={() => setCompose(true)} onAgent={() => setAgent(true)} />
      <SuggestionModal />
      <ZippySuiteDialog />
    </div>
  );
}
