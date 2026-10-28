import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, UserMinus, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { SenderAvatar } from '@/components/mail/chips';
import { useTRPC } from '@/lib/trpc';
import { formatListDate } from '@/lib/utils';
import { t, tp } from '@/lib/i18n';

export const meta = () => [{ title: `${t('Abonnements')} · ZMail` }];

export default function Subscriptions() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery(trpc.mail.subscriptions.queryOptions());
  const [running, setRunning] = useState<string | null>(null);
  const unsubscribe = useMutation(trpc.mail.unsubscribe.mutationOptions());

  const run = async (threadId: string, email: string) => {
    setRunning(email);
    try {
      const outcome = await unsubscribe.mutateAsync({ threadId });
      if (outcome.status === 'success') toast.success(t('Désinscrit de {email}', { email }), { description: outcome.detail });
      else toast.error(t('Impossible pour {email}', { email }), { description: outcome.detail });
    } finally {
      setRunning(null);
      void queryClient.invalidateQueries({ queryKey: trpc.mail.subscriptions.queryKey() });
    }
  };

  const neverOpened = data?.filter((s) => s.opened === 0 && s.status === 'subscribed' && s.canUnsubscribe) ?? [];

  return (
    <div className="scrollbar-none h-full overflow-y-auto">
      <div data-drag-region className="h-12" />
      <div className="mx-auto max-w-[820px] px-8 pb-16">
        <h1 className="text-[20px] font-semibold tracking-tight">{t('Abonnements')}</h1>
        <p className="text-muted-foreground mt-1 text-[13.5px]">{t('Toutes les newsletters et listes marketing détectées, avec votre taux d’ouverture. L’agent se désinscrit pour vous en un clic.')}</p>
        {neverOpened.length ? (
          <div className="mt-5 flex items-center gap-3 rounded-xl bg-ai/10 px-4 py-3 border border-ai/20">
            <UserMinus className="size-4 text-ai" />
            <p className="flex-1 text-[13px]">
              <b className="font-semibold">{tp(neverOpened.length, '{n} liste', '{n} listes')}</b> {t('que vous n’ouvrez jamais.')}
            </p>
            <button
              onClick={async () => {
                for (const s of neverOpened) await run(s.threadId, s.fromEmail);
              }}
              className="h-8 rounded-lg bg-ai px-3 text-[13px] font-medium text-ai-foreground hover:bg-ai/90"
            >
              {t('Tout désinscrire')}
            </button>
          </div>
        ) : null}
        <div className="mt-5 overflow-hidden rounded-xl border border-border">
          <div className="text-muted-foreground grid grid-cols-[1fr_90px_90px_150px] gap-3 border-b border-border px-4 py-2 text-[11px] font-medium tracking-wide uppercase">
            <span>{t('Expéditeur')}</span>
            <span className="text-right">{t('Reçus')}</span>
            <span className="text-right">{t('Ouverts')}</span>
            <span />
          </div>
          {isPending ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="text-muted-foreground size-4 animate-spin" />
            </div>
          ) : data?.length ? (
            data.map((s) => (
              <div key={s.fromEmail} className="grid grid-cols-[1fr_90px_90px_150px] items-center gap-3 border-b border-border px-4 py-2.5 last:border-0">
                <div className="flex min-w-0 items-center gap-3">
                  <SenderAvatar name={s.fromName} email={s.fromEmail} size={28} />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{s.fromName || s.fromEmail}</p>
                    <p className="text-muted-foreground truncate text-[11.5px]">
                      {s.fromEmail} · {t('dernier {date}', { date: formatListDate(s.lastAt) })}
                    </p>
                  </div>
                </div>
                <span className="text-right text-[13px] tabular-nums">{s.total}</span>
                <span className={`text-right text-[13px] tabular-nums ${s.opened === 0 ? 'text-destructive' : ''}`}>{t('{n} %', { n: Math.round((s.opened / s.total) * 100) })}</span>
                <div className="flex justify-end">
                  {s.status === 'success' ? (
                    <span className="flex items-center gap-1 text-[12.5px] text-success">
                      <CheckCircle2 className="size-3.5" /> {t('Désinscrit')}
                    </span>
                  ) : s.status === 'failed' ? (
                    <span className="flex items-center gap-1 text-[12.5px] text-destructive" title={s.detail ?? ''}>
                      <XCircle className="size-3.5" /> {t('Échec')}
                    </span>
                  ) : s.canUnsubscribe ? (
                    <button onClick={() => void run(s.threadId, s.fromEmail)} disabled={running !== null} className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] border border-border hover:bg-accent hover:text-accent-foreground disabled:opacity-50">
                      {running === s.fromEmail ? <Loader2 className="size-3 animate-spin" /> : <UserMinus className="size-3" />}
                      {t('Se désinscrire')}
                    </button>
                  ) : (
                    <span className="text-muted-foreground text-[12px]">{t('Pas de lien')}</span>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground py-10 text-center text-[13px]">{t('Aucune newsletter détectée.')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
