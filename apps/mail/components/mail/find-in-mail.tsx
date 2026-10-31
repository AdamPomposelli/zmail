import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { cn, isMac } from '@/lib/utils';
import { t, tp } from '@/lib/i18n';

/** Fired by a mail's frame when ⌘F is pressed inside it (the frame has its own keyboard). */
export const FIND_EVENT = 'zmail:find';

const ALL = 'zm-find';
const CURRENT = 'zm-find-current';
/** Same look in the app and inside each mail's frame, which has its own styles. */
export const FIND_STYLE = `::highlight(${ALL}){background-color:rgba(250,204,21,.45);color:inherit}::highlight(${CURRENT}){background-color:#f97316;color:#fff}`;

const stripAccents = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Lower case, no-break spaces as spaces and, unless the search itself has accents, no accents:
 * « recu » finds « Reçu », « é » finds only « é ».
 * Returns the folded text and, for each of its characters, where it came from in the original.
 */
function fold(text: string, keepAccents = false) {
  let out = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const lower = text[i]!.replace(/\u00a0/g, ' ').toLowerCase();
    for (const c of keepAccents ? lower : stripAccents(lower)) {
      out += c;
      map.push(i);
    }
  }
  return { out, map };
}

/** The visible text of the conversation, in reading order, frames included. */
function textNodes(root: Node, into: Text[] = []) {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      const el = node as Element;
      if (el.matches('script, style, noscript, [data-find-skip], [hidden]')) return NodeFilter.FILTER_REJECT;
      if (el.tagName === 'IFRAME') {
        const body = (el as HTMLIFrameElement).contentDocument?.body;
        if (body) textNodes(body, into);
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_SKIP;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) into.push(n as Text);
  return into;
}

type Win = Window & typeof globalThis;
const windowOf = (range: Range) => range.startContainer.ownerDocument!.defaultView as Win | null;

/** Draws the matches with the CSS Custom Highlight API: the mail's DOM is never touched. */
function paint(ranges: Range[], current: number, frames: Document[]) {
  const wins = new Set<Win>([window as Win, ...frames.map((d) => d.defaultView as Win).filter(Boolean)]);
  for (const w of wins) {
    if (!w.CSS?.highlights) continue;
    w.CSS.highlights.delete(ALL);
    w.CSS.highlights.delete(CURRENT);
    const mine = ranges.filter((r) => windowOf(r) === w);
    if (!mine.length) continue;
    const doc = w.document;
    if (doc !== document && !doc.getElementById('zm-find-style')) {
      const style = doc.createElement('style');
      style.id = 'zm-find-style';
      style.textContent = FIND_STYLE;
      doc.head.append(style);
    }
    w.CSS.highlights.set(ALL, new w.Highlight(...mine));
    const cur = ranges[current];
    if (cur && windowOf(cur) === w) w.CSS.highlights.set(CURRENT, new w.Highlight(cur));
  }
}

/**
 * ⌘F in an open conversation: finds a word or an amount in its mails (frames included), like the
 * browser's find but scoped to the mail. A magnifier with its shortcut sits in the toolbar and
 * opens into a field; Enter / ⇧Enter go through the matches, Escape closes.
 */
