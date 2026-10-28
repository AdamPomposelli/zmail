import { useId } from 'react';
import { BRAND_LOGOS, type Brand } from '@/lib/brand-logos';
import { cn } from '@/lib/utils';

/** Mail provider presets (engine ids) → logo. */
const PROVIDER_BRANDS: Record<string, Brand> = {
  gmail: 'gmail',
  'google-workspace': 'google',
  icloud: 'icloud',
  outlook: 'outlook',
  'mailbox-org': 'mailbox-org',
  namecheap: 'namecheap',
  fastmail: 'fastmail',
  ovh: 'ovh',
  zoho: 'zoho',
};

/** AI services → logo. */
/** Brands drawn as SVG marks, plus Apple Intelligence drawn from Apple's own icon. */
export type LogoBrand = Brand | 'apple-intelligence';

const SERVICE_BRANDS: Record<string, LogoBrand> = {
  apple: 'apple-intelligence',
  zenmux: 'zenmux',
  openrouter: 'openrouter',
  openai: 'openai',
  ollama: 'ollama',
};

/** Model id prefixes (`vendor/model`) → logo of the lab behind the model. */
const MODEL_VENDORS: [RegExp, LogoBrand][] = [
  [/^(openai\/|gpt-|o\d)/i, 'openai'],
  [/^(google\/|gemini|gemma)/i, 'gemini'],
  [/^(anthropic\/|claude)/i, 'anthropic'],
  [/^deepseek/i, 'deepseek'],
  [/^(qwen|alibaba)/i, 'qwen'],
  [/^mistral/i, 'mistral'],
  [/^(meta|llama)/i, 'meta'],
  [/^xiaomi/i, 'xiaomi'],
  [/^bytedance/i, 'bytedance'],
  [/^apple/i, 'apple-intelligence'],
];

/** Marks hard-coded in black, inverted in dark mode (the tile follows the theme too). */
const DARK_MARKS = new Set<Brand>(['zenmux']);

export const brandForProvider = (presetId: string | null | undefined): Brand | null => (presetId ? (PROVIDER_BRANDS[presetId] ?? null) : null);
export const brandForService = (kind: string | null | undefined): LogoBrand | null => (kind ? (SERVICE_BRANDS[kind] ?? null) : null);
export const brandForModel = (model: string | null | undefined): LogoBrand | null => (model ? (MODEL_VENDORS.find(([re]) => re.test(model))?.[1] ?? null) : null);

/**
 * A brand's real logo. Bare by default (the mark alone, for rows and small sizes on the
 * sidebar/background). `tile` puts it on a theme-aware card square, like an app icon, for
 * larger places (settings); the tile follows the theme so it never shows a harsh white edge.
 */
export function BrandLogo({ brand, size = 20, tile = false, className, fallback }: { brand: LogoBrand | null; size?: number; tile?: boolean; className?: string; fallback?: string }) {
  // Gradient ids inside logos must be unique per instance.
  const uid = useId().replace(/:/g, '');
  if (brand === 'apple-intelligence') {
    // Apple's own app icon: it already is a rounded tile, so it is never wrapped in ours.
    const px = tile ? size : Math.round(size * 1.1);
    return <img src="/brands/apple-intelligence.png" alt="Apple Intelligence" width={px} height={px} className={cn('inline-block shrink-0 rounded-[22%]', className)} draggable={false} />;
  }
  if (!brand) {
    if (!fallback) return null;
    return (
      <span
        className={cn('inline-flex shrink-0 items-center justify-center rounded-md bg-muted font-semibold text-muted-foreground', className)}
        style={{ width: size, height: size, fontSize: size * 0.45 }}
        aria-hidden
      >
        {fallback.charAt(0).toUpperCase()}
      </span>
    );
  }
  const logo = BRAND_LOGOS[brand];
  const body = logo.body.replace(/id="([^"]+)"/g, `id="$1-${uid}"`).replace(/url\(#([^)]+)\)/g, `url(#$1-${uid})`).replace(/href="#([^"]+)"/g, `href="#$1-${uid}"`);
  const svg = (
    <svg
      viewBox={logo.viewBox}
      width={tile ? size * 0.62 : size}
      height={tile ? size * 0.62 : size}
      fill="currentColor"
      // Official brand colour when the mark has one; otherwise currentColor follows the theme.
      style={logo.color ? { color: logo.color } : undefined}
      role="img"
      aria-label={logo.label}
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
  const invert = DARK_MARKS.has(brand) && 'dark:invert';
  if (!tile) return <span className={cn('inline-flex shrink-0', invert, className)}>{svg}</span>;
  return (
    <span
      className={cn('bg-card text-card-foreground border-border inline-flex shrink-0 items-center justify-center rounded-md border shadow-xs', className)}
      style={{ width: size, height: size }}
      title={logo.label}
    >
      <span className={cn('inline-flex', invert)}>{svg}</span>
    </span>
  );
}
