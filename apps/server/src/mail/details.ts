import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { simpleParser } from 'mailparser';
import type { EngineContext } from '../context';
import { evaluateAuth } from './auth';
import { log } from '../lib/log';

/** What the reader's « info » button shows: the headers that tell who sent what, to whom, how. */
export type MessageDetails = {
  id: string;
  from: string;
  to: string;
  cc: string | null;
  replyTo: string | null;
  /** The user's address it arrived on (Delivered-To), or the account's. */
  receivedOn: string;
  accountEmail: string;
  folder: string;
  date: string | null;
  subject: string;
  messageId: string | null;
  returnPath: string | null;
  mailer: string | null;
  size: number;
  auth: ReturnType<typeof evaluateAuth>;
};

const header = (lines: readonly { key: string; line: string }[], key: string) => {
  const line = lines.find((h) => h.key === key)?.line;
  return line ? line.slice(line.indexOf(':') + 1).replace(/\r?\n[ \t]+/g, ' ').trim() || null : null;
};

export async function messageDetails(ctx: EngineContext, id: string): Promise<MessageDetails | null> {
  const row = ctx.store.message(id);
  if (!row) return null;
  const account = ctx.accounts.get(row.account_id);
  const source = await ctx.accounts.worker(row.account_id).source(id).catch(() => null);
  const lines = source ? (await simpleParser(source, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true })).headerLines : [];
  const auth = header(lines, 'authentication-results') ?? row.auth_results;
  if (row.auth_results === null && source) ctx.db.run('UPDATE messages SET auth_results = ? WHERE id = ?', auth ?? '', id);
  const delivered = header(lines, 'delivered-to') ?? row.delivered_to;
  return {
    id,
    from: header(lines, 'from') ?? `${row.from_name} <${row.from_email}>`,
    to: header(lines, 'to') ?? '',
    cc: header(lines, 'cc'),
    replyTo: header(lines, 'reply-to'),
    receivedOn: delivered ?? account?.email ?? '',
    accountEmail: account?.email ?? '',
    folder: row.path.replace(/^\[(Gmail|Google Mail)\][/.]/, ''),
    date: header(lines, 'date'),
    subject: row.subject,
    messageId: row.message_id,
    returnPath: header(lines, 'return-path')?.replace(/[<>]/g, '') ?? null,
    mailer: header(lines, 'x-mailer') ?? header(lines, 'user-agent'),
    size: source?.length ?? row.size,
    auth: evaluateAuth(auth ?? null, row.from_email),
  };
}

/** The raw message (RFC 822), for « View source » and the .eml download. */
export async function messageSource(ctx: EngineContext, id: string) {
  const row = ctx.store.message(id);
  if (!row) return null;
  return ctx.accounts.worker(row.account_id).source(id);
}

/**
 * Mails synced before ZMail kept the authentication results: read them from the stored raw
 * files once, in the background (only the headers, the first 64 KB of each file).
 */
export async function backfillAuthResults(ctx: EngineContext) {
  const rows = ctx.db.all<{ id: string; account_id: string }>('SELECT id, account_id FROM messages WHERE auth_results IS NULL LIMIT 5000');
  let found = 0;
  for (const row of rows) {
    let value = '';
    try {
      const file = await open(join(ctx.dataDir, 'raw', row.account_id, `${row.id}.eml`));
      try {
        const { buffer, bytesRead } = await file.read(Buffer.alloc(65536), 0, 65536, 0);
        const head = buffer.subarray(0, bytesRead).toString('utf8').split(/\r?\n\r?\n/)[0] ?? '';
        const m = head.match(/^Authentication-Results:([^\n]*(?:\r?\n[ \t][^\n]*)*)/im);
        value = m ? m[1]!.replace(/\r?\n[ \t]+/g, ' ').trim() : '';
      } finally {
        await file.close();
      }
    } catch {
      continue; // no raw copy (e.g. sent from another client): leave it for the details view
    }
    if (value) found++;
    ctx.db.run('UPDATE messages SET auth_results = ? WHERE id = ?', value, row.id);
  }
  if (rows.length) log.info('auth', `authentication results read for ${found}/${rows.length} older mails`);
}
