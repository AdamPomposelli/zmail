/**
 * The icons people pick in the sidebar (categories, fixed views, accounts): a library icon's
 * name (« icon:<name> » for accounts), a brand logo, an emoji, or a small image as a data URL
 * (PNG, JPEG, SVG, WebP, GIF, favicon). Anything else is refused: these values are rendered.
 */
export function isIconValue(value: string, opts: { prefixed?: boolean } = {}) {
  if (value.length > 400_000) return false;
  if (/^emoji:\p{Extended_Pictographic}[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}]{0,15}$/u.test(value)) return true;
  if (/^emoji:[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(value)) return true;
  if (/^image:data:image\/(png|jpeg|svg\+xml|webp|gif|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=]+$/.test(value)) return true;
  return opts.prefixed ? /^(icon|brand):[a-z0-9-]+$/.test(value) : /^[a-z0-9-]+$/.test(value);
}
