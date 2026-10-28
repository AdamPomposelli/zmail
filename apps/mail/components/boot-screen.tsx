import { useEffect, useRef } from 'react';

/** The boot skeleton inside React (e.g. while the engine restarts), driven by public/boot.js. */
export function BootScreen({ progress, label, cap }: { progress: number; label: string; cap?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<NonNullable<typeof window.ZMailBoot>['mount']> | null>(null);
  useEffect(() => {
    if (ref.current && window.ZMailBoot && !controller.current) controller.current = window.ZMailBoot.mount(ref.current, { progress, label, cap });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => controller.current?.set(progress, label, cap), [progress, label, cap]);
  return <div ref={ref} className="zb" />;
}
