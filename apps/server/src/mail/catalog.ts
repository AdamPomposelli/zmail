import type { Database } from '../db';
import { SYSTEM_TAGS } from '../ai/taxonomy';
import { domainOf, type Address } from '../lib/address';
import { newId } from '../lib/ids';
import { t } from '../lib/i18n';

export type Business = {
  id: string;
  name: string;
  color: string;
  emoji: string | null;
  description: string;
  sort: number;
  matchers: BusinessMatcher[];
};

export type BusinessMatcher = { id: string; type: 'account' | 'address' | 'domain' | 'sender'; value: string };

export type Tag = {
  id: string;
  name: string;
  color: string;
  description: string;
  kind: 'system' | 'custom';
  icon: string | null;
  sort: number;
};

const slugify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'tag';

export class Catalog {
  constructor(private readonly db: Database) {}

  seed() {
    SYSTEM_TAGS.forEach((tag, sort) =>
      this.db.run(
        `INSERT OR IGNORE INTO tags (id, name, color, description, kind, icon, sort, created_at) VALUES (?, ?, ?, ?, 'system', ?, ?, ?)`,
        tag.id,
        tag.name,
        tag.color,
        tag.description,
        tag.icon,
        sort,
        Date.now(),
      ),
    );
  }

  // ── Businesses ───────────────────────────────────────────────────────────────

  businesses(): Business[] {
    const matchers = this.db.all<BusinessMatcher & { business_id: string }>('SELECT * FROM business_matchers');
    return this.db
      .all<Omit<Business, 'matchers'>>('SELECT id, name, color, emoji, description, sort FROM businesses ORDER BY sort, created_at')
      .map((b) => ({
        ...b,
        matchers: matchers.filter((m) => m.business_id === b.id).map(({ id, type, value }) => ({ id, type, value })),
      }));
  }

  saveBusiness(input: Omit<Business, 'id' | 'sort' | 'matchers'> & { id?: string; matchers: Omit<BusinessMatcher, 'id'>[] }) {
    const id = input.id ?? newId('biz');
    this.db.tx(() => {
      if (input.id) {
        this.db.run('UPDATE businesses SET name = ?, color = ?, emoji = ?, description = ? WHERE id = ?', input.name, input.color, input.emoji, input.description, id);
      } else {
        const sort = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM businesses')!.n;
        this.db.run(
          'INSERT INTO businesses (id, name, color, emoji, description, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          id,
          input.name,
          input.color,
          input.emoji,
          input.description,
          sort,
          Date.now(),
        );
      }
      this.db.run('DELETE FROM business_matchers WHERE business_id = ?', id);
      for (const matcher of input.matchers) {
        const value = matcher.value.trim().toLowerCase().replace(/^@/, '');
        if (!value) continue;
        this.db.run('INSERT INTO business_matchers (id, business_id, type, value) VALUES (?, ?, ?, ?)', newId('bm'), id, matcher.type, value);
      }
      // Accounts linked through an `account` matcher also carry the business directly.
      this.db.run('UPDATE accounts SET business_id = NULL WHERE business_id = ?', id);
      for (const matcher of input.matchers.filter((m) => m.type === 'account')) {
        this.db.run('UPDATE accounts SET business_id = ? WHERE id = ?', id, matcher.value);
      }
    });
    return this.businesses().find((b) => b.id === id)!;
  }

  removeBusiness(id: string) {
    this.db.tx(() => {
      this.db.run('DELETE FROM businesses WHERE id = ?', id);
      this.db.run('UPDATE triage SET business_id = NULL WHERE business_id = ?', id);
    });
  }

