import * as cheerio from 'cheerio';
import { DEFAULT_UNSUBSCRIBE_PROMPT, UNSUBSCRIBE_CONTRACT } from './prompt-config';
import type { UnsubscribeInfo } from '../types';
import type { AiRouter } from './providers';
import { log } from '../lib/log';
import { t } from '../lib/i18n';

export type UnsubscribeOutcome = {
  status: 'success' | 'failed';
  method: 'one-click' | 'mailto' | 'http' | 'http-form' | 'none';
  target: string;
  detail: string;
  /** Page to open by hand when the agent could not finish. */
  manualUrl?: string;
};

const SUCCESS =
  /(successfully unsubscribed|you('| ha)ve been (unsubscribed|removed)|you are (now )?unsubscribed|unsubscribe(d)? successful|no longer receive|won't receive|will not receive|removed from (our|the|this) (mailing )?list|d[ée]sinscription (a [ée]t[ée] )?(prise en compte|confirm[ée]e|r[ée]ussie|effectu[ée]e)|vous (avez [ée]t[ée]|êtes|etes) (bien )?d[ée]sinscrit|vous ne recevrez plus|d[ée]sabonnement (confirm[ée]|effectu[ée]|r[ée]ussi)|vous [êe]tes d[ée]sabonn[ée]|abmeldung erfolgreich|preferences (have been )?(updated|saved)|pr[ée]f[ée]rences (ont [ée]t[ée] )?(mises à jour|enregistr[ée]es))/i;
const ACTION_WORDS = /(unsubscribe|d[ée]sinscri|d[ée]sabonn|opt[- ]?out|confirm|remove me|stop|valider|ne plus recevoir|retirer)/i;
const ALL_WORDS = /(all|tout|toutes|tous|every|global|unsubscribe)/i;

const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
};

const pageText = ($: cheerio.CheerioAPI) => $('body').text().replace(/\s+/g, ' ').trim();

export class UnsubscribeAgent {
  constructor(
    private readonly ai: AiRouter,
    private readonly sendMail: (to: string, subject: string, body: string) => Promise<void>,
    /** The editable instructions (advanced AI settings). */
    private readonly instructions: () => string = () => DEFAULT_UNSUBSCRIBE_PROMPT,
  ) {}

  async run(info: UnsubscribeInfo, recipient: string): Promise<UnsubscribeOutcome> {
    if (info.oneClick) {
      const outcome = await this.oneClick(info.oneClick);
      if (outcome.status === 'success') return outcome;
    }
    if (info.http) {
      const outcome = await this.viaWebPage(info.http, recipient).catch(
        (error): UnsubscribeOutcome => ({ status: 'failed', method: 'http', target: info.http!, detail: (error as Error).message, manualUrl: info.http }),
      );
      if (outcome.status === 'success' || !info.mailto) return outcome;
    }
    if (info.mailto) return this.viaMailto(info.mailto);
    if (info.oneClick) return { status: 'failed', method: 'one-click', target: info.oneClick, detail: t('Le serveur a refusé la désinscription en un clic.'), manualUrl: info.oneClick };
    return { status: 'failed', method: 'none', target: '', detail: t('Aucun lien de désinscription trouvé dans ce mail.') };
  }

