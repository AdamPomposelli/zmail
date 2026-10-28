import type { ChatCase, TriageCase } from './dataset';

export type TriageScore = { total: number; priority: number; spam: number; opportunity: number; otp: number; tags: number; mistakes: string[] };

const PRIORITY: Record<string, number> = { low: 0, normal: 1, high: 2, urgent: 3, basse: 0, normale: 1, haute: 2, urgente: 3 };

const normalizeOtp = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.replace(/[\s-]/g, '').toUpperCase() : null);

/** Grades one model reply against the labelled expectation (each part 0–100, total weighted). */
export function scoreTriage(c: TriageCase, reply: Record<string, unknown> | null): TriageScore {
  if (!reply) return { total: 0, priority: 0, spam: 0, opportunity: 0, otp: 0, tags: 0, mistakes: ['pas de JSON'] };
  const mistakes: string[] = [];
  const priority = PRIORITY[String(reply.priority).toLowerCase()];
  const priorityScore = priority === c.expect.priority ? 100 : priority !== undefined && Math.abs(priority - c.expect.priority) === 1 ? 50 : 0;
  if (priorityScore < 100) mistakes.push(`priorité ${reply.priority} au lieu de ${['low', 'normal', 'high', 'urgent'][c.expect.priority]}`);

  const spamScore = Boolean(reply.spam) === c.expect.spam ? 100 : 0;
  if (!spamScore) mistakes.push(`spam ${Boolean(reply.spam)}`);
  const opportunityScore = Boolean(reply.opportunity) === c.expect.opportunity ? 100 : 0;
  if (!opportunityScore) mistakes.push(`opportunité ${Boolean(reply.opportunity)}`);

  const otp = normalizeOtp(reply.otp);
  const otpScore = otp === (c.expect.otp ? c.expect.otp.toUpperCase() : null) ? 100 : 0;
  if (!otpScore) mistakes.push(`OTP ${otp ?? 'null'} au lieu de ${c.expect.otp ?? 'null'}`);

  const tags = Array.isArray(reply.tags) ? reply.tags.map(String) : [];
  const must = c.expect.mustTag ?? [];
  const forbidden = (c.expect.mustNotTag ?? []).filter((t) => tags.includes(t));
  const recall = must.length ? must.filter((t) => tags.includes(t)).length / must.length : 1;
  const tagScore = Math.max(0, recall - 0.5 * forbidden.length) * 100;
  if (recall < 1) mistakes.push(`tags ${JSON.stringify(tags)} sans ${must.filter((t) => !tags.includes(t)).join(', ')}`);
  if (forbidden.length) mistakes.push(`tags interdits ${forbidden.join(', ')}`);

  const total = priorityScore * 0.3 + spamScore * 0.2 + otpScore * 0.2 + opportunityScore * 0.15 + tagScore * 0.15;
  return { total, priority: priorityScore, spam: spamScore, opportunity: opportunityScore, otp: otpScore, tags: tagScore, mistakes };
}

export function scoreChat(c: ChatCase, reply: unknown): number {
  const actions = (reply as { actions?: { tool?: string; args?: Record<string, unknown> }[] } | null)?.actions;
  if (!Array.isArray(actions)) return 0;
  const action = actions.find((a) => a.tool === c.tool);
  if (!action) return 0;
  return !c.check || c.check(action.args ?? {}) ? 100 : 50;
}
