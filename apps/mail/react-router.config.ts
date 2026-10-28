import type { Config } from '@react-router/dev/config';

// Single-page app: the engine serves the static build from ZMail.app.
export default {
  ssr: false,
  buildDirectory: 'build',
  appDirectory: 'app',
} satisfies Config;
