import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useTRPC } from '@/lib/trpc';
import { copyText, isNativeApp } from '@/lib/native';
import { t } from '@/lib/i18n';

type EngineEvent =
  | { type: 'sync'; accountId: string; status: string; error?: string | null }
  | { type: 'mail'; reason: string; threadIds: string[] }
  | { type: 'suggestion'; id: string }
  | { type: 'notification'; id: string; kind: string; title: string; body: string; otp?: string | null; threadId?: string | null }
  | { type: 'unsubscribe'; id: string; status: string; fromEmail: string };

/** Live updates from the engine (SSE): refreshes queries and surfaces notifications in-app. */
export function useEngineEvents() {
  const queryClient = useQueryClient();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const pending = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const flush = () => {
      timer.current = null;
      const keys = [...pending.current];
      pending.current.clear();
      if (keys.includes('mail')) {
        void queryClient.invalidateQueries({ queryKey: trpc.mail.list.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.mail.counts.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.mail.thread.pathKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.accounts.folders.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.cleanup.pathKey() });
        // A mail reclassified as spam leaves the alerts.
        void queryClient.invalidateQueries({ queryKey: trpc.notifications.list.queryKey() });
      }
      if (keys.includes('accounts')) void queryClient.invalidateQueries({ queryKey: trpc.accounts.list.queryKey() });
      if (keys.includes('suggestions')) void queryClient.invalidateQueries({ queryKey: trpc.rules.suggestions.queryKey() });
      if (keys.includes('subscriptions')) void queryClient.invalidateQueries({ queryKey: trpc.mail.subscriptions.queryKey() });
      if (keys.includes('notifications')) void queryClient.invalidateQueries({ queryKey: trpc.notifications.list.queryKey() });
    };
    const schedule = (key: string) => {
      pending.current.add(key);
      timer.current ??= setTimeout(flush, 350);
    };

    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      source = new EventSource('/api/events');
      const on = (type: string, handler: (event: EngineEvent) => void) =>
        source!.addEventListener(type, (e) => handler(JSON.parse((e as MessageEvent).data)));
      on('mail', () => schedule('mail'));
      on('sync', () => {
        schedule('accounts');
        schedule('mail');
      });
      on('suggestion', () => schedule('suggestions'));
      on('unsubscribe', (event) => {
        schedule('subscriptions');
        schedule('mail');
        if (event.type === 'unsubscribe' && event.status === 'success') toast.success(t('Désinscrit de {email}', { email: event.fromEmail }));
      });
      on('notification', (event) => {
        schedule('notifications');
        if (event.type !== 'notification') return;
        // The app shows native notifications; in a browser, mirror them as toasts.
        if (isNativeApp() && event.kind !== 'otp') return;
        const open = event.threadId ? () => navigate(`/mail/inbox?thread=${event.threadId}`) : undefined;
        if (event.otp) {
          toast(event.title, {
            description: event.body,
            duration: 30_000,
            action: { label: t('Copier le code'), onClick: () => void copyText(event.otp!).then(() => toast.success(t('Code copié'))) },
          });
        } else {
          toast(event.title, { description: event.body, action: open ? { label: t('Ouvrir'), onClick: open } : undefined });
        }
      });
      source.onerror = () => {
        source?.close();
        retry = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      source?.close();
      if (retry) clearTimeout(retry);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [queryClient, trpc, navigate]);
}