  /**
   * Which business a message belongs to, from where it came in. Most specific wins:
   * sender address › recipient alias › recipient domain › sender domain › receiving account.
   */
  resolveBusiness(message: { accountId: string; from: Address; to: Address[]; cc: Address[]; deliveredTo: string | null }): string | null {
    const businesses = this.businesses();
    if (businesses.length === 0) return null;
    const recipients = [message.deliveredTo ?? '', ...message.to.map((a) => a.email), ...message.cc.map((a) => a.email)]
      .map((e) => e.toLowerCase())
      .filter(Boolean);
    const sender = message.from.email.toLowerCase();
    const find = (type: BusinessMatcher['type'], test: (value: string) => boolean) =>
      businesses.find((b) => b.matchers.some((m) => m.type === type && test(m.value)))?.id;

    return (
      find('sender', (v) => v === sender || (v.startsWith('*@') && domainOf(sender) === v.slice(2))) ??
      find('address', (v) => recipients.includes(v)) ??
      find('domain', (v) => recipients.some((r) => domainOf(r) === v || domainOf(r).endsWith(`.${v}`))) ??
      find('domain', (v) => domainOf(sender) === v) ??
      find('account', (v) => v === message.accountId) ??
      this.db.get<{ business_id: string | null }>('SELECT business_id FROM accounts WHERE id = ?', message.accountId)?.business_id ??
      null
    );
  }

  // ── Tags ─────────────────────────────────────────────────────────────────────

  /** The categories in use. Built-in ones the user removed are left out (see hiddenTags). */
  tags(): Tag[] {
    return this.db.all<Tag>('SELECT id, name, color, description, kind, icon, sort FROM tags WHERE hidden = 0 ORDER BY kind DESC, sort, name');
  }

  hiddenTags(): Tag[] {
    return this.db.all<Tag>('SELECT id, name, color, description, kind, icon, sort FROM tags WHERE hidden = 1 ORDER BY sort, name');
  }

  restoreTag(id: string) {
    this.db.run('UPDATE tags SET hidden = 0 WHERE id = ?', id);
  }

  tag(id: string) {
    return this.tags().find((t) => t.id === id);
  }

  findTag(nameOrId: string) {
    const key = slugify(nameOrId);
    return this.tags().find((t) => t.id === nameOrId || t.id === key || slugify(t.name) === key);
  }

  saveTag(input: { id?: string; name: string; color: string; description: string; icon?: string | null }) {
    if (input.id && this.tag(input.id)) {
      this.db.run('UPDATE tags SET name = ?, color = ?, description = ?, icon = ? WHERE id = ?', input.name, input.color, input.description, input.icon ?? null, input.id);
      return this.tag(input.id)!;
    }
    let id = slugify(input.name);
    while (this.tag(id)) id = `${slugify(input.name)}-${Math.random().toString(36).slice(2, 5)}`;
    this.db.run(
      `INSERT INTO tags (id, name, color, description, kind, icon, sort, created_at) VALUES (?, ?, ?, ?, 'custom', ?, ?, ?)`,
      id,
      input.name,
      input.color,
      input.description,
      input.icon ?? null,
      1000,
      Date.now(),
    );
    return this.tag(id)!;
  }

  /**
   * Your own categories are deleted. Built-in ones are hidden instead: the AI stops using them
   * and they disappear everywhere, but Settings → Categories can bring them back.
   */
  removeTag(id: string) {
    const tag = this.tag(id);
    if (!tag) throw new Error(t('Catégorie introuvable'));
    if (tag.kind === 'system') {
      this.db.run('UPDATE tags SET hidden = 1 WHERE id = ?', id);
      return { hidden: true };
    }
    this.db.run('DELETE FROM tags WHERE id = ?', id);
    this.db.run(
      `UPDATE triage SET tags = (SELECT COALESCE(json_group_array(j.value), '[]') FROM json_each(triage.tags) j WHERE j.value != ?)
       WHERE EXISTS (SELECT 1 FROM json_each(triage.tags) j WHERE j.value = ?)`,
      id,
      id,
    );
    return { hidden: false };
  }

  /** Without a model, custom tags match on their name or the comma-separated keywords of their description. */
  matchCustomTags(text: string): string[] {
    const haystack = text.toLowerCase();
    return this.tags()
      .filter((t) => t.kind === 'custom')
      .filter((t) => {
        const keywords = [t.name, ...t.description.split(/[,;\n]/)].map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 3 && k.split(' ').length <= 3);
        return keywords.some((k) => haystack.includes(k));
      })
      .map((t) => t.id);
  }
}
