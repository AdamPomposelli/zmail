import { ImapFlow } from 'imapflow';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import nodemailer from 'nodemailer';
import { MAILS, type FixtureMail } from './mails';

export const TEST_SERVER = { host: '127.0.0.1', imapPort: 3143, smtpPort: 3025 };

const FOLDERS = ['Sent', 'Trash', 'Junk', 'Archive', 'Drafts'];

export async function buildRaw(mail: FixtureMail, index: number, threadIds: Map<string, string[]>) {
  const messageId = `<fixture-${index}-${mail.thread ?? 'single'}@zmail.test>`;
  const previous = mail.thread ? (threadIds.get(mail.thread) ?? []) : [];
  if (mail.thread) threadIds.set(mail.thread, [...previous, messageId]);
  // A branch answers an earlier mail of the thread, not the last one.
  const parents = mail.answers === undefined ? previous : previous.slice(0, mail.answers + 1);
  return new MailComposer({
    from: { name: mail.fromName, address: mail.from },
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    date: new Date(Date.now() - mail.hoursAgo * 3600_000),
    messageId,
    inReplyTo: parents.at(-1),
    references: parents.length ? parents.join(' ') : undefined,
    headers: mail.headers,
  })
    .compile()
    .build();
}

export async function imapFor(email: string) {
  const client = new ImapFlow({
    host: TEST_SERVER.host,
    port: TEST_SERVER.imapPort,
    secure: false,
    auth: { user: email, pass: email },
    logger: false,
  });
  await client.connect();
  return client;
}

/** Wipes and refills the demo mailboxes on the local GreenMail server. */
export async function seedMailboxes(mails: FixtureMail[] = MAILS) {
  const owners = new Map<string, FixtureMail[]>();
  for (const mail of mails) {
    const owner = mail.folder === 'Sent' ? mail.from : mail.to;
    owners.set(owner, [...(owners.get(owner) ?? []), mail]);
  }
  const threadIds = new Map<string, string[]>();
  const ordered = [...mails].sort((a, b) => b.hoursAgo - a.hoursAgo);
  const raws = new Map<FixtureMail, Buffer>();
  for (const [i, mail] of ordered.entries()) raws.set(mail, await buildRaw(mail, i, threadIds));

  for (const [owner, items] of owners) {
    const client = await imapFor(owner);
    try {
      for (const folder of ['INBOX', ...FOLDERS]) {
        await client.mailboxCreate(folder).catch(() => undefined);
        const lock = await client.getMailboxLock(folder);
        try {
          if ((client.mailbox && client.mailbox !== true && client.mailbox.exists) || 0) await client.messageDelete('1:*');
        } finally {
          lock.release();
        }
      }
      for (const mail of items) {
        await client.append(mail.folder ?? 'INBOX', raws.get(mail)!, mail.seen || mail.folder === 'Sent' ? ['\\Seen'] : [], new Date(Date.now() - mail.hoursAgo * 3600_000));
      }
    } finally {
      await client.logout();
    }
  }
}

/** Delivers a mail through SMTP, as a real new arrival (exercises IMAP IDLE). */
export async function deliver(mail: Omit<FixtureMail, 'hoursAgo'> & { hoursAgo?: number }) {
  const transport = nodemailer.createTransport({ host: TEST_SERVER.host, port: TEST_SERVER.smtpPort, secure: false, ignoreTLS: true });
  await transport.sendMail({
    from: { name: mail.fromName, address: mail.from },
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    headers: mail.headers,
  });
}
