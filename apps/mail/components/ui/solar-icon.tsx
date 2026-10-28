import type { CSSProperties } from 'react';
import { iconFor, useIconLibrary } from '@/lib/icon-library';
import { cn } from '@/lib/utils';

export type IconComponent = (props: { className?: string; style?: CSSProperties }) => React.JSX.Element;

/**
 * Renders a ZMail icon by key (`flame`, `_inbox`…) in the icon library chosen in
 * Settings → Appearance (Akar Icons by default). The name is historical: Solar was the only set.
 */
export function SolarIcon({ name, className, style }: { name: string; className?: string; style?: CSSProperties }) {
  const library = useIconLibrary();
  const icon = iconFor(library, name);
  if (!icon) return <span className={cn('inline-block size-4 shrink-0', className)} aria-hidden />;
  return (
    <svg
      viewBox={`0 0 ${icon.w} ${icon.h}`}
      className={cn('zm-icon size-4 shrink-0', className)}
      data-icons={library}
      style={style}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  );
}

/** A component with the lucide shape (`<Icon className />`), for icon maps and NavItem slots. */
export const solar = (name: string): IconComponent => {
  const Icon: IconComponent = (props) => <SolarIcon name={name} {...props} />;
  return Icon;
};
