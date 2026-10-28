import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, X } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useTRPC } from '@/lib/trpc';
import { ZIPPY_APPS, ZIPPY_ORANGE } from '@/lib/zippy-suite';
import { openZippySuite } from './suite-dialog';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

const HIDE_DAYS = 14;

/** Today's featured app: one per day, so the row stays fresh like a real first mail. */
const featured = () => ZIPPY_APPS[Math.floor(Date.now() / 86_400_000) % ZIPPY_APPS.length]!;

/** Hidden for two weeks when dismissed; stored with the UI preferences. */
function usePromoVisibility() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: ui, isSuccess } = useQuery(trpc.settings.get.queryOptions());
  const key = trpc.settings.get.queryKey();
  const save = useMutation(
    trpc.settings.save.mutationOptions({
      onMutate: (patch) => queryClient.setQueryData(key, (prev: Record<string, unknown> | undefined) => ({ ...prev, ...patch })),
    }),
  );
  const hiddenUntil = Number(ui?.zippyPromoHiddenUntil ?? 0);
  return {
    visible: isSuccess && ui?.zippyPromoNever !== true && Date.now() > hiddenUntil,
    remindLater: () => save.mutate({ zippyPromoHiddenUntil: Date.now() + HIDE_DAYS * 86_400_000 }),
    never: () => save.mutate({ zippyPromoNever: true }),
  };
}

/** First "mail" of the inbox, like Gmail's promoted messages: the rest of the Zippy suite. */
export function SuitePromoRow() {
  const { visible, remindLater, never } = usePromoVisibility();
  const [leaving, setLeaving] = useState(false);
  const hide = () => setLeaving(true);
  if (!visible) return null;
  const app = featured();
  return (
    <div className="px-1.5 py-[1px]">
      <LeaveDialog open={leaving} onOpenChange={setLeaving} onRemind={remindLater} onNever={never} />
      <div
        role="button"
        tabIndex={0}
        onClick={() => openZippySuite(app.id)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openZippySuite(app.id))}
        style={{ '--zippy': ZIPPY_ORANGE } as CSSProperties}
        className="group zippy-sheen relative flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/70"
        aria-label={t('Suite Zippy : découvrir {name}', { name: app.name })}
      >
        <span className="relative mt-0.5 shrink-0">
          <img src="/zippy/zippy.svg" alt="" className="size-8 rounded-[24%] shadow-xs" draggable={false} />
          {/* Same blue dot as an unread mail. */}
          <span className="ring-background absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-primary ring-2" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-semibold">{t('Suite Zippy')}</span>
            <span className="border-border text-muted-foreground rounded border px-1 text-[10px] leading-4 font-medium">{t('Annonce')}</span>
            <button
              type="button"
              onClick={(e) => (e.stopPropagation(), hide())}
              className="text-muted-foreground hover:text-foreground hover:bg-accent ml-auto flex size-5 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={t('Masquer cette annonce')}
              title={t('Masquer cette annonce')}
            >
              <X className="size-3.5" />
            </button>
          </div>
          <p className="mt-0.5 truncate text-[13px]">
            {t('Vous aimez ZMail ? Essayez {name}, le {app} gratuit et open source', { app: app.like })
              .split('{name}')
              .map((part, i) => (i ? [<span key="name" className="font-medium">{app.name}</span>, part] : part))}
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="flex -space-x-1.5" aria-hidden>
              {ZIPPY_APPS.slice(0, 5).map((a) => (
                <img key={a.id} src={a.icon} alt="" className="ring-background size-4 rounded-[24%] ring-1" />
              ))}
            </span>
            <span className="text-muted-foreground truncate text-[12px]">{t('ZPanel, ZNotes, ZPay, ZFlow et 3 autres · gratuits et open source')}</span>
            <ArrowUpRight className="text-muted-foreground ml-auto size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Bottom of the welcome page, the moment people have just seen how much time ZMail saves them:
 * the whole suite, always there (no ×, it never covers anything), today's app put forward.
 */
export function SuiteBanner() {
  const app = featured();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openZippySuite(app.id)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openZippySuite(app.id))}
      style={{ '--zippy': ZIPPY_ORANGE } as CSSProperties}
      className="group zippy-sheen border-border bg-card relative mt-10 cursor-pointer overflow-hidden rounded-2xl border p-4 transition-colors hover:bg-muted/60"
      aria-label={t('Suite Zippy : découvrir {name}', { name: app.name })}
    >
      <div className="flex items-start gap-3">
        <span className="relative shrink-0">
          <img src="/zippy/zippy.svg" alt="" className="size-10 rounded-[24%] shadow-sm" draggable={false} />
          <span className="ring-card absolute -top-0.5 -right-0.5 size-3 rounded-full bg-primary ring-2" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold">{t('Suite Zippy')}</span>
            <span className="border-border text-muted-foreground rounded border px-1 text-[10px] leading-4 font-medium">{t('Annonce')}</span>
          </div>
          <p className="mt-0.5 text-[13.5px] leading-snug">
            {t('Vous aimez ZMail ? Essayez {name}, le {app} gratuit et open source.', { app: app.like })
              .split('{name}')
              .map((part, i) => (i ? [<span key="name" className="font-semibold">{app.name}</span>, part] : part))}
          </p>
          <p className="text-muted-foreground mt-0.5 line-clamp-1 text-[12.5px]">{app.pitch}</p>
        </div>
        <ArrowUpRight className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
      <div className="mt-3.5 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
        {ZIPPY_APPS.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={(e) => (e.stopPropagation(), openZippySuite(a.id))}
            className={cn('hover:bg-background/80 flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition-colors', a.id === app.id && 'bg-background/70')}
            title={t('{name} : le {app} gratuit et open source', { name: a.name, app: a.like })}
          >
            <img src={a.icon} alt="" className="size-7 rounded-[24%] shadow-xs transition-transform group-hover:scale-[1.04]" draggable={false} />
            <span className="text-[11px] font-medium">{a.name}</span>
            <span className="text-muted-foreground -mt-1 text-[10px]">≈ {a.like}</span>
          </button>
        ))}
      </div>
      <p className="text-muted-foreground mt-3 text-center text-[11.5px]">{t('Gratuites, open source, et elles marchent toutes ensemble.')}</p>
    </div>
  );
}

