/**
 * ZMail's own logo. The files under /brand are projected from Brand/variants/<Brand/ACTIVE>
 * by scripts/sync-brand.sh: change the logo there, never here.
 */
export const APP_BRAND = {
  name: 'ZMail',
  icon: '/brand/icon.svg',
  favicon: '/brand/favicon.svg',
  faviconIco: '/favicon.ico',
  appleTouchIcon: '/brand/apple-touch-icon.png',
  /** zmail token of the Zippy brand kit. */
  color: '#FC2832',
} as const;
