import { dirname, join, resolve } from 'node:path';
import type { EngineContext } from '../context';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

export const DEFAULT_PORT = 47812;
export const defaultDataDir = () =>
  process.env.ZMAIL_DATA_DIR ?? join(homedir(), 'Library', 'Application Support', 'ZMail');

/** Written by main.ts once listening: how the stdio bridge finds the engine's real port. */
export const engineFile = (dataDir: string) => join(dataDir, 'engine.json');
export type EngineFile = { port: number; pid: number; startedAt: number };

/**
 * The stdio bridge ships next to the engine bundle (dist/ and ZMail.app/Contents/Resources/engine).
 * In dev (`tsx src/main.ts`) it is the built copy in apps/server/dist.
 */
export function bridgePath(): string {
  const entry = process.argv[1] ? resolve(process.argv[1]) : '';
  const candidates = [
    join(dirname(entry), 'zmail-mcp.mjs'),
    join(dirname(entry), '..', 'dist', 'zmail-mcp.mjs'),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

export function developerInfo(engine: EngineContext) {
  const port = engine.port ?? Number(process.env.ZMAIL_PORT ?? DEFAULT_PORT);
  const origin = `http://127.0.0.1:${port}`;
  const bridge = bridgePath();
  return {
    port,
    baseUrl: `${origin}/api/v1`,
    openapiUrl: `${origin}/api/v1/openapi.json`,
    mcpUrl: `${origin}/mcp`,
    dataDir: engine.dataDir,
    engineFile: engineFile(engine.dataDir),
    nodePath: process.execPath,
    bridgePath: bridge,
    bridgeAvailable: existsSync(bridge),
  };
}