/** Discreet line at the bottom of the welcome page. */
export function SuitePromoFooter() {
  return (
    <button type="button" onClick={() => openZippySuite()} className="group text-muted-foreground hover:text-foreground mt-6 flex items-center gap-2 text-[11.5px] transition-colors">
      <span className="flex -space-x-1" aria-hidden>
        {ZIPPY_APPS.slice(0, 4).map((a) => (
          <img key={a.id} src={a.icon} alt="" className="ring-background size-3.5 rounded-[24%] ring-1 grayscale transition group-hover:grayscale-0" />
        ))}
      </span>
      {t('Découvrez la suite Zippy : ZPanel, ZNotes, ZPay, ZFlow… gratuits et open source')}
      <ArrowUpRight className="size-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </button>
  );
}

/**
 * Shown when the × is clicked: one more chance, then the person decides. Persuasive, but every
 * button says exactly what it does (no confirmshaming trick that hides the real choice).
 * The suite opens after this dialog's close animation, or the same click would dismiss it.
 */
function LeaveDialog({ open, onOpenChange, onRemind, onNever }: { open: boolean; onOpenChange: (open: boolean) => void; onRemind: () => void; onNever: () => void }) {
  const close = (then: () => void) => () => {
    onOpenChange(false);
    then();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showOverlay className="max-w-[460px] gap-0 overflow-hidden p-0" style={{ '--zippy': ZIPPY_ORANGE } as CSSProperties}>
        <div className="zippy-hero relative px-7 pt-8 pb-6 text-center">
          <span className="zippy-hero-glow pointer-events-none absolute -top-24 left-1/2 h-56 w-[420px] -translate-x-1/2 rounded-full" aria-hidden />
          <div className="relative mx-auto flex w-fit -space-x-2.5" aria-hidden>
            {ZIPPY_APPS.slice(0, 5).map((a, i) => (
              <img key={a.id} src={a.icon} alt="" className="zippy-stack ring-background size-11 rounded-[24%] shadow-md ring-2" style={{ '--i': i } as CSSProperties} />
            ))}
          </div>
          <DialogTitle className="relative mt-5 text-[21px] leading-tight font-semibold tracking-tight">{t('Vous êtes sûr de vouloir passer à côté ?')}</DialogTitle>
          <DialogDescription className="text-muted-foreground relative mt-2 text-[13.5px] leading-relaxed">
            {t('ZPanel, ZNotes, ZPay, ZFlow… les alternatives gratuites et open source aux outils que vous payez déjà. Les utilisateurs de ZMail sont les premiers à les découvrir — et la suite s’agrandit chaque mois.')}
          </DialogDescription>
        </div>
        <div className="border-border flex flex-col gap-2 border-t px-7 py-5">
          <button
            type="button"
            onClick={close(onRemind)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/50 h-10 rounded-lg text-[14px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
            autoFocus
          >
            {t('Me le rappeler dans 2 semaines')}
          </button>
          <button type="button" onClick={close(() => setTimeout(() => openZippySuite(), 220))} className="text-foreground hover:bg-accent h-9 rounded-lg text-[13.5px] font-medium transition-colors">
            {t('Voir la suite d’abord')}
          </button>
          <button type="button" onClick={close(onNever)} className="text-muted-foreground hover:text-foreground mt-1 text-[12.5px] underline-offset-2 transition-colors hover:underline">
            {t('Ne plus jamais afficher — tant pis, je passe à côté')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
