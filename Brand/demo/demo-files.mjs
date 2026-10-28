// Writes the two documents the compose assistant attaches in the demo (Sophie asks for them),
// into ~/Documents/ZMail Demo. Delete that folder once the captures are done.
//   node Brand/demo/demo-files.mjs <playwright dir>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [playwrightDir] = process.argv.slice(2);
if (!playwrightDir) throw new Error('usage: demo-files.mjs <playwright dir>');
const { chromium } = createRequire(join(playwrightDir, 'package.json'))('playwright');
const out = join(homedir(), 'Documents', 'ZMail Demo');
mkdirSync(out, { recursive: true });
const docs = [
  ['Engagement letter - Ledgerline (signed).pdf', '<h1>Engagement letter</h1><p>Ledgerline Accounting and Nordlys Studio LLC agree on the year-end closing and annual accounts for fiscal year 2026.</p><p>Signed: Adam, Nordlys Studio — Sophie Laurent, Ledgerline Accounting</p>'],
  ['Nimbus Cloud invoice - March 2026.pdf', '<h1>Invoice INV-2026-03-3120</h1><p>Nimbus Cloud — March 2026 invoice</p><p>Bill to: Nordlys Studio LLC</p><p>Cloud hosting, March 2026: $184.20</p>'],
];
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
for (const [name, body] of docs) {
  await page.setContent(`<html><body style="font-family:Helvetica;padding:60px">${body}</body></html>`);
  await page.pdf({ path: join(out, name), format: 'Letter' });
}
await browser.close();
console.log(out);
