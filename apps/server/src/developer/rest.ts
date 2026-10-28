import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bearerToken, type ApiKey, type Scope } from './keys';
import type { EngineContext } from '../context';
import { ApiError, DeveloperApi } from './api';
import { openapiDocument } from './openapi';
import { log } from '../lib/log';
import { z } from 'zod';

export type DeveloperEnv = { Variables: { apiKey: ApiKey } };

const unauthorized = (c: Context, message: string) =>
  c.json({ error: { code: 'unauthorized', message } }, 401, {
    'www-authenticate': 'Bearer realm="zmail"',
  });

/** `Authorization: Bearer zm_live_…` — the key itself is never logged. */
export const requireApiKey =
  (engine: EngineContext): MiddlewareHandler<DeveloperEnv> =>
  async (c, next) => {
    const header = c.req.header('authorization');
    if (!header) return unauthorized(c, 'Missing Authorization: Bearer <api key> header');
    const key = engine.apiKeys.verify(bearerToken(header));
    if (!key) return unauthorized(c, 'Invalid or revoked API key');
    c.set('apiKey', key);
    await next();
  };

const requireScope =
  (scope: Scope): MiddlewareHandler<DeveloperEnv> =>
  async (c, next) => {
    if (!c.get('apiKey').scopes.includes(scope))
      return c.json(
        { error: { code: 'forbidden', message: `This key lacks the "${scope}" scope` } },
        403,
      );
    await next();
  };

const body = async (c: Context) => {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(400, 'Request body must be JSON');
  }
};

/** REST API v1, mounted at /api/v1. */
export function developerRoutes(engine: EngineContext) {
  const api = new DeveloperApi(engine);
  const app = new Hono<DeveloperEnv>();

  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json(
        { error: { code: 'invalid_request', message: 'Invalid request', issues: error.issues } },
        400,
      );
    if (error instanceof ApiError)
      return c.json(
        {
          error: {
            code: error.status === 404 ? 'not_found' : 'invalid_request',
            message: error.message,
          },
        },
        error.status,
      );
    log.error('api', c.req.method, c.req.path, (error as Error).message);
    return c.json({ error: { code: 'internal', message: (error as Error).message } }, 500);
  });
  app.notFound((c) =>
    c.json(
      { error: { code: 'not_found', message: `No route ${c.req.method} ${c.req.path}` } },
      404,
    ),
  );

  // Public: lets tools and the settings page read the contract without a key.
  app.get('/openapi.json', (c) => c.json(openapiDocument(new URL(c.req.url).origin)));

  app.use('*', requireApiKey(engine));
  const read = requireScope('read');
  const write = requireScope('write');

  app.get('/accounts', read, (c) => c.json({ items: api.accounts() }));
  app.get('/tags', read, (c) => c.json({ items: api.tags() }));
  app.get('/businesses', read, (c) => c.json({ items: api.businesses() }));

  app.get('/threads', read, (c) => {
    const q = c.req.query();
    return c.json(
      api.threads({
        view: (q.view || undefined) as never,
        tagId: q.tag,
        businessId: q.business,
        accountId: q.account,
        mailboxId: q.mailbox,
        query: q.q,
        unreadOnly: q.unread === 'true' || q.unread === '1',
        limit: (q.limit || undefined) as never,
        cursor: (q.cursor || undefined) as never,
      }),
    );
  });
  app.get('/threads/:id', read, (c) => c.json(api.thread(c.req.param('id'))));
  app.get('/search', read, (c) =>
    c.json(
      api.search(
        c.req.query('q') ?? '',
        Math.min(100, Math.max(1, Number(c.req.query('limit')) || 25)),
      ),
    ),
  );

  app.post('/messages/send', write, async (c) => c.json(await api.send(await body(c))));
  app.post('/threads/actions', write, async (c) => c.json(await api.act(await body(c))));

  return app;
}
