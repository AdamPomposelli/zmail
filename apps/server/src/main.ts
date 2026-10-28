import { serve } from '@hono/node-server';
import { rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EngineContext } from './context';
import { createApp } from './server';
import { log } from './lib/log';
import { DEFAULT_PORT, defaultDataDir, engineFile, type EngineFile } from './developer/info';

const dataDir = defaultDataDir();
const port = Number(process.env.ZMAIL_PORT ?? DEFAULT_PORT);
const uiDir = process.env.ZMAIL_UI_DIR ? resolve(process.env.ZMAIL_UI_DIR) : undefined;

const engine = await EngineContext.create(dataDir);
const app = createApp(engine, uiDir);

const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  engine.port = info.port;
  // Lets the MCP stdio bridge (zmail-mcp.mjs) find this engine whatever port the app picked.
  const discovery: EngineFile = { port: info.port, pid: process.pid, startedAt: Date.now() };
  try {
    writeFileSync(engineFile(dataDir), JSON.stringify(discovery), { mode: 0o600 });
  } catch (error) {
    log.warn('engine', 'could not write engine.json', (error as Error).message);
  }
  log.info('engine', `ZMail engine on http://127.0.0.1:${info.port} (data: ${dataDir}, bridge: ${engine.bridge.connected ? 'yes' : 'no'})`);
});

engine.accounts.startAll();
engine.pipeline.backfill();

// Prices and model lists of connected services, refreshed daily for routing and forecasts.
for (const provider of engine.ai.settings().providers.filter((p) => p.type === 'openai')) {
  void engine.ai.catalog.models(provider.kind ?? 'custom', provider.baseUrl ?? '', engine.ai.apiKey(provider));
}

const shutdown = async () => {
  log.info('engine', 'shutting down');
  await engine.accounts.stopAll();
  rmSync(engineFile(dataDir), { force: true });
  server.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// The app passes its pid: never outlive it, even if it crashed.
const parentPid = Number(process.env.ZMAIL_PARENT_PID);
if (parentPid) {
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      void shutdown();
    }
  }, 2000).unref();
}
