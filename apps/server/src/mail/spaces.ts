import type { EngineContext } from '../context';
import { newId } from '../lib/ids';
import { bus } from '../lib/events';

/**
 * Spaces, as in Arc: « Principal », « Personnel », one per business… Each one has its own
 * inbox, favourites, subscriptions and categories, so personal and business mail never mix.
 *
 * A mail's space is resolved when it is read, never stored per message:
 *   the conversation moved by hand (or by a rule) → its business's space → its account's → main.
 * Linking a business or an account to a space therefore applies to all past mail at once.
 */
export const MAIN_SPACE = 'main';

/** Joins every query needs to compute a message's space (`m` messages, `t` triage). */
export const SPACE_JOINS = `LEFT JOIN space_overrides so ON so.thread_id = m.thread_id
  LEFT JOIN businesses sb ON sb.id = t.business_id
  LEFT JOIN accounts sa ON sa.id = m.account_id`;
export const SPACE_EXPR = `COALESCE(so.space_id, sb.space_id, sa.space_id, '${MAIN_SPACE}')`;

export type Space = {
  id: string;
  name: string;
  icon: string | null;
  color: string;
  sort: number;
  accountIds: string[];
  businessIds: string[];
};

type SpaceRow = { id: string; name: string; icon: string | null; color: string; sort: number };

export class Spaces {
  constructor(private readonly ctx: EngineContext) {}

  list(): Space[] {
    const rows = this.ctx.db.all<SpaceRow>('SELECT id, name, icon, color, sort FROM spaces ORDER BY sort, created_at');
    const accounts = this.ctx.db.all<{ id: string; space_id: string | null }>('SELECT id, space_id FROM accounts');
    const businesses = this.ctx.db.all<{ id: string; space_id: string | null }>('SELECT id, space_id FROM businesses');
    return rows.map((r) => ({
      ...r,
      accountIds: accounts.filter((a) => a.space_id === r.id).map((a) => a.id),
      businessIds: businesses.filter((b) => b.space_id === r.id).map((b) => b.id),
    }));
  }

  get(id: string) {
    return this.list().find((s) => s.id === id);
  }

