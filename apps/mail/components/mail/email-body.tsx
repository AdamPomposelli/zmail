import DOMPurify from 'dompurify';
import { ImageOff } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { FIND_EVENT } from './find-in-mail';
import { trackGesture } from '@/lib/track';

/** Rich newsletters keep their own light design; plain mails follow the app theme. */
const isRich = (html: string) => /<table|bgcolor|background(-color)?\s*:|[^-]color\s*:/i.test(html);

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const linkify = (text: string) =>
  escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, '<br>');

export function EmailBody({ messageId, threadId, html, text, allowImages, onBlockedImages }: { messageId: string; threadId?: string; html: string; text: string; allowImages: boolean; onBlockedImages?: (blocked: boolean) => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);
  const { resolvedTheme } = useTheme();
  const rich = Boolean(html) && isRich(html);
  const dark = resolvedTheme === 'dark' && !rich;

  const { doc, blocked } = useMemo(() => {
    let blocked = 0;
    const source = html || `<div>${linkify(text)}</div>`;
    const clean = DOMPurify.sanitize(source, { WHOLE_DOCUMENT: false, FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'], ADD_ATTR: ['target'] });
    const container = document.createElement('div');
    container.innerHTML = clean;
    container.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') ?? '';
      if (src.startsWith('cid:')) {
        img.setAttribute('src', `/api/messages/${messageId}/cid/${encodeURIComponent(src.slice(4))}`);
      } else if (/^https?:/i.test(src) && !allowImages) {
        img.removeAttribute('src');
        img.setAttribute('data-blocked', src);
        img.style.display = 'none';
        blocked++;
      }
    });
    container.querySelectorAll('a').forEach((a) => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
    const fg = dark ? '#e7e7e9' : '#1f1f22';
    const link = dark ? '#7aa7ff' : '#2563eb';
    const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
      <style>
        :root{color-scheme:${dark ? 'dark' : 'light'};}
        html,body{margin:0;padding:0;background:${rich ? '#ffffff' : 'transparent'};}
        body{font:14px/1.6 -apple-system,BlinkMacSystemFont,'Geist','Segoe UI',sans-serif;color:${fg};word-wrap:break-word;overflow-wrap:anywhere;padding:${rich ? '16px' : '0'};}
        a{color:${link};}
        img{max-width:100%;height:auto;}
        table{max-width:100%;}
        blockquote{margin:0 0 0 2px;padding-left:12px;border-left:2px solid ${dark ? '#3a3a3d' : '#e4e4e7'};color:${dark ? '#a1a1aa' : '#71717a'};}
        pre{white-space:pre-wrap;}
      </style></head><body>${container.innerHTML}</body></html>`;
    return { doc, blocked };
  }, [html, text, messageId, allowImages, dark, rich]);

  useEffect(() => onBlockedImages?.(blocked > 0), [blocked, onBlockedImages]);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;
    const measure = () => {
      const body = frame.contentDocument?.body;
      if (body) setHeight(Math.max(40, Math.ceil(body.scrollHeight) + 2));
    };
    // The frame has its own keyboard: ⌘F clicked into a mail still opens the search in it.
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        window.dispatchEvent(new Event(FIND_EVENT));
      }
    };
    // A link opened from the mail (the domain only: where the user goes, not the full address).
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.('a[href]');
      if (!link || !threadId) return;
      let domain: string | null = null;
      try {
        domain = new URL(link.getAttribute('href') ?? '').hostname || null;
      } catch {
        // mailto:, relative or broken links: still a click
      }
      trackGesture({ action: 'openLink', threadId, meta: { domain, message: messageId } });
    };
    const onLoad = () => {
      measure();
      frame.contentDocument?.addEventListener('keydown', onKey);
      frame.contentDocument?.addEventListener('click', onClick);
      const body = frame.contentDocument?.body;
      if (body) {
        observer = new ResizeObserver(measure);
        observer.observe(body);
      }
    };
    frame.addEventListener('load', onLoad);
    return () => {
      frame.removeEventListener('load', onLoad);
      frame.contentDocument?.removeEventListener('keydown', onKey);
      frame.contentDocument?.removeEventListener('click', onClick);
      observer?.disconnect();
    };
  }, [doc, threadId, messageId]);

  return (
    <div className={cn(rich && 'overflow-hidden rounded-xl bg-white border border-border')}>
      <iframe
        ref={ref}
        title={t('Contenu du mail')}
        srcDoc={doc}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        className="block w-full border-0"
        style={{ height, colorScheme: dark ? 'dark' : 'light', background: 'transparent' }}
      />
    </div>
  );
}

export function BlockedImagesNotice({ onAllow }: { onAllow: () => void }) {
  return (
    <div className="text-muted-foreground mb-3 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
      <ImageOff className="size-3.5" />
      {t('Images distantes bloquées pour protéger votre vie privée (pixels de suivi).')}
      <button onClick={onAllow} className="text-foreground ml-auto font-medium underline-offset-2 hover:underline">
        {t('Afficher les images')}
      </button>
    </div>
  );
}
