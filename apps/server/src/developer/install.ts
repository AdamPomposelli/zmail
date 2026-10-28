import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import type { EngineContext } from '../context';
import { dirname, join } from 'node:path';
import { developerInfo } from './info';
import type { Scope } from './keys';
import { homedir } from 'node:os';
import { t } from '../lib/i18n';

export const MCP_CLIENTS = [
  'claude-desktop',
  'cursor',
  'windsurf',
  'claude-code',
  'vscode',
  'codex',
  'chatgpt',
] as const;
export type McpClient = (typeof MCP_CLIENTS)[number];

type ClientSpec = {
  name: string;
  /** `file`: ZMail merges its entry into the client's JSON config. `snippet`: the user pastes it. `manual`: not installable from here. */
  mode: 'file' | 'snippet' | 'manual';
  transport: 'stdio' | 'http';
  configPath?: () => string;
};

const home = () => homedir();
const CLIENTS: Record<McpClient, ClientSpec> = {
  'claude-desktop': {
    name: 'Claude Desktop',
    mode: 'file',
    transport: 'stdio',
    configPath: () =>
      join(home(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
  },
  cursor: {
    name: 'Cursor',
    mode: 'file',
    transport: 'http',
    configPath: () => join(home(), '.cursor', 'mcp.json'),
  },
  windsurf: {
    name: 'Windsurf',
    mode: 'file',
    transport: 'http',
    configPath: () => join(home(), '.codeium', 'windsurf', 'mcp_config.json'),
  },
  'claude-code': {
    name: 'Claude Code',
    mode: 'snippet',
    transport: 'http',
    configPath: () => join(home(), '.claude.json'),
  },
  vscode: { name: 'VS Code', mode: 'snippet', transport: 'http' },
  codex: {
    name: 'Codex CLI',
    mode: 'snippet',
    transport: 'stdio',
    configPath: () => join(home(), '.codex', 'config.toml'),
  },
  chatgpt: { name: 'ChatGPT', mode: 'manual', transport: 'http' },
};

const SERVER_NAME = 'zmail';

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  if (!raw.trim()) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('not an object');
    return value as Record<string, unknown>;
  } catch {
    throw new Error(
      t('{path} n’est pas un JSON valide : ZMail ne le modifie pas. Corrigez-le ou ajoutez l’entrée à la main.', { path }),
    );
  }
}

const hasServer = (config: Record<string, unknown> | null) =>
  Boolean(
    config &&
      typeof config.mcpServers === 'object' &&
      config.mcpServers &&
      SERVER_NAME in config.mcpServers,
  );

/** Merges `entry` under mcpServers.zmail, keeping every other entry; backs up the file first. */
function mergeServerEntry(path: string, entry: Record<string, unknown>) {
  const current = readJson(path);
  let backupPath: string | null = null;
  if (current !== null) {
    backupPath = `${path}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
    copyFileSync(path, backupPath);
  }
  const config = current ?? {};
  const servers =
    config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
      ? (config.mcpServers as Record<string, unknown>)
      : {};
  const next = { ...config, mcpServers: { ...servers, [SERVER_NAME]: entry } };
  mkdirSync(dirname(path), { recursive: true });
  // The entry carries an API key: owner-only, written atomically.
  const tmp = `${path}.zmail-tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, {
    mode: current !== null ? statSync(path).mode & 0o777 & ~0o077 : 0o600,
  });
  renameSync(tmp, path);
  return { path, backupPath };
}

const tomlString = (s: string) => JSON.stringify(s);

