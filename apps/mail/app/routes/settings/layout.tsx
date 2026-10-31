import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router';
import { highlight } from '@/lib/reveal';

/** Scrolls to the card or row named in the URL hash (settings search) and briefly highlights it. */
function useScrollToHash(scroller: React.RefObject<HTMLDivElement | null>) {
  const { pathname, hash, key } = useLocation();
  useEffect(() => {
    const id = decodeURIComponent(hash.slice(1));
    if (!id) {
      scroller.current?.scrollTo({ top: 0 });
      return;
    }
    // Pages render their data asynchronously: wait for the target to exist.
    let frame = 0;
    const started = performance.now();
    const seek = () => {
      const target = document.getElementById(id);
      if (!target) {
        if (performance.now() - started < 2500) frame = requestAnimationFrame(seek);
        return;
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      highlight(target);
    };
    seek();
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash, key, scroller]);
}

/** Navigation and search live in the app sidebar, which switches to the settings menu here. */
export default function SettingsLayout() {
  const scroller = useRef<HTMLDivElement>(null);
  useScrollToHash(scroller);
  return (
    <div ref={scroller} className="scrollbar scrollbar-w-1 scrollbar-thumb-black/10 dark:scrollbar-thumb-white/10 h-full overflow-y-auto">
      <div data-drag-region className="h-12" />
      <Outlet />
    </div>
  );
}
