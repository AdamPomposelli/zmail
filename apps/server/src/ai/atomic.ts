import type { CompletionRequest } from './providers';
import type { JevRequest, JevResponse } from './jev';
import { parseJevTriage } from './jev';
import type { ModelTriage } from './merge';
import { parseJsonReply } from './providers';
import { outputLanguage } from '../lib/i18n';

/**
 * Jev's typed questions asked to a small generative model (Apple Intelligence on the Mac):
 * the same one-judgment-per-question set, answered true/false, then the same truth table in
 * code. Small on-device models judge simple facts far better than a whole mail at once.
 * Unlike Jev, the model also writes the one-line summary.
 */
export function atomicRequest(jev: Omit<JevRequest, 'model'>, thresholds?: { yes: number; lean: number }): CompletionRequest {
  const yesNo = Object.entries(jev.questions).filter(([, q]) => q.type === 'noul');
  const otp = jev.questions.otp?.type === 'choice' ? Object.keys(jev.questions.otp.criteria) : [];
  const system = [
    'You read ONE email and answer simple questions about it. Each answer is true or false, judged only from what the email says.',
    'Reply with a JSON object only: one boolean per question id, plus "otp" and "summary".',
    ...yesNo.map(([id, q]) => `- ${id}: ${q.instructions}${q.type === 'noul' && q.criteria ? ` (true: ${q.criteria.true} false: ${q.criteria.false})` : ''}`),
    otp.length
      ? `- otp: the one-time code the recipient must type in, exactly as one of ${otp.map((c) => `"${c}"`).join(', ')}, or null if none of them is such a code (an order, tracking or postal number is not).`
      : '- otp: null',
    `- summary: one sentence in ${outputLanguage()}, at most 15 words, saying what the sender wants.`,
  ].join('\n');
  const s = jev.state;
  const prompt = [
    `From: ${s.sender.name} <${s.sender.address}>`,
    `To: ${s.recipient}`,
    `Subject: ${s.subject}`,
    `Sent to a mailing list: ${s.sent_to_a_mailing_list ? 'yes' : 'no'}`,
    '',
    s.body,
  ].join('\n');
  return { system, prompt, json: true, maxTokens: 700, temperature: 0, reasoning: 'off', atomicOf: jev, jevThresholds: thresholds };
}

/** The model's true/false answers, read as near-certain probabilities, through Jev's truth table. */
export function parseAtomicReply(text: string, jev: Omit<JevRequest, 'model'>, thresholds?: { yes: number; lean: number }): ModelTriage {
  const data = (parseJsonReply(text) ?? {}) as Record<string, unknown>;
  const answers: JevResponse['answers'] = {};
  for (const [id, q] of Object.entries(jev.questions)) {
    if (q.type !== 'noul') continue;
    const v = data[id];
    // A missing answer is « unsure », not « no ».
    answers[id] = { type: 'noul', noul: v === true || v === 'true' ? 0.95 : v === false || v === 'false' ? 0.05 : 0.5 };
  }
  const otpChoices = jev.questions.otp?.type === 'choice' ? Object.keys(jev.questions.otp.criteria) : [];
  const otp = typeof data.otp === 'string' ? data.otp.replace(/[\s-]/g, '') : null;
  if (otp && otpChoices.includes(otp)) answers.otp = { type: 'choice', choice: otp };
  const triage = parseJevTriage({ answers }, thresholds);
  return { ...triage, summary: typeof data.summary === 'string' ? data.summary : undefined };
}
