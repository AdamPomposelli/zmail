import { useEffect, useState } from 'react';
import { isNativeApp, postNative } from '@/lib/native';

/** The Mac app's updater (Updater.swift), as it reports itself through `zmail:update` events. */
export type AppUpdate = {
  phase: 'idle' | 'checking' | 'upToDate' | 'downloading' | 'preparing' | 'ready' | 'failed' | 'manual';
  current: string;
  version?: string;
  progress: number;
  error?: string;
};

export function useAppUpdate() {
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  useEffect(() => {
    if (!isNativeApp()) return;
    const onUpdate = (e: Event) => setUpdate((e as CustomEvent<AppUpdate>).detail);
    window.addEventListener('zmail:update', onUpdate);
    // A page reload must not lose a download in progress or a ready update.
    postNative({ type: 'getUpdateState' });
    return () => window.removeEventListener('zmail:update', onUpdate);
  }, []);
  return {
    update,
    /** Quits, swaps the app for the new version and opens it (or opens the release page). */
    install: () => postNative({ type: 'installUpdate' }),
    check: () => postNative({ type: 'checkForUpdates' }),
  };
}
