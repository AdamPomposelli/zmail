import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EngineContext } from '../src/context';
import { ACCOUNTS, BUSINESSES } from './fixtures/mails';
import { deliver, imapFor, seedMailboxes, TEST_SERVER } from './fixtures/seed';
import { startUnsubscribeMock } from './fixtures/unsubscribe-mock';
import { createTestEngine, waitFor, type FakeBridge } from './helpers';

/**
 * End to end against a real IMAP/SMTP server (GreenMail, `pnpm testmail:up`):
 * sync, triage, IDLE push, notifications, server-side actions, learned rules, unsubscribe.
 */
let engine: EngineContext;
let bridge: FakeBridge;
let mock: Awaited<ReturnType<typeof startUnsubscribeMock>>;
const businessIds: Record<string, string> = {};
const accountIds: Record<string, string> = {};

const thread = (subject: string, view: 'inbox' | 'spam' | 'trash' | 'archive' = 'inbox') =>
  engine.store.listThreads({ view, limit: 200 }).items.find((t) => t.subject === subject);

beforeAll(async () => {
  mock = await startUnsubscribeMock();
  await seedMailboxes();
  ({ engine, bridge } = await createTestEngine());

  for (const b of BUSINESSES) {
    businessIds[b.key] = engine.catalog.saveBusiness({
      name: b.name,
      emoji: b.emoji,
      color: b.color,
      description: b.description,
      matchers: b.domains.map((value) => ({ type: 'domain' as const, value })),
    }).id;
  }
  for (const a of ACCOUNTS) {
    const account = await engine.accounts.create({
      email: a.email,
      name: a.name,
      provider: 'custom',
      imapHost: TEST_SERVER.host,
      imapPort: TEST_SERVER.imapPort,
      imapSecure: false,
      smtpHost: TEST_SERVER.host,
      smtpPort: TEST_SERVER.smtpPort,
      smtpSecure: false,
      username: a.email,
      password: a.email,
    });
    accountIds[a.email] = account.id;
  }
  await waitFor(() => engine.accounts.list().every((a) => a.initialSyncDone && a.status === 'idle'), { timeout: 60_000 });
  await engine.pipeline.idle();
});

afterAll(async () => {
  await engine?.accounts.stopAll();
  await mock?.close();
});

describe('sync & unified inbox', () => {
  it('imports every account into one inbox, threads included', () => {
    const inbox = engine.store.listThreads({ view: 'inbox', limit: 200 }).items;
    expect(new Set(inbox.map((t) => t.accountId)).size).toBe(ACCOUNTS.length);
    const fermes = inbox.find((t) => t.subject.includes('maquette v2'))!;
    expect(fermes.count).toBe(3);
    expect(engine.store.getThread(fermes.id)!.messages.map((m) => m.mailbox)).toEqual(['inbox', 'sent', 'inbox']);
  });

  it('sorts the inbox by priority first', () => {
    const inbox = engine.store.listThreads({ view: 'inbox', limit: 200 }).items;
    const firstNormal = inbox.findIndex((t) => t.priority < 2);
    expect(firstNormal).toBeGreaterThan(0);
    expect(inbox.slice(firstNormal).every((t) => t.priority < 2 || !t.unread)).toBe(true);
    expect(inbox[0]!.priority).toBe(3);
  });

  it('removes spam from the inbox', () => {
    expect(thread('FÉLICITATIONS !!! VOUS AVEZ GAGNÉ UN IPHONE 17')).toBeUndefined();
    expect(thread('FÉLICITATIONS !!! VOUS AVEZ GAGNÉ UN IPHONE 17', 'spam')?.spam).toBe(true);
    expect(thread('Your account will be suspended', 'spam')).toBeDefined();
  });
});

