import { ContextMenu as ContextMenuPrimitive } from 'radix-ui';
import { Check, ChevronRight } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/** Right-click menu in the app's own style (same look as the dropdown menus), never the WebView's. */
const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

const ContextMenuContent = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.Content>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>>(
  ({ className, ...props }, ref) => (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        ref={ref}
        className={cn(
          'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 z-200 min-w-44 overflow-hidden rounded-md border p-1 shadow-md',
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  ),
);
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;

const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & { destructive?: boolean }
>(({ className, destructive, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(
      'focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
      destructive && 'text-destructive focus:text-destructive focus:bg-destructive/10',
      className,
    )}
    {...props}
  />
));
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

const ContextMenuSeparator = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.Separator>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>>(
  ({ className, ...props }, ref) => <ContextMenuPrimitive.Separator ref={ref} className={cn('bg-muted -mx-1 my-1 h-px', className)} {...props} />,
);
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName;

const ContextMenuLabel = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.Label>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>>(
  ({ className, ...props }, ref) => <ContextMenuPrimitive.Label ref={ref} className={cn('text-muted-foreground truncate px-2 py-1 text-[11px] font-medium', className)} {...props} />,
);
ContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName;


const ContextMenuSub = ContextMenuPrimitive.Sub;

const ContextMenuSubTrigger = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger>>(
  ({ className, children, ...props }, ref) => (
    <ContextMenuPrimitive.SubTrigger
      ref={ref}
      className={cn(
        'focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="text-muted-foreground ml-auto" />
    </ContextMenuPrimitive.SubTrigger>
  ),
);
ContextMenuSubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName;

const ContextMenuSubContent = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.SubContent>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>>(
  ({ className, ...props }, ref) => (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent
        ref={ref}
        className={cn(
          'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 z-200 max-h-[60vh] min-w-44 overflow-y-auto rounded-md border p-1 shadow-md',
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  ),
);
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName;

const ContextMenuCheckboxItem = React.forwardRef<React.ElementRef<typeof ContextMenuPrimitive.CheckboxItem>, React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>>(
  ({ className, children, ...props }, ref) => (
    <ContextMenuPrimitive.CheckboxItem
      ref={ref}
      className={cn('focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-7 text-sm outline-none select-none [&_svg]:size-4 [&_svg]:shrink-0', className)}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <Check className="size-3.5" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  ),
);
ContextMenuCheckboxItem.displayName = ContextMenuPrimitive.CheckboxItem.displayName;

export { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuLabel, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent, ContextMenuCheckboxItem };
