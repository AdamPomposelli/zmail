import { ArrowUpRight, Check } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { openExternal } from '@/lib/native';
import { ZIPPY_APPS, ZIPPY_GITHUB, ZIPPY_ORANGE, type ZippyApp } from '@/lib/zippy-suite';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

const EVENT = 'zmail:zippy-suite';

/** Ink-coloured brands (ZNotes, ZCode) would vanish on dark surfaces: they use the text colour instead. */
const accentOf = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 0.18 ? 'var(--foreground)' : hex;
};

/** Opens the Zippy suite modal from anywhere (inbox row, welcome page…). */
export const openZippySuite = (focus?: string) => window.dispatchEvent(new CustomEvent(EVENT, { detail: focus }));

function AppCard({ app, index, highlighted }: { app: ZippyApp; index: number; highlighted: boolean }) {
  return (
    <button
      type="button"
      onClick={() => openExternal(app.url)}
      style={{ '--app': accentOf(app.color), '--i': index } as CSSProperties}
      className={cn(
        'zippy-card group/card bg-card text-card-foreground border-border relative flex flex-col gap-3 overflow-hidden rounded-xl border p-4 text-left transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5',
        highlighted && 'zippy-card-focus',
      )}
    >
      <span className="zippy-card-glow pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/card:opacity-100" aria-hidden />
      <span className="relative flex items-start gap-3">
        <img src={app.icon} alt="" className="size-11 shrink-0 rounded-[24%] shadow-sm transition-transform duration-300 group-hover/card:scale-105 group-hover/card:-rotate-3" draggable={false} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[15px] font-semibold tracking-tight">{app.name}</span>
            <span className="text-success bg-success/10 rounded-full px-1.5 py-px text-[10px] font-semibold">{t('Gratuit')}</span>
          </span>
          <span className="text-muted-foreground mt-0.5 block text-[12.5px]">
            {t('Le {app} gratuit et open source')
              .split('{app}')
              .map((part, i) => (i ? [<span key="app" className="text-foreground font-medium">{app.like}</span>, part] : part))}
          </span>
        </span>
        <ArrowUpRight className="text-muted-foreground size-4 shrink-0 transition-transform duration-300 group-hover/card:translate-x-0.5 group-hover/card:-translate-y-0.5 group-hover/card:text-[var(--app)]" />
      </span>
      <span className="relative text-[13px] leading-relaxed">{app.pitch}</span>
      <span className="relative flex flex-col gap-1">
        {app.points.map((point) => (
          <span key={point} className="text-muted-foreground flex items-center gap-1.5 text-[12px]">
            <Check className="size-3.5 shrink-0 text-[var(--app)]" />
            {point}
          </span>
        ))}
      </span>
      <span className="relative mt-auto flex items-center gap-1 pt-1 text-[12px] font-medium text-[var(--app)] dark:brightness-150">
        {app.placeholder ? t('Voir sur GitHub') : t('Voir le projet sur GitHub')}
        <ArrowUpRight className="size-3.5" />
      </span>
    </button>
  );
}

/** "You like ZMail? You'll love the rest": the whole suite, one click from each repo. */
export function ZippySuiteDialog() {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<string | undefined>();
  useEffect(() => {
    const onOpen = (event: Event) => {
      setFocus((event as CustomEvent<string | undefined>).detail);
      setOpen(true);
    };
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showOverlay className="max-h-[88vh] max-w-[880px] gap-0 overflow-y-auto p-0">
        <div className="zippy-hero relative overflow-hidden px-8 pt-9 pb-7" style={{ '--zippy': ZIPPY_ORANGE } as CSSProperties}>
          <span className="zippy-hero-glow pointer-events-none absolute -top-32 left-1/2 h-72 w-[640px] -translate-x-1/2 rounded-full" aria-hidden />
          <div className="relative flex items-center gap-2">
            <img src="/zippy/zippy.svg" alt="" className="size-6 rounded-[24%]" />
            <span className="text-[12px] font-semibold tracking-wide uppercase" style={{ color: ZIPPY_ORANGE }}>
              {t('La suite Zippy')}
            </span>
          </div>
          <DialogTitle className="relative mt-3 text-[28px] leading-tight font-semibold tracking-tight">
            {t('Vous aimez ZMail ?')}
            <br />
            {t('Vous allez adorer le reste.')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground relative mt-2 max-w-[560px] text-[14px] leading-relaxed">
            {t('Les mêmes promesses que ZMail, pour tous vos autres outils : gratuits, open source, et vos données restent chez vous. Les alternatives aux apps que vous payez déjà.')}
          </DialogDescription>
          <div className="relative mt-5 flex -space-x-2" aria-hidden>
            {ZIPPY_APPS.map((app, i) => (
              <img key={app.id} src={app.icon} alt="" className="zippy-stack ring-background size-9 rounded-[24%] ring-2" style={{ '--i': i } as CSSProperties} />
            ))}
          </div>
        </div>

        <div className="grid gap-3 px-8 pb-6 sm:grid-cols-2">
          {ZIPPY_APPS.map((app, i) => (
            <AppCard key={app.id} app={app} index={i} highlighted={focus === app.id} />
          ))}
        </div>

        <div className="border-border text-muted-foreground flex flex-wrap items-center justify-between gap-3 border-t px-8 py-4 text-[12.5px]">
          <span>{t('Chaque app Zippy est gratuite et open source, pour toujours.')}</span>
          <button type="button" onClick={() => openExternal(ZIPPY_GITHUB)} className="text-foreground inline-flex items-center gap-1 font-medium hover:underline">
            {t('Toute la suite sur GitHub')}
            <ArrowUpRight className="size-3.5" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
