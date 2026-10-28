import { reactRouter } from '@react-router/dev/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import tailwindcss from '@tailwindcss/vite';
import babel from 'vite-plugin-babel';
import { defineConfig } from 'vite';

const engine = process.env.ZMAIL_ENGINE_URL ?? 'http://127.0.0.1:47812';

export default defineConfig({
  plugins: [
    reactRouter(),
    babel({
      filter: /\.[jt]sx?$/,
      babelConfig: {
        presets: ['@babel/preset-typescript'],
        plugins: [['babel-plugin-react-compiler', {}]],
      },
    }),
    tsconfigPaths(),
    tailwindcss(),
  ],
  server: {
    port: Number(process.env.PORT ?? 5317),
    proxy: { '/api': { target: engine, changeOrigin: true } },
  },
  build: { sourcemap: false },
});
