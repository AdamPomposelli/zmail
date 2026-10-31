import type { Database } from './db';
import type { NativeBridge } from './native/bridge';
import { bus } from './lib/events';
import { newId } from './lib/ids';

export type NotificationKind = 'otp' | 'priority' | 'opportunity' | 'rule' | 'unsubscribe_failed' | 'info' | 'agent';

export type NotificationSettings = {
  enabled: boolean;
  otp: boolean;
  urgent: boolean;
  high: boolean;
  opportunity: boolean;
  rules: boolean;
  unsubscribeFailed: boolean;
  /** Businesses whose mail never notifies (except OTP). */
  mutedBusinesses: string[];
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  otp: true,
  urgent: true,
  high: false,
  opportunity: true,
  rules: true,
  unsubscribeFailed: true,
  mutedBusinesses: [],
};

export type NotificationRecord = {
  id: string;
  at: number;
  kind: NotificationKind;
  title: string;
  body: string;
  threadId: string | null;
  otp: string | null;
  delivered: string;
  read: boolean;
};

export class Notifier {
  constructor(
    private readonly db: Database,
    private readonly bridge: NativeBridge,
  ) {}

  settings(): NotificationSettings {
    return { ...DEFAULT_NOTIFICATION_SETTINGS, ...this.db.getSetting<Partial<NotificationSettings>>('notifications', {}) };
  }

  saveSettings(settings: NotificationSettings) {
    this.db.setSetting('notifications', settings);
  }

  allows(kind: NotificationKind, opts: { priority?: number; businessId?: string | null } = {}) {
    const s = this.settings();
    if (!s.enabled) return false;
    if (kind !== 'otp' && opts.businessId && s.mutedBusinesses.includes(opts.businessId)) return false;
    switch (kind) {
      case 'otp':
        return s.otp;
      case 'priority':
        return (opts.priority ?? 0) >= 3 ? s.urgent : s.high;
      case 'opportunity':
        return s.opportunity;
      case 'rule':
        return s.rules;
      case 'unsubscribe_failed':
        return s.unsubscribeFailed;
      default:
        return true;
    }
  }

  async send(input: { kind: NotificationKind; title: string; subtitle?: string; body: string; threadId?: string | null; otp?: string | null }) {
    const id = newId('ntf');
    const delivered = await this.bridge.notify({ id, ...input });
    this.db.run(
      'INSERT INTO notifications (id, at, kind, title, body, thread_id, otp, delivered) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      Date.now(),
      input.kind,
      input.title,
      input.body,
      input.threadId ?? null,
      input.otp ?? null,
      delivered,
    );
    bus.emitEvent({ type: 'notification', id, kind: input.kind, title: input.title, body: input.body, otp: input.otp, threadId: input.threadId, delivered });
    return { id, delivered };
  }

  /**
   * Latest notifications, minus those whose mail has since turned out to be spam (or sits in
   * junk / trash): a reclassified mail must never stay among the alerts.
   */
  list(limit = 50): NotificationRecord[] {
    return this.db
      .all<Omit<NotificationRecord, 'read' | 'threadId'> & { read: number; thread_id: string | null }>(
        `SELECT n.* FROM notifications n
         WHERE n.thread_id IS NULL OR n.thread_id LIKE 'agent:%' OR NOT EXISTS (
           SELECT 1 FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id LEFT JOIN triage t ON t.message_id = m.id
           WHERE m.thread_id = n.thread_id AND (t.spam = 1 OR mb.special_use IN ('junk', 'trash'))
         )
         ORDER BY n.at DESC LIMIT ?`,
        limit,
      )
      .map(({ thread_id, read, ...rest }) => ({ ...rest, threadId: thread_id, read: read === 1 }));
  }

  markAllRead() {
    this.db.run('UPDATE notifications SET read = 1 WHERE read = 0');
  }
}
