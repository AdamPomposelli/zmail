import { describe, expect, it } from 'vitest';
import { JEV_QUESTIONS, buildJevTriage, parseJevTriage, type JevResponse } from '../src/ai/jev';
import { JevClient } from '../src/ai/providers';
import type { MailFeatures } from '../src/ai/heuristics';

const features = (over: Partial<MailFeatures> = {}): MailFeatures => ({
  subject: 'Votre code de vérification',
  text: 'Votre code de vérification est : 482913. Commande n° 104820.',
  html: '',
  from: { name: 'Paylane', email: 'no-reply@paylane.test' },
  to: [{ email: 'adam@nordlys.studio' }],
  cc: [],
  listUnsubscribe: null,
  listUnsubscribePost: null,
  listId: null,
  precedence: null,
  autoSubmitted: null,
  spamHeader: null,
  attachments: [],
  ...over,
});

/** A Jev response where every signal is « no » except the ones given. */
const answers = (yes: Record<string, number>, otp?: string): JevResponse => ({
  answers: {
    ...Object.fromEntries(Object.keys(JEV_QUESTIONS).map((k) => [k, { type: 'noul', noul: yes[k] ?? 0.05 }])),
    ...(otp ? { otp: { type: 'choice', choice: otp } } : {}),
  },
});

describe('Jev (TypeSafe System One)', () => {
  it('sends structured state, atomic questions, and the OTP as a pick among the codes in the mail', () => {
    const req = buildJevTriage({ model: 'typesafe/jev-1.14', features: features(), bulk: false, tags: [{ id: 'security', name: 'Sécurité', description: '' }, { id: 'suppliers', name: 'Fournisseurs', description: 'Factures fournisseurs' }], businesses: [] });
    expect(req.state.sender).toEqual({ name: 'Paylane', address: 'no-reply@paylane.test', domain: 'paylane.test' });
    expect(Object.keys(req.questions)).toEqual(expect.arrayContaining(['gives_a_one_time_code', 'domain_is_official', 'otp', 'tag:suppliers']));
    // Built-in tags are derived in code, not asked.
    expect(req.questions['tag:security']).toBeUndefined();
    expect(Object.keys((req.questions.otp as { criteria: Record<string, string> }).criteria).sort()).toEqual(['104820', '482913']);
  });

  it('leaves out the domain check when the sender has no name', () => {
    const req = buildJevTriage({ model: 'typesafe/jev-1.14', features: features({ from: { email: 'no_reply@immigration.gov.vn' } }), bulk: false, tags: [], businesses: [] });
    expect(req.questions.domain_is_official).toBeUndefined();
  });

  it('decides in code: a code is kept only when Jev says one is given', () => {
    expect(parseJevTriage(answers({ gives_a_one_time_code: 0.95, is_automated_status: 0.9 }, '482913'))).toMatchObject({ otp: '482913', priority: 'high', spam: false, tags: ['security'] });
    expect(parseJevTriage(answers({ is_purchase_or_payment_record: 0.9 }, '104820'))).toMatchObject({ otp: null, priority: 'normal', tags: ['finance'] });
  });

  it('flags phishing: credentials asked from a domain that is not the sender’s', () => {
    expect(parseJevTriage(answers({ asks_to_pay_or_give_details: 0.95, domain_is_official: 0.1 })).spam).toBe(true);
    expect(parseJevTriage(answers({ asks_to_pay_or_give_details: 0.95, domain_is_official: 0.9 })).spam).toBe(false);
  });

  it('does not call an official free gift a scam', () => {
    const { domain_is_official: _, ...noDomain } = answers({ promises_unexpected_money: 0.8 }).answers;
    expect(parseJevTriage({ answers: noDomain }).spam).toBe(false);
    expect(parseJevTriage(answers({ promises_unexpected_money: 0.9, asks_to_pay_or_give_details: 0.8, domain_is_official: 0.9 })).spam).toBe(true);
  });

  it('ranks disputes and outages urgent, a person waiting for a reply high, a promotion low', () => {
    expect(parseJevTriage(answers({ reports_payment_dispute: 0.9, domain_is_official: 0.9 }))).toMatchObject({ priority: 'urgent', tags: ['chargeback'] });
    expect(parseJevTriage(answers({ written_by_a_person: 0.9, expects_a_reply: 0.9, domain_is_official: 0.9 }))).toMatchObject({ priority: 'high', tags: ['to-respond'] });
    expect(parseJevTriage(answers({ is_promotion: 0.9, domain_is_official: 0.9 }))).toMatchObject({ priority: 'low', tags: ['marketing'] });
  });

  it('refuses free-text tasks so the route falls through to the next model', async () => {
    const client = new JevClient('zenmux', 'ZenMux', 'https://zenmux.ai/api/v1', 'typesafe/jev-1.14', 'key');
    await expect(client.complete({ system: '', prompt: 'Résume ma boîte' })).rejects.toThrow(/tri uniquement/);
  });
});
