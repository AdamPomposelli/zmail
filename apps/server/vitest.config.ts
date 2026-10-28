import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    // Tests assert the engine's French texts: pin the language whatever the machine's locale.
    env: { ZMAIL_NO_OSASCRIPT: '1', ZMAIL_NO_KEYCHAIN: '1', ZMAIL_LOCALE: 'fr' },
  },
});
