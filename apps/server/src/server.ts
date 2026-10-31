import { Hono, type MiddlewareHandler } from 'hono';
import { MICROSOFT_REDIRECT_PATH } from './mail/oauth';
import { t } from './lib/i18n';
import { streamSSE } from 'hono/streaming';
import { getMimeType } from 'hono/utils/mime';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { EngineContext } from './context';
import { extractAttachment } from './mail/parse';
import { appRouter } from './trpc';
import { bus } from './lib/events';
import { developerRoutes, requireApiKey, type DeveloperEnv } from './developer/rest';
import { handleMcpRequest } from './mcp/server';

export function createApp(engine: EngineContext, uiDir?: string) {
  const app = new Hono();

  // The engine only listens on loopback; refuse cross-site requests from other local pages.
  const sameOrigin: MiddlewareHandler = async (c, next) => {
    const origin = c.req.header('origin');
    if (origin && URL.parse(origin)?.host !== new URL(c.req.url).host) return c.json({ error: 'forbidden' }, 403);
    await next();
  };
  app.use('/api/*', sameOrigin);
  app.use('/mcp', sameOrigin);

  // Developer surfaces, authenticated by API key (Réglages → API / Connecteurs IA).
  app.route('/api/v1', developerRoutes(engine));
  const mcp = new Hono<DeveloperEnv>();
  mcp.use('*', requireApiKey(engine));
  mcp.all('/', (c) => handleMcpRequest(engine, c.get('apiKey'), c.req.raw));
  app.route('/mcp', mcp);

  // Microsoft's sign-in comes back here (« Se connecter avec Microsoft »), in the user's browser.
  app.get(MICROSOFT_REDIRECT_PATH, async (c) => {
    const result = await engine.oauth.callback(c.req.query());
    const escape = (v: string) => v.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
    const title = result.ok ? t('C’est fait : retournez dans ZMail') : t('La connexion n’a pas abouti');
    const body = result.ok ? t('{email} est connecté. Vous pouvez fermer cet onglet.', { email: result.message || 'Microsoft' }) : result.message;
    return c.html(
      `<!doctype html><meta charset="utf-8"><title>ZMail</title><meta name="viewport" content="width=device-width"><style>body{font:15px -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#111;color:#eee}main{text-align:center;max-width:420px;padding:24px}h1{font-size:20px;margin:12px 0 6px}p{color:#aaa;line-height:1.5}.i{font-size:40px}</style><main><div class="i">${result.ok ? '✅' : '⚠️'}</div><h1>${escape(title)}</h1><p>${escape(body)}</p></main>${result.ok ? '<script>setTimeout(()=>window.close(),1500)</script>' : ''}`,
      result.ok ? 200 : 400,
    );
  });

  app.get('/api/health', (c) => c.json({ ok: true, accounts: engine.accounts.list().length, bridge: engine.bridge.connected }));

  app.all('/api/trpc/*', (c) =>
    fetchRequestHandler({
      endpoint: '/api/trpc',
      req: c.req.raw,
      router: appRouter,
      createContext: () => ({ engine }),
    }),
  );

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = bus.onEvent((event) => void stream.writeSSE({ event: event.type, data: JSON.stringify(event) }));
      stream.onAbort(() => {
        unsubscribe();
      });
      while (!stream.aborted) {
        await stream.writeSSE({ event: 'ping', data: String(Date.now()) });
        await stream.sleep(25_000);
      }
      unsubscribe();
    }),
  );

  app.get('/api/messages/:id/attachments/:index', async (c) => {
    const row = engine.store.message(c.req.param('id'));
    if (!row) return c.notFound();
    const source = await engine.accounts.worker(row.account_id).source(row.id);
    const attachment = source ? await extractAttachment(source, Number(c.req.param('index'))) : null;
    if (!attachment) return c.notFound();
    const disposition = c.req.query('download') ? 'attachment' : 'inline';
    return new Response(new Uint8Array(attachment.content), {
      headers: {
        'content-type': attachment.contentType,
        'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
        'cache-control': 'private, max-age=86400',
      },
    });
  });

  // « Download (.eml) » from the reader's message menu.
  app.get('/api/messages/:id/source', async (c) => {
    const row = engine.store.message(c.req.param('id'));
    if (!row) return c.notFound();
    const source = await engine.accounts.worker(row.account_id).source(row.id);
    if (!source) return c.notFound();
    const name = (row.subject || 'message').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80).trim() || 'message';
    return new Response(new Uint8Array(source), {
      headers: { 'content-type': 'message/rfc822', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}.eml` },
    });
  });

  app.get('/api/messages/:id/cid/:cid', async (c) => {
    const row = engine.store.message(c.req.param('id'));
    if (!row) return c.notFound();
    const source = await engine.accounts.worker(row.account_id).source(row.id);
    if (!source) return c.notFound();
    const { simpleParser } = await import('mailparser');
    const parsed = await simpleParser(source);
    const wanted = decodeURIComponent(c.req.param('cid')).replace(/^<|>$/g, '');
    const image = parsed.attachments.find((a) => a.cid === wanted || a.contentId === `<${wanted}>`);
    if (!image) return c.notFound();
    return new Response(new Uint8Array(image.content), { headers: { 'content-type': image.contentType, 'cache-control': 'private, max-age=86400' } });
  });

  if (uiDir && existsSync(join(uiDir, 'index.html'))) {
    // Absolute paths, read on each request: the app bundle can be rebuilt while it runs, which
    // swaps the UI files and deletes the engine's working directory (so no cwd-relative root).
    const root = resolve(uiDir);
    app.get('*', async (c) => {
      const path = decodeURIComponent(c.req.path);
      if (!/\.[a-z0-9]+$/i.test(path)) return c.html(await readFile(join(root, 'index.html'), 'utf8'));
      const file = resolve(root, `.${path}`);
      if (!file.startsWith(`${root}/`)) return c.notFound();
      const body = await readFile(file).catch(() => null);
      if (!body) return c.notFound();
      return new Response(new Uint8Array(body), {
        headers: { 'content-type': getMimeType(file) ?? 'application/octet-stream', 'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' },
      });
    });
  }

  return app;
}
