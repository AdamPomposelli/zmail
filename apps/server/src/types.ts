import type { Address } from './lib/address';

export type { Address };

export type Priority = 0 | 1 | 2 | 3;
export const PRIORITY_LABELS = ['low', 'normal', 'high', 'urgent'] as const;

export type View =
  | 'inbox'
  | 'priority'
  | 'opportunities'
  | 'otp'
  | 'newsletters'
  | 'unread'
  | 'starred'
  | 'sent'
  | 'drafts'
  | 'archive'
  | 'spam'
  | 'trash'
  /** One server folder or Gmail label (`mailboxId` filter). */
  | 'folder';

export const VIEWS = ['inbox', 'priority', 'opportunities', 'otp', 'newsletters', 'unread', 'starred', 'sent', 'drafts', 'archive', 'spam', 'trash', 'folder'] as const satisfies readonly View[];

export type UnsubscribeInfo = {
  oneClick?: string;
  http?: string;
  mailto?: string;
  /** Link found in the body rather than the List-Unsubscribe header. */
  fromBody?: boolean;
};

export type Triage = {
  businessId: string | null;
  priority: Priority;
  tags: string[];
  spam: boolean;
  spamReason: string | null;
  otp: string | null;
  opportunity: boolean;
  opportunityReason: string | null;
  newsletter: boolean;
  unsubscribe: UnsubscribeInfo | null;
  summary: string;
  engine: string;
  userOverride: boolean;
  rulesApplied: string[];
};

export type AttachmentMeta = { index: number; filename: string; contentType: string; size: number; inline: boolean; cid?: string };

export type ThreadListItem = {
  id: string;
  accountId: string;
  accountEmail: string;
  accountColor: string;
  subject: string;
  snippet: string;
  summary: string;
  from: Address;
  date: number;
  unread: boolean;
  starred: boolean;
  count: number;
  hasAttachments: boolean;
  priority: Priority;
  tags: string[];
  businessId: string | null;
  spam: boolean;
  otp: string | null;
  opportunity: boolean;
  newsletter: boolean;
  mailbox: string | null;
  latestMessageId: string;
};

export type MessageView = {
  id: string;
  messageId: string | null;
  accountId: string;
  mailbox: string | null;
  from: Address;
  to: Address[];
  cc: Address[];
  replyTo: string | null;
  subject: string;
  date: number;
  html: string;
  text: string;
  attachments: AttachmentMeta[];
  unread: boolean;
  starred: boolean;
  references: string[];
  /** The message this one answers, when it is in the conversation. */
  parentId: string | null;
  depth: number;
  triage: Triage | null;
};

export type ThreadDetail = {
  id: string;
  accountId: string;
  accountEmail: string;
  subject: string;
  messages: MessageView[];
  /** Who answers whom, in reading order (see mail/reply-tree.ts). */
  tree: import('./mail/reply-tree').TreeNode[];
  priority: Priority;
  tags: string[];
  businessId: string | null;
  spam: boolean;
  spamReason: string | null;
  otp: string | null;
  opportunity: boolean;
  opportunityReason: string | null;
  newsletter: boolean;
  unsubscribe: UnsubscribeInfo | null;
  summary: string;
  starred: boolean;
  unread: boolean;
  mailbox: string | null;
};
