import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { t, tp } from '@/lib/i18n';

/**
 * Dragging conversations from the list onto a folder of the sidebar (pointer events, so it works
 * the same in the macOS app's WebView and in a browser).
 *
 * While a drag is on, only the folders of the conversations' own account stay alive: every other
 * sidebar row (other accounts, categories, views) is greyed and ignores the pointer. Sidebar rows
 * declare themselves with `data-nav-row`, and as targets with `data-drop-account` plus
 * `data-drop-mailbox` (a folder) or `data-drop-special` (inbox, archive, junk, trash).
 * The space switcher's icons (`data-drop-space`) take conversations of any account.
 */
export type MailDropTarget = { mailboxId: string | null; special: string | null; spaceId: string | null; label: string };
type DragState = { count: number; subject: string; accountId: string; x: number; y: number; over: string | null };

let state: DragState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

export const isMailDragging = () => state !== null;

function targetAt(x: number, y: number, accountId: string): HTMLElement | null {
  const space = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-space]');
  if (space) return space;
  const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-account]');
  if (!row || row.dataset.dropAccount !== accountId) return null;
  return row.dataset.dropMailbox || row.dataset.dropSpecial ? row : null;
}

/** Starts a drag at the pointer's position; `onDrop` runs when released over a valid folder. */
export function startMailDrag(info: { ids: string[]; accountId: string; subject: string; x: number; y: number }, onDrop: (target: MailDropTarget) => void) {
  const { accountId } = info;
  state = { count: info.ids.length, subject: info.subject, accountId, x: info.x, y: info.y, over: null };
  // Everything that cannot receive these conversations goes grey and inert.
  for (const row of document.querySelectorAll<HTMLElement>('[data-nav-row]')) {
    if (row.dataset.dropAccount !== accountId) row.dataset.dragOff = '';
  }
  document.body.dataset.mailDrag = '';
  document.body.style.userSelect = 'none';
  window.dispatchEvent(new CustomEvent('zmail:mail-drag-start', { detail: { accountId } }));
  emit();

  // Near the top or bottom of the sidebar, it scrolls: folders further down stay reachable.
  let scroller: HTMLElement | null = document.querySelector<HTMLElement>('[data-nav-row]');
  while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  let pointer = { x: info.x, y: info.y };
  let frame = 0;
  const autoscroll = () => {
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      const inside = pointer.x >= box.left && pointer.x <= box.right;
      const edge = !inside ? 0 : pointer.y < box.top + 48 ? -1 : pointer.y > box.bottom - 48 ? 1 : 0;
      if (edge) scroller.scrollBy(0, edge * 10);
    }
    frame = requestAnimationFrame(autoscroll);
  };
  frame = requestAnimationFrame(autoscroll);

  let over: HTMLElement | null = null;
  const move = (e: PointerEvent) => {
    e.preventDefault();
    pointer = { x: e.clientX, y: e.clientY };
    const next = targetAt(e.clientX, e.clientY, accountId);
    if (next !== over) {
      if (over) delete over.dataset.dragOver;
      if (next) next.dataset.dragOver = '';
      over = next;
    }
    state = { ...state!, x: e.clientX, y: e.clientY, over: next?.dataset.dropLabel ?? null };
    emit();
  };
  const up = (e: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    cancelAnimationFrame(frame);
    // The folder that is lit up is where it goes: what the person sees, even if the sidebar moved.
    const target = e.type === 'pointerup' ? (over ?? targetAt(e.clientX, e.clientY, accountId)) : null;
    for (const row of document.querySelectorAll<HTMLElement>('[data-drag-off], [data-drag-over]')) {
      delete row.dataset.dragOff;
      delete row.dataset.dragOver;
    }
    delete document.body.dataset.mailDrag;
    document.body.style.userSelect = '';
    state = null;
    emit();
    // The release must not also click the row or the folder under the pointer.
    const swallow = (ev: MouseEvent) => (ev.preventDefault(), ev.stopPropagation());
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    if (target) onDrop({ mailboxId: target.dataset.dropMailbox ?? null, special: target.dataset.dropSpecial ?? null, spaceId: target.dataset.dropSpace ?? null, label: target.dataset.dropLabel ?? '' });
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/** The card that follows the pointer: what is moving, and where it would land. */
export function MailDragGhost() {
  const drag = useSyncExternalStore(subscribe, () => state, () => null);
  if (!drag) return null;
  return createPortal(
    <div
      className="bg-popover text-popover-foreground border-border pointer-events-none fixed z-[300] max-w-[260px] rounded-lg border px-3 py-2 shadow-lg"
      style={{ left: drag.x + 14, top: drag.y + 10 }}
      aria-hidden
    >
      <p className="truncate text-[12.5px] font-medium">{drag.count > 1 ? tp(drag.count, '{n} conversation', '{n} conversations') : drag.subject || t('(sans objet)')}</p>
      <p className={drag.over ? 'text-primary text-[11.5px]' : 'text-muted-foreground text-[11.5px]'}>{drag.over ? t('Déplacer dans {folder}', { folder: drag.over }) : t('Déposez sur un dossier de ce compte ou sur un espace')}</p>
    </div>,
    document.body,
  );
}
