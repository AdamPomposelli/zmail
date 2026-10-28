import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EditorContent, useEditor } from '@tiptap/react';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Check, CornerUpLeft, Italic, List, Loader2, Mic, Paperclip, PenLine, Send, Settings2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useHotkeys } from 'react-hotkeys-hook';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { RecipientInput, isEmail, type RecipientInputHandle } from './recipient-input';
import { signatureHtml, signatureText, useSignatures } from './signatures';
import { ComposeAssistant, type AssistDraft } from './compose-assistant';
import { useCatalog } from '@/hooks/use-catalog';
import { useTRPC, type Message, type Thread } from '@/lib/trpc';
import { cn, displayName, formatFullDate, isMac } from '@/lib/utils';
import { SolarIcon } from '@/components/ui/solar-icon';
import { t } from '@/lib/i18n';

/** `editAsNew`: the message as a fresh draft (same recipients, subject and body), like Thunderbird. */
export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward' | 'editAsNew';

type Attachment = { filename: string; contentType: string; base64: string; size: number; fromAssistant?: boolean };

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** The assistant writes plain text; the editor wants paragraphs. */
const textToHtml = (text: string) => text.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');

const quote = (message: Message) =>
  `<p></p><p>${t('Le {date}, {name} {email} a écrit :', { date: formatFullDate(message.date), name: escapeHtml(displayName(message.from)), email: `&lt;${message.from.email}&gt;` })}</p><blockquote>${message.html || message.text.replace(/\n/g, '<br>')}</blockquote>`;

