/**
 * Replays the OTP and phishing checks over a real ZMail database, read-only, to measure
 * false positives before shipping a change. Prints sender/subject only, never bodies.
 *
 *   tsx scripts/audit-otp-spam.ts [path/to/zmail.db]
 */
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findOtp, validateOtp } from '../src/ai/otp';
import { detectPhishing } from '../src/ai/phishing';

const file = process.argv[2] ?? join(homedir(), 'Library', 'Application Support', 'ZMail', 'zmail.db');
const db = new DatabaseSync(file, { readOnly: true });
type Row = { id: string; from_name: string; from_email: string; to_json: string; subject: string; text_body: string; folder: string; otp: string | null; spam: number };
const rows = db
  .prepare(
    `SELECT m.id, m.from_name, m.from_email, m.to_json, m.subject, m.text_body, mb.special_use AS folder, t.otp, t.spam
     FROM messages m JOIN mailboxes mb ON mb.id = m.mailbox_id LEFT JOIN triage t ON t.message_id = m.id
     WHERE mb.special_use NOT IN ('sent', 'drafts')`,
  )
  .all() as Row[];

const line = (r: Row, extra: string) => `  ${r.folder.padEnd(7)} ${(r.from_name || r.from_email).slice(0, 28).padEnd(28)} ${r.subject.slice(0, 55).padEnd(55)} ${extra}`;
const otpKept: string[] = [];
const otpDropped: string[] = [];
const phishing: string[] = [];
let heuristicOtps = 0;
for (const r of rows) {
  const text = `${r.subject}\n${r.text_body}`;
  if (r.otp) (validateOtp(r.otp, text) ? otpKept : otpDropped).push(line(r, r.otp));
  if (findOtp(text)) heuristicOtps++;
  const verdict = detectPhishing({ fromName: r.from_name, fromEmail: r.from_email, to: (JSON.parse(r.to_json) as { email: string }[]).map((a) => a.email), subject: r.subject, text: r.text_body });
  if (verdict.phishing) phishing.push(line(r, verdict.reason ?? ''));
}
console.log(`${rows.length} mails\n\nStored OTP still accepted (${otpKept.length}):\n${otpKept.join('\n')}`);
console.log(`\nStored OTP now rejected (${otpDropped.length}):\n${otpDropped.join('\n')}`);
console.log(`\nPhishing detected (${phishing.length}), by folder:\n${phishing.sort().join('\n')}`);
console.log(`\nHeuristic OTP found in ${heuristicOtps} mails`);
