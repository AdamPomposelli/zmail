/**
 * Gestures only the app sees (reading time and depth, a link or an attachment opened, a code
 * copied, a search), for the habits analysis. Fired from anywhere, even outside React (a mail's
 * frame); `useGestureTracker` (mounted once, in the sidebar) sends them to the engine.
 */
export type Gesture = {
  action: 'view' | 'openLink' | 'downloadAttachment' | 'copyOtp' | 'search';
  threadId?: string | null;
  ms?: number;
  meta?: Record<string, string | number | boolean | null>;
};

export const GESTURE_EVENT = 'zmail:gesture';

export const trackGesture = (gesture: Gesture) => window.dispatchEvent(new CustomEvent<Gesture>(GESTURE_EVENT, { detail: gesture }));

/**
 * The conversation on screen keeps counting its reading time until it closes, which is often
 * because of the decision itself (archived, deleted…). Before acting, that time is sent first,
 * so the decision is logged as « read for 40 s », not « never opened ».
 */
const pendingViews = new Map<string, () => void>();

export function registerView(threadId: string, flush: () => void) {
  pendingViews.set(threadId, flush);
  return () => {
    if (pendingViews.get(threadId) === flush) pendingViews.delete(threadId);
  };
}

export const flushViews = (threadIds: string[]) => threadIds.forEach((id) => pendingViews.get(id)?.());
