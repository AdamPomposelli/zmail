import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Anchor id for a card or row, so the settings search can scroll to it. */
export const settingsAnchor = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function SettingsPage({ title, description, actions, children, wide = false }: { title: string; description?: string; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn('mx-auto w-full px-8 pt-2 pb-16', wide ? 'max-w-[1180px]' : 'max-w-[760px]')}>
      <div className="mb-6 flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-muted-foreground mt-1 text-[13.5px] leading-relaxed">{description}</p> : null}
        </div>
        {actions}
      </div>
      <div className="space-y-6">{children}</div>
    </div>
  );
}

export function Card({ id, title, description, children, className, action }: { id?: string; title?: string; description?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section id={id ?? (title ? settingsAnchor(title) : undefined)} className={cn('bg-card text-card-foreground border-border scroll-mt-4 rounded-xl border', className)}>
      {title ? (
        <header className="flex items-start gap-3 border-border border-b px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold">{title}</h2>
            {description ? <p className="text-muted-foreground mt-0.5 text-[12.5px]">{description}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function Row({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div id={settingsAnchor(label)} className="flex scroll-mt-4 items-center gap-4 rounded-lg py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium">{label}</p>
        {description ? <p className="text-muted-foreground text-[12.5px]">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

type SettingsButtonProps = React.ComponentProps<'button'>;

/** Compact primary action of a settings page — the shadcn `default` Button at settings density. */
export function PrimaryButton({ className, type = 'button', ...props }: SettingsButtonProps) {
  return <Button {...props} type={type} variant="default" className={cn('h-8 gap-1.5 rounded-lg px-3 py-0 text-[13px]', className)} />;
}

/** Secondary, outlined action — the shadcn `ghost` Button with a hairline border. */
export function GhostButton({ className, type = 'button', ...props }: SettingsButtonProps) {
  return <Button {...props} type={type} variant="ghost" className={cn('text-foreground/80 ring-border hover:text-foreground h-8 gap-1.5 rounded-lg px-3 py-0 text-[13px] font-normal ring-1 [&_svg]:size-3.5', className)} />;
}

export function ColorPicker({ value, onChange, colors }: { value: string; onChange: (c: string) => void; colors: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {colors.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} className={cn('ring-offset-card size-6 rounded-full ring-offset-2 transition', value === c && 'ring-2')} style={{ backgroundColor: c, ['--tw-ring-color' as string]: c }} aria-label={c} />
      ))}
    </div>
  );
}