  /** Creates or edits a space, and which accounts and businesses feed it. */
  save(input: { id?: string; name: string; icon?: string | null; color: string; accountIds?: string[]; businessIds?: string[] }) {
    const name = input.name.trim();
    if (!name) throw new Error('Donnez un nom à l’espace.');
    const id = input.id ?? newId('sp');
    let touched: string[] = [];
    this.ctx.db.tx(() => {
      if (input.id && this.ctx.db.get('SELECT 1 FROM spaces WHERE id = ?', input.id)) {
        this.ctx.db.run('UPDATE spaces SET name = ?, icon = ?, color = ? WHERE id = ?', name, input.icon ?? null, input.color, id);
      } else {
        const sort = this.ctx.db.get<{ n: number }>('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM spaces')!.n;
        this.ctx.db.run('INSERT INTO spaces (id, name, icon, color, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, name, input.icon ?? null, input.color, sort, Date.now());
      }
      // « main » is where everything else goes: nothing is linked to it explicitly.
      if (id !== MAIN_SPACE) {
        if (input.accountIds) {
          const before = this.ctx.db.all<{ id: string }>('SELECT id FROM accounts WHERE space_id = ?', id).map((a) => a.id);
          this.ctx.db.run('UPDATE accounts SET space_id = NULL WHERE space_id = ?', id);
          for (const a of input.accountIds) this.ctx.db.run('UPDATE accounts SET space_id = ? WHERE id = ?', id, a);
          touched = [...new Set([...before, ...input.accountIds])];
        }
        if (input.businessIds) {
          this.ctx.db.run('UPDATE businesses SET space_id = NULL WHERE space_id = ?', id);
          for (const b of input.businessIds) this.ctx.db.run('UPDATE businesses SET space_id = ? WHERE id = ?', id, b);
        } else this.syncBusinesses(touched);
      }
    });
    this.changed();
    return this.get(id)!;
  }

  /**
   * A business follows the space of the accounts linked to it (Réglages → Comptes), so choosing
   * the accounts is enough: its mail received on other accounts lands in that space too.
   * Only the businesses of the accounts that just changed move; one given its own space
   * (« un espace par business ») keeps it until one of its accounts is moved.
   */
  syncBusinesses(accountIds: string[]) {
    if (!accountIds.length) return;
    const marks = accountIds.map(() => '?').join(', ');
    this.ctx.db.run(
      `UPDATE businesses SET space_id = (
         SELECT a.space_id FROM accounts a WHERE a.business_id = businesses.id AND a.space_id IS NOT NULL ORDER BY a.created_at LIMIT 1)
       WHERE id IN (SELECT business_id FROM accounts WHERE id IN (${marks}) AND business_id IS NOT NULL)`,
      ...accountIds,
    );
    this.changed();
  }

  /** One account into a space (« Déplacer vers » in the sidebar); its business follows it. */
  moveAccount(accountId: string, spaceId: string) {
    if (spaceId !== MAIN_SPACE && !this.get(spaceId)) throw new Error('Espace introuvable.');
    this.ctx.db.run('UPDATE accounts SET space_id = ? WHERE id = ?', spaceId === MAIN_SPACE ? null : spaceId, accountId);
    this.syncBusinesses([accountId]);
  }

  /** Its mail goes back to the other spaces' rules (or to « main »); its own categories go too. */
  remove(id: string) {
    if (id === MAIN_SPACE) throw new Error('L’espace principal ne peut pas être supprimé.');
    this.ctx.db.tx(() => {
      this.ctx.db.run('UPDATE accounts SET space_id = NULL WHERE space_id = ?', id);
      this.ctx.db.run('UPDATE businesses SET space_id = NULL WHERE space_id = ?', id);
      this.ctx.db.run('DELETE FROM space_overrides WHERE space_id = ?', id);
      this.ctx.db.run('DELETE FROM tags WHERE space_id = ?', id);
      this.ctx.db.run('DELETE FROM spaces WHERE id = ?', id);
    });
    this.changed();
  }

  reorder(ids: string[]) {
    this.ctx.db.tx(() => ids.forEach((id, i) => this.ctx.db.run('UPDATE spaces SET sort = ? WHERE id = ?', i, id)));
    this.changed();
  }

  /** « Déplacer vers l’espace » : the whole conversation, including its future replies. */
  move(threadIds: string[], spaceId: string, source: 'user' | 'rule' | 'agent' = 'user') {
    if (!this.ctx.db.get('SELECT 1 FROM spaces WHERE id = ?', spaceId)) throw new Error('Espace introuvable');
    this.ctx.db.tx(() => {
      for (const threadId of threadIds) {
        // Moving back to where its rules would put it anyway removes the exception.
        const natural = this.naturalSpace(threadId);
        if (natural === spaceId) this.ctx.db.run('DELETE FROM space_overrides WHERE thread_id = ?', threadId);
        else
          this.ctx.db.run(
            'INSERT INTO space_overrides (thread_id, space_id, source, at) VALUES (?, ?, ?, ?) ON CONFLICT(thread_id) DO UPDATE SET space_id = excluded.space_id, source = excluded.source, at = excluded.at',
            threadId,
            spaceId,
            source,
            Date.now(),
          );
      }
    });
    bus.emitEvent({ type: 'mail', reason: 'changed', threadIds });
  }

  /** Where a conversation is now. */
  spaceOf(threadId: string): string {
    const row = this.ctx.db.get<{ space: string }>(
      `SELECT ${SPACE_EXPR} AS space FROM messages m LEFT JOIN triage t ON t.message_id = m.id ${SPACE_JOINS} WHERE m.thread_id = ? ORDER BY m.date DESC LIMIT 1`,
      threadId,
    );
    return row?.space ?? MAIN_SPACE;
  }

  /** Where a new mail lands, before its triage is saved (for the categories the AI may use). */
  spaceFor(input: { threadId: string; businessId: string | null; accountId: string }): string {
    const override = this.ctx.db.get<{ space_id: string }>('SELECT space_id FROM space_overrides WHERE thread_id = ?', input.threadId)?.space_id;
    if (override) return override;
    const business = input.businessId ? this.ctx.db.get<{ space_id: string | null }>('SELECT space_id FROM businesses WHERE id = ?', input.businessId)?.space_id : null;
    if (business) return business;
    return this.ctx.db.get<{ space_id: string | null }>('SELECT space_id FROM accounts WHERE id = ?', input.accountId)?.space_id ?? MAIN_SPACE;
  }

  /** Where it would be without a manual move. */
  private naturalSpace(threadId: string): string {
    const row = this.ctx.db.get<{ space: string }>(
      `SELECT COALESCE(sb.space_id, sa.space_id, '${MAIN_SPACE}') AS space FROM messages m LEFT JOIN triage t ON t.message_id = m.id
       LEFT JOIN businesses sb ON sb.id = t.business_id LEFT JOIN accounts sa ON sa.id = m.account_id
       WHERE m.thread_id = ? ORDER BY m.date DESC LIMIT 1`,
      threadId,
    );
    return row?.space ?? MAIN_SPACE;
  }

  /** One space per business, linked to it (and to its accounts): the quick start in settings. */
  createPerBusiness() {
    const businesses = this.ctx.catalog.businesses();
    const existing = this.list();
    const created: Space[] = [];
    for (const b of businesses) {
      if (existing.some((s) => s.businessIds.includes(b.id))) continue;
      const accounts = this.ctx.db.all<{ id: string }>('SELECT id FROM accounts WHERE business_id = ? AND space_id IS NULL', b.id).map((a) => a.id);
      created.push(this.save({ name: b.name, icon: b.emoji ? `emoji:${b.emoji}` : null, color: b.color, businessIds: [b.id], accountIds: accounts }));
    }
    return created;
  }

  private changed() {
    bus.emitEvent({ type: 'mail', reason: 'changed', threadIds: [] });
  }
}
