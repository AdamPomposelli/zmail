import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineContext } from '../src/context';
import { MAIN_SPACE } from '../src/mail/spaces';
import { createTestEngine } from './helpers';

/** « Déplacer vers » an account's space, from the sidebar. */
let engine: EngineContext;

beforeAll(async () => {
  ({ engine } = await createTestEngine());
  engine.db.run(
    `INSERT INTO accounts (id, email, name, provider, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username, secret, color, created_at)
     VALUES ('acc', 'me@zmail.test', 'Me', 'custom', 'h', 1, 1, 'h', 1, 1, 'u', ?, '#000', 0)`,
    engine.secrets.encrypt('x'),
  );
});

describe('moving an account between spaces', () => {
  it('moves it into a space, then back to the main one', () => {
    const work = engine.spaces.save({ name: 'Travail', color: '#3B82F6' });
    engine.spaces.moveAccount('acc', work.id);
    expect(engine.spaces.list().find((s) => s.id === work.id)?.accountIds).toEqual(['acc']);
    engine.spaces.moveAccount('acc', MAIN_SPACE);
    expect(engine.spaces.list().find((s) => s.id === work.id)?.accountIds).toEqual([]);
    expect(engine.db.get<{ space_id: string | null }>('SELECT space_id FROM accounts WHERE id = ?', 'acc')?.space_id).toBeNull();
  });

  it('refuses a space that does not exist', () => {
    expect(() => engine.spaces.moveAccount('acc', 'nope')).toThrow(/introuvable/);
  });
});
