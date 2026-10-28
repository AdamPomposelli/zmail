import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import type { AttachmentMeta } from '../types';
import type { Address } from '../lib/address';

export type ParsedEmail = {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  subject: string;
  from: Address;
  to: Address[];
  cc: Address[];
  replyTo: string | null;
  deliveredTo: string | null;
  date: number;
  text: string;
  html: string;
  attachments: AttachmentMeta[];
  listUnsubscribe: string | null;
  listUnsubscribePost: string | null;
  listId: string | null;
  precedence: string | null;
  autoSubmitted: string | null;
  spamHeader: string | null;
  /** The topmost Authentication-Results: the one the receiving provider added (mail/auth.ts). */
  authResults: string | null;
};

const addresses = (value: AddressObject | AddressObject[] | undefined): Address[] =>
  (Array.isArray(value) ? value : value ? [value] : [])
    .flatMap((group) => group.value)
    .flatMap((a) => (a.group ? a.group : [a]))
    .filter((a) => a.address)
    .map((a) => ({ name: a.name || undefined, email: a.address!.toLowerCase() }));

const rawHeader = (parsed: ParsedMail, name: string) => {
  const line = parsed.headerLines.find((h) => h.key === name)?.line;
  if (!line) return null;
  return line.slice(line.indexOf(':') + 1).replace(/\r?\n[ \t]+/g, ' ').trim() || null;
};

const ids = (value: string | string[] | undefined): string[] =>
  (Array.isArray(value) ? value : value ? value.split(/\s+/) : []).map((v) => v.trim()).filter(Boolean);

const htmlToText = (html: string) =>
  html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();

export async function parseEmail(source: Buffer | string): Promise<ParsedEmail> {
  const parsed = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
  const html = typeof parsed.html === 'string' ? parsed.html : '';
  const text = parsed.text?.trim() || (html ? htmlToText(html) : '');
  const from = addresses(parsed.from)[0] ?? { email: '' };
  const replyTo = addresses(parsed.replyTo)[0]?.email ?? null;

  return {
    messageId: parsed.messageId ?? null,
    inReplyTo: ids(parsed.inReplyTo)[0] ?? null,
    references: ids(parsed.references),
    subject: parsed.subject ?? '',
    from,
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
    replyTo: replyTo && replyTo !== from.email ? replyTo : null,
    deliveredTo: rawHeader(parsed, 'delivered-to') ?? rawHeader(parsed, 'x-original-to'),
    date: parsed.date?.getTime() ?? Date.now(),
    text,
    html,
    attachments: parsed.attachments.map((a, index) => ({
      index,
      filename: a.filename ?? `piece-jointe-${index + 1}`,
      contentType: a.contentType,
      size: a.size,
      inline: a.contentDisposition === 'inline' && Boolean(a.cid),
      cid: a.cid,
    })),
    listUnsubscribe: rawHeader(parsed, 'list-unsubscribe'),
    listUnsubscribePost: rawHeader(parsed, 'list-unsubscribe-post'),
    listId: rawHeader(parsed, 'list-id'),
    precedence: rawHeader(parsed, 'precedence'),
    autoSubmitted: rawHeader(parsed, 'auto-submitted'),
    authResults: rawHeader(parsed, 'authentication-results'),
    spamHeader: rawHeader(parsed, 'x-spam-flag') ?? rawHeader(parsed, 'x-spam-status'),
  };
}

export async function extractAttachment(source: Buffer, index: number) {
  const parsed = await simpleParser(source);
  const attachment = parsed.attachments[index];
  if (!attachment) return null;
  return { filename: attachment.filename ?? `piece-jointe-${index + 1}`, contentType: attachment.contentType, content: attachment.content, cid: attachment.cid };
}

export async function inlineImages(source: Buffer) {
  const parsed = await simpleParser(source);
  return parsed.attachments
    .filter((a) => a.cid)
    .map((a) => ({ cid: a.cid!, dataUrl: `data:${a.contentType};base64,${a.content.toString('base64')}` }));
}
