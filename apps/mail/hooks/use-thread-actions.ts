import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { useTRPC, type Outputs, type ThreadItem } from '@/lib/trpc';
import { t } from '@/lib/i18n';

type ListPage = Outputs['mail']['list'];

export type ThreadAction = 'archive' | 'trash' | 'spam' | 'notSpam' | 'restore' | 'deleteForever' | 'read' | 'unread' | 'star' | 'unstar';

const LABELS: Record<ThreadAction, [string, string]> = {
  archive: [t('Archivé'), t('Archivés')],
  trash: [t('Mis à la corbeille'), t('Mis à la corbeille')],
  spam: [t('Classé en spam'), t('Classés en spam')],
  notSpam: [t('Remis dans la boîte de réception'), t('Remis dans la boîte de réception')],
  restore: [t('Restauré'), t('Restaurés')],
  deleteForever: [t('Supprimé définitivement'), t('Supprimés définitivement')],
  read: [t('Marqué comme lu'), t('Marqués comme lus')],
  unread: [t('Marqué comme non lu'), t('Marqués comme non lus')],
  star: [t('Suivi'), t('Suivis')],
  unstar: [t('Plus suivi'), t('Plus suivis')],
};

const REMOVES: ThreadAction[] = ['archive', 'trash', 'spam', 'notSpam', 'restore', 'deleteForever'];

/** Thread mutations with optimistic list updates and an undo toast where it makes sense. */
export function useThreadActions() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const listKey = trpc.mail.list.pathKey();

  const patchLists = useCallback(
    (ids: string[], update: (item: ThreadItem) => ThreadItem | null) => {
      const snapshot = queryClient.getQueriesData<InfiniteData<ListPage>>({ queryKey: listKey });
      queryClient.setQueriesData<InfiniteData<ListPage>>({ queryKey: listKey }, (data) =>
        data?.pages
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                items: page.items.flatMap((item) => (ids.includes(item.id) ? (update(item) ?? []) : [item])),
              })),
            }
          : data,
      );
      return () => snapshot.forEach(([key, value]) => queryClient.setQueryData(key, value));
    },
    [queryClient, listKey],
  );

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: listKey });
    void queryClient.invalidateQueries({ queryKey: trpc.mail.counts.queryKey() });
    void queryClient.invalidateQueries({ queryKey: trpc.mail.thread.pathKey() });
  }, [queryClient, listKey, trpc]);

  const client = {
    archive: useMutation(trpc.mail.archive.mutationOptions()),
    trash: useMutation(trpc.mail.trash.mutationOptions()),
    spam: useMutation(trpc.mail.spam.mutationOptions()),
    notSpam: useMutation(trpc.mail.notSpam.mutationOptions()),
    restore: useMutation(trpc.mail.restore.mutationOptions()),
    deleteForever: useMutation(trpc.mail.deleteForever.mutationOptions()),
    markRead: useMutation(trpc.mail.markRead.mutationOptions()),
    star: useMutation(trpc.mail.star.mutationOptions()),
  };

  const run = useCallback(
    async (action: ThreadAction, threadIds: string[], options: { silent?: boolean } = {}) => {
      if (threadIds.length === 0) return;
      const rollback = REMOVES.includes(action)
        ? patchLists(threadIds, () => null)
        : patchLists(threadIds, (item) => ({
            ...item,
            unread: action === 'unread' ? true : action === 'read' ? false : item.unread,
            starred: action === 'star' ? true : action === 'unstar' ? false : item.starred,
          }));
      try {
        const input = { threadIds };
        if (action === 'read' || action === 'unread') await client.markRead.mutateAsync({ ...input, read: action === 'read' });
        else if (action === 'star' || action === 'unstar') await client.star.mutateAsync({ ...input, on: action === 'star' });
        else await client[action].mutateAsync(input);
        if (!options.silent) {
          const label = LABELS[action][threadIds.length > 1 ? 1 : 0];
          const undo = action === 'archive' || action === 'trash' || action === 'spam' ? () => void run('restore', threadIds, { silent: true }).then(() => toast(t('Action annulée'))) : undefined;
          toast(threadIds.length > 1 ? t('{n} conversations — {action}', { n: threadIds.length, action: label.toLowerCase() }) : label, undo ? { action: { label: t('Annuler|undo'), onClick: undo } } : undefined);
        }
      } catch (error) {
        rollback();
        toast.error(t('Action impossible : {error}', { error: (error as Error).message }));
      } finally {
        refresh();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patchLists, refresh],
  );

  return { run, refresh, patchLists };
}
