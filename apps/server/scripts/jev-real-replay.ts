/**
 * Runs Jev (or an LLM, for comparison) over the mail of a real ZMail database (read-only) and compares its verdicts with
 * the provider's own sorting (Gmail's Spam folder) and with the stored triage. The folder is
 * never shown to Jev. Prints sender/subject only, never bodies.
 *
 *   tsx scripts/jev-real-replay.ts [model]
 */
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { keyFromApp } from '../bench/key';
import { PROVIDER_KINDS } from '../src/ai/catalog';
import { classifyHeuristically } from '../src/ai/heuristics';
import { buildJevTriage, callJev, isJevModel, parseJevTriage } from '../src/ai/jev';
import { OpenAiCompatibleClient, parseJsonReply } from '../src/ai/providers';
import { buildTriageRequest } from '../src/ai/prompts';
import type { ModelTriage } from '../src/ai/merge';
import { mergeTriage } from '../src/ai/merge';
import { SYSTEM_TAGS } from '../src/ai/taxonomy';
import { featuresOf } from '../src/ai/pipeline';
import type { MessageRow } from '../src/mail/store';

const model = process.argv[2] ?? 'typesafe/jev-1.13';
const db = new DatabaseSync(join(homedir(), 'Library', 'Application Support', 'ZMail', 'zmail.db'), { readOnly: true });
const rows = db
  .prepare(
    `SELECT m.*, mb.special_use, t.spam AS stored_spam, t.otp AS stored_otp, t.engine AS stored_engine FROM messages m
     JOIN mailboxes mb ON mb.id = m.mailbox_id LEFT JOIN triage t ON t.message_id = m.id
     WHERE mb.special_use IN ('inbox', 'junk', 'archive', 'all')`,
  )
  .all() as (MessageRow & { special_use: string; stored_spam: number | null; stored_otp: string | null; stored_engine: string | null })[];
const baseUrl = PROVIDER_KINDS.zenmux.baseUrl;
const key = keyFromApp(baseUrl, 'ZenMux');
const tags = SYSTEM_TAGS.map((t) => ({ id: t.id, name: t.name, description: t.description }));
const known = new Set(tags.map((t) => t.id));

let next = 0;
let tokens = 0;
let failed = 0;
const out: { row: (typeof rows)[number]; spam: boolean; otp: string | null; priority: number; tags: string[] }[] = [];
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (next < rows.length) {
      const row = rows[next++]!;
      const features = featuresOf(row);
      const heuristic = classifyHeuristically(features);
      try {
        let verdict: ModelTriage;
        if (isJevModel(model)) {
          const res = await callJev(baseUrl, key, buildJevTriage({ model, features, bulk: heuristic.bulk, tags, businesses: [] }));
          tokens += res.usage?.input_tokens ?? 0;
          verdict = parseJevTriage(res);
        } else {
          // Same comparison for an LLM, with ZMail's production prompt.
          const { text, usage } = await new OpenAiCompatibleClient('replay', 'ZenMux', baseUrl, model, key, 'zenmux').complete(buildTriageRequest({ features, bulk: heuristic.bulk, tags, businesses: [] }));
          tokens += usage?.promptTokens ?? 0;
          verdict = parseJsonReply(text) as ModelTriage;
        }
        // folder deliberately left out: the model must find the spam on its own.
        const m = mergeTriage({ heuristic, model: verdict, text: `${row.subject}\n${row.text_body}`, knownTags: known });
        out.push({ row, spam: m.spam, otp: m.otp, priority: m.priority, tags: m.tags });
      } catch {
        failed++;
      }
    }
  }),
);

const line = (r: (typeof out)[number], extra = '') => `  ${r.row.special_use.padEnd(7)} ${(r.row.from_name || r.row.from_email).slice(0, 26).padEnd(26)} ${r.row.subject.slice(0, 58).padEnd(58)} ${extra}`;
const junk = out.filter((r) => r.row.special_use === 'junk');
const clean = out.filter((r) => r.row.special_use !== 'junk');
console.log(`${model} sur ${out.length} vrais mails (${failed} échecs d’appel), ${Math.round(tokens / Math.max(1, out.length))} jetons/mail`);
console.log(`\nSpam de Gmail repérés sans connaître le dossier : ${junk.filter((r) => r.spam).length}/${junk.length}`);
junk.filter((r) => !r.spam).forEach((r) => console.log(line(r, 'manqué')));
console.log(`\nMails légitimes (boîte, archives) classés spam : ${clean.filter((r) => r.spam).length}/${clean.length}`);
clean.filter((r) => r.spam).forEach((r) => console.log(line(r, 'faux positif')));
console.log(`\nCodes OTP retenus :`);
out.filter((r) => r.otp).forEach((r) => console.log(line(r, r.otp!)));
console.log(`\nVerdicts qui changent par rapport au tri enregistré (moteur précédent) :`);
out.filter((r) => r.row.stored_spam !== null && (Boolean(r.row.stored_spam) !== r.spam || (r.row.stored_otp ?? null) !== r.otp)).forEach((r) => console.log(line(r, `avant: spam=${Boolean(r.row.stored_spam)} otp=${r.row.stored_otp ?? '—'} (${r.row.stored_engine}) → Jev: spam=${r.spam} otp=${r.otp ?? '—'}`)));
