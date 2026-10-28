import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { EngineContext } from '../context';
import { newId } from '../lib/ids';
import { getLocale, t, tp } from '../lib/i18n';

const run = promisify(execFile);

/** What the user said (or typed), plus what the composer already holds. */
export type AssistInput = {
  instruction: string;
  accountId?: string | null;
  /** Set when replying from a thread: its history is given to the model. */
  threadId?: string | null;
  draft?: { to?: string[]; cc?: string[]; subject?: string; body?: string };
};

export type AssistFile = { id: string; name: string; path: string; size: number; modified: number };

export type AssistResult = {
  to: string[];
  cc: string[];
  subject: string;
  /** Plain text, paragraphs separated by blank lines. */
  body: string;
  replyToThreadId: string | null;
  attachments: AssistFile[];
  note: string;
  engine: string;
};

const Reply = z.object({
  to: z.array(z.string()).default([]),
  cc: z.array(z.string()).default([]),
  subject: z.string().default(''),
  body: z.string().default(''),
  replyToThreadId: z.string().nullish(),
  fileQueries: z.array(z.string()).default([]),
  note: z.string().default(''),
});

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_FILE = 20 * 1024 * 1024;
/** What people attach: documents, sheets, slides, images, archives. Never code, data or build output. */
const ATTACHABLE = /\.(pdf|docx?|xlsx?|pptx?|pages|numbers|key|odt|ods|odp|rtf|txt|md|csv|png|jpe?g|heic|gif|webp|zip)$/i;
/** Where people keep what they send, searched by name when Spotlight finds nothing. */
const FOLDERS = ['Documents', 'Desktop', 'Downloads'];
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const words = (text: string) => [...new Set(text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9@.]+/).filter((w) => w.length >= 3))];

/**
 * The composer's assistant: "write to Claire about the quote and attach my March invoice",
 * "reply to today's mail from Stripe saying it's fixed". It gathers the context itself (contacts,
 * matching threads, the thread being answered), asks the chat model once for the whole draft,
 * then finds the requested files with Spotlight. Files are only proposed: the person sees them
 * attached and can remove them before sending; only files proposed here can be read back.
 */
export class ComposeAssistant {
  private offered = new Map<string, { path: string; at: number }>();

  constructor(private readonly ctx: EngineContext) {}