/** The exact configuration of each client for a given key. */
export function clientConfig(
  engine: EngineContext,
  client: McpClient,
  key: string,
): { entry: Record<string, unknown> } | { language: string; snippet: string } {
  const info = developerInfo(engine);
  const auth = { Authorization: `Bearer ${key}` };
  const stdio = {
    command: info.nodePath,
    args: [info.bridgePath],
    env: { ZMAIL_API_KEY: key, ZMAIL_DATA_DIR: info.dataDir },
  };
  switch (client) {
    case 'claude-desktop':
      return { entry: stdio };
    case 'cursor':
      return { entry: { url: info.mcpUrl, headers: auth } };
    case 'windsurf':
      return { entry: { serverUrl: info.mcpUrl, headers: auth } };
    case 'claude-code':
      return {
        language: 'shell',
        snippet: `claude mcp add --transport http ${SERVER_NAME} ${info.mcpUrl} --header "Authorization: Bearer ${key}"`,
      };
    case 'vscode':
      return {
        language: 'json',
        snippet: JSON.stringify(
          { servers: { [SERVER_NAME]: { type: 'http', url: info.mcpUrl, headers: auth } } },
          null,
          2,
        ),
      };
    case 'codex':
      return {
        language: 'toml',
        snippet: [
          `[mcp_servers.${SERVER_NAME}]`,
          `command = ${tomlString(info.nodePath)}`,
          `args = [${tomlString(info.bridgePath)}]`,
          `env = { ZMAIL_API_KEY = ${tomlString(key)}, ZMAIL_DATA_DIR = ${tomlString(info.dataDir)} }`,
        ].join('\n'),
      };
    case 'chatgpt':
      return { language: 'text', snippet: info.mcpUrl };
  }
}

function installed(client: McpClient): boolean | null {
  const path = CLIENTS[client].configPath?.();
  if (!path) return null;
  try {
    if (client === 'codex')
      return (
        existsSync(path) && readFileSync(path, 'utf8').includes(`[mcp_servers.${SERVER_NAME}]`)
      );
    return hasServer(readJson(path));
  } catch {
    return null;
  }
}

/** Every supported client, whether it looks present on this Mac and whether ZMail is configured in it. */
export function listClients() {
  return MCP_CLIENTS.map((id) => {
    const spec = CLIENTS[id];
    const path = spec.configPath?.() ?? null;
    return {
      id,
      name: spec.name,
      mode: spec.mode,
      transport: spec.transport,
      configPath: path,
      detected: path ? existsSync(dirname(path)) : null,
      installed: installed(id),
    };
  });
}

export type InstallResult =
  | { mode: 'file'; client: McpClient; path: string; backupPath: string | null; keyPrefix: string }
  | { mode: 'snippet'; client: McpClient; language: string; snippet: string; keyPrefix: string };

/**
 * Creates a dedicated key for the client, then writes its config (file clients) or returns the
 * snippet to paste. Only ever called from an explicit click in the settings.
 */
export function installClient(
  engine: EngineContext,
  client: McpClient,
  scopes: Scope[],
): InstallResult {
  const spec = CLIENTS[client];
  if (spec.mode === 'manual')
    throw new Error(
      t('{name} ne peut pas se connecter à un serveur local : il faut l’exposer en HTTPS (tunnel).', { name: spec.name }),
    );
  if (spec.transport === 'stdio' && !developerInfo(engine).bridgeAvailable)
    throw new Error(
      t('Le pont MCP (zmail-mcp.mjs) est introuvable : reconstruisez le moteur (pnpm --filter @zmail/engine build).'),
    );
  const { key, apiKey } = engine.apiKeys.create(`MCP · ${spec.name}`, scopes);
  const config = clientConfig(engine, client, key);
  if (spec.mode === 'file' && 'entry' in config) {
    try {
      const { path, backupPath } = mergeServerEntry(spec.configPath!(), config.entry);
      return { mode: 'file', client, path, backupPath, keyPrefix: apiKey.prefix };
    } catch (error) {
      engine.apiKeys.revoke(apiKey.id);
      throw error;
    }
  }
  if (!('snippet' in config)) throw new Error(t('Configuration inattendue'));
  return {
    mode: 'snippet',
    client,
    language: config.language,
    snippet: config.snippet,
    keyPrefix: apiKey.prefix,
  };
}