describe('triage', () => {
  it('extracts OTP codes', () => {
    expect(thread('Votre code de vérification Paylane')?.otp).toBe('482913');
    expect(thread('Sign-in code for CloudForge')?.otp).toBe('715264');
  });

  it('assigns businesses from the receiving address', () => {
    expect(thread('Litige ouvert : chargeback de 249,00 € sur la commande #10482')?.businessId).toBe(businessIds.shop);
    expect(thread('Demande de devis — application mobile de réservation')?.businessId).toBe(businessIds.studio);
    expect(thread('Dîner samedi ?')?.businessId).toBe(businessIds.perso);
    const shopOnly = engine.store.listThreads({ view: 'inbox', businessId: businessIds.shop, limit: 100 }).items;
    expect(shopOnly.length).toBeGreaterThan(2);
    expect(shopOnly.every((t) => t.accountEmail === 'support@maisonvelours.shop')).toBe(true);
  });

  it('flags urgent issues and opportunities per business', () => {
    const chargeback = thread('Litige ouvert : chargeback de 249,00 € sur la commande #10482')!;
    expect(chargeback.priority).toBe(3);
    expect(chargeback.tags).toContain('chargeback');
    const opportunities = engine.store.listThreads({ view: 'opportunities', limit: 50 }).items.map((t) => t.subject);
    expect(opportunities).toEqual(
      expect.arrayContaining(['Demande de devis — application mobile de réservation', 'Commande en gros : 120 parures de lit pour notre hôtel']),
    );
    expect(opportunities).not.toContain('Boostez vos ventes x10 avec notre IA');
  });

  it('recognises newsletters and their unsubscribe method', () => {
    const devpulse = engine.store.getThread(thread('DevPulse #212 — React 20, Bun 2 et la fin des frameworks CSS')!.id)!;
    expect(devpulse.newsletter).toBe(true);
    expect(devpulse.unsubscribe?.oneClick).toContain('/one-click/devpulse');
    expect(devpulse.priority).toBe(0);
  });
});

describe('live mail (IMAP IDLE) & notifications', () => {
  it('pushes a new OTP mail within seconds and notifies with the code', async () => {
    bridge.notifications = [];
    await deliver({ to: 'adam@nordlys.studio', from: 'security@vaultly.test', fromName: 'Vaultly', subject: 'Votre code de connexion Vaultly', text: 'Votre code de connexion : 551209\nValable 5 minutes.' });
    const notification = await waitFor(() => bridge.notifications.find((n) => n.kind === 'otp'), { timeout: 15_000 });
    expect(notification.otp).toBe('551209');
    expect(notification.threadId).toBeTruthy();
  });

  it('notifies an urgent chargeback, never spam', async () => {
    bridge.notifications = [];
    await deliver({ to: 'support@maisonvelours.shop', from: 'disputes@paylane.test', fromName: 'Paylane Disputes', subject: 'Nouveau chargeback : 59,00 € (commande #10533)', text: 'Un client a ouvert un litige sur un paiement de 59,00 €.' });
    await deliver({ to: 'adam.perso@gmail.test', from: 'winner@lucky-prize.test', fromName: 'Gains', subject: 'Vous avez gagné !!!', text: 'Vous avez gagné un prix, réclamez votre prix maintenant.' });
    const urgent = await waitFor(() => bridge.notifications.find((n) => n.kind === 'priority'), { timeout: 15_000 });
    expect(urgent.title).toContain('Urgent');
    await new Promise((r) => setTimeout(r, 1500));
    expect(bridge.notifications.some((n) => n.body.includes('gagné'))).toBe(false);
  });
});

