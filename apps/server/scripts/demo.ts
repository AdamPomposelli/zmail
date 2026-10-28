/**
 * Demo engine: refills the local GreenMail server with realistic mail, then runs a fresh
 * engine connected to the five demo mailboxes. `pnpm testmail:up` first.
 *
 *   ZMAIL_DATA_DIR=/tmp/zmail-demo tsx scripts/demo.ts [--keep] [--lang en]
 *
 * `--lang en` seeds the English mailboxes (test/fixtures/mails-en.ts) and sets the engine to English.
 */
import { serve } from '@hono/node-server';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { EngineContext } from '../src/context';
import { createApp } from '../src/server';
import { ACCOUNTS as ACCOUNTS_FR, BUSINESSES as BUSINESSES_FR, MAILS, UNSUB_BASE, type FixtureMail } from '../test/fixtures/mails';
import { ACCOUNTS_EN, BUSINESSES_EN, MAILS_EN } from '../test/fixtures/mails-en';
import { seedMailboxes, TEST_SERVER } from '../test/fixtures/seed';
import { startUnsubscribeMock } from '../test/fixtures/unsubscribe-mock';

process.env.ZMAIL_NO_KEYCHAIN = '1';
const dataDir = process.env.ZMAIL_DATA_DIR ?? join(tmpdir(), 'zmail-demo');
const keep = process.argv.includes('--keep');
const english = process.argv.includes('--lang') && process.argv[process.argv.indexOf('--lang') + 1] === 'en';
const ACCOUNTS = english ? ACCOUNTS_EN : ACCOUNTS_FR;
const BUSINESSES = english ? BUSINESSES_EN : BUSINESSES_FR;
if (!keep) rmSync(dataDir, { recursive: true, force: true });

await startUnsubscribeMock();
// A sender the demo user keeps deleting: trashing these three shows the rule suggestion.
const deals: FixtureMail[] = [1, 2, 3].map((n) => ({
  to: 'adam.perso@gmail.test',
  from: 'deals@promo-flash.test',
  fromName: 'Promo Flash',
  subject: ['Deal du jour : -60 % sur les écouteurs', 'Vente flash : montres connectées', 'Dernière chance : -70 % ce soir'][n - 1]!,
  text: 'Soldes flash, offre exclusive, code promo FLASH60. Livraison offerte.',
  hoursAgo: 30 + n * 20,
  headers: { 'List-Unsubscribe': `<${UNSUB_BASE}/one-click/promo-flash>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
}));
// A long accounting conversation, replies of replies plus one side branch (Betterbird-style tree).
const closing: FixtureMail[] = [
  { fromName: 'Maxime Guerin', from: 'maxime.guerin@cabinet-demo.test', subject: 'tarifs fermeture', text: 'Bonjour Adam, voici nos tarifs pour la fermeture de la société.', hoursAgo: 24 * 28 },
  { fromName: 'Adam Pomposelli', from: 'adam@nordlys.studio', subject: 'Re: tarifs fermeture', text: 'Merci Maxime, quels documents faut-il préparer ?', hoursAgo: 24 * 21 },
  { fromName: 'Maxime Guerin', from: 'maxime.guerin@cabinet-demo.test', subject: 'Re: tarifs fermeture', text: 'Le grand livre et les relevés bancaires de l’année.', hoursAgo: 24 * 21 - 5 },
  { fromName: 'Adam Pomposelli', from: 'adam@nordlys.studio', subject: 'Re: tarifs fermeture', text: 'Les relevés sont en pièce jointe.', hoursAgo: 24 * 20 },
  { fromName: 'Maxime Guerin', from: 'maxime.guerin@cabinet-demo.test', subject: 'Re: tarifs fermeture', text: 'Bien reçu, il manque décembre.', hoursAgo: 24 * 13 },
  { fromName: 'Maxime Guerin', from: 'maxime.guerin@cabinet-demo.test', subject: 'Re: tarifs fermeture', text: 'C’est bon pour moi, je lance la procédure.', hoursAgo: 24 * 10 },
  { fromName: 'Sophie Laurent', from: 'sophie.laurent@cabinet-demo.test', subject: 'Re: tarifs fermeture', text: 'Je joins la facture d’acompte, en copie de Maxime.', hoursAgo: 24 * 5, answers: 0 },
].map((m) => ({ ...m, to: 'adam@nordlys.studio', thread: 'tarifs-fermeture' }));
if (!keep) await seedMailboxes(english ? MAILS_EN : [...MAILS, ...deals, ...closing]);
const engine = await EngineContext.create(dataDir);
if (english) engine.db.setSetting('locale', 'en');

if (engine.accounts.list().length === 0) {
  const ids: Record<string, string> = {};
  for (const b of BUSINESSES) {
    ids[b.key] = engine.catalog.saveBusiness({ name: b.name, emoji: b.emoji, color: b.color, description: b.description, matchers: b.domains.map((value) => ({ type: 'domain' as const, value })) }).id;
  }
  for (const a of ACCOUNTS) {
    await engine.accounts.create({
      email: a.email,
      name: a.name,
      provider: a.email.endsWith('gmail.test') ? 'gmail' : a.email.endsWith('mailbox.test') ? 'mailbox-org' : 'custom',
      imapHost: TEST_SERVER.host,
      imapPort: TEST_SERVER.imapPort,
      imapSecure: false,
      smtpHost: TEST_SERVER.host,
      smtpPort: TEST_SERVER.smtpPort,
      smtpSecure: false,
      username: a.email,
      password: a.email,
      businessId: ids[a.business],
    });
  }
} else {
  engine.accounts.startAll();
}
engine.pipeline.backfill();

const port = Number(process.env.ZMAIL_PORT ?? 47812);
const uiDir = process.env.ZMAIL_UI_DIR ? resolve(process.env.ZMAIL_UI_DIR) : undefined;
serve({ fetch: createApp(engine, uiDir).fetch, port, hostname: '127.0.0.1' }, () => console.log(`demo engine on http://127.0.0.1:${port} (data: ${dataDir})`));
