import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';

export type DropTarget = { list: string; index: number };
type Drag = { key: string; list: string; target: DropTarget | null; x: number; y: number; dx: number; dy: number; width: number; html: string };

/**
 * Drag & drop for sidebar rows, built on pointer events rather than the HTML5 DnD API:
 * it behaves the same in WKWebView (the macOS app), Safari and Chromium, shows a ghost
 * that follows the pointer, and never fires the row's link at the end of a drag.
 * Lists are elements marked `data-drop-list="<id>"`; rows carry `data-drag-key`.
 */
export function useSidebarDrag({ canDrop, onDrop }: { canDrop: (key: string, list: string) => boolean; onDrop: (key: string, from: string, to: DropTarget) => void }) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const live = useRef<Drag | null>(null);
  const callbacks = useRef({ canDrop, onDrop });
  callbacks.current = { canDrop, onDrop };

  const targetAt = useCallback((key: string, x: number, y: number): DropTarget | null => {
    // Lists can nest (a folder's subfolders): the innermost list under the pointer that accepts
    // this row wins, and only its own rows count, not those of the lists inside it.
    const lists: HTMLElement[] = [];
    for (let el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-list]'); el; el = el.parentElement?.closest<HTMLElement>('[data-drop-list]')) lists.push(el);
    const list = lists.find((el) => callbacks.current.canDrop(key, el.dataset.dropList!));
    const id = list?.dataset.dropList;
    if (!list || !id) return null;
    const rows = [...list.querySelectorAll<HTMLElement>('[data-drag-key]')].filter((row) => row.dataset.dragKey !== key && row.closest('[data-drop-list]') === list);
    const index = rows.filter((row) => {
      const box = row.getBoundingClientRect();
      return box.top + box.height / 2 < y;
    }).length;
    return { list: id, index };
  }, []);

  const onPointerDown = useCallback(
    (key: string, list: string) => (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, [data-no-drag]')) return;
      const row = event.currentTarget;
      const start = { x: event.clientX, y: event.clientY };
      let scroller: HTMLElement | null = row.parentElement;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      let active = false;

      const move = (e: PointerEvent) => {
        if (!active) {
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
          active = true;
          const box = row.getBoundingClientRect();
          live.current = { key, list, target: null, x: e.clientX, y: e.clientY, dx: start.x - box.left, dy: start.y - box.top, width: box.width, html: row.outerHTML };
          document.body.style.cursor = 'grabbing';
          document.body.style.userSelect = 'none';
        }
        e.preventDefault();
        // Near the top or bottom of the scrolling sidebar, it scrolls: long folder lists stay reachable.
        if (scroller) {
          const box = scroller.getBoundingClientRect();
          const edge = e.clientY < box.top + 36 ? -1 : e.clientY > box.bottom - 36 ? 1 : 0;
          if (edge) scroller.scrollBy(0, edge * 14);
        }
        live.current = { ...live.current!, x: e.clientX, y: e.clientY, target: targetAt(key, e.clientX, e.clientY) };
        setDrag(live.current);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (!active) return;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // The pointerup is followed by a click on the row's link: swallow it once.
        const swallow = (e: MouseEvent) => (e.preventDefault(), e.stopPropagation());
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
        const done = live.current;
        live.current = null;
        setDrag(null);
        if (done?.target) callbacks.current.onDrop(done.key, done.list, done.target);
      };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    [targetAt],
  );

  useEffect(() => () => void ((document.body.style.cursor = ''), (document.body.style.userSelect = '')), []);

  const ghost = drag
    ? createPortal(
        <div
          className="bg-sidebar border-border pointer-events-none fixed z-[300] rounded-lg border opacity-95 shadow-lg"
          style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.width }}
          dangerouslySetInnerHTML={{ __html: drag.html }}
          aria-hidden
        />,
        document.body,
      )
    : null;

  return { drag, onPointerDown, ghost };
}
