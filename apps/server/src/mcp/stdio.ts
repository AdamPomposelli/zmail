/**
 * zmail-mcp: stdio ⇄ Streamable HTTP bridge for MCP clients that only launch local commands
 * (Claude Desktop, Codex CLI). It forwards every JSON-RPC message to the running ZMail engine.
 *
 *   ZMAIL_API_KEY=zm_live_… node zmail-mcp.mjs
 *
 * The engine's port is read from <dataDir>/engine.json on each (re)connection, so it keeps
 * working when ZMail.app picks another port. Optional: ZMAIL_DATA_DIR, ZMAIL_URL (full /mcp URL).
 * stdout carries the protocol only; diagnostics go to stderr, and the key is never printed.
 */
import {
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type JSONRPCMessage,
} from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { DEFAULT_PORT, defaultDataDir, engineFile, type EngineFile } from '../developer/info';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { t } from '../lib/i18n';

const warn = (...args: unknown[]) => console.error('[zmail-mcp]', ...args);

const apiKey = process.env.ZMAIL_API_KEY?.trim();
if (!apiKey) {
  warn(
    'ZMAIL_API_KEY is not set. Create a key in ZMail → Réglages → API (or use Réglages → Connecteurs IA → Installer).',
  );
  process.exit(1);
}

function engineUrl(): URL {
  if (process.env.ZMAIL_URL) return new URL(process.env.ZMAIL_URL);
  const dataDir = defaultDataDir();
  let port = Number(process.env.ZMAIL_PORT) || DEFAULT_PORT;
  try {
    const info = JSON.parse(readFileSync(engineFile(dataDir), 'utf8')) as EngineFile;
    if (Number.isInteger(info.port)) port = info.port;
  } catch {
    // ZMail not started yet (or an old engine): fall back to the default port.
  }
  return new URL(`http://127.0.0.1:${port}/mcp`);
}

const stdio = new StdioServerTransport();
let http: StreamableHTTPClientTransport | null = null;
let protocolVersion: string | null = null;
const initializeIds = new Set<string | number>();

async function connect() {
  const transport = new StreamableHTTPClientTransport(engineUrl(), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
  });
  transport.onmessage = (message) => {
    if (isJSONRPCResultResponse(message) && initializeIds.delete(message.id)) {
      const version = (message.result as { protocolVersion?: unknown }).protocolVersion;
      if (typeof version === 'string') {
        protocolVersion = version;
        transport.setProtocolVersion(version);
      }
    }
    void stdio
      .send(message)
      .catch((error) => warn('stdout write failed:', (error as Error).message));
  };
  transport.onerror = (error) => warn((error as Error).message);
  await transport.start();
  if (protocolVersion) transport.setProtocolVersion(protocolVersion);
  return transport;
}

async function forward(message: JSONRPCMessage) {
  if (isJSONRPCRequest(message) && message.method === 'initialize') initializeIds.add(message.id);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      http ??= await connect();
      await http.send(message);
      return;
    } catch (error) {
      // Engine restarted (maybe on another port): rediscover and retry once.
      const stale = http;
      http = null;
      void stale?.close().catch(() => undefined);
      if (attempt === 1) {
        warn('ZMail engine unreachable:', (error as Error).message);
        if (isJSONRPCRequest(message)) {
          const unauthorized = /\b401\b/.test((error as Error).message);
          await stdio.send({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32000,
              message: unauthorized
                ? t('Clé API ZMail invalide ou révoquée (ZMAIL_API_KEY).')
                : t('ZMail n’est pas lancé : ouvrez l’application ZMail puis réessayez.'),
            },
          });
        }
      }
    }
  }
}

// Dispatched in order (a client may pipeline initialize + initialized + requests); the handshake
// and notifications are awaited, other requests run concurrently (ask_inbox can take a while).
let queue = Promise.resolve();
stdio.onmessage = (message) => {
  const blocking = !isJSONRPCRequest(message) || message.method === 'initialize';
  queue = queue.then(() => (blocking ? forward(message) : void forward(message)));
};
stdio.onclose = () => {
  void http?.close().catch(() => undefined);
  process.exit(0);
};
stdio.onerror = (error) => warn((error as Error).message);
await stdio.start();
