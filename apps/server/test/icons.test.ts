import { describe, expect, it } from 'vitest';
import { isIconValue } from '../src/lib/icons';

/** Icons people pick for categories, fixed views and accounts: rendered, so checked. */
describe('custom icons', () => {
  it('accepts library icons, emoji (flags and skin tones too) and small images, GIFs included', () => {
    for (const ok of ['receipt', 'emoji:🎯', 'emoji:🇫🇷', 'emoji:👍🏽', 'emoji:🧑‍💻', 'image:data:image/gif;base64,R0lGODlhAQABAAAAACw=', 'image:data:image/svg+xml;base64,PHN2Zy8+', 'image:data:image/png;base64,iVBORw0KGgo='])
      expect(isIconValue(ok), ok).toBe(true);
    expect(isIconValue('icon:briefcase', { prefixed: true })).toBe(true);
    expect(isIconValue('brand:gmail', { prefixed: true })).toBe(true);
  });

  it('refuses anything that is not an icon', () => {
    for (const bad of ['emoji:hello', 'image:javascript:alert(1)', 'image:data:text/html;base64,PGI+', '<svg onload=x>', 'icon:briefcase', `image:data:image/png;base64,${'A'.repeat(400_001)}`])
      expect(isIconValue(bad), bad.slice(0, 40)).toBe(false);
  });
});
