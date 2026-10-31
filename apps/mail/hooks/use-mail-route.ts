import { useCallback, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { View } from '@/lib/trpc';
import { t } from '@/lib/i18n';

export const VIEWS: View[] = ['inbox', 'priority', 'opportunities', 'otp', 'newsletters', 'unread', 'starred', 'sent', 'drafts', 'archive', 'spam', 'trash', 'folder'];

export const VIEW_TITLES: Record<View, string> = {
  inbox: t('Boîte de réception'),
  priority: t('Prioritaires'),
  opportunities: t('Opportunités'),
  otp: t('Codes OTP'),
  newsletters: t('Newsletters'),
  unread: t('Non lus'),
  starred: t('Suivis'),
  sent: t('Envoyés'),
  drafts: t('Brouillons'),
  archive: t('Archives'),
  spam: t('Spam'),
  trash: t('Corbeille'),
  folder: t('Dossier'),
};

/** The mail screen's state lives in the URL: /mail/:view?business=&tag=&account=&mailbox=&q=&thread=&msg= */
export function useMailRoute() {
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const view = (VIEWS.includes(params.view as View) ? params.view : 'inbox') as View;

  const state = useMemo(
    () => ({
      view,
      businessId: search.get('business'),
      tagId: search.get('tag'),
      accountId: search.get('account'),
      mailboxId: search.get('mailbox'),
      query: search.get('q') ?? '',
      threadId: search.get('thread'),
      /** One message of the open conversation to bring into view (picked in its reply tree). */
      messageId: search.get('msg'),
      /** Opens the conversation with the composer ready (reply, forward… from the list's menu). */
      compose: search.get('compose'),
      sort: (search.get('sort') === 'date' ? 'date' : 'smart') as 'smart' | 'date',
    }),
    [view, search],
  );

  const update = useCallback(
    (patch: Partial<Record<'business' | 'tag' | 'account' | 'mailbox' | 'q' | 'thread' | 'msg' | 'compose' | 'sort', string | null>>, replace = false) => {
      setSearch(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === '' || value === undefined) next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace },
      );
    },
    [setSearch],
  );

  return { ...state, update };
}
