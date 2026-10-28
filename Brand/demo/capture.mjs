// Captures the real ZMail UI for the README demo (see Brand/demo/README.md).
// Needs the English demo engine (port 47814 in .claude/launch.json):
//   pnpm --filter @zmail/engine exec tsx scripts/demo.ts --lang en
// with an AI connection for the compose assistant (scripts/copy-ai-connection.ts), and the two
// documents it attaches somewhere in ~/Documents (see README.md).
//
//   node Brand/demo/capture.mjs <playwright dir> <out dir> [base url]
//
// Every PNG is a real screenshot, 1920×1080 at device scale 2, dark mode. boxes.json says where
// the elements the camera aims at are, in CSS px.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [playwrightDir, out, base = 'http://localhost:47814'] = process.argv.slice(2);
if (!playwrightDir || !out) throw new Error('usage: capture.mjs <playwright dir> <out dir> [base url]');
const { chromium } = createRequire(join(playwrightDir, 'package.json'))('playwright');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: 'dark', locale: 'en-US' });
await context.addInitScript(() => {
  localStorage.setItem('zmail.locale', 'en');
  // Runs on every page load: only a default, so a theme set later sticks.
  if (!localStorage.getItem('theme')) localStorage.setItem('theme', 'dark');
});
const page = await context.newPage();
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' });
const settle = (ms = 900) => page.waitForTimeout(ms);
const boxes = {};

// The smallest ancestor of the element holding `text` whose box fits the given limits.
const around = (text, limits) =>
  page.evaluate(
    ([text, limits]) => {
      const own = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      const hit = [...document.querySelectorAll('body *')].find((e) => own(e) === text && e.getBoundingClientRect().width > 0);
      for (let e = hit; e; e = e.parentElement) {
        const r = e.getBoundingClientRect();
        if (r.width >= (limits.minW ?? 0) && r.width <= (limits.maxW ?? 1e9) && r.height >= (limits.minH ?? 0) && r.height <= (limits.maxH ?? 1e9)) return { x: r.x, y: r.y, width: r.width, height: r.height };
      }
      return null;
    },
    [text, limits],
  );
const union = (...bs) => {
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  return { x, y, width: Math.max(...bs.map((b) => b.x + b.width)) - x, height: Math.max(...bs.map((b) => b.y + b.height)) - y };
};
const need = (name, b) => {
  if (!b) throw new Error(`capture: could not find ${name}`);
  boxes[name] = b;
};

// 1. The inbox, sorted by the AI.
await page.goto(`${base}/mail/inbox`);
await page.getByText('Your Paylane verification code').first().waitFor({ timeout: 120_000 });
await settle(3000);
need('sidebar', await around('New message', { minW: 200, maxW: 420, minH: 600 }));
need('list', await around('Your Paylane verification code', { minW: 420, maxW: 1000, minH: 600 }));
const row = (subject) => around(subject, { minW: 380, maxW: 1000, minH: 50, maxH: 140 });
const rows = (await Promise.all(['Quote request: mobile booking app', 'Dispute opened: $249.00 chargeback on order #10482', 'Year-end closing: two documents missing', 'Your Paylane verification code'].map(row))).filter(Boolean);
need('rows', rows.length ? union(...rows) : null);
need('tags', await row('Quote request: mobile booking app'));
await shot('inbox');

// 2. The precision presets.
await page.goto(`${base}/settings/ai`);
await page.getByText('Ultra', { exact: true }).first().waitFor();
await settle(1500);
await page.getByText('Ultra', { exact: true }).first().scrollIntoViewIfNeeded();
await settle(500);
const presetCard = await around('How the AI sorts your emails', { minW: 400, maxW: 1100, minH: 250, maxH: 700 });
need('presets', presetCard);
// The three mode cards: the buttons inside that card.
need('presetCards', await page.evaluate((card) => {
  const inside = [...document.querySelectorAll('button')].map((b) => b.getBoundingClientRect()).filter((r) => r.x >= card.x && r.y >= card.y && r.x + r.width <= card.x + card.width + 1 && r.y + r.height <= card.y + card.height + 1 && r.height > 100);
  if (!inside.length) return null;
  const x = Math.min(...inside.map((r) => r.x)), y = Math.min(...inside.map((r) => r.y));
  return { x, y, width: Math.max(...inside.map((r) => r.x + r.width)) - x, height: Math.max(...inside.map((r) => r.y + r.height)) - y };
}, presetCard));
await shot('presets');

