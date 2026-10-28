import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Composer } from './composer';
import { t } from '@/lib/i18n';

export function ComposeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showOverlay className="max-w-[680px] border-0 bg-transparent p-0 shadow-none">
        <DialogTitle className="sr-only">{t('Nouveau message')}</DialogTitle>
        {open ? <Composer mode="new" onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
