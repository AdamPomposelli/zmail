type NativeMessage = { type: 'setBadge'; count: number } | { type: 'setAppearance'; mode: string; css: string } | { type: 'dictation'; action: 'start' | 'stop'; language?: string } | { type: 'copy'; text: string } | { type: 'openExternal'; url: string } | { type: 'startDrag' } | { type: 'zoomWindow' } | { type: 'setLocale'; locale: 'fr' | 'en' } | { type: 'getUpdateState' } | { type: 'checkForUpdates' } | { type: 'installUpdate' };

declare global {
  interface Window {
    zmailNative?: { platform: 'macos'; version: string; bridgeUrl?: string; bridgeToken?: string; postMessage?: (msg: NativeMessage) => void };
    webkit?: { messageHandlers?: { zmail?: { postMessage: (msg: NativeMessage) => void } } };
  }
}

/** True inside ZMail.app (WKWebView), false in a regular browser during development. */
export const isNativeApp = () => typeof window !== 'undefined' && Boolean(window.webkit?.messageHandlers?.zmail);

export function postNative(message: NativeMessage) {
  window.webkit?.messageHandlers?.zmail?.postMessage(message);
}

/** Calls the macOS app's own API (loopback, with the token the app injects). Null outside the app. */
export async function nativeBridge<T>(path: string, body?: unknown): Promise<T | null> {
  const native = typeof window === 'undefined' ? undefined : window.zmailNative;
  if (!native?.bridgeUrl || !native.bridgeToken) return null;
  const res = await fetch(`${native.bridgeUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${native.bridgeToken}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`bridge ${res.status}`);
  return (await res.json()) as T;
}

export async function copyText(text: string) {
  if (isNativeApp()) {
    postNative({ type: 'copy', text });
    return;
  }
  await navigator.clipboard.writeText(text);
}

export function openExternal(url: string) {
  if (isNativeApp()) postNative({ type: 'openExternal', url });
  else window.open(url, '_blank', 'noopener,noreferrer');
}
