import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'linked',
  legalComments: 'none',
  banner: {
    js: "import { createRequire as __zmailRequire } from 'node:module'; const require = __zmailRequire(import.meta.url);",
  },
  logLevel: 'info',
};

// One self-contained ESM file: ZMail.app ships it next to a bundled node binary.
await build({ ...shared, entryPoints: ['src/main.ts'], outfile: 'dist/engine.mjs' });

// MCP stdio bridge for Claude Desktop / Codex CLI, shipped next to engine.mjs.
await build({ ...shared, entryPoints: ['src/mcp/stdio.ts'], outfile: 'dist/zmail-mcp.mjs' });