  async draft(input: AssistInput): Promise<AssistResult> {
    const instruction = input.instruction.trim();
    if (!instruction) throw new Error(t('Dites ou écrivez ce que vous voulez envoyer.'));
    const account = (input.accountId && this.ctx.accounts.get(input.accountId)) || this.ctx.accounts.list()[0];
    const keys = words(instruction);

    const contacts = this.contacts(keys);
    const threads = this.threads(keys);
    const current = input.threadId ? this.ctx.store.getThread(input.threadId) : null;
    const history = current
      ? current.messages
          .slice(-4)
          .map((m) => `De ${m.from.name ?? ''} <${m.from.email}> le ${new Date(m.date).toLocaleString('fr-FR')} :\n${m.text.slice(0, 1500)}`)
          .join('\n---\n')
      : '';

    const system = [
      'Tu rédiges des mails pour l’utilisateur à partir d’une consigne souvent dictée à voix haute (phrases orales, hésitations : comprends l’intention).',
      'Réponds en JSON : {"to":[adresses],"cc":[adresses],"subject":"","body":"","replyToThreadId":null|"id","fileQueries":["…"],"note":""}.',
      '- to/cc : uniquement des adresses présentes dans les contacts ou les fils fournis, ou dictées explicitement. Jamais d’adresse inventée ; si le destinataire est introuvable, laisse vide et dis-le dans note.',
      '- replyToThreadId : l’id d’un fil fourni si l’utilisateur veut répondre à un mail reçu (« réponds au dernier mail de… »), sinon null. En réponse, to = l’expéditeur du fil et subject = « Re: » + sujet.',
      '- body : le mail complet prêt à envoyer, dans la langue de la consigne (ou du fil en réponse), ton naturel et professionnel, sans signature (ajoutée automatiquement), paragraphes séparés par une ligne vide. N’invente aucun fait, chiffre ou engagement absent de la consigne ou du fil.',
      '- fileQueries : si l’utilisateur demande de joindre des documents de son ordinateur, 1 à 3 mots-clés de recherche par document, dans la langue de la consigne (ex. "facture mars", "devis acme" ; en anglais "march invoice", "acme quote"). Sinon [].',
      `- note : une phrase courte pour l’utilisateur sur ce que tu as fait ou ce qui manque, en ${getLocale() === 'fr' ? 'français' : 'anglais'}.`,
    ].join('\n');
    const prompt = [
      `Aujourd’hui : ${new Date().toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })}.`,
      `L’utilisateur : ${account?.name ?? ''} <${account?.email ?? ''}>.`,
      `Contacts possibles :\n${contacts.map((c) => `- ${c.name ? `${c.name} ` : ''}<${c.email}> (${c.n} échanges)`).join('\n') || '- aucun'}`,
      `Fils récents qui peuvent correspondre :\n${threads.map((t) => `- id=${t.id} · ${t.from} <${t.email}> · « ${t.subject} » · ${new Date(t.date).toLocaleString('fr-FR')}${t.summary ? ` · ${t.summary}` : ''}`).join('\n') || '- aucun'}`,
      current ? `L’utilisateur répond au fil id=${current.id} « ${current.subject} ». Historique :\n${history}` : '',
      input.draft && (input.draft.subject || input.draft.body || input.draft.to?.length) ? `Brouillon actuel : à ${input.draft.to?.join(', ') || '—'} · objet « ${input.draft.subject ?? ''} »\n${(input.draft.body ?? '').slice(0, 1500)}` : '',
      `Consigne : ${instruction}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const completion = await this.ctx.ai.complete('chat', { system, prompt, json: true, maxTokens: 900, reasoning: 'low' });
    if (!completion?.data) throw new Error(t('Aucune IA disponible pour rédiger : activez Apple Intelligence ou connectez un service dans Réglages → Intelligence artificielle.'));
    const parsed = Reply.safeParse(completion.data);
    if (!parsed.success) throw new Error(t('L’IA a répondu dans un format inattendu. Reformulez la demande.'));
    const reply = parsed.data;

    // Never trust an address the model made up: keep only those it was given or that were dictated.
    const known = new Set([...contacts.map((c) => c.email), ...threads.map((t) => t.email), ...(current?.messages.flatMap((m) => [m.from.email, ...m.to.map((a) => a.email)]) ?? []), ...(instruction.match(/[^\s<>()]+@[^\s<>()]+\.[a-z]{2,}/gi) ?? [])].map((e) => e.toLowerCase()));
    const clean = (list: string[]) => [...new Set(list.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL.test(e) && known.has(e)))];
    const replyToThreadId = current?.id ?? (reply.replyToThreadId && threads.some((t) => t.id === reply.replyToThreadId) ? reply.replyToThreadId : null);

    const attachments: AssistFile[] = [];
    for (const query of reply.fileQueries.slice(0, 3)) {
      const file = await this.findFile(query);
      if (file && !attachments.some((a) => a.path === file.path)) attachments.push(file);
    }
    const missingFiles = reply.fileQueries.length - attachments.length;
    const note = [reply.note, missingFiles > 0 ? tp(missingFiles, '{n} document introuvable sur votre Mac.', '{n} documents introuvables sur votre Mac.') : ''].filter(Boolean).join(' ');
    return { to: clean(reply.to), cc: clean(reply.cc), subject: reply.subject, body: reply.body, replyToThreadId, attachments, note, engine: completion.model };
  }

  /** Reads a file this assistant proposed (and only those), for attaching it. */
  async readOffered(id: string) {
    const offer = this.offered.get(id);
    if (!offer) throw new Error(t('Pièce jointe inconnue ou expirée'));
    const info = await stat(offer.path);
    if (info.size > MAX_FILE) throw new Error(t('Fichier trop volumineux (20 Mo maximum)'));
    return { filename: basename(offer.path), contentType: mimeOf(offer.path), base64: (await readFile(offer.path)).toString('base64'), size: info.size };
  }

  /** People the user writes with, best matches for the instruction's words first. */
  private contacts(keys: string[]) {
    const rows = this.ctx.db.all<{ email: string; name: string | null; n: number }>(
      `SELECT lower(from_email) AS email, max(from_name) AS name, count(*) AS n FROM messages
       WHERE from_email IS NOT NULL AND from_email NOT LIKE '%noreply%' AND from_email NOT LIKE '%no-reply%'
       GROUP BY lower(from_email) ORDER BY n DESC LIMIT 400`,
    );
    const score = (c: { email: string; name: string | null }) => keys.filter((k) => `${c.name ?? ''} ${c.email}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(k)).length;
    return rows
      .map((c) => ({ ...c, score: score(c) }))
      .sort((a, b) => b.score - a.score || b.n - a.n)
      .slice(0, 25);
  }

