import type { ModelTriage } from './merge';

/**
 * The « Ultra » mode's double check: two models sort the same mail in parallel; when they
 * disagree on what matters (spam, priority, one-time code, opportunity), a third one decides,
 * field by field, by majority.
 */

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const prio = (t: ModelTriage) => {
  const i = PRIORITIES.indexOf(String(t.priority ?? '').toLowerCase());
  return i < 0 ? 1 : i;
};
const otpOf = (t: ModelTriage) => (typeof t.otp === 'string' && t.otp.trim() ? t.otp.replace(/[\s-]/g, '').toUpperCase() : null);
const tagsOf = (t: ModelTriage) => (Array.isArray(t.tags) ? t.tags.filter((x): x is string => typeof x === 'string') : []);

/** Do two verdicts agree on everything that changes what the user sees first? */
export function agree(a: ModelTriage, b: ModelTriage) {
  return Boolean(a.spam) === Boolean(b.spam) && Boolean(a.opportunity) === Boolean(b.opportunity) && otpOf(a) === otpOf(b) && prio(a) === prio(b);
}

/** Majority per field (priority: the median), tags kept when most models chose them. */
export function voteTriage(answers: ModelTriage[]): ModelTriage {
  const n = answers.length;
  const majority = (f: (t: ModelTriage) => boolean) => answers.filter(f).length * 2 > n;
  const otps = answers.map(otpOf);
  const otpCounts = new Map<string | null, number>();
  for (const o of otps) otpCounts.set(o, (otpCounts.get(o) ?? 0) + 1);
  const [otp] = [...otpCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null];
  const priorities = answers.map(prio).sort((a, b) => a - b);
  const tagVotes = new Map<string, number>();
  for (const t of answers) for (const tag of new Set(tagsOf(t))) tagVotes.set(tag, (tagVotes.get(tag) ?? 0) + 1);
  const spam = majority((t) => Boolean(t.spam));
  return {
    spam,
    spamReason: spam ? answers.find((t) => t.spam && typeof t.spamReason === 'string')?.spamReason : null,
    opportunity: majority((t) => Boolean(t.opportunity)),
    opportunityReason: answers.find((t) => t.opportunity && typeof t.opportunityReason === 'string')?.opportunityReason ?? null,
    otp: otp && otps.filter((o) => o === otp).length * 2 > n ? otp : (otp ?? null),
    priority: PRIORITIES[priorities[Math.floor((n - 1) / 2)]!],
    tags: [...tagVotes.entries()].filter(([, v]) => v * 2 >= n).map(([t]) => t),
    // The written summary comes from whichever model writes one (Jev does not).
    summary: answers.map((t) => t.summary).find((s) => typeof s === 'string' && s.trim()),
  };
}