export function FindInMail({ scope }: { scope: RefObject<HTMLElement | null> }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [ranges, setRanges] = useState<Range[]>([]);
  const [current, setCurrent] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const frames = useCallback(() => [...(scope.current?.querySelectorAll('iframe') ?? [])].map((f) => f.contentDocument).filter((d): d is Document => !!d), [scope]);

  // A counter, so ⌘F again while open puts the focus back in the field.
  const [asked, setAsked] = useState(0);
  const show = useCallback(() => {
    setOpen(true);
    setAsked((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!asked || !open) return;
    // Pressed inside a mail's frame, the focus is there: take it back to the app first.
    if (document.activeElement instanceof HTMLIFrameElement) document.activeElement.blur();
    window.focus();
    input.current?.focus();
    input.current?.select();
  }, [asked, open]);
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  useHotkeys('mod+f', show, { preventDefault: true, enableOnFormTags: true }, [show]);
  useEffect(() => {
    window.addEventListener(FIND_EVENT, show);
    return () => window.removeEventListener(FIND_EVENT, show);
  }, [show]);

  // Searches again when the text changes: a mail unfolds, a frame finishes loading, images show.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const root = scope.current;
    if (!open || !root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setVersion((v) => v + 1), 120);
    };
    const observer = new MutationObserver(bump);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    root.addEventListener('load', bump, true);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      root.removeEventListener('load', bump, true);
    };
  }, [open, scope]);

  useEffect(() => {
    const root = scope.current;
    const typed = query.trim();
    const accents = stripAccents(typed) !== typed;
    const needle = fold(typed.normalize('NFC'), accents).out;
    if (!open || !root || !needle) {
      setRanges([]);
      return;
    }
    const found: Range[] = [];
    for (const node of textNodes(root)) {
      const { out, map } = fold(node.nodeValue ?? '', accents);
      for (let at = out.indexOf(needle); at !== -1 && found.length < 1000; at = out.indexOf(needle, at + needle.length)) {
        const range = node.ownerDocument.createRange();
        range.setStart(node, map[at]!);
        range.setEnd(node, map[at + needle.length - 1]! + 1);
        found.push(range);
      }
    }
    setRanges(found);
    setCurrent((c) => (c < found.length ? c : 0));
  }, [query, open, version, scope]);

  // A new search starts from the first match.
  useEffect(() => setCurrent(0), [query]);

  useEffect(() => {
    paint(ranges, current, frames());
    const range = ranges[current];
    const target = range?.startContainer.parentElement;
    // Centred, across the frame and the conversation's scroll at once.
    target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }, [ranges, current, frames]);
  useEffect(() => () => paint([], 0, frames()), [frames]);

  const go = (dir: 1 | -1) => ranges.length && setCurrent((c) => (c + dir + ranges.length) % ranges.length);
  const key = isMac ? '⌘' : 'Ctrl';

  if (!open)
    return (
      <button
        type="button"
        onClick={show}
        title={t('Rechercher dans ce mail ({key} F)', { key })}
        aria-label={t('Rechercher dans ce mail')}
        className="text-muted-foreground hover:text-foreground hover:bg-accent flex h-8 items-center gap-1.5 rounded-lg px-2 transition"
      >
        <Search className="size-4" />
        <kbd className="font-sans text-[11px]">{key} F</kbd>
      </button>
    );

  return (
    <label data-find-skip className="bg-muted ring-border zm-unfold flex h-8 w-64 items-center gap-2 rounded-lg px-2.5 text-[13px] ring-1">
      <Search className="text-muted-foreground size-3.5 shrink-0" />
      <input
        ref={input}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('Rechercher dans ce mail')}
        aria-label={t('Rechercher dans ce mail')}
        className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none"
        onKeyDown={(e) => {
          // Escape here closes the search, not the conversation.
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            go(e.shiftKey ? -1 : 1);
          }
          if (e.key === 'Escape') close();
        }}
      />
      {query.trim() ? (
        <span className={cn('shrink-0 text-[11.5px] tabular-nums', ranges.length ? 'text-muted-foreground' : 'text-destructive')} aria-live="polite">
          {ranges.length ? `${current + 1}/${ranges.length}` : tp(0, '{n} résultat', '{n} résultats')}
        </span>
      ) : null}
      <span className="flex shrink-0 items-center">
        <button type="button" onClick={() => go(-1)} disabled={!ranges.length} className="text-muted-foreground hover:text-foreground disabled:opacity-40 flex size-5 items-center justify-center rounded" aria-label={t('Résultat précédent (⇧↵)')} title={t('Résultat précédent (⇧↵)')}>
          <ChevronUp className="size-3.5" />
        </button>
        <button type="button" onClick={() => go(1)} disabled={!ranges.length} className="text-muted-foreground hover:text-foreground disabled:opacity-40 flex size-5 items-center justify-center rounded" aria-label={t('Résultat suivant (↵)')} title={t('Résultat suivant (↵)')}>
          <ChevronDown className="size-3.5" />
        </button>
        <button type="button" onClick={close} className="text-muted-foreground hover:text-foreground flex size-5 items-center justify-center rounded" aria-label={t('Fermer la recherche (Échap)')} title={t('Fermer la recherche (Échap)')}>
          <X className="size-3.5" />
        </button>
      </span>
    </label>
  );
}
