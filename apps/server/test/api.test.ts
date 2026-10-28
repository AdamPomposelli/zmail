import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { installClient } from '../src/developer/install';
import type { IncomingMessage } from '../src/mail/store';
import type { EngineContext } from '../src/context';
import { engineFile } from '../src/developer/info';
import { createTestEngine } from './helpers';
import { createApp } from '../src/server';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Developer API and MCP, against a real HTTP server on a random port (no IMAP needed). */
let engine: EngineContext;
let server: ServerType;
let origin: string;
let readKey: string;
let writeKey: string;
const ids: Record<string, string> = {};

function seedMail() {
  const accountId = 'acc_test';
  engine.db.run(
    `INSERT INTO accounts (id, email, name, provider, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username, secret, color, created_at)
     VALUES (?, 'me@zmail.test', 'Me', 'custom', '127.0.0.1', 1, 0, '127.0.0.1', 1, 0, 'me', ?, '#3B82F6', ?)`,
    accountId,
    engine.secrets.encrypt('x'),
    Date.now(),
  );
  engine.db.run(
    `INSERT INTO mailboxes (id, account_id, path, name, special_use, uidvalidity) VALUES ('mb_inbox', ?, 'INBOX', 'INBOX', 'inbox', '1')`,
    accountId,
  );
  const mails = [
    {
      key: 'invoice',
      subject: 'Votre facture OVH de mars',
      from: 'billing@ovh.test',
      text: 'Facture n°42 : 12,99 €',
    },
    {
      key: 'dinner',
      subject: 'Dîner samedi ?',
      from: 'ami@perso.test',
      text: 'On se voit samedi soir ?',
    },
  ];
  mails.forEach((m, i) => {
    const msg: IncomingMessage = {
      accountId,
      mailboxId: 'mb_inbox',
      // Negative uids: local-only messages, so flag actions never reach an IMAP server.
      uid: -(i + 1),
      messageId: `<${m.key}@zmail.test>`,
      inReplyTo: null,
      references: [],
      subject: m.subject,
      from: { email: m.from },
      to: [{ email: 'me@zmail.test' }],
      cc: [],
      replyTo: null,
      deliveredTo: null,
      date: Date.now() - i * 60_000,
      text: m.text,
      html: `<p>${m.text}</p>`,
      attachments: [],
      unread: true,
      starred: false,
      listUnsubscribe: null,
      listUnsubscribePost: null,
      listId: null,
      precedence: null,
      autoSubmitted: null,
      spamHeader: null,
      size: 100,
      isNew: true,
    };
    const { id, threadId } = engine.store.upsert(msg, '1');
    engine.store.saveTriage(id, {
      businessId: null,
      priority: 1,
      tags: [],
      spam: false,
      spamReason: null,
      otp: null,
      opportunity: false,
      opportunityReason: null,
      newsletter: false,
      unsubscribe: null,
      summary: '',
      engine: 'test',
      userOverride: false,
      rulesApplied: [],
    });
    ids[m.key] = threadId;
  });
}

