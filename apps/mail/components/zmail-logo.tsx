import { APP_BRAND } from '@/lib/app-brand';
import { cn } from '@/lib/utils';

/** ZMail's app icon, the tile from Brand/ (see lib/app-brand.ts). */
export function ZMailLogo({ size = 36, className }: { size?: number; className?: string }) {
  return <img src={APP_BRAND.icon} alt={APP_BRAND.name} width={size} height={size} className={cn('inline-block shrink-0 select-none', className)} draggable={false} />;
}