  /** Recent inbox threads, the ones matching the instruction first. */
  private threads(keys: string[]) {
    const recent = this.ctx.store.listThreads({ view: 'inbox', limit: 12, sort: 'date' }).items;
    const matching = keys.length ? this.ctx.store.listThreads({ view: 'inbox', limit: 8, sort: 'date', query: keys.filter((k) => !/^(reponds?|repondre|mail|message|dernier|aujourd|envoie|ecris)/.test(k)).slice(0, 4).join(' ') }).items : [];
    const seen = new Set<string>();
    return [...matching, ...recent]
      .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
      .slice(0, 15)
      .map((t) => ({ id: t.id, from: t.from.name ?? t.from.email, email: t.from.email.toLowerCase(), subject: t.subject, date: t.date, summary: t.summary ?? '' }));
  }

  /**
   * Finds the file a query names, in the user's home only. In order: Spotlight by name, then
   * the usual folders walked by name (Spotlight can be off, or not have indexed a new file yet),
   * then Spotlight by content. Only documents people attach count; the file whose name holds
   * the most query words wins, then the most recent.
   */
  private async findFile(query: string): Promise<AssistFile | null> {
    if (process.platform !== 'darwin' || !query.trim()) return null;
    const home = homedir();
    const terms = query.replace(/["\\*]/g, ' ').trim();
    const words = fold(terms).split(/\s+/).filter((w) => w.length > 1);
    const hidden = (p: string) => /\/(Library|\.Trash|node_modules|\.git)\//.test(p) || /\/\./.test(p.slice(home.length));
    const nameScore = (p: string) => words.filter((w) => fold(basename(p)).includes(w)).length;
    const mdfind = async (args: string[]) => {
      try {
        const { stdout } = await run('mdfind', ['-onlyin', home, ...args], { timeout: 4000, maxBuffer: 1024 * 1024 });
        return stdout.split('\n').filter((p) => p && ATTACHABLE.test(p) && !hidden(p));
      } catch {
        return []; // Spotlight unavailable or timed out.
      }
    };

    let candidates = await mdfind([`kMDItemDisplayName == "*${terms.split(/\s+/).join('*')}*"cd && kMDItemContentTypeTree != "public.folder"`]);
    if (!candidates.length) candidates = (await this.walk(FOLDERS.map((f) => join(home, f)), 4)).filter((p) => ATTACHABLE.test(p) && nameScore(p) >= Math.min(2, words.length));
    if (!candidates.length) candidates = await mdfind([terms]);
    const files = (
      await Promise.all(
        candidates.slice(0, 40).map(async (path) => {
          const info = await stat(path).catch(() => null);
          return info?.isFile() && info.size > 0 && info.size <= MAX_FILE ? { path, size: info.size, modified: info.mtimeMs, score: nameScore(path) } : null;
        }),
      )
    ).filter((f): f is NonNullable<typeof f> => f !== null);
    const best = files.sort((a, b) => b.score - a.score || b.modified - a.modified)[0];
    if (!best) return null;
    const id = newId('att');
    this.offered.set(id, { path: best.path, at: Date.now() });
    // Offers expire after an hour; the map stays small.
    for (const [key, offer] of this.offered) if (Date.now() - offer.at > 3_600_000) this.offered.delete(key);
    return { id, name: basename(best.path), path: best.path.replace(home, '~'), size: best.size, modified: best.modified };
  }

  /**
   * Files under these folders, a few levels deep. Skips hidden folders, Library, and code
   * repositories (a folder with .git): documents people send don't live there. Bounded, and
   * kept a minute so the documents of one request share a single walk.
   */
  private walked: { at: number; files: Promise<string[]> } | null = null;
  private walk(dirs: string[], depth: number): Promise<string[]> {
    if (this.walked && Date.now() - this.walked.at < 60_000) return this.walked.files;
    const files: string[] = [];
    let budget = 1500;
    const level = async (current: string[], left: number): Promise<void> => {
      if (left < 0 || !current.length || budget <= 0) return;
      budget -= current.length;
      const next: string[] = [];
      await Promise.all(
        current.map(async (dir) => {
          const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
          if (entries.some((e) => e.name === '.git')) return;
          for (const e of entries) {
            if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'Library') continue;
            if (e.isDirectory()) next.push(join(dir, e.name));
            else if (e.isFile()) files.push(join(dir, e.name));
          }
        }),
      );
      await level(next, left - 1);
    };
    const result = level(dirs, depth).then(() => files);
    this.walked = { at: Date.now(), files: result };
    return result;
  }
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.heic': 'image/heic',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv', '.txt': 'text/plain', '.zip': 'application/zip', '.key': 'application/x-iwork-keynote-sffkey', '.pages': 'application/x-iwork-pages-sffpages', '.numbers': 'application/x-iwork-numbers-sffnumbers',
};
const mimeOf = (path: string) => MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
