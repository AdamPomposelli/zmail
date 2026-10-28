import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Trash2, UserMinus, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { SenderAvatar } from '@/components/mail/chips';
import { BrandLogo, brandForProvider } from '@/components/brand-logo';
import { useCatalog } from '@/hooks/use-catalog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useTRPC, type Outputs } from '@/lib/trpc';
import { formatListDate } from '@/lib/utils';
import { t, tp } from '@/lib/i18n';

export const meta = () => [{ title: `${t('Abonnements')} · ZMail` }];

type Subscription = Outputs['mail']['subscriptions'][number];
const COLUMNS = 'grid-cols-[1fr_70px_80px_150px]';

export default function Subscriptions() {
  const trpc = useTRPC();
  const catalog = useCatalog();
  const { data: ui } = useQuery(trpc.settings.get.queryOptions());
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery(trpc.mail.subscriptions.queryOptions());
  const [running, setRunning] = useState<string | null>(null);
  const unsubscribe = useMutation(trpc.mail.unsubscribe.mutationOptions());
  const trashFromSender = useMutation(trpc.mail.trashFromSender.mutationOptions());
  const restore = useMutation(trpc.mail.restore.mutationOptions());
  // After an unsubscribe: offer to clear that sender's mails too (they go to the trash).
  const [ask, setAsk] = useState<Subscription[] | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.mail.subscriptions.queryKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.mail.list.pathKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.mail.counts.queryKey() });
  };

  const run = async (s: Subscription, quiet = false) => {
    setRunning(`${s.accountId}|${s.fromEmail}`);
    try {
      const outcome = await unsubscribe.mutateAsync({ threadId: s.threadId });
      if (outcome.status !== 'success') toast.error(t('Impossible pour {email}', { email: s.fromEmail }), { description: outcome.detail });
      else if (!quiet && s.kept === 0) toast.success(t('Désinscrit de {email}', { email: s.fromEmail }), { description: outcome.detail });
      return outcome.status === 'success';
    } finally {
      setRunning(null);
      refresh();
    }
  };
  const unsubscribeOne = async (s: Subscription) => {
    if ((await run(s)) && s.kept > 0) setAsk([s]);
  };
  const unsubscribeAll = async (list: Subscription[]) => {
    const done: Subscription[] = [];
    for (const s of list) if (await run(s, true)) done.push(s);
    if (done.some((s) => s.kept > 0)) setAsk(done.filter((s) => s.kept > 0));
    else if (done.length) toast.success(tp(done.length, 'Désinscrit de {n} liste', 'Désinscrit de {n} listes'));
  };
  /** Moves every mail of these senders to the trash, with an undo. */
  const deleteAll = async (list: Subscription[]) => {
    setAsk(null);
    const moved: string[] = [];
    for (const s of list) {
      setRunning(`${s.accountId}|${s.fromEmail}`);
      try {
        moved.push(...(await trashFromSender.mutateAsync({ accountId: s.accountId, fromEmail: s.fromEmail })).threadIds);
      } catch (error) {
        toast.error((error as Error).message);
      }
    }
    setRunning(null);
    refresh();
    const mails = list.reduce((n, s) => n + s.kept, 0);
    toast.success(tp(mails, '{n} mail à la corbeille', '{n} mails à la corbeille'), {
      action: { label: t('Annuler|undo'), onClick: () => void restore.mutateAsync({ threadIds: moved }).then(refresh) },
    });
  };

  // One section per mailbox, in the sidebar's order: at a glance, which address gets which list.
  const order = Array.isArray(ui?.accountOrder) ? (ui.accountOrder as string[]) : [];
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length + catalog.accounts.findIndex((a) => a.id === id));
  const sections = [...catalog.accounts]
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((account) => ({ account, rows: (data ?? []).filter((s) => s.accountId === account.id) }))
    .filter((section) => section.rows.length > 0);
  const total = data?.length ?? 0;

  const row = (s: Subscription) => {
    const key = `${s.accountId}|${s.fromEmail}`;
    return (
      <div key={key} className={`grid ${COLUMNS} items-center gap-3 border-b border-border px-4 py-2.5 last:border-0`}>
        <div className="flex min-w-0 items-center gap-3">
          <SenderAvatar name={s.fromName} email={s.fromEmail} size={28} />
          <div className="min-w-0">
            <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
              <span className="truncate">{s.fromName || s.fromEmail}</span>
              {s.status === 'success' ? (
                <span className="bg-success/10 text-success inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full px-1.5 text-[10.5px] font-medium">
                  <CheckCircle2 className="size-3" /> {t('Désinscrit')}
                </span>
              ) : null}
            </p>
            <p className="text-muted-foreground truncate text-[11.5px]">
              {s.fromEmail} · {t('dernier {date}', { date: formatListDate(s.lastAt) })}
            </p>
          </div>
        </div>
        <span className="text-right text-[13px] tabular-nums">{s.total}</span>
        <span className={`text-right text-[13px] tabular-nums ${s.opened === 0 ? 'text-destructive' : ''}`}>{t('{n} %', { n: Math.round((s.opened / s.total) * 100) })}</span>
        <div className="flex justify-end">
          {s.status === 'success' ? (
            s.kept > 0 ? (
              <button
                onClick={() => void deleteAll([s])}
                disabled={running !== null}
                title={tp(s.kept, 'Mettre son {n} mail à la corbeille', 'Mettre ses {n} mails à la corbeille')}
                className="hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 flex h-7 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12.5px] disabled:opacity-50"
              >
                {running === key ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                {t('Tout supprimer')}
              </button>
            ) : (
              <span className="text-muted-foreground flex items-center gap-1 text-[12.5px]">
                <CheckCircle2 className="size-3.5" /> {t('Nettoyé')}
              </span>
            )
          ) : s.status === 'failed' ? (
            <span className="flex items-center gap-1 text-[12.5px] text-destructive" title={s.detail ?? ''}>
              <XCircle className="size-3.5" /> {t('Échec')}
            </span>
          ) : s.canUnsubscribe ? (
            <button onClick={() => void unsubscribeOne(s)} disabled={running !== null} className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] border border-border hover:bg-accent hover:text-accent-foreground disabled:opacity-50">
              {running === key ? <Loader2 className="size-3 animate-spin" /> : <UserMinus className="size-3" />}
              {t('Se désinscrire')}
            </button>
          ) : (
            <span className="text-muted-foreground text-[12px]">{t('Pas de lien')}</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="scrollbar-none h-full overflow-y-auto">
      <div data-drag-region className="h-12" />
      <div className="mx-auto max-w-[820px] px-8 pb-16">
        <h1 className="text-[20px] font-semibold tracking-tight">{t('Abonnements')}</h1>
        <p className="text-muted-foreground mt-1 text-[13.5px]">{t('Les newsletters et listes marketing de chaque boîte mail, avec votre taux d’ouverture. L’agent se désinscrit pour vous en un clic, depuis la bonne adresse.')}</p>
        {isPending ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          </div>
        ) : total === 0 ? (
          <p className="text-muted-foreground mt-5 rounded-xl border border-border py-10 text-center text-[13px]">{t('Aucune newsletter détectée.')}</p>
        ) : (
          sections.map(({ account, rows }) => {
            const neverOpened = rows.filter((s) => s.opened === 0 && s.status === 'subscribed' && s.canUnsubscribe);
            const brand = brandForProvider(account.provider);
            return (
              <section key={account.id} className="mt-7" aria-label={account.email}>
                <header className="mb-2 flex items-center gap-2.5 px-1">
                  {brand ? <BrandLogo brand={brand} size={16} /> : <span className="size-2 rounded-full" style={{ backgroundColor: account.color }} />}
                  <h2 className="min-w-0 truncate text-[14px] font-semibold">{account.label || account.email}</h2>
                  {account.label ? <span className="text-muted-foreground truncate text-[12px]">{account.email}</span> : null}
                  <span className="text-muted-foreground ml-auto shrink-0 text-[12px] tabular-nums">{tp(rows.length, '{n} abonnement', '{n} abonnements')}</span>
                </header>
                {neverOpened.length ? (
                  <div className="bg-ai/10 border-ai/20 mb-2 flex items-center gap-3 rounded-xl border px-4 py-2.5">
                    <UserMinus className="text-ai size-4" />
                    <p className="flex-1 text-[13px]">
                      <b className="font-semibold">{tp(neverOpened.length, '{n} liste', '{n} listes')}</b> {t('que vous n’ouvrez jamais.')}
                    </p>
                    <button
                      onClick={() => void unsubscribeAll(neverOpened)}
                      disabled={running !== null}
                      className="bg-ai text-ai-foreground hover:bg-ai/90 h-8 rounded-lg px-3 text-[13px] font-medium disabled:opacity-50"
                    >
                      {t('Tout désinscrire')}
                    </button>
                  </div>
                ) : null}
                <div className="overflow-hidden rounded-xl border border-border">
                  <div className={`text-muted-foreground grid ${COLUMNS} gap-3 border-b border-border px-4 py-2 text-[11px] font-medium tracking-wide uppercase`}>
                    <span>{t('Expéditeur')}</span>
                    <span className="text-right">{t('Reçus')}</span>
                    <span className="text-right">{t('Ouverts')}</span>
                    <span />
                  </div>
                  {rows.map(row)}
                </div>
              </section>
            );
          })
        )}
      </div>
      <Dialog open={ask !== null} onOpenChange={(open) => !open && setAsk(null)}>
        <DialogContent showOverlay className="max-w-[420px]">
          {ask ? (
            <>
              <DialogTitle className="text-[16px]">
                {ask.length === 1
                  ? tp(ask[0]!.kept, 'Supprimer aussi le mail de {name} ?', 'Supprimer aussi les {n} mails de {name} ?', { name: ask[0]!.fromName || ask[0]!.fromEmail })
                  : tp(ask.reduce((n, s) => n + s.kept, 0), 'Supprimer aussi leur mail ?', 'Supprimer aussi leurs {n} mails ?')}
              </DialogTitle>
              <DialogDescription className="text-[13px]">
                {ask.length === 1 ? t('Vous êtes désinscrit. Ses anciens mails partent à la corbeille, vous pourrez encore les récupérer.') : t('Vous êtes désinscrit de ces listes. Leurs anciens mails partent à la corbeille, vous pourrez encore les récupérer.')}
              </DialogDescription>
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setAsk(null)} className="hover:bg-accent h-8 rounded-lg border border-border px-3 text-[13px]">
                  {t('Garder')}
                </button>
                <button type="button" onClick={() => void deleteAll(ask)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium">
                  <Trash2 className="size-3.5" /> {t('Supprimer')}
                </button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
