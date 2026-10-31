import { solar, type IconComponent } from '@/components/ui/solar-icon';
import { cn } from '@/lib/utils';

const KEYS = [
  'flame',
  'star',
  'flag',
  'alarm-clock',
  'zap',
  'target',
  'reply',
  'message-circle',
  'inbox',
  'sparkles',
  'handshake',
  'rocket',
  'crown',
  'key',
  'key-round',
  'shield-check',
  'shield-alert',
  'receipt',
  'credit-card',
  'circle-dollar-sign',
  'landmark',
  'scale',
  'file-text',
  'briefcase',
  'building-2',
  'users',
  'user',
  'heart',
  'house',
  'calendar',
  'newspaper',
  'book-open',
  'megaphone',
  'bell',
  'shopping-bag',
  'gift',
  'package',
  'truck',
  'plane',
  'car',
  'globe',
  'code',
  'bug',
  'wrench',
  'palette',
  'graduation-cap',
  'stethoscope',
  'archive',
  'tag',
] as const;

/** The icons a category can wear, by the name stored in `tags.icon`, drawn in the chosen icon library. */
export const TAG_ICONS: Record<string, IconComponent> = Object.fromEntries(
  KEYS.map((key) => [key, solar(key)]),
);

/**
 * A tag's icon. Tinted with the tag colour by default (chips, pickers). `mono` draws it in
 * currentColor so it follows the row's text tone (sidebar, palette: sober, Linear-like); the
 * colour then only survives as the 6px dot of tags that have no icon.
 */
export function TagIcon({
  icon,
  color,
  className,
  mono = false,
}: {
  icon?: string | null;
  color: string;
  className?: string;
  mono?: boolean;
}) {
  // Your own: an emoji, or an image (PNG, SVG, an animated GIF…) shown as it is.
  const custom = customIcon(icon, className);
  if (custom) return custom;
  const Icon = icon ? TAG_ICONS[icon] : undefined;
  if (!Icon)
    return (
      <span
        className={cn(mono ? 'size-1.5' : 'size-2', 'shrink-0 rounded-full', className)}
        style={{ backgroundColor: color }}
      />
    );
  return <Icon className={cn('size-4 shrink-0', className)} style={mono ? undefined : { color }} />;
}

/**
 * Icons people pick themselves, shared by categories, the fixed views and accounts:
 * « emoji:🎯 » or « image:data:image/… » (an uploaded PNG, JPEG, SVG, WebP or GIF).
 */
export function customIcon(icon: string | null | undefined, className?: string, size = 16) {
  if (icon?.startsWith('emoji:'))
    return (
      <span className={cn('flex shrink-0 items-center justify-center leading-none', className)} style={{ width: size, height: size, fontSize: size * 0.9 }}>
        {icon.slice(6)}
      </span>
    );
  if (icon?.startsWith('image:data:image/')) return <img src={icon.slice(6)} alt="" className={cn('shrink-0 rounded-[3px] object-contain', className)} style={{ width: size, height: size }} />;
  return null;
}
