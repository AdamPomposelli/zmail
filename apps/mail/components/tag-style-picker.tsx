import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TAG_ICONS } from '@/lib/tag-icons';
import { useTRPC, type Tag } from '@/lib/trpc';
import { PALETTE, cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { toast } from 'sonner';
import { IconPicker } from '@/components/icon-picker';

/** Icon + colour grid. `value.icon` null means "just a coloured dot". */
export function TagStyleGrid({ value, onChange }: { value: { icon: string | null; color: string }; onChange: (v: { icon: string | null; color: string }) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-10 gap-1">
        <button
          type="button"
          onClick={() => onChange({ ...value, icon: null })}
          className={cn('hover:bg-accent flex size-7 items-center justify-center rounded-md', !value.icon && 'bg-accent ring-border ring-1')}
          title={t('Pastille de couleur')}
          aria-label={t('Pastille de couleur')}
        >
          <span className="size-2 rounded-full" style={{ backgroundColor: value.color }} />
        </button>
        {Object.entries(TAG_ICONS).map(([name, Icon]) => (
          <button
            key={name}
            type="button"
            onClick={() => onChange({ ...value, icon: name })}
            className={cn('hover:bg-accent flex size-7 items-center justify-center rounded-md', value.icon === name && 'bg-accent ring-border ring-1')}
            aria-label={name}
          >
            <Icon className="size-4" style={{ color: value.color }} />
          </button>
        ))}
      </div>
      <div className="grid grid-cols-12 gap-1">
        {PALETTE.map((c) => (
          <button key={c} type="button" onClick={() => onChange({ ...value, color: c })} className="flex aspect-square w-full items-center justify-center rounded-full" style={{ backgroundColor: c }} aria-label={c}>
            {/* White on a user-data swatch (not a theme surface): readable on every palette colour. */}
            {value.color === c ? <Check className="size-3.5 text-white" /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Popover to restyle a tag in place (sidebar, settings), saved immediately. */
export function TagStylePopover({ tag, children, align = 'start', open, onOpenChange }: { tag: Tag; children: ReactNode; align?: 'start' | 'end'; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const save = useMutation(trpc.catalog.saveTag.mutationOptions({ onSuccess: () => void queryClient.invalidateQueries({ queryKey: trpc.catalog.tags.queryKey() }), onError: (e) => toast.error(e.message) }));
  const write = (patch: { icon?: string | null; color?: string }) => save.mutate({ id: tag.id, name: tag.name, description: tag.description, color: patch.color ?? tag.color, icon: patch.icon !== undefined ? patch.icon : (tag.icon ?? null) });
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} side="right" className="w-auto p-3">
        <IconPicker
          title={tag.kind === 'system' ? t(tag.name) : tag.name}
          value={tag.icon ?? null}
          color={tag.color}
          dot
          fallback={<span className="size-2.5 rounded-full" style={{ backgroundColor: tag.color }} />}
          onChange={(icon) => write({ icon })}
          onColor={(color) => write({ color })}
        />
      </PopoverContent>
    </Popover>
  );
}
