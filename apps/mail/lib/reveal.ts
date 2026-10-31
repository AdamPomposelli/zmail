/** The brief blue glow that points at an element (settings search, a mail shown from the overview). */
export const HIGHLIGHT: Keyframe[] = [
  { backgroundColor: 'rgba(0,111,254,0.14)', boxShadow: '0 0 0 4px rgba(0,111,254,0.14)' },
  { backgroundColor: 'transparent', boxShadow: '0 0 0 4px transparent' },
];

export function highlight(element: Element) {
  element.animate(HIGHLIGHT, { duration: 1800, delay: 250, easing: 'ease-out' });
}

/**
 * Scrolls the mail list to a conversation and makes its row glow, so it can be spotted among
 * the others. Waits a moment for the row to render (the list may still be loading).
 */
export function revealThread(threadId: string) {
  // Opening the mail re-renders the list first: start once that is done, or the scroll is lost.
  setTimeout(() => seekThread(threadId), 220);
}

function seekThread(threadId: string) {
  const started = performance.now();
  const seek = () => {
    const row = document.querySelector(`[data-thread-id="${CSS.escape(threadId)}"]`);
    if (!row) {
      if (performance.now() - started < 2500) requestAnimationFrame(seek);
      return;
    }
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlight(row.firstElementChild ?? row);
  };
  seek();
}
