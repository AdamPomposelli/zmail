/**
 * Themes in the shadcn/ui variable format, the one tweakcn.com edits and exports.
 * The 42 presets come from tweakcn (https://github.com/jnsahaj/tweakcn, Apache-2.0),
 * converted once to JSON; "ZMail" is our own default and mirrors app/globals.css.
 */
import TWEAKCN from './presets.json';
import { t } from '@/lib/i18n';

export type ThemeStyles = Record<string, string>;
export type ThemePreset = { id: string; label: string; light: ThemeStyles; dark: ThemeStyles; custom?: boolean };

export const DEFAULT_THEME_ID = 'zmail';
export const CSS_KEY = 'zmail.theme.css';

const ZMAIL: ThemePreset = {
  id: DEFAULT_THEME_ID,
  label: 'ZMail',
  // Empty: globals.css already holds these values, so the default needs no override.
  light: {},
  dark: {},
};

export const PRESETS: ThemePreset[] = [ZMAIL, ...(TWEAKCN as ThemePreset[])];

/** Variables a theme may set; anything else in pasted CSS is ignored. */
const KEYS = new Set([
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground', 'primary', 'primary-foreground',
  'secondary', 'secondary-foreground', 'muted', 'muted-foreground', 'accent', 'accent-foreground', 'destructive',
  'destructive-foreground', 'border', 'input', 'ring', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'sidebar',
  'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground', 'sidebar-accent', 'sidebar-accent-foreground',
  'sidebar-border', 'sidebar-ring', 'font-sans', 'font-serif', 'font-mono', 'radius', 'letter-spacing', 'spacing',
  'shadow-color', 'shadow-opacity', 'shadow-blur', 'shadow-spread', 'shadow-offset-x', 'shadow-offset-y',
]);

const SYSTEM_FONTS = /^(geist|geist mono|inter var|system-ui|-apple-system|blinkmacsystemfont|ui-sans-serif|ui-serif|ui-monospace|sans-serif|serif|monospace|georgia|times new roman|courier new|menlo|monaco|arial|helvetica|sfmono-regular|segoe ui)$/i;

/** First family of a CSS font stack, when it must be fetched from Google Fonts. */
function webFont(stack: string | undefined) {
  const first = stack?.split(',')[0]?.trim().replace(/^["']|["']$/g, '');
  return first && !SYSTEM_FONTS.test(first) ? first : null;
}

function block(selector: string, styles: ThemeStyles) {
  const lines = Object.entries(styles)
    .filter(([key, value]) => KEYS.has(key) && /^[^;{}<>]+$/.test(value))
    .map(([key, value]) => `  --${key}: ${value};`);
  return lines.length ? `${selector} {\n${lines.join('\n')}\n}` : '';
}

/** Applies a theme over the defaults: one <style> for both modes, so light/dark switching stays instant. */
export function applyTheme(preset: ThemePreset) {
  if (typeof document === 'undefined') return;
  const css = [block(':root', preset.light), block('.dark', preset.dark)].filter(Boolean).join('\n');
  let style = document.getElementById('zmail-theme') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'zmail-theme';
    document.head.appendChild(style);
  }
  style.textContent = css;
  try {
    // Read back by the inline script in root.tsx, so the next launch paints the theme at once.
    localStorage.setItem(CSS_KEY, css);
  } catch {
    // Storage unavailable: the theme is still applied for this session.
  }

  const fonts = [...new Set([preset.light, preset.dark].flatMap((s) => [webFont(s['font-sans']), webFont(s['font-serif']), webFont(s['font-mono'])]).filter((f): f is string => Boolean(f)))];
  let link = document.getElementById('zmail-theme-fonts') as HTMLLinkElement | null;
  if (!fonts.length) return link?.remove();
  const href = `https://fonts.googleapis.com/css2?${fonts.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`).join('&')}&display=swap`;
  if (!link) {
    link = document.createElement('link');
    link.id = 'zmail-theme-fonts';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  if (link.href !== href) link.href = href;
}

/**
 * Reads the CSS that tweakcn's "Code" button exports (`:root { --x: … } .dark { … }`),
 * with or without the `@theme inline` part. Returns null when nothing usable is found.
 */
export function parseThemeCss(css: string, label = t('Thème importé')): ThemePreset | null {
  const read = (selector: RegExp) => {
    const body = css.match(selector)?.[1] ?? '';
    const styles: ThemeStyles = {};
    for (const [, key, value] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) if (KEYS.has(key!)) styles[key!] = value!.trim();
    return styles;
  };
  const light = read(/:root\s*\{([^}]*)\}/);
  const dark = read(/\.dark\s*\{([^}]*)\}/);
  if (!Object.keys(light).length && !Object.keys(dark).length) return null;
  const common = Object.fromEntries(Object.entries(light).filter(([k]) => /^(font-|radius|letter-spacing|spacing|shadow-)/.test(k)));
  return { id: `custom-${Date.now().toString(36)}`, label, light, dark: { ...common, ...dark }, custom: true };
}

/** A few colours to preview a theme in the picker. */
export function swatches(preset: ThemePreset, mode: 'light' | 'dark') {
  const s = mode === 'dark' ? preset.dark : preset.light;
  const fallback = mode === 'dark' ? { background: '#1a1a1b', primary: '#2f86ff', secondary: '#27272a', accent: '#29292c', foreground: '#f4f4f5' } : { background: '#ffffff', primary: '#006ffe', secondary: '#f4f4f5', accent: '#f0f0f2', foreground: '#0a0a0b' };
  const pick = (key: keyof typeof fallback) => s[key] ?? fallback[key];
  return { background: pick('background'), primary: pick('primary'), secondary: pick('secondary'), accent: pick('accent'), foreground: pick('foreground') };
}

const STORAGE_KEY = 'zmail.theme';

/** The chosen theme is kept locally for an instant first paint, and in the engine to survive reinstalls. */
export function storedTheme(): ThemePreset {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ThemePreset;
  } catch {
    // Private mode or corrupted value: fall back to the default.
  }
  return PRESETS[0]!;
}

export function rememberTheme(preset: ThemePreset) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preset));
  } catch {
    // Not fatal: the engine copy still restores it.
  }
}