  /** RFC 8058: a POST with `List-Unsubscribe=One-Click` is all it takes. */
  private async oneClick(url: string): Promise<UnsubscribeOutcome> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...BROWSER_HEADERS, 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return { status: 'success', method: 'one-click', target: url, detail: t('Désinscription en un clic (RFC 8058) acceptée.') };
      return { status: 'failed', method: 'one-click', target: url, detail: t('Réponse HTTP {status}', { status: res.status }), manualUrl: url };
    } catch (error) {
      return { status: 'failed', method: 'one-click', target: url, detail: (error as Error).message, manualUrl: url };
    }
  }

  private async viaMailto(mailto: string): Promise<UnsubscribeOutcome> {
    const url = new URL(mailto);
    const to = decodeURIComponent(url.pathname);
    const subject = url.searchParams.get('subject') ?? 'unsubscribe';
    const body = url.searchParams.get('body') ?? 'unsubscribe';
    try {
      await this.sendMail(to, subject, body);
      return { status: 'success', method: 'mailto', target: to, detail: t('Demande de désinscription envoyée à {to}.', { to }) };
    } catch (error) {
      return { status: 'failed', method: 'mailto', target: to, detail: t('Envoi impossible : {error}', { error: (error as Error).message }) };
    }
  }

  private async fetchPage(url: string, init: RequestInit = {}) {
    const res = await fetch(url, { ...init, headers: { ...BROWSER_HEADERS, ...(init.headers ?? {}) }, redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    const html = await res.text();
    return { res, html, $: cheerio.load(html), url: res.url || url };
  }

  private async viaWebPage(url: string, recipient: string): Promise<UnsubscribeOutcome> {
    let page = await this.fetchPage(url);
    if (!page.res.ok) return { status: 'failed', method: 'http', target: url, detail: t('La page répond {status}.', { status: page.res.status }), manualUrl: url };
    if (SUCCESS.test(pageText(page.$))) return { status: 'success', method: 'http', target: url, detail: t('La page confirme la désinscription.') };

    // Up to two interactions: submit the unsubscribe form, or follow a confirmation link.
    for (let step = 0; step < 2; step++) {
      const form = this.pickForm(page.$);
      if (form) {
        page = await this.submitForm(page, form, recipient);
      } else {
        const link = page.$('a[href]')
          .toArray()
          .find((a) => ACTION_WORDS.test(page.$(a).text()) && !/mailto:|javascript:/i.test(page.$(a).attr('href') ?? ''));
        if (!link) break;
        page = await this.fetchPage(new URL(page.$(link).attr('href')!, page.url).toString());
      }
      if (!page.res.ok) break;
      if (SUCCESS.test(pageText(page.$))) {
        return { status: 'success', method: 'http-form', target: url, detail: t('Formulaire de désinscription envoyé et confirmé.') };
      }
    }

    const verdict = await this.askModel(pageText(page.$));
    if (verdict === 'success') return { status: 'success', method: 'http', target: url, detail: t('La page confirme la désinscription (analyse IA).') };
    return {
      status: 'failed',
      method: 'http',
      target: url,
      detail: t('La page demande une action manuelle (connexion, captcha ou choix de préférences).'),
      manualUrl: url,
    };
  }

  private pickForm($: cheerio.CheerioAPI) {
    const forms = $('form').toArray();
    return (
      forms.find((f) => ACTION_WORDS.test($(f).text() + ($(f).attr('action') ?? '') + $(f).find('[type=submit],button').toArray().map((b) => $(b).attr('value') ?? $(b).text()).join(' '))) ??
      (forms.length === 1 ? forms[0] : undefined)
    );
  }

  private async submitForm(page: Awaited<ReturnType<UnsubscribeAgent['fetchPage']>>, form: Parameters<cheerio.CheerioAPI>[0], recipient: string) {
    const { $ } = page;
    const $form = $(form);
    const body = new URLSearchParams();
    $form.find('input, select, textarea').each((_, el) => {
      const $el = $(el);
      const name = $el.attr('name');
      if (!name) return;
      const type = ($el.attr('type') ?? 'text').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'image') return;
      if (type === 'checkbox' || type === 'radio') {
        const label = `${name} ${$el.attr('value') ?? ''} ${$el.parent().text()}`;
        if ($el.attr('checked') !== undefined || ALL_WORDS.test(label)) body.append(name, $el.attr('value') ?? 'on');
        return;
      }
      if (type === 'email' || /mail/i.test(name)) body.append(name, $el.attr('value') || recipient);
      else if (el.tagName === 'select') body.append(name, $el.find('option[selected]').attr('value') ?? $el.find('option').first().attr('value') ?? '');
      else body.append(name, $el.attr('value') ?? '');
    });
    const submit = $form.find('[type=submit][name], button[name]').toArray().find((b) => ACTION_WORDS.test($(b).attr('value') ?? $(b).text()));
    if (submit) body.append($(submit).attr('name')!, $(submit).attr('value') ?? '');
    const action = new URL($form.attr('action') ?? page.url, page.url).toString();
    const method = ($form.attr('method') ?? 'get').toUpperCase();
    log.info('unsubscribe', `${method} ${action}`);
    return method === 'POST'
      ? this.fetchPage(action, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } })
      : this.fetchPage(`${action}${action.includes('?') ? '&' : '?'}${body.toString()}`);
  }

  private async askModel(text: string): Promise<'success' | 'needs_action' | 'unknown'> {
    if (!text) return 'unknown';
    const reply = await this.ai.complete('unsubscribe', {
      system: `${this.instructions()}\n${UNSUBSCRIBE_CONTRACT}`,
      prompt: text.slice(0, 2500),
      json: true,
      maxTokens: 120,
      reasoning: 'off',
    });
    const status = (reply?.data as { status?: string } | undefined)?.status;
    return status === 'success' ? 'success' : status === 'needs_action' ? 'needs_action' : 'unknown';
  }
}
