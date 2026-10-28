import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { copyText } from '@/lib/native';
import { PrimaryButton } from './ui';
import { cn } from '@/lib/utils';
import { intlLocale, t } from '@/lib/i18n';
import { toast } from 'sonner';

/** Copy-to-clipboard icon button with a short confirmation state. */
export function CopyButton({
  value,
  label = t('Copier'),
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={async () => {
        await copyText(value);
        setCopied(true);
        toast.success(t('Copié'));
        setTimeout(() => setCopied(false), 1500);
      }}
      className={cn(
        'text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex size-7 shrink-0 items-center justify-center rounded-md transition',
        className,
      )}
    >
      {copied ? <Check className="text-success size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/** A single value (URL, path) in mono with a copy button. */
export function CopyField({ value, className }: { value: string; className?: string }) {
  return (
    <div
      className={cn(
        'bg-muted border-border flex min-w-0 items-center gap-1 rounded-lg border py-1 pl-3 pr-1',
        className,
      )}
    >
      <code className="min-w-0 flex-1 truncate font-mono text-[12px]">{value}</code>
      <CopyButton value={value} />
    </div>
  );
}

/** Multi-line snippet (command, JSON, TOML) with a copy button. */
export function CodeBlock({
  code,
  label,
  className,
}: {
  code: string;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn('bg-muted border-border relative rounded-lg border', className)}>
      {label ? (
        <p className="text-muted-foreground border-border border-b px-3 py-1.5 text-[11.5px]">
          {label}
        </p>
      ) : null}
      <pre className="overflow-x-auto whitespace-pre-wrap break-all py-2.5 pl-3 pr-10 font-mono text-[12px] leading-relaxed">
        {code}
      </pre>
      <CopyButton value={code} className="absolute right-1.5 top-1.5" />
    </div>
  );
}

/** Shown right after a key was created: the only time the full secret is visible. */
export function SecretDialog({
  open,
  onClose,
  title,
  description,
  secret,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  secret: string;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent showOverlay className="max-w-[560px]">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <div className="space-y-3">
          <CodeBlock code={secret} />
          <p className="text-warning bg-warning/10 border-warning/30 flex items-start gap-2 rounded-lg border px-3 py-2 text-[12.5px]">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            {t('Copiez-la maintenant : ZMail n’en garde qu’une empreinte et ne pourra plus l’afficher.')}
          </p>
          {children}
          <div className="flex justify-end">
            <PrimaryButton onClick={onClose}>{t('J’ai copié')}</PrimaryButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const dateFormat = new Intl.DateTimeFormat(intlLocale, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const relative = new Intl.RelativeTimeFormat(intlLocale, { numeric: 'auto' });

export const formatDate = (ms: number) => dateFormat.format(ms);

export function formatLastUsed(ms: number | null) {
  if (!ms) return t('Jamais utilisée');
  const minutes = Math.round((ms - Date.now()) / 60_000);
  if (minutes > -60) return relative.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours > -24) return relative.format(hours, 'hour');
  return relative.format(Math.round(hours / 24), 'day');
}
