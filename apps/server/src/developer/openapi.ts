import { THREAD_ACTIONS } from './api';
import { VIEWS } from '../types';
import { t } from '../lib/i18n';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object, description = 'OK') => ({
  description,
  content: { 'application/json': { schema } },
});
const errors = {
  '400': { $ref: '#/components/responses/BadRequest' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
};
const list = (item: string) => ({
  type: 'object',
  required: ['items'],
  properties: { items: { type: 'array', items: ref(item) } },
});
const query = (name: string, description: string, schema: object = { type: 'string' }) => ({
  name,
  in: 'query',
  required: false,
  description,
  schema,
});

/** Hand-written OpenAPI 3.1 description of /api/v1 (kept next to rest.ts). */
export function openapiDocument(origin: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'ZMail API',
      version: '1.0.0',
      description:
        `Local API of the ZMail engine. Listens on 127.0.0.1 only. Authenticate with \`Authorization: Bearer zm_live_…\` (create keys in ${t('Réglages → API')}). ` +
        'Scopes: `read` (accounts, tags, threads, search) and `write` (send, thread actions).',
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ bearer: [] }],
    paths: {
      '/accounts': {
        get: {
          summary: 'Connected mail accounts',
          operationId: 'listAccounts',
          'x-scope': 'read',
          responses: { '200': json(list('Account')), ...errors },
        },
      },
      '/tags': {
        get: {
          summary: 'Tags',
          operationId: 'listTags',
          'x-scope': 'read',
          responses: { '200': json(list('Tag')), ...errors },
        },
      },
      '/businesses': {
        get: {
          summary: 'Businesses (groups of mail by activity)',
          operationId: 'listBusinesses',
          'x-scope': 'read',
          responses: { '200': json(list('Business')), ...errors },
        },
      },
      '/threads': {
        get: {
          summary: 'List conversations of a view',
          operationId: 'listThreads',
          'x-scope': 'read',
          parameters: [
            query('view', 'Mail view', { type: 'string', enum: VIEWS, default: 'inbox' }),
            query('tag', 'Tag id'),
            query('business', 'Business id'),
            query('account', 'Account id'),
            query('mailbox', 'Mailbox id (with view=folder)'),
            query('q', 'Full-text filter'),
            query('unread', 'Only unread conversations', { type: 'boolean' }),
            query('limit', 'Page size', { type: 'integer', minimum: 1, maximum: 200, default: 50 }),
            query('cursor', 'nextCursor of the previous page', { type: 'integer', minimum: 0 }),
          ],
          responses: {
            '200': json({
              type: 'object',
              required: ['items', 'nextCursor'],
              properties: {
                items: { type: 'array', items: ref('ThreadListItem') },
                nextCursor: { type: ['integer', 'null'] },
              },
            }),
            ...errors,
          },
        },
      },
      '/threads/{id}': {
        get: {
          summary: 'One conversation with every message (text and HTML bodies)',
          operationId: 'getThread',
          'x-scope': 'read',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': json(ref('ThreadDetail')),
            '404': { $ref: '#/components/responses/NotFound' },
            ...errors,
          },
        },
      },
      '/search': {
        get: {
          summary: 'Full-text search across inbox, archive and sent mail',
          operationId: 'search',
          'x-scope': 'read',
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
            query('limit', 'Max results', {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 25,
            }),
          ],
          responses: { '200': json(list('ThreadListItem')), ...errors },
        },
      },
      '/messages/send': {
        post: {
          summary: 'Send an email',
          operationId: 'sendMessage',
          'x-scope': 'write',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('SendRequest') } },
          },
          responses: {
            '200': json(ref('Ok')),
            '404': { $ref: '#/components/responses/NotFound' },
            ...errors,
          },
        },
      },
      '/threads/actions': {
        post: {
          summary: 'Apply an action to conversations',
          operationId: 'threadActions',
          'x-scope': 'write',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('ActionRequest') } },
          },
          responses: {
            '200': json({
              type: 'object',
              properties: {
                ok: { type: 'boolean' },
                action: { type: 'string' },
                threadIds: { type: 'array', items: { type: 'string' } },
                missing: { type: 'array', items: { type: 'string' } },
              },
            }),
            '404': { $ref: '#/components/responses/NotFound' },
            ...errors,
          },
        },
      },
    },
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'zm_live_…' } },
      responses: {
        BadRequest: json(ref('Error'), 'Invalid request'),
        Unauthorized: json(ref('Error'), 'Missing, invalid or revoked API key'),
        Forbidden: json(ref('Error'), 'The key lacks the required scope'),
        NotFound: json(ref('Error'), 'Not found'),
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                issues: { type: 'array' },
              },
            },
          },
        },
        Ok: { type: 'object', properties: { ok: { type: 'boolean' } } },
        Address: {
          type: 'object',
          required: ['email'],
          properties: { name: { type: 'string' }, email: { type: 'string' } },
        },
        Account: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            name: { type: 'string' },
            provider: { type: 'string' },
            color: { type: 'string' },
            businessId: { type: ['string', 'null'] },
            aliases: { type: 'array', items: { type: 'string' } },
            status: { type: 'string' },
            lastError: { type: ['string', 'null'] },
            lastSyncAt: { type: ['integer', 'null'] },
          },
        },
        Tag: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            color: { type: 'string' },
            description: { type: 'string' },
            kind: { type: 'string', enum: ['system', 'custom'] },
          },
        },
        Business: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            color: { type: 'string' },
            emoji: { type: ['string', 'null'] },
            description: { type: 'string' },
          },
        },
        ThreadListItem: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            accountId: { type: 'string' },
            accountEmail: { type: 'string' },
            subject: { type: 'string' },
            snippet: { type: 'string' },
            summary: { type: 'string' },
            from: ref('Address'),
            date: { type: 'integer', description: 'Unix time (ms)' },
            unread: { type: 'boolean' },
            starred: { type: 'boolean' },
            count: { type: 'integer' },
            priority: { type: 'integer', minimum: 0, maximum: 3 },
            tags: { type: 'array', items: { type: 'string' } },
            businessId: { type: ['string', 'null'] },
            spam: { type: 'boolean' },
            otp: { type: ['string', 'null'] },
            mailbox: { type: ['string', 'null'] },
            latestMessageId: { type: 'string' },
          },
        },
        Message: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            messageId: { type: ['string', 'null'], description: 'RFC 5322 Message-ID' },
            accountId: { type: 'string' },
            mailbox: { type: ['string', 'null'] },
            from: ref('Address'),
            to: { type: 'array', items: ref('Address') },
            cc: { type: 'array', items: ref('Address') },
            subject: { type: 'string' },
            date: { type: 'integer' },
            text: { type: 'string' },
            html: { type: 'string' },
            attachments: { type: 'array', items: { type: 'object' } },
            unread: { type: 'boolean' },
            starred: { type: 'boolean' },
          },
        },
        ThreadDetail: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            accountId: { type: 'string' },
            accountEmail: { type: 'string' },
            subject: { type: 'string' },
            messages: { type: 'array', items: ref('Message') },
            priority: { type: 'integer' },
            tags: { type: 'array', items: { type: 'string' } },
            businessId: { type: ['string', 'null'] },
            summary: { type: 'string' },
            unread: { type: 'boolean' },
            starred: { type: 'boolean' },
          },
        },
        SendRequest: {
          type: 'object',
          required: ['accountId', 'to', 'subject'],
          description: 'Give `html`, `text` or both.',
          properties: {
            accountId: { type: 'string' },
            to: { type: 'array', items: { type: 'string', format: 'email' }, minItems: 1 },
            cc: { type: 'array', items: { type: 'string', format: 'email' } },
            bcc: { type: 'array', items: { type: 'string', format: 'email' } },
            subject: { type: 'string' },
            html: { type: 'string' },
            text: { type: 'string' },
            inReplyToMessageId: {
              type: 'string',
              description: 'Message `id` (from GET /threads/{id}) this mail replies to',
            },
          },
        },
        ActionRequest: {
          type: 'object',
          required: ['threadIds', 'action'],
          properties: {
            threadIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 500 },
            action: { type: 'string', enum: THREAD_ACTIONS },
            tagId: { type: 'string', description: 'Required for tag / untag' },
          },
        },
      },
    },
  };
}
