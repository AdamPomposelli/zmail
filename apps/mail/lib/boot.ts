/**
 * The boot skeleton (public/boot.js) stays on screen from the first paint until the inbox has
 * its mails, so the macOS boot page, the app's first paint and the real UI flow into each other.
 */
type BootController = { set: (progress: number, label: string, cap?: number) => void; error: (message: string | null) => void; done: () => Promise<void> };
declare global {
  interface Window {
    ZMailBoot?: { mount: (root: HTMLElement, initial?: { progress?: number; label?: string; cap?: number; instant?: boolean }) => BootController };
    zmailAppBoot?: BootController;
  }
}

let finished = false;

export function bootStep(progress: number, label: string, cap?: number) {
  if (!finished) window.zmailAppBoot?.set(progress, label, cap);
}

/** Fades the skeleton out once (later calls do nothing). */
export function bootDone() {
  if (finished || typeof window === 'undefined') return;
  finished = true;
  const root = document.getElementById('zmail-boot');
  // Hidden rather than removed: React owns the node.
  void (window.zmailAppBoot?.done() ?? Promise.resolve()).then(() => root?.style.setProperty('display', 'none'));
}

// Never hold the screen hostage: whatever happens, the skeleton leaves after 15 s.
if (typeof window !== 'undefined') setTimeout(bootDone, 15_000);

export {};