describe('folders and labels', () => {
  it('syncs a folder whose mails are all older than the sync window (Gmail label « Comptabilité »)', async () => {
    const email = 'adam.perso@gmail.test';
    const client = await imapFor(email);
    try {
      await client.mailboxCreate('Comptabilite-Ancienne').catch(() => undefined);
      const raw = ['From: Maxime Guerin <maxime@cabinet.test>', `To: ${email}`, 'Subject: Déclaration de TVA de mai', 'Message-ID: <tva-mai@cabinet.test>', 'Date: Tue, 03 Jun 2025 09:00:00 +0000', '', 'Votre déclaration est jointe.'].join('\r\n');
      await client.append('Comptabilite-Ancienne', raw, ['\\Seen'], new Date('2025-06-03T09:00:00Z'));
    } finally {
      await client.logout();
    }
    const worker = engine.accounts.worker(accountIds[email]!);
    await worker.sync({ refreshFolders: true });
    const box = engine.db.get<{ id: string }>(`SELECT id FROM mailboxes WHERE account_id = ? AND path = 'Comptabilite-Ancienne'`, accountIds[email]!)!;
    const items = engine.store.listThreads({ view: 'folder', mailboxId: box.id, limit: 20 }).items;
    expect(items.map((i) => i.subject)).toContain('Déclaration de TVA de mai');
  });

  it('loads a folder’s older mails from the server, a page at a time', async () => {
    const email = 'adam.perso@gmail.test';
    const client = await imapFor(email);
    try {
      await client.mailboxCreate('Gros-Dossier').catch(() => undefined);
      for (let n = 1; n <= 5; n++) {
        const raw = [`From: Archive <archive@old.test>`, `To: ${email}`, `Subject: Ancien ${n}`, `Message-ID: <old-${n}@old.test>`, `Date: Mon, 0${n} Jan 2024 10:00:00 +0000`, '', 'Texte.'].join('\r\n');
        await client.append('Gros-Dossier', raw, ['\\Seen'], new Date(`2024-01-0${n}T10:00:00Z`));
      }
    } finally {
      await client.logout();
    }
    const worker = engine.accounts.worker(accountIds[email]!);
    await worker.sync({ refreshFolders: true });
    const box = engine.db.get<{ id: string }>(`SELECT id FROM mailboxes WHERE account_id = ? AND path = 'Gros-Dossier'`, accountIds[email]!)!;
    // Pretend the sync kept only the latest two (as it keeps the latest 200 of a big folder).
    engine.db.run(`DELETE FROM messages WHERE mailbox_id = ? AND subject IN ('Ancien 1', 'Ancien 2', 'Ancien 3')`, box.id);
    const subjects = () => engine.store.listThreads({ view: 'folder', mailboxId: box.id, limit: 20 }).items.map((i) => i.subject).sort();
    expect(subjects()).toEqual(['Ancien 4', 'Ancien 5']);
    expect(await worker.loadOlder(box.id, 2)).toEqual({ fetched: 2, more: true });
    expect(subjects()).toEqual(['Ancien 2', 'Ancien 3', 'Ancien 4', 'Ancien 5']);
    expect(await worker.loadOlder(box.id, 2)).toEqual({ fetched: 1, more: false });
    expect(subjects()).toEqual(['Ancien 1', 'Ancien 2', 'Ancien 3', 'Ancien 4', 'Ancien 5']);
  });
});

