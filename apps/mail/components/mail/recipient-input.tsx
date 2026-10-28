import { X } from 'lucide-react';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]{2,}$/;
export const isEmail = (value: string) => EMAIL.test(value);

/** "Name <a@b.c>" or "a@b.c" → address; anything else is kept as typed (shown as invalid). */
const normalize = (raw: string) => {
  const value = raw.trim().replace(/^mailto:/i, '');
  return value.match(/<([^>]+)>\s*$/)?.[1]?.trim() ?? value;
};
const split = (text: string) => text.split(/[,;\s]+/).map(normalize).filter(Boolean);

export type RecipientInputHandle = {
  /** Commits whatever is still being typed and returns the full list. */
  flush: () => string[];
  focus: () => void;
};

/**
 * Recipients as chips, like Gmail: a complete address followed by space, comma, ; or Enter
 * becomes a chip. Clicking a chip turns it back into text to edit it; leaving the field turns
 * it into a chip again. Each chip has a × to remove it.
 */
export const RecipientInput = forwardRef<RecipientInputHandle, { value: string[]; onChange: (value: string[]) => void; placeholder?: string; autoFocus?: boolean; label: string }>(
  function RecipientInput({ value, onChange, placeholder, autoFocus, label }, ref) {
    const [draft, setDraft] = useState('');
    const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
    const input = useRef<HTMLInputElement>(null);
    // Latest values for flush(), which can run before React re-renders.
    const latest = useRef({ value, draft, editing });
    latest.current = { value, draft, editing };

    const withEdit = (list: string[], edit: { index: number; text: string } | null) => {
      if (!edit) return list;
      const replacement = split(edit.text);
      return [...list.slice(0, edit.index), ...replacement, ...list.slice(edit.index + 1)];
    };
    const unique = (list: string[]) => list.filter((v, i) => list.findIndex((w) => w.toLowerCase() === v.toLowerCase()) === i);

    const flush = () => {
      const { value: list, draft: text, editing: edit } = latest.current;
      const next = unique([...withEdit(list, edit), ...split(text)]);
      if (edit || text.trim()) {
        setEditing(null);
        setDraft('');
        onChange(next);
      }
      return next;
    };
    useImperativeHandle(ref, () => ({ flush, focus: () => input.current?.focus() }));

    const commitDraft = (text: string) => {
      const parts = split(text);
      if (parts.length) onChange(unique([...value, ...parts]));
      setDraft('');
    };

    const finishEdit = () => {
      if (!editing) return;
      onChange(unique(withEdit(value, editing)));
      setEditing(null);
    };

    const remove = (index: number) => onChange(value.filter((_, i) => i !== index));

    return (
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-1" onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), input.current?.focus())}>
        {value.map((email, index) =>
          editing?.index === index ? (
            <input
              key={`edit-${index}`}
              autoFocus
              value={editing.text}
              size={Math.max(editing.text.length + 1, 4)}
              onChange={(e) => setEditing({ index, text: e.target.value })}
              onBlur={finishEdit}
              onKeyDown={(e) => {
                if ([' ', ',', ';', 'Enter', 'Tab'].includes(e.key) && !e.metaKey && !e.ctrlKey) {
                  if (e.key !== 'Tab') e.preventDefault();
                  finishEdit();
                  if (e.key !== 'Tab') input.current?.focus();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditing(null);
                  input.current?.focus();
                }
              }}
              className="h-6 rounded-md bg-transparent px-1.5 text-[13px] ring-1 ring-ring/50 outline-none"
              aria-label={t('Modifier {email}', { email })}
            />
          ) : (
            <span
              key={`${email}-${index}`}
              onClick={() => setEditing({ index, text: email })}
              title={isEmail(email) ? t('Cliquer pour modifier') : t('Adresse invalide — cliquer pour corriger')}
              className={cn(
                'group flex h-6 max-w-full cursor-text items-center gap-1 rounded-md pr-1 pl-2 text-[13px] transition-colors',
                isEmail(email) ? 'bg-muted hover:bg-accent' : 'bg-destructive/10 text-destructive ring-1 ring-destructive/30',
              )}
            >
              <span className="truncate">{email}</span>
              <button
                type="button"
                onClick={(e) => (e.stopPropagation(), remove(index))}
                onMouseDown={(e) => e.preventDefault()}
                className="text-muted-foreground hover:text-foreground flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-accent"
                aria-label={t('Retirer {name}', { name: email })}
              >
                <X className="size-3" />
              </button>
            </span>
          ),
        )}
        <input
          ref={input}
          value={draft}
          autoFocus={autoFocus}
          aria-label={label}
          placeholder={value.length ? undefined : placeholder}
          onChange={(e) => {
            const text = e.target.value;
            // A pasted list, or a separator typed after a complete address, makes chips.
            // An incomplete address stays as text: the separator is simply ignored.
            if (/[,;\s]/.test(text)) {
              const parts = text.split(/[,;\s]+/);
              const typing = /[,;\s]$/.test(text) ? '' : (parts.pop() ?? '');
              const complete = parts.map(normalize).filter(isEmail);
              const incomplete = parts.map(normalize).filter((p) => p && !isEmail(p));
              if (complete.length) onChange(unique([...value, ...complete]));
              setDraft([...incomplete, typing].filter(Boolean).join(''));
            } else setDraft(text);
          }}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === 'Tab') && draft.trim() && !e.metaKey && !e.ctrlKey) {
              if (e.key === 'Enter') e.preventDefault();
              commitDraft(draft);
            } else if (e.key === 'Backspace' && !draft && value.length) {
              e.preventDefault();
              remove(value.length - 1);
            }
          }}
          onBlur={() => draft.trim() && commitDraft(draft)}
          className="placeholder:text-muted-foreground/70 h-6 min-w-[120px] flex-1 bg-transparent text-[13px] outline-none"
        />
      </div>
    );
  },
);
