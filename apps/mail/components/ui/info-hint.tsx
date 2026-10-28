import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/** A small (i) next to a label; hovering it explains the field in plain words. */
export function InfoHint({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>
        <button type="button" tabIndex={-1} className={cn('text-muted-foreground/70 hover:text-foreground inline-flex size-4 items-center justify-center rounded-full align-middle transition', className)} aria-label={t('Plus d’informations')}>
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[280px] text-[12.5px] leading-relaxed font-normal">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
