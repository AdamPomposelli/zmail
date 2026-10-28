import type { CSSProperties } from 'react';
import { SolarIcon } from '@/components/ui/solar-icon';
import type { ThemePreset } from '@/lib/themes';
import { cn } from '@/lib/utils';
import { t, tp } from '@/lib/i18n';

const MAILS = [
  { from: 'Claire Martin', initials: 'CM', subject: t('Demande de devis — application mobile'), summary: t('Budget 40 k€, lancement prévu en mars.'), time: '09:41', unread: true, priority: true, chips: [{ label: t('Opportunité'), icon: 'sparkles', color: '#10B981' }, { label: t('À répondre'), icon: 'reply', color: '#3B82F6' }] },
  { from: 'Stripe', initials: 'S', subject: t('Litige ouvert : 249,00 € sur #10482'), summary: t('Un client conteste un paiement.'), time: '09:12', unread: true, priority: true, chips: [{ label: 'Chargeback', icon: 'shield-alert', color: '#DC2626' }] },
  { from: 'Paylane', initials: 'P', subject: t('Votre code de vérification'), summary: t('Code 482913, valable 10 minutes.'), time: '08:57', unread: false, priority: false, chips: [{ label: t('Sécurité & OTP'), icon: 'key', color: '#8B5CF6' }] },
  { from: 'DevPulse', initials: 'D', subject: t('Le digest de la semaine #212'), summary: t('Cinq articles sur React et Rust.'), time: t('Hier'), unread: false, priority: false, chips: [{ label: 'Newsletter', icon: 'newspaper', color: '#06B6D4' }] },
];

/**
 * A miniature ZMail drawn with the real theme tokens. The preset's variables are set on this
 * element only, so hovering a theme previews it without touching the rest of the app.
 */
export function ThemeAppPreview({ preset, mode }: { preset: ThemePreset; mode: 'light' | 'dark' }) {
  const styles = mode === 'dark' ? preset.dark : preset.light;
  const vars = Object.fromEntries(Object.entries(styles).map(([key, value]) => [`--${key}`, value])) as CSSProperties;
  return (
    <div style={vars} className="bg-sidebar text-foreground border-border flex h-[460px] overflow-hidden rounded-xl border font-sans shadow-md" aria-label={t('Aperçu du thème {name}', { name: preset.label })}>
      <div className="flex w-[120px] shrink-0 flex-col gap-0.5 p-2 text-[11px]">
        <div className="bg-background border-border mb-1.5 flex h-7 items-center gap-1.5 rounded-md border px-2 font-medium shadow-xs">
          <SolarIcon name="_compose" className="size-3.5" />
          {t('Nouveau')}
        </div>
        {[
          ['_inbox', t('Réception'), 21, true],
          ['flame', t('Important'), 3, false],
          ['reply', t('À répondre'), 3, false],
          ['_starred', t('Favoris'), 0, false],
        ].map(([icon, label, count, active]) => (
          <div key={label as string} className={cn('flex h-6 items-center gap-1.5 rounded-md px-1.5', active ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' : 'text-sidebar-foreground')}>
            <SolarIcon name={icon as string} className={cn('size-3.5', active ? 'text-sidebar-accent-foreground' : 'text-muted-foreground')} />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {count ? <span className="text-muted-foreground text-[10px] tabular-nums">{count}</span> : null}
          </div>
        ))}
        <p className="text-muted-foreground mt-2 mb-0.5 px-1.5 text-[9px] font-medium tracking-wide uppercase">{t('Catégories')}</p>
        {[
          ['sparkles', t('Opportunité')],
          ['receipt', t('Factures')],
          ['newspaper', t('Newsletter')],
        ].map(([icon, label]) => (
          <div key={label} className="text-sidebar-foreground flex h-6 items-center gap-1.5 rounded-md px-1.5">
            <SolarIcon name={icon!} className="text-muted-foreground size-3.5" />
            <span className="truncate">{label}</span>
          </div>
        ))}
      </div>

      <div className="bg-background border-border my-1.5 mr-1.5 flex min-w-0 flex-1 overflow-hidden rounded-lg border">
        <div className="border-border flex w-[55%] min-w-0 flex-col border-r">
          <div className="flex items-baseline gap-1.5 px-3 pt-3 pb-2">
            <span className="truncate text-[13px] font-semibold whitespace-nowrap">{t('Réception')}</span>
            <span className="text-muted-foreground shrink-0 text-[10px] whitespace-nowrap">{tp(21, '{n} non lu', '{n} non lus')}</span>
          </div>
          <div className="bg-muted text-muted-foreground mx-2.5 mb-1.5 flex h-6 items-center gap-1.5 rounded-md px-2 text-[10px]">
            <SolarIcon name="_search" className="size-3" />
            {t('Rechercher…')}
          </div>
          {MAILS.map((mail, i) => (
            <div key={mail.subject} className={cn('relative mx-1.5 rounded-md px-2 py-1.5', i === 0 && 'bg-muted')}>
              {mail.priority ? <span className="bg-warning absolute top-2 bottom-2 left-0 w-0.5 rounded-full" /> : null}
              <div className="flex items-center gap-1.5">
                <span className="bg-primary text-primary-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold">{mail.initials}</span>
                <span className={cn('min-w-0 flex-1 truncate text-[11px]', mail.unread ? 'font-semibold' : 'text-muted-foreground')}>{mail.from}</span>
                <span className="text-muted-foreground text-[9px]">{mail.time}</span>
              </div>
              <p className={cn('mt-0.5 truncate pl-6.5 text-[10.5px]', mail.unread ? 'text-foreground' : 'text-muted-foreground')}>{mail.subject}</p>
              <div className="mt-1 flex gap-1 overflow-hidden pl-6.5">
                {mail.chips.map((chip) => (
                  <span key={chip.label} className="inline-flex h-4 shrink-0 items-center gap-1 rounded-sm px-1 text-[9px] font-medium whitespace-nowrap" style={{ color: chip.color, backgroundColor: `${chip.color}1F` }}>
                    <SolarIcon name={chip.icon} className="size-2.5" />
                    {chip.label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          <p className="text-[12px] leading-tight font-semibold">{t('Demande de devis — application mobile')}</p>
          <div className="bg-card text-card-foreground border-border rounded-md border p-2">
            <p className="text-ai flex items-center gap-1 text-[9px] font-medium tracking-wide uppercase">
              <SolarIcon name="_ai" className="size-3" />
              {t('Résumé IA')}
            </p>
            <p className="mt-1 text-[10px] leading-snug">{t('Budget 40 k€, lancement en mars. Elle attend une proposition cette semaine.')}</p>
          </div>
          <p className="text-muted-foreground text-[10px] leading-relaxed">{t('Bonjour Adam, nous aimerions lancer notre application de réservation au printemps…')}</p>
          <div className="mt-auto flex flex-wrap gap-1.5">
            <span className="bg-primary text-primary-foreground inline-flex h-6 items-center rounded-md px-2.5 text-[10px] font-medium">{t('Répondre')}</span>
            <span className="bg-secondary text-secondary-foreground border-border inline-flex h-6 items-center rounded-md border px-2 text-[10px]">{t('Transférer')}</span>
            <span className="bg-destructive/10 text-destructive inline-flex h-6 items-center rounded-md px-2 text-[10px]">{t('Spam')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
