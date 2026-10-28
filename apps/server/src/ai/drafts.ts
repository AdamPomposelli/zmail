import type { EngineContext } from '../context';
import { outputLanguage } from '../lib/i18n';

/**
 * Reply drafts for the « Trier et répondre » cockpit. The model reads the conversation and
 * writes the reply the user would send, in the conversation's language, signed with the
 * account's sender name. It also says whether it is sure: a reply it is not sure about (money,
 * a commitment, a decision, missing information) goes to the « à vérifier » group instead.
 */
export type Draft = { text: string; confident: boolean; reason: string };

const MAX_CHARS = 3500;

export class ReplyDrafter {
  constructor(private readonly ctx: EngineContext) {}

  async draft(threadId: string, instruction?: string, previous?: string): Promise<Draft | null> {
    const messages = this.ctx.store.threadMessages(threadId).filter((m) => m.special_use !== 'drafts');
    const last = messages.filter((m) => m.special_use !== 'sent').at(-1);
    if (!last) return null;
    const account = this.ctx.accounts.get(last.account_id);
    const transcript = messages
      .slice(-4)
      .map((m) => `${m.special_use === 'sent' ? 'Moi' : m.from_name || m.from_email} (${new Date(m.date).toISOString().slice(0, 10)}) :\n${m.text_body.replace(/\n{3,}/g, '\n\n').slice(0, 1500)}`)
      .join('\n\n---\n\n')
      .slice(-MAX_CHARS);
    const result = await this.ctx.ai.complete('chat', {
      system: [
        `You write the reply that the user (${account?.name || account?.email || 'the recipient'}) would send to the last message of this email conversation.`,
        'Write in the language of the conversation, in the user’s voice: short, natural, polite, no filler, no subject line, no placeholders like [Name]. Sign with the user’s first name if the conversation is informal, else with their name.',
        'Never invent facts, prices, dates or commitments that the conversation does not give. When a decision belongs to the user, write a reply that commits to nothing (acknowledge, ask the missing detail, say they will come back to it): such a reply is safe, so "confident" stays true.',
        'Set "confident" to false only when no useful reply is possible without the user: the reply would have to state a price, accept or refuse a deal, pick a date, or give information you do not have. Most replies are confident.',
        `Reply with JSON only: {"reply": string, "confident": boolean, "reason": string}. "reason": one short sentence in ${outputLanguage()} explaining what the reply does, or why the user should check it.`,
      ].join('\n'),
      prompt: [instruction ? `Instruction from the user for this reply: ${instruction}` : null, previous ? `Previous draft (rewrite it):\n${previous}` : null, 'Conversation:', transcript].filter(Boolean).join('\n\n'),
      json: true,
      maxTokens: 700,
      reasoning: 'low',
    });
    const data = result?.data as { reply?: unknown; confident?: unknown; reason?: unknown } | undefined;
    if (!data || typeof data.reply !== 'string' || !data.reply.trim()) return null;
    return { text: data.reply.trim(), confident: data.confident !== false, reason: typeof data.reason === 'string' ? data.reason : '' };
  }

  /** One-line recap of each group of unread mail, for the overview (cached per set of mails). */
  async recap(groups: Record<'tidy' | 'ask' | 'mine', { from: string; subject: string; tags: string[] }[]>): Promise<Record<'tidy' | 'ask' | 'mine', string> | null> {
    const key = JSON.stringify(Object.values(groups).map((g) => g.map((m) => m.subject)));
    const cached = this.ctx.db.getSetting<{ key: string; at: number; value: Record<'tidy' | 'ask' | 'mine', string> } | null>('overview:recap', null);
    if (cached && cached.key === key && Date.now() - cached.at < 30 * 60_000) return cached.value;
    const list = (items: { from: string; subject: string; tags: string[] }[]) =>
      items.length ? items.slice(0, 15).map((m) => `- ${m.from} : ${m.subject}${m.tags.length ? ` [${m.tags.join(', ')}]` : ''}`).join('\n') : '(aucun)';
    const result = await this.ctx.ai.complete('chat', {
      system: [
        'You summarise groups of unread emails for a busy person, so they know at a glance what each group contains.',
        `For each group write ONE sentence in ${outputLanguage()}, at most 18 words, naming the concrete senders or topics (e.g. « Surtout les newsletters DevPulse et Medium, et 3 promos Déco Maison »). No counting sentence, no advice. Empty group: empty string.`,
        'Reply with JSON only: {"tidy": string, "ask": string, "mine": string}.',
      ].join('\n'),
      prompt: [`tidy (the AI files them on its own):\n${list(groups.tidy)}`, `ask (it will ask the user):\n${list(groups.ask)}`, `mine (need the user):\n${list(groups.mine)}`].join('\n\n'),
      json: true,
      maxTokens: 300,
      reasoning: 'off',
    });
    const data = result?.data as Record<string, unknown> | undefined;
    if (!data) return null;
    const value = { tidy: String(data.tidy ?? ''), ask: String(data.ask ?? ''), mine: String(data.mine ?? '') };
    this.ctx.db.setSetting('overview:recap', { key, at: Date.now(), value });
    return value;
  }
}