/** Test assertions read arbitrary JSON bodies. */
type JsonResponse = Omit<Response, 'json'> & { json(): Promise<any> };
const api = (
  path: string,
  init: RequestInit & { key?: string | null } = {},
): Promise<JsonResponse> => {
  const { key = readKey, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (key) headers.set('authorization', `Bearer ${key}`);
  if (rest.body) headers.set('content-type', 'application/json');
  return fetch(`${origin}/api/v1${path}`, { ...rest, headers }) as Promise<JsonResponse>;
};

beforeAll(async () => {
  ({ engine } = await createTestEngine());
  seedMail();
  readKey = engine.apiKeys.create('read only', ['read']).key;
  writeKey = engine.apiKeys.create('agent', ['read', 'write']).key;
  const app = createApp(engine);
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
      engine.port = info.port;
      origin = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
});

describe('API keys', () => {
  it('stores only a hash and shows the key once', () => {
    const { key, apiKey } = engine.apiKeys.create('tmp', ['read']);
    expect(key).toMatch(/^zm_live_[\w-]{32}$/);
    expect(apiKey.prefix).toBe(key.slice(0, 12));
    const row = engine.db.get<Record<string, string>>(
      'SELECT * FROM api_keys WHERE id = ?',
      apiKey.id,
    )!;
    expect(Object.values(row)).not.toContain(key);
    expect(row.hash).toHaveLength(64);
    expect(engine.apiKeys.list().find((k) => k.id === apiKey.id)).not.toHaveProperty('hash');
    expect(engine.apiKeys.revoke(apiKey.id)).toBe(true);
    expect(engine.apiKeys.verify(key)).toBeNull();
  });
});

describe('REST /api/v1', () => {
  it('rejects missing, malformed and revoked keys with 401 JSON', async () => {
    const missing = await api('/accounts', { key: null });
    expect(missing.status).toBe(401);
    expect((await missing.json()).error.code).toBe('unauthorized');
    expect((await api('/accounts', { key: 'zm_live_nope' })).status).toBe(401);
    const { key, apiKey } = engine.apiKeys.create('revoked', ['read']);
    expect((await api('/accounts', { key })).status).toBe(200);
    engine.apiKeys.revoke(apiKey.id);
    expect((await api('/accounts', { key })).status).toBe(401);
  });

  it('keeps refusing cross-site browser requests', async () => {
    const res = await api('/accounts', { headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
  });

  it('serves the OpenAPI document without a key', async () => {
    const res = await api('/openapi.json', { key: null });
    const doc = await res.json();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers[0].url).toBe(`${origin}/api/v1`);
    expect(Object.keys(doc.paths)).toContain('/threads/actions');
  });

  it('lists accounts without secrets, tags and threads', async () => {
    const accounts = (await (await api('/accounts')).json()).items;
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).not.toHaveProperty('secret');
    expect(accounts[0]).not.toHaveProperty('username');
    expect((await (await api('/tags')).json()).items.length).toBeGreaterThan(0);

    const page = await (await api('/threads?view=inbox&limit=10')).json();
    expect(page.items.map((t: { subject: string }) => t.subject)).toEqual([
      'Votre facture OVH de mars',
      'Dîner samedi ?',
    ]);
    expect(page.nextCursor).toBeNull();
    const firstPage = await (await api('/threads?limit=1')).json();
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toBe(1);

    expect((await api('/threads?view=nope')).status).toBe(400);
  });

  it('reads a thread with text and html, searches', async () => {
    const thread = await (await api(`/threads/${ids.invoice}`)).json();
    expect(thread.messages[0].text).toContain('Facture n°42');
    expect(thread.messages[0].html).toContain('<p>');
    expect((await api('/threads/t_missing')).status).toBe(404);
    const found = await (await api('/search?q=facture')).json();
    expect(found.items.map((t: { id: string }) => t.id)).toEqual([ids.invoice]);
  });

  it('requires the write scope for actions', async () => {
    const body = JSON.stringify({ threadIds: [ids.dinner], action: 'read' });
    const denied = await api('/threads/actions', { method: 'POST', body });
    expect(denied.status).toBe(403);
    expect((await api('/messages/send', { method: 'POST', body: '{}' })).status).toBe(403);
  });

  it('applies actions through the engine', async () => {
    const res = await api('/threads/actions', {
      method: 'POST',
      key: writeKey,
      body: JSON.stringify({ threadIds: [ids.dinner, 't_missing'], action: 'read' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      threadIds: [ids.dinner],
      missing: ['t_missing'],
    });
    expect(engine.store.getThread(ids.dinner)!.unread).toBe(false);

    const star = await api('/threads/actions', {
      method: 'POST',
      key: writeKey,
      body: JSON.stringify({ threadIds: [ids.dinner], action: 'star' }),
    });
    expect(star.status).toBe(200);
    expect(engine.store.getThread(ids.dinner)!.starred).toBe(true);

    const tagged = await api('/threads/actions', {
      method: 'POST',
      key: writeKey,
      body: JSON.stringify({ threadIds: [ids.invoice], action: 'tag', tagId: 'finance' }),
    });
    expect(tagged.status).toBe(200);
    expect(engine.store.getThread(ids.invoice)!.tags).toContain('finance');

    const invalid = await api('/threads/actions', {
      method: 'POST',
      key: writeKey,
      body: JSON.stringify({ threadIds: [ids.invoice], action: 'tag' }),
    });
    expect(invalid.status).toBe(400);
    expect(
      (await api('/threads/actions', { method: 'POST', key: writeKey, body: 'not json' })).status,
    ).toBe(400);
  });
});

describe('MCP /mcp', () => {
  const connect = async (key: string) => {
    const client = new Client({ name: 'zmail-test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${key}` } },
      }),
    );
    return client;
  };

  it('rejects requests without a valid key', async () => {
    const res = await fetch(`${origin}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    await expect(connect('zm_live_invalid')).rejects.toThrow();
  });

  it('lists only read tools for a read key', async () => {
    const client = await connect(readKey);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_accounts',
        'list_tags',
        'search_mail',
        'list_threads',
        'read_thread',
      ]),
    );
    expect(names).not.toContain('send_mail');
    expect(names).not.toContain('archive_threads');
    await client.close();
  });

  it('calls read and write tools', async () => {
    const client = await connect(writeKey);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'send_mail',
        'archive_threads',
        'mark_read',
        'star_threads',
        'trash_threads',
        'tag_threads',
        'mark_spam',
        'ask_inbox',
      ]),
    );

    const search = await client.callTool({ name: 'search_mail', arguments: { query: 'facture' } });
    const results = JSON.parse((search.content as { text: string }[])[0]!.text);
    expect(results[0]).toMatchObject({
      thread_id: ids.invoice,
      subject: 'Votre facture OVH de mars',
    });

    const thread = await client.callTool({
      name: 'read_thread',
      arguments: { thread_id: ids.invoice },
    });
    expect((thread.content as { text: string }[])[0]!.text).toContain('Facture n°42');

    const unread = await client.callTool({
      name: 'mark_read',
      arguments: { thread_ids: [ids.invoice], read: false },
    });
    expect(unread.isError).toBeFalsy();
    expect(engine.store.getThread(ids.invoice)!.unread).toBe(true);

    const missing = await client.callTool({
      name: 'read_thread',
      arguments: { thread_id: 't_missing' },
    });
    expect(missing.isError).toBe(true);
    await client.close();
  });

  it('lets an MCP client audit and edit the AI setup (read key: audit only)', async () => {
    const reader = await connect(readKey);
    const readable = (await reader.listTools()).tools.map((t) => t.name);
    expect(readable).toEqual(expect.arrayContaining(['get_ai_setup', 'triage_report']));
    expect(readable).not.toContain('update_ai_prompt');
    const setup = JSON.parse(((await reader.callTool({ name: 'get_ai_setup', arguments: {} })).content as { text: string }[])[0]!.text);
    expect(setup.actions.map((a: { id: string }) => a.id)).toEqual(['triage', 'chat', 'unsubscribe']);
    expect(setup.actions[0].jev.questions.length).toBeGreaterThan(20);
    await reader.close();

    const writer = await connect(writeKey);
    const updated = await writer.callTool({ name: 'update_ai_prompt', arguments: { action: 'chat', llm_prompt: 'Tu es l’agent de ZMail. Réponds très brièvement, en français.', note: 'plus bref' } });
    expect(updated.isError).toBeFalsy();
    expect(engine.prompts.get().chat.llm).toContain('très brièvement');
    expect(engine.prompts.history()[0]).toMatchObject({ action: 'chat', by: 'mcp', note: 'plus bref' });
    const broken = await writer.callTool({ name: 'update_ai_prompt', arguments: { action: 'triage', llm_prompt: 'Trie sans la liste des tags, merci.', note: 'x' } });
    expect(broken.isError).toBe(true);
    await writer.callTool({ name: 'reset_ai_prompt', arguments: { action: 'chat' } });
    expect(engine.prompts.customised().chat.llm).toBe(false);
    await writer.close();
  });

  it('works through the stdio bridge, discovering the port from engine.json', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zmail-bridge-'));
    writeFileSync(
      engineFile(dataDir),
      JSON.stringify({ port: engine.port, pid: process.pid, startedAt: Date.now() }),
    );
    const client = new Client({ name: 'zmail-stdio-test', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', join(import.meta.dirname, '../src/mcp/stdio.ts')],
        env: {
          ...(process.env as Record<string, string>),
          ZMAIL_API_KEY: readKey,
          ZMAIL_DATA_DIR: dataDir,
        },
        stderr: 'pipe',
      }),
    );
    const listed = await client.callTool({
      name: 'list_threads',
      arguments: { view: 'inbox', limit: 5 },
    });
    expect(JSON.parse((listed.content as { text: string }[])[0]!.text).threads).toHaveLength(2);
    await client.close();
  });
});

describe('install helpers', () => {
  it('merges the zmail entry into an existing config, with a backup', () => {
    const home = mkdtempSync(join(tmpdir(), 'zmail-home-'));
    const previousHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const path = join(home, '.cursor', 'mcp.json');
      mkdirSync(join(home, '.cursor'));
      writeFileSync(
        path,
        JSON.stringify({ mcpServers: { other: { url: 'http://x' } }, theme: 'dark' }),
      );
      const result = installClient(engine, 'cursor', ['read']);
      expect(result.mode).toBe('file');
      const config = JSON.parse(readFileSync(path, 'utf8'));
      expect(config.theme).toBe('dark');
      expect(config.mcpServers.other).toEqual({ url: 'http://x' });
      expect(config.mcpServers.zmail.url).toBe(`${origin}/mcp`);
      const key = config.mcpServers.zmail.headers.Authorization.replace('Bearer ', '');
      expect(engine.apiKeys.verify(key)?.scopes).toEqual(['read']);
      expect(result.mode === 'file' && result.backupPath && existsSync(result.backupPath)).toBe(
        true,
      );

      const snippet = installClient(engine, 'claude-code', ['read']);
      expect(snippet.mode === 'snippet' && snippet.snippet).toMatch(
        /^claude mcp add --transport http zmail http:\/\/127\.0\.0\.1:\d+\/mcp --header "Authorization: Bearer zm_live_/,
      );
      expect(() => installClient(engine, 'chatgpt', ['read'])).toThrow(/HTTPS/);
    } finally {
      process.env.HOME = previousHome;
    }
  });
});