// 3. Sophie's mail, then the reply written by the compose assistant.
await page.goto(`${base}/mail/inbox`);
await page.getByText('Year-end closing: two documents missing').first().click();
await page.getByRole('button', { name: 'Reply', exact: true }).first().waitFor({ timeout: 60_000 });
await settle(1500);
await shot('thread');
await page.getByRole('button', { name: 'Reply', exact: true }).first().click();
await settle(900);
await page.getByRole('button', { name: 'Assistant' }).click();
const instruction = page.getByLabel('Instruction for the assistant');
await instruction.waitFor();
await instruction.fill('Reply to Sophie and attach the signed engagement letter and the March invoice from Nimbus Cloud');
await settle(500);
// Headless Chrome has no microphone: drop its error line, which ZMail.app never shows.
await page.evaluate(() => document.querySelectorAll('p.text-destructive').forEach((p) => /microphone/i.test(p.textContent) && p.remove()));
need('instruction', await instruction.boundingBox());
boxes.instructionBg = await page.evaluate(() => {
  // The colour behind the field: the first ancestor with an opaque background, mixed like the app does.
  const el = document.querySelector('textarea[aria-label="Instruction for the assistant"]');
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  for (let e = el; e; e = e.parentElement) {
    const bg = getComputedStyle(e).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
  }
  return '#111';
});
need('assistant', await around('Writing assistant', { minW: 400, maxW: 1400, minH: 80, maxH: 260 }));
need('composer', await around('Writing assistant', { minW: 500, maxW: 1500, minH: 450 }));
await shot('compose-ask');
await instruction.press('Enter');
await page.getByText(/\.pdf/).first().waitFor({ timeout: 120_000 });
await page.getByText(/\.pdf/).first().scrollIntoViewIfNeeded();
// The assistant's note shows as a toast for a few seconds: let it go.
await settle(6000);
const files = await page.getByText(/\.pdf/).all();
const fileBoxes = (await Promise.all(files.map((f) => f.boundingBox()))).filter(Boolean);
need('attachments', fileBoxes.length ? union(...fileBoxes.map((b) => ({ ...b, x: b.x - 30, width: b.width + 56 }))) : null);
need('composer', await page.evaluate(() => {
  const el = document.querySelector('[contenteditable="true"]');
  for (let e = el; e; e = e.parentElement) {
    const r = e.getBoundingClientRect();
    if (r.height > 450 && r.width > 500) return { x: r.x, y: r.y, width: r.width, height: r.height };
  }
  return null;
}));
await shot('compose-done');
await page.keyboard.press('Escape');

// 4. Themes: the same inbox in a few of them, dark and light.
const THEMES = [['ZMail', 'dark'], ['Violet Bloom', 'dark'], ['Vintage Paper', 'light'], ['Ocean Breeze', 'dark'], ['Kodama Grove', 'dark'], ['Claude', 'light'], ['Sunset Horizon', 'dark'], ['Cyberpunk', 'dark']];
for (const [i, [name, mode]] of THEMES.entries()) {
  await page.emulateMedia({ colorScheme: mode });
  await page.evaluate((m) => localStorage.setItem('theme', m), mode);
  await page.goto(`${base}/settings/appearance`);
  await settle(800);
  const button = page.getByRole('button', { name }).first();
  if (!(await button.count())) {
    console.warn(`theme not found: ${name}`);
    continue;
  }
  await button.click();
  await settle(400);
  await page.goto(`${base}/mail/inbox`);
  await page.getByText('Your Paylane verification code').first().waitFor();
  await settle(1500);
  await shot(`theme-${i}`);
}
// Back to ZMail's own theme, dark.
await page.emulateMedia({ colorScheme: 'dark' });
await page.evaluate(() => localStorage.setItem('theme', 'dark'));
await page.goto(`${base}/settings/appearance`);
await page.getByRole('button', { name: THEMES[0][0] }).first().click().catch(() => {});

writeFileSync(join(out, 'boxes.json'), JSON.stringify(boxes, null, 2));
console.log(JSON.stringify(boxes, null, 2));
await browser.close();
