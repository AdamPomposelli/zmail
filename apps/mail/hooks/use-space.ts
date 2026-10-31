import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import { useTRPC, type Outputs } from '@/lib/trpc';

export type Space = Outputs['spaces']['list'][number];
export const MAIN_SPACE = 'main';

/**
 * The space being looked at (as in Arc): its inbox, favourites, subscriptions and categories.
 * Kept per Mac (local storage); a space that no longer exists falls back to « Principal ».
 */
const KEY = 'zmail.space';
let current = (() => {
  try {
    return localStorage.getItem(KEY) || MAIN_SPACE;
  } catch {
    return MAIN_SPACE;
  }
})();
const listeners = new Set<() => void>();
function setCurrent(id: string) {
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // private mode: the choice lasts until the window closes
  }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

export function useSpaces() {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.spaces.list.queryOptions());
  const spaces = data ?? [];
  const stored = useSyncExternalStore(subscribe, () => current, () => MAIN_SPACE);
  const space = spaces.find((s) => s.id === stored) ?? spaces.find((s) => s.id === MAIN_SPACE) ?? null;
  const spaceId = space?.id ?? MAIN_SPACE;
  const select = useCallback((id: string) => setCurrent(id), []);
  /** Next or previous space (swipe, ⌃→ / ⌃←), wrapping around. */
  const step = useCallback(
    (dir: 1 | -1) => {
      if (spaces.length < 2) return;
      const i = spaces.findIndex((s) => s.id === spaceId);
      setCurrent(spaces[(i + dir + spaces.length) % spaces.length]!.id);
    },
    [spaces, spaceId],
  );
  return { spaces, space, spaceId, select, step };
}

/**
 * The space a piece of the sidebar is drawn for. The sidebar draws the spaces on either side of
 * the current one too, so a two-finger swipe slides real content in (as in Arc).
 */
export const SpaceScope = createContext<string | null>(null);

export function useScopedSpaceId() {
  const { spaceId } = useSpaces();
  return useContext(SpaceScope) ?? spaceId;
}