export function Composer({ mode, thread, message, onClose, className }: { mode: ComposeMode; thread?: Thread; message?: Message; onClose: () => void; className?: string }) {
  const trpc = useTRPC();
  const catalog = useCatalog();
  const send = useMutation(trpc.mail.send.mutationOptions());
  const queryClient = useQueryClient();
  const readAttachment = useMutation(trpc.compose.attachment.mutationOptions());
  // Assistant panel (null = closed; listen = opened from the microphone, starts dictating).
  const [assistant, setAssistant] = useState<{ listen: boolean } | null>(null);
  // A new mail the assistant turned into a reply ("réponds au dernier mail de…").
  const [replyTo, setReplyTo] = useState<{ message: Message; subject: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const initial = useMemo(() => {
    if (!message || !thread) return { to: [] as string[], cc: [] as string[], subject: '', accountId: catalog.accounts[0]?.id ?? '' };
    const account = catalog.accountById.get(message.accountId);
    const mine = new Set([account?.email, ...(account?.aliases ?? [])].filter(Boolean));
    const replyTarget = message.replyTo ?? message.from.email;
    const subject = thread.subject.replace(/^(re|fwd?|tr)\s*:\s*/i, '');
    if (mode === 'forward') return { to: [], cc: [], subject: `Fwd: ${subject}`, accountId: message.accountId };
    if (mode === 'editAsNew') return { to: message.to.map((a) => a.email), cc: message.cc.map((a) => a.email), subject: message.subject, accountId: message.accountId };
    const others = mode === 'replyAll' ? [...message.to, ...message.cc].map((a) => a.email).filter((e) => !mine.has(e) && e !== replyTarget) : [];
    return { to: mine.has(replyTarget) ? message.to.map((a) => a.email) : [replyTarget], cc: others, subject: `Re: ${subject}`, accountId: message.accountId };
  }, [mode, thread, message, catalog.accounts, catalog.accountById]);

  const [accountId, setAccountId] = useState(initial.accountId);
  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc);
  const [showCc, setShowCc] = useState(initial.cc.length > 0);
  const toField = useRef<RecipientInputHandle>(null);
  const subjectField = useRef<HTMLInputElement>(null);
  const ccField = useRef<RecipientInputHandle>(null);
  const navigate = useNavigate();

  // Signature: the account's default (new mail vs. reply/forward), switchable from the toolbar.
  const signatures = useSignatures();
  const kind = mode === 'new' || mode === 'editAsNew' ? 'newMail' : 'reply';
  const [signatureId, setSignatureId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (signatures.loaded) setSignatureId(signatures.defaultFor(accountId, kind));
    // Re-pick when the sending account changes, like Gmail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatures.loaded, accountId]);
  const signature = signatures.byId(signatureId);
  const [subject, setSubject] = useState(initial.subject);

  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false }), Placeholder.configure({ placeholder: mode === 'new' ? t('Écrivez votre message…') : t('Votre réponse…') })],
    content: mode === 'forward' && message ? quote(message) : mode === 'editAsNew' && message ? message.html || message.text.replace(/\n/g, '<br>') : '',
    immediatelyRender: false,
    editorProps: { attributes: { class: 'prose prose-sm dark:prose-invert max-w-none min-h-[140px] focus:outline-none text-[14px] leading-relaxed' } },
    autofocus: mode === 'new' ? false : 'start',
  });

  const submit = async () => {
    const recipients = toField.current?.flush() ?? to;
    const copies = ccField.current?.flush() ?? cc;
    if (!accountId) return toast.error(t('Connectez d’abord une boîte mail.'));
    if (recipients.length === 0) return toast.error(t('Ajoutez au moins un destinataire.'));
    const invalid = [...recipients, ...copies].filter((e) => !isEmail(e));
    if (invalid.length) return toast.error(t('Adresse invalide : {addresses}', { addresses: invalid.join(', ') }));
    // Signature sits between the new text and the quoted mail, as in Gmail.
    const body = `${editor?.getHTML() ?? ''}${signature ? signatureHtml(signature) : ''}`;
    const answering = mode === 'reply' || mode === 'replyAll' ? message : replyTo?.message;
    const html = answering ? `${body}${quote(answering)}` : body;
    try {
      await send.mutateAsync({
        accountId,
        to: recipients,
        cc: copies,
        subject: subject || t('(sans objet)'),
        html,
        text: `${editor?.getText() ?? ''}${signature ? signatureText(signature) : ''}`,
        inReplyToMessageId: answering?.id ?? null,
        attachments: attachments.map(({ size: _size, fromAssistant: _assistant, ...a }) => a),
      });
      toast.success(t('Message envoyé'));
      onClose();
    } catch (error) {
      toast.error(t('Envoi impossible : {error}', { error: (error as Error).message }));
    }
  };

  useHotkeys('mod+enter', () => void submit(), { preventDefault: true, enableOnFormTags: true, enableOnContentEditable: true }, [submit]);

  /** Fills the composer from the assistant's draft; everything stays editable before sending. */
  const applyDraft = async (draft: AssistDraft) => {
    if (draft.to.length) setTo((prev) => [...new Set([...prev, ...draft.to])]);
    if (draft.cc.length) (setCc((prev) => [...new Set([...prev, ...draft.cc])]), setShowCc(true));
    if (draft.subject) setSubject(draft.subject);
    if (draft.body) editor?.commands.setContent(textToHtml(draft.body));
    if (draft.replyToThreadId && !message) {
      const thread = await queryClient.fetchQuery(trpc.mail.thread.queryOptions({ id: draft.replyToThreadId }));
      const account = catalog.accountById.get(thread.accountId);
      const mine = new Set([account?.email, ...(account?.aliases ?? [])].filter(Boolean));
      const last = [...thread.messages].reverse().find((m) => !mine.has(m.from.email)) ?? thread.messages.at(-1);
      if (last) {
        setReplyTo({ message: last as Message, subject: thread.subject });
        setAccountId(thread.accountId);
        if (!draft.subject) setSubject(`Re: ${thread.subject.replace(/^(re|fwd?|tr)\s*:\s*/i, '')}`);
      }
    }
    for (const file of draft.attachments) {
      try {
        const content = await readAttachment.mutateAsync({ id: file.id });
        setAttachments((prev) => (prev.some((a) => a.filename === content.filename && a.size === content.size) ? prev : [...prev, { ...content, fromAssistant: true }]));
      } catch (error) {
        toast.error(t('{file} : {error}', { file: file.name, error: (error as Error).message }));
      }
    }
    setAssistant(null);
    editor?.commands.focus('end');
  };

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const next = await Promise.all(
      [...files].map(
        (file) =>
          new Promise<Attachment>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ filename: file.name, contentType: file.type || 'application/octet-stream', base64: String(reader.result).split(',')[1] ?? '', size: file.size });
            reader.readAsDataURL(file);
          }),
      ),
    );
    setAttachments((prev) => [...prev, ...next]);
  };

  const field = 'flex min-h-9 items-center gap-2 border-b border-border px-4 text-[13px]';
  const input = 'placeholder:text-muted-foreground/70 min-w-0 flex-1 bg-transparent outline-none';

  return (
    <div className={cn('flex flex-col overflow-hidden rounded-xl bg-card text-card-foreground border border-border shadow-lg', className)}>
      <div className={field}>
        <span className="text-muted-foreground w-10 shrink-0">{t('De')}</span>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="h-7 w-auto gap-2 border-0 bg-transparent px-0 text-[13px] shadow-none focus:ring-0">
            <SelectValue placeholder={t('Choisir un compte')} />
          </SelectTrigger>
          <SelectContent>
            {catalog.accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ backgroundColor: a.color }} />
                  {a.name} &lt;{a.email}&gt;
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground ml-auto" title={t('Fermer')}>
          <X className="size-4" />
        </button>
      </div>
      {assistant ? (
        <ComposeAssistant
          autoListen={assistant.listen}
          context={{ accountId, threadId: thread?.id ?? null, draft: { to, cc, subject, body: editor?.getText() ?? '' } }}
          onDraft={applyDraft}
          onClose={() => setAssistant(null)}
        />
      ) : null}
      {replyTo ? (
        <div className="border-border bg-muted/50 text-muted-foreground flex items-center gap-2 border-b px-4 py-1.5 text-[12px]">
          <CornerUpLeft className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {t('En réponse à')} <span className="text-foreground font-medium">{displayName(replyTo.message.from)}</span> · {t('« {subject} »', { subject: replyTo.subject })}
          </span>
          <button type="button" onClick={() => setReplyTo(null)} className="hover:text-foreground" aria-label={t('Ne plus répondre à ce mail')}>
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}
      <div className={field}>
        <FieldLabel onFocus={() => toField.current?.focus()}>{t('À')}</FieldLabel>
        <RecipientInput ref={toField} value={to} onChange={setTo} label={t('Destinataires')} autoFocus={mode === 'new' || mode === 'forward' || mode === 'editAsNew'} />
        {!showCc ? (
          <button onClick={() => setShowCc(true)} className="text-muted-foreground hover:text-foreground text-xs">
            Cc
          </button>
        ) : null}
      </div>
      {showCc ? (
        <div className={field}>
          <FieldLabel onFocus={() => ccField.current?.focus()}>Cc</FieldLabel>
          <RecipientInput ref={ccField} value={cc} onChange={setCc} label={t('Copie à')} autoFocus={!initial.cc.length} />
        </div>
      ) : null}
      {mode === 'new' || mode === 'forward' || mode === 'editAsNew' ? (
        <div className={field}>
          <FieldLabel onFocus={() => subjectField.current?.focus()}>{t('Objet')}</FieldLabel>
          <input ref={subjectField} value={subject} onChange={(e) => setSubject(e.target.value)} aria-label={t('Objet')} className={cn(input, 'font-medium')} />
        </div>
      ) : null}

      <div className="max-h-[50vh] min-h-[160px] overflow-y-auto px-4 py-3">
        <EditorContent editor={editor} />
        {signature ? (
          <div className="zmail-signature-preview text-muted-foreground mt-3 text-[13px] leading-relaxed">
            <p>--</p>
            <div className="prose prose-sm dark:prose-invert text-muted-foreground max-w-none text-[13px] [&_p]:my-0" dangerouslySetInnerHTML={{ __html: signature.html }} />
          </div>
        ) : null}
      </div>

      {attachments.length ? (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {attachments.map((a, i) => (
            <span key={i} className={cn('flex h-6 items-center gap-1.5 rounded-md px-2 text-xs', a.fromAssistant ? 'bg-ai/10 ring-ai/25 ring-1' : 'bg-muted')} title={a.fromAssistant ? t('Trouvé sur votre Mac par l’assistant : vérifiez avant d’envoyer') : undefined}>
              {a.fromAssistant ? <SolarIcon name="_ai" className="text-ai size-3" /> : <Paperclip className="size-3" />}
              {a.filename}
              <span className="text-muted-foreground">{t('{n} Ko', { n: Math.ceil(a.size / 1024) })}</span>
              <button onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} aria-label={t('Retirer {name}', { name: a.filename })}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-1 border-t border-border px-2 py-2">
        <button
          onClick={() => void submit()}
          disabled={send.isPending}
          className="flex h-8 items-center gap-2 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
        >
          {send.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          {t('Envoyer')}
          <kbd className="font-sans text-[11px] opacity-70">{isMac ? '⌘' : 'Ctrl'}↵</kbd>
        </button>
        <button
          type="button"
          onClick={() => setAssistant((a) => (a ? null : { listen: true }))}
          className={cn('ml-1 flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors', assistant ? 'bg-ai text-ai-foreground' : 'bg-ai/10 text-ai hover:bg-ai/20')}
          title={t('Dicter à l’assistant : destinataires, réponse, pièces jointes')}
          aria-pressed={Boolean(assistant)}
        >
          <Mic className="size-3.5" />
          {t('Assistant')}
        </button>
        <div className="ml-1 flex items-center">
          {[
            { icon: Bold, run: () => editor?.chain().focus().toggleBold().run(), active: editor?.isActive('bold') },
            { icon: Italic, run: () => editor?.chain().focus().toggleItalic().run(), active: editor?.isActive('italic') },
            { icon: List, run: () => editor?.chain().focus().toggleBulletList().run(), active: editor?.isActive('bulletList') },
          ].map(({ icon: Icon, run, active }, i) => (
            <button key={i} onClick={run} className={cn('text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-md hover:bg-accent', active && 'text-foreground')}>
              <Icon className="size-3.5" />
            </button>
          ))}
          <button onClick={() => fileInput.current?.click()} className="text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-md hover:bg-accent" title={t('Joindre un fichier')}>
            <Paperclip className="size-3.5" />
          </button>
          <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => void addFiles(e.target.files)} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={cn('text-muted-foreground hover:text-foreground flex h-8 items-center gap-1.5 rounded-md px-2 text-[12.5px] hover:bg-accent', signature && 'text-foreground')} title={t('Signature')}>
                <PenLine className="size-3.5" />
                <span className="max-w-[120px] truncate">{signature ? signature.name : t('Signature')}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-60">
              <DropdownMenuLabel className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">{t('Signature')}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setSignatureId(null)}>
                <Check className={cn('size-3.5', signature ? 'opacity-0' : '')} />
                {t('Aucune signature')}
              </DropdownMenuItem>
              {signatures.items.map((s) => (
                <DropdownMenuItem key={s.id} onSelect={() => setSignatureId(s.id)}>
                  <Check className={cn('size-3.5', signature?.id === s.id ? '' : 'opacity-0')} />
                  <span className="truncate">{s.name}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => (onClose(), navigate(signatures.items.length ? '/settings/signatures' : '/settings/signatures?new=1'))}>
                <Settings2 className="size-3.5" />
                {signatures.items.length ? t('Gérer les signatures…') : t('Créer une signature…')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

/** A field's name (À, Cc, Objet): clicking it puts the cursor in the field, like Mail and Gmail. */
function FieldLabel({ children, onFocus }: { children: string; onFocus: () => void }) {
  return (
    <span onMouseDown={(e) => (e.preventDefault(), onFocus())} className="text-muted-foreground hover:text-foreground w-10 shrink-0 cursor-text select-none transition-colors">
      {children}
    </span>
  );
}
