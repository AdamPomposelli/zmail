import type { Database } from '../db';
import { newId } from '../lib/ids';

export type Signature = { id: string; name: string; html: string };
/** Like Gmail: one default for new mail and one for replies/forwards, per sending account. */
export type SignatureDefaults = { newMail: string | null; reply: string | null };
export type SignatureSettings = { items: Signature[]; defaults: Record<string, SignatureDefaults> };

const KEY = 'signatures';

/** Reusable signatures, picked automatically per account and switchable from the composer. */
export class Signatures {
  constructor(private readonly db: Database) {}

  settings(): SignatureSettings {
    const stored = this.db.getSetting<SignatureSettings | null>(KEY, null);
    if (stored) return stored;
    // First run: signatures previously stored on accounts become library entries.
    const legacy = this.db.all<{ id: string; name: string; email: string; signature: string }>("SELECT id, name, email, signature FROM accounts WHERE signature != ''");
    const settings: SignatureSettings = { items: [], defaults: {} };
    for (const account of legacy) {
      const signature = { id: newId('sig'), name: account.name || account.email, html: account.signature };
      settings.items.push(signature);
      settings.defaults[account.id] = { newMail: signature.id, reply: signature.id };
    }
    this.db.setSetting(KEY, settings);
    return settings;
  }

  save(input: { id?: string; name: string; html: string }) {
    const settings = this.settings();
    const signature: Signature = { id: input.id ?? newId('sig'), name: input.name.trim() || 'Signature', html: input.html };
    const exists = settings.items.some((s) => s.id === signature.id);
    const items = exists ? settings.items.map((s) => (s.id === signature.id ? signature : s)) : [...settings.items, signature];
    const defaults = { ...settings.defaults };
    // The very first signature becomes everyone's default, as most people only have one.
    if (!settings.items.length) {
      const accounts = this.db.all<{ id: string }>('SELECT id FROM accounts');
      for (const { id } of accounts) defaults[id] = { newMail: signature.id, reply: signature.id };
    }
    this.db.setSetting(KEY, { items, defaults });
    return signature;
  }

  remove(id: string) {
    const settings = this.settings();
    const clear = (value: string | null) => (value === id ? null : value);
    const defaults = Object.fromEntries(Object.entries(settings.defaults).map(([account, d]) => [account, { newMail: clear(d.newMail), reply: clear(d.reply) }]));
    this.db.setSetting(KEY, { items: settings.items.filter((s) => s.id !== id), defaults });
  }

  setDefaults(accountId: string, defaults: SignatureDefaults) {
    const settings = this.settings();
    this.db.setSetting(KEY, { ...settings, defaults: { ...settings.defaults, [accountId]: defaults } });
  }
}
