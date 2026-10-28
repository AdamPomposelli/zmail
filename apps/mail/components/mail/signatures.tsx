import { useQuery } from '@tanstack/react-query';
import { EditorContent, useEditor } from '@tiptap/react';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, Link2 } from 'lucide-react';
import { useEffect } from 'react';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

export type Signature = { id: string; name: string; html: string };
export type SignatureDefaults = { newMail: string | null; reply: string | null };

export function useSignatures() {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.signatures.list.queryOptions());
  const items: Signature[] = data?.items ?? [];
  const defaults: Record<string, SignatureDefaults> = data?.defaults ?? {};
  return {
    loaded: Boolean(data),
    items,
    defaults,
    byId: (id: string | null | undefined) => items.find((s) => s.id === id) ?? null,
    /** Default for an account: new mail vs. reply/forward, like Gmail. */
    defaultFor: (accountId: string, kind: 'newMail' | 'reply') => defaults[accountId]?.[kind] ?? null,
  };
}

/** The block appended to the outgoing mail. The "-- " line is the standard signature delimiter. */
export const signatureHtml = (signature: Signature) => `<div class="zmail-signature"><p>-- </p>${signature.html}</div>`;

export const signatureText = (signature: Signature) => {
  const div = document.createElement('div');
  div.innerHTML = signature.html.replace(/<\/p>|<br\s*\/?>/gi, '\n');
  return `\n\n-- \n${(div.textContent ?? '').trim()}`;
};

/** Small rich-text editor for a signature: bold, italic, links. */
export function SignatureEditor({ html, onChange, autoFocus }: { html: string; onChange: (html: string) => void; autoFocus?: boolean }) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false, codeBlock: false, blockquote: false }), Link.configure({ openOnClick: false }), Placeholder.configure({ placeholder: t('Votre nom, votre fonction, votre téléphone…') })],
    content: html,
    immediatelyRender: false,
    autofocus: autoFocus ? 'end' : false,
    editorProps: { attributes: { class: 'prose prose-sm dark:prose-invert max-w-none min-h-[96px] px-3 py-2.5 text-[13.5px] leading-relaxed focus:outline-none [&_p]:my-0' } },
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? '' : editor.getHTML()),
  });
  useEffect(() => {
    if (editor && html !== editor.getHTML() && !editor.isFocused) editor.commands.setContent(html);
  }, [editor, html]);

  const link = () => {
    if (!editor) return;
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt(t('Adresse du lien'), previous ?? 'https://');
    if (url === null) return;
    if (!url || url === 'https://') editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const tool = (active: boolean | undefined) => cn('text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded-md hover:bg-accent', active && 'text-foreground bg-accent');
  return (
    <div className="overflow-hidden rounded-lg border border-input focus-within:ring-2 focus-within:ring-ring/50">
      <div className="flex items-center gap-0.5 border-b border-border px-1.5 py-1">
        <button type="button" onClick={() => editor?.chain().focus().toggleBold().run()} className={tool(editor?.isActive('bold'))} title={t('Gras')}>
          <Bold className="size-3.5" />
        </button>
        <button type="button" onClick={() => editor?.chain().focus().toggleItalic().run()} className={tool(editor?.isActive('italic'))} title={t('Italique')}>
          <Italic className="size-3.5" />
        </button>
        <button type="button" onClick={link} className={tool(editor?.isActive('link'))} title={t('Lien')}>
          <Link2 className="size-3.5" />
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