describe('actions are mirrored on the IMAP server', () => {
  it('archives a thread into the Archive folder', async () => {
    const t = thread('Votre colis a été expédié')!;
    await engine.actions.archive([t.id]);
    expect(thread('Votre colis a été expédié')).toBeUndefined();
    const client = await imapFor('adam.perso@gmail.test');
    try {
      const lock = await client.getMailboxLock('Archive');
      try {
        const subjects: string[] = [];
        for await (const m of client.fetch('1:*', { envelope: true })) subjects.push(m.envelope?.subject ?? '');
        expect(subjects).toContain('Votre colis a été expédié');
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
    expect(engine.store.listThreads({ view: 'archive', limit: 50 }).items.map((i) => i.subject)).toContain('Votre colis a été expédié');
  });

  it('files a conversation into one of the account’s folders (drag onto the sidebar)', async () => {
    const email = 'adam.perso@gmail.test';
    const client = await imapFor(email);
    await client.mailboxCreate('Voyages').catch(() => undefined);
    await client.logout();
    const worker = engine.accounts.worker(accountIds[email]!);
    await worker.sync({ refreshFolders: true });
    const box = engine.db.get<{ id: string }>(`SELECT id FROM mailboxes WHERE account_id = ? AND path = 'Voyages'`, accountIds[email]!)!;
    const t = engine.store.listThreads({ view: 'inbox', accountId: accountIds[email]!, limit: 50 }).items[0]!;
    await engine.actions.moveToFolder([t.id], box.id);
    expect(engine.store.listThreads({ view: 'inbox', limit: 200 }).items.find((i) => i.id === t.id)).toBeUndefined();
    expect(engine.store.listThreads({ view: 'folder', mailboxId: box.id, limit: 20 }).items.map((i) => i.subject)).toContain(t.subject);
    const check = await imapFor(email);
    try {
      const lock = await check.getMailboxLock('Voyages');
      try {
        const subjects: string[] = [];
        for await (const m of check.fetch('1:*', { envelope: true })) subjects.push(m.envelope?.subject ?? '');
        expect(subjects).toContain(t.subject);
      } finally {
        lock.release();
      }
    } finally {
      await check.logout();
    }
  });

  it('moves a folder into another one on the server, keeping its mails, then back to the top', async () => {
    const email = 'adam.perso@gmail.test';
    // The IMAP test server outlives a run: names of this run only.
    const run = Date.now().toString(36);
    const [name, parentName] = [`Projets ${run}`, `Archives ${run}`];
    const client = await imapFor(email);
    await client.mailboxCreate(name);
    await client.mailboxCreate(parentName);
    const subject = `Devis classé ${run}`;
    await client.append(name, `From: Claire <claire@client.test>\r\nTo: ${email}\r\nSubject: ${subject}\r\nMessage-ID: <${run}@zmail.test>\r\nDate: ${new Date().toUTCString()}\r\n\r\nCi-joint le devis.\r\n`);
    await client.logout();
    const worker = engine.accounts.worker(accountIds[email]!);
    await worker.sync({ refreshFolders: true });
    const box = (path: string) => engine.db.get<{ id: string; path: string }>(`SELECT id, path FROM mailboxes WHERE account_id = ? AND path = ?`, accountIds[email]!, path);
    const folder = box(name)!;
    const parent = box(parentName)!;
    await worker.syncFolder(folder.id);
    const t = engine.store.listThreads({ view: 'folder', mailboxId: folder.id, limit: 20 }).items.find((i) => i.subject === subject)!;
    expect(t).toBeDefined();

    const moved = await worker.moveFolder(folder.id, parent.id);
    expect(moved.path).toMatch(new RegExp(`^${parentName}[./]${name}$`));
    expect(box(name)).toBeUndefined();
    // Same folder, same mails: only its path changed.
    expect(box(moved.path)?.id).toBe(folder.id);
    expect(engine.store.listThreads({ view: 'folder', mailboxId: folder.id, limit: 20 }).items.map((i) => i.id)).toContain(t.id);
    const check = await imapFor(email);
    try {
      const paths = (await check.list()).map((m) => m.path);
      expect(paths).toContain(moved.path);
      expect(paths).not.toContain(name);
    } finally {
      await check.logout();
    }

    await expect(worker.moveFolder(parent.id, folder.id)).rejects.toThrow(/sous-dossiers/);
    // Back to the top level. GreenMail answers OK to this RENAME without doing it (Dovecot,
    // Gmail… do it): either way the folder and its mails stay consistent with the server.
    const back = await worker.moveFolder(folder.id, null).catch((e: Error) => e);
    if (back instanceof Error) {
      expect(back.message).toMatch(/n’a pas déplacé/);
      expect(box(moved.path)?.id).toBe(folder.id);
    } else expect(box(name)?.id).toBe(folder.id);
    expect(engine.store.listThreads({ view: 'folder', mailboxId: folder.id, limit: 20 }).items.map((i) => i.id)).toContain(t.id);

    const cleanup = await imapFor(email);
    for (const m of (await cleanup.list()).filter((x) => x.path.includes(run)).sort((x, y) => y.path.length - x.path.length)) await cleanup.mailboxDelete(m.path).catch(() => undefined);
    await cleanup.logout();
  });

  it('creates, renames, marks read and deletes a folder on the server, its mails going to the Trash', async () => {
    const email = 'adam.perso@gmail.test';
    const run = Date.now().toString(36);
    const worker = engine.accounts.worker(accountIds[email]!);
    const box = (path: string) => engine.db.get<{ id: string; path: string }>(`SELECT id, path FROM mailboxes WHERE account_id = ? AND path = ?`, accountIds[email]!, path);
    const serverPaths = async () => {
      const c = await imapFor(email);
      try {
        return (await c.list()).map((m) => m.path);
      } finally {
        await c.logout();
      }
    };

    const created = await worker.createFolder(null, `spam ${run}`);
    expect(await serverPaths()).toContain(created.path);
    await expect(worker.createFolder(null, `spam ${run}`)).rejects.toThrow(/existe déjà/);
    const child = await worker.createFolder(created.id, 'Vieux');
    expect(child.path).toMatch(new RegExp(`^spam ${run}[./]Vieux$`));
    // An empty subfolder goes away on its own. (GreenMail can never delete a folder renamed while
    // it had a subfolder: it drops the connection, where Dovecot or Gmail don't. Moving a folder
    // with its subfolders is covered above.)
    expect(await worker.deleteFolder(child.id)).toMatchObject({ deleted: 1, moved: 0 });
    expect(await serverPaths()).not.toContain(child.path);

    const renamed = await worker.renameFolder(created.id, `Indésirables ${run}`);
    expect(renamed.path).toBe(`Indésirables ${run}`);
    expect(box(renamed.path)?.id).toBe(created.id);
    expect(await serverPaths()).not.toContain(created.path);

    // A mail in it (it goes to the Trash with the folder).
    const c = await imapFor(email);
    await c.append(renamed.path, `From: Julie Martin <julie@amis.test>\r\nTo: ${email}\r\nSubject: Photos ${run}\r\nMessage-ID: <photos-${run}@zmail.test>\r\nDate: ${new Date().toUTCString()}\r\n\r\nLes photos du week-end sont en ligne.\r\n`);
    // « Mark all read » is checked on « Voyages »: GreenMail cannot delete a folder whose mails
    // were just flagged (it drops the connection; Dovecot and Gmail don't).
    await c.mailboxCreate('Voyages').catch(() => undefined);
    await c.append('Voyages', `From: Train <billets@train.test>\r\nTo: ${email}\r\nSubject: Billet ${run}\r\nMessage-ID: <billet-${run}@zmail.test>\r\nDate: ${new Date().toUTCString()}\r\n\r\nVotre billet.\r\n`);
    await c.logout();
    await worker.sync({ refreshFolders: true });
    await worker.syncFolder(created.id);
    const voyages = box('Voyages')!;
    await worker.syncFolder(voyages.id);
    const unread = (id: string) => engine.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE mailbox_id = ? AND unread = 1', id)?.n;
    expect(unread(voyages.id)).toBeGreaterThan(0);
    await worker.markFolderRead(voyages.id);
    expect(unread(voyages.id)).toBe(0);
    const check = await imapFor(email);
    try {
      const lock = await check.getMailboxLock('Voyages');
      try {
        for await (const m of check.fetch('1:*', { flags: true })) expect(m.flags?.has('\\Seen')).toBe(true);
      } finally {
        lock.release();
      }
    } finally {
      await check.logout();
    }

    // System folders are not touched.
    await expect(worker.deleteFolder(engine.db.get<{ id: string }>(`SELECT id FROM mailboxes WHERE account_id = ? AND special_use = 'inbox'`, accountIds[email]!)!.id)).rejects.toThrow(/système/);

    expect(await worker.deleteFolder(created.id)).toMatchObject({ deleted: 1, moved: 1 });
    expect((await serverPaths()).some((p) => p.includes(run))).toBe(false);
    expect(box(renamed.path)).toBeUndefined();
    // The mail is in the Trash, not lost.
    const trash = await imapFor(email);
    try {
      const lock = await trash.getMailboxLock('Trash');
      try {
        const subjects: string[] = [];
        for await (const m of trash.fetch('1:*', { envelope: true })) subjects.push(m.envelope?.subject ?? '');
        expect(subjects).toContain(`Photos ${run}`);
      } finally {
        lock.release();
      }
    } finally {
      await trash.logout();
    }
  });

  it('marks as read on the server', async () => {
    const t = thread('Dîner samedi ?')!;
    await engine.actions.markRead([t.id], true);
    const client = await imapFor('adam.perso@gmail.test');
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const flags: string[][] = [];
        for await (const m of client.fetch('1:*', { envelope: true, flags: true })) {
          if (m.envelope?.subject === 'Dîner samedi ?') flags.push([...(m.flags ?? [])]);
        }
        expect(flags).toEqual([['\\Seen']]);
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  });
});

describe('sending', () => {
  it('replies through SMTP, files the copy in Sent and threads it', async () => {
    const t = thread('Demande de devis — application mobile de réservation')!;
    const original = engine.store.getThread(t.id)!.messages.at(-1)!;
    await engine.actions.send({
      accountId: accountIds['contact@nordlys.studio']!,
      to: ['adam.perso@gmail.test'],
      subject: 'Re: Demande de devis — application mobile de réservation',
      html: '<p>Bonjour Claire, voici notre proposition.</p>',
      inReplyToMessageId: original.id,
    });
    const received = await waitFor(() => engine.store.listThreads({ view: 'inbox', accountId: accountIds['adam.perso@gmail.test'], limit: 100 }).items.find((i) => i.subject.startsWith('Re: Demande de devis')));
    expect(received.from.email).toBe('contact@nordlys.studio');
    await waitFor(() => engine.store.getThread(t.id)!.messages.some((m) => m.mailbox === 'sent'));
    expect(engine.patterns.history().some((h) => h.action === 'reply')).toBe(true);
  });
});

describe('learning from repeated actions', () => {
  it('suggests a rule after the same sender is deleted three times, then applies it', async () => {
    for (let i = 1; i <= 3; i++) {
      await deliver({
        to: 'adam.perso@gmail.test',
        from: 'deals@promo-flash.test',
        fromName: 'Promo Flash',
        subject: `Deal du jour n°${i} : -60 % sur les écouteurs`,
        text: 'Soldes flash, offre exclusive, code promo FLASH60.',
        headers: { 'List-Unsubscribe': '<http://127.0.0.1:47900/one-click/promo-flash>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
    }
    const deals = await waitFor(() => {
      const items = engine.store.listThreads({ view: 'inbox', limit: 200 }).items.filter((t) => t.from.email === 'deals@promo-flash.test');
      return items.length === 3 && items.every((i) => i.newsletter) ? items : null;
    });
    for (const d of deals) await engine.actions.trash([d.id]);

    const suggestion = engine.patterns.pending().find((s) => s.patternKey === 'trash:sender:deals@promo-flash.test')!;
    expect(suggestion).toBeDefined();
    expect(suggestion.title).toMatch(/promo-flash/);
    expect(suggestion.rule.actions.map((a) => a.type)).toEqual(['unsubscribe', 'trash']);

    const rule = engine.rules.create(suggestion.rule, 'suggestion');
    engine.patterns.decide(suggestion.id, 'accepted');
    expect(engine.patterns.pending().some((s) => s.id === suggestion.id)).toBe(false);

    await deliver({ to: 'adam.perso@gmail.test', from: 'deals@promo-flash.test', fromName: 'Promo Flash', subject: 'Deal du jour n°4', text: 'Encore des soldes, code promo FLASH70.' });
    await waitFor(() => engine.store.listThreads({ view: 'trash', limit: 200 }).items.some((t) => t.subject === 'Deal du jour n°4'));
    expect(thread('Deal du jour n°4')).toBeUndefined();
    expect(engine.rules.get(rule.id)!.hits).toBeGreaterThanOrEqual(1);
    await waitFor(() => mock.unsubscribed.has('promo-flash'));
  });

  it('logs every user action', () => {
    const actions = engine.patterns.history().map((h) => h.action);
    expect(actions).toEqual(expect.arrayContaining(['trash', 'archive', 'markRead']));
  });
});

describe('one-click unsubscribe agent', () => {
  it('uses RFC 8058 one-click when available', async () => {
    const outcome = await engine.subscriptions.unsubscribe(thread('DevPulse #212 — React 20, Bun 2 et la fin des frameworks CSS')!.id);
    expect(outcome).toMatchObject({ status: 'success', method: 'one-click' });
    expect(mock.unsubscribed.has('devpulse')).toBe(true);
  });

  it('fills and submits an unsubscribe form', async () => {
    const outcome = await engine.subscriptions.unsubscribe(thread('🔥 -40 % sur tout le site : derniers jours !')!.id);
    expect(outcome).toMatchObject({ status: 'success', method: 'http-form' });
    expect(mock.unsubscribed.has('deco-maison')).toBe(true);
  });

  it('sends the mailto request when only an address is given', async () => {
    const outcome = await engine.subscriptions.unsubscribe(thread('La lettre du dimanche : ce qu’il faut retenir de la semaine')!.id);
    expect(outcome).toMatchObject({ status: 'success', method: 'mailto' });
  });

  it('notifies when it cannot finish (captcha)', async () => {
    bridge.notifications = [];
    const outcome = await engine.subscriptions.unsubscribe(thread('Flash sale : Lisbonne dès 39 €')!.id);
    expect(outcome.status).toBe('failed');
    expect(outcome.manualUrl).toContain('/captcha/horizon');
    expect(bridge.notifications.find((n) => n.kind === 'unsubscribe_failed')?.title).toBe('Désinscription impossible');
  });
});

describe('conversational agent', () => {
  it('turns « notifie-moi des chargebacks » into a notification rule', async () => {
    const reply = await engine.agent.chat('Notifie-moi de tous les chargebacks', []);
    expect(reply.steps[0]).toMatchObject({ tool: 'notify_on', ok: true });
    const rule = engine.rules.list().find((r) => r.source === 'agent')!;
    expect(rule.actions).toEqual([{ type: 'notify' }]);
    expect(rule.conditions).toEqual(expect.arrayContaining([{ field: 'tag', op: 'is', value: 'chargeback' }]));

    bridge.notifications = [];
    await deliver({ to: 'support@maisonvelours.shop', from: 'disputes@paylane.test', fromName: 'Paylane Disputes', subject: 'Chargeback reçu sur la commande #10601', text: 'Un chargeback a été reçu.' });
    const n = await waitFor(() => bridge.notifications.find((x) => x.kind === 'rule'), { timeout: 15_000 });
    expect(n.title).toContain('Chargeback');
  });

  it('answers « quels sont mes mails importants ? » with threads', async () => {
    const reply = await engine.agent.chat('Quels sont mes mails importants ?', []);
    expect(reply.threads.length).toBeGreaterThan(0);
    expect(reply.threads.every((t) => t.priority >= 2)).toBe(true);
  });
});

describe('server sync', () => {
  /** Server-side state of a message: its folder and IMAP keywords. */
  const onServer = async (email: string, subject: string) => {
    const client = await imapFor(email);
    try {
      for (const folder of ['INBOX', 'Junk']) {
        const lock = await client.getMailboxLock(folder);
        try {
          // fetchAll: leaving a fetch() iterator early keeps the mailbox locked.
          const found = (await client.fetchAll('1:*', { envelope: true, flags: true })).find((m) => m.envelope?.subject === subject);
          if (found) return { folder, flags: [...(found.flags ?? [])] };
        } finally {
          lock.release();
        }
      }
      return null;
    } finally {
      await client.logout();
    }
  };
  const SPAM = 'FÉLICITATIONS !!! VOUS AVEZ GAGNÉ UN IPHONE 17';

  it('keeps the AI sorting local by default but mirrors what you categorise yourself', async () => {
    expect(engine.serverSync.mode()).toBe('manual');
    expect((await onServer('adam.perso@gmail.test', SPAM))?.folder).toBe('INBOX');

    const t = thread('Dîner samedi ?')!;
    const tag = engine.catalog.tags().find((x) => x.name === 'Réunion')!;
    expect(t.tags).not.toContain(tag.id);
    engine.actions.setTags([t.id], [tag.id], []);
    await waitFor(async () => (await onServer('adam.perso@gmail.test', t.subject))?.flags.includes('ZMail_Reunion'), { timeout: 15_000 });
    // …and removing it removes it on the server too.
    engine.actions.setTags([t.id], [], [tag.id]);
    await waitFor(async () => !(await onServer('adam.perso@gmail.test', t.subject))?.flags.includes('ZMail_Reunion'), { timeout: 15_000 });
  });

  it('measures how much the AI was corrected before trusting it', () => {
    const trust = engine.serverSync.trust();
    expect(trust.decisions).toBeGreaterThan(0);
    expect(trust.ready).toBe(false); // the fixtures are hours old, not two weeks
    expect(trust.daysLeft).toBeGreaterThan(0);
  });

  it('once trusted, sends AI spam to Junk and AI tags to the server', async () => {
    await engine.serverSync.setMode('all');
    await waitFor(async () => (await onServer('adam.perso@gmail.test', SPAM))?.folder === 'Junk', { timeout: 30_000 });
    expect(thread(SPAM, 'spam')).toBeDefined();
    expect(thread(SPAM)).toBeUndefined();
    const report = await waitFor(() => engine.serverSync.lastReport(), { timeout: 30_000 });
    expect(report.movedToJunk).toBeGreaterThan(0);
    expect(report.labelled).toBeGreaterThan(0);
    await engine.serverSync.setMode('manual');
  });
});
