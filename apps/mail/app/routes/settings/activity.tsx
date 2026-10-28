import { useQuery } from '@tanstack/react-query';
import { Archive, Eye, Inbox, MailOpen, Reply, ShieldBan, Star, Tag, Trash2, UserMinus, type LucideIcon } from 'lucide-react';
import { Card, SettingsPage } from '@/components/settings/ui';
import { useTRPC } from '@/lib/trpc';
import { formatListDate } from '@/lib/utils';
import { t } from '@/lib/i18n';

const ACTIONS: Record<string, { label: string; icon: LucideIcon }> = {
  open: { label: t('Ouvert'), icon: Eye },
  markRead: { label: t('Marqué comme lu'), icon: MailOpen },
  markUnread: { label: t('Marqué non lu'), icon: MailOpen },
  star: { label: t('Suivi'), icon: Star },
  unstar: { label: t('Plus suivi'), icon: Star },
  archive: { label: t('Archivé'), icon: Archive },
  trash: { label: t('Supprimé'), icon: Trash2 },
  spam: { label: t('Spam'), icon: ShieldBan },
  notSpam: { label: t('Pas un spam'), icon: Inbox },
  restore: { label: t('Restauré'), icon: Inbox },
  addTag: { label: t('Tag ajouté'), icon: Tag },
  removeTag: { label: t('Tag retiré'), icon: Tag },
  setBusiness: { label: t('Business changé'), icon: Tag },
  setPriority: { label: t('Priorité changée'), icon: Tag },
  unsubscribe: { label: t('Désinscription'), icon: UserMinus },
  reply: { label: t('Réponse'), icon: Reply },
};

export default function ActivitySettings() {
  const trpc = useTRPC();
  const { data: log } = useQuery(trpc.activity.list.queryOptions({ limit: 150 }));
  const { data: stats } = useQuery(trpc.activity.stats.queryOptions());
  return (
    <SettingsPage title={t('Journal d’activité')} description={t('Chaque action est enregistrée localement. C’est ce journal que l’agent analyse pour repérer vos habitudes et proposer des règles.')}>
      <div className="grid grid-cols-3 gap-2.5">
        {(stats ?? []).slice(0, 6).map((s) => {
          const meta = ACTIONS[s.action];
          return (
            <div key={s.action} className="bg-card border-border rounded-xl border p-3.5">
              <p className="text-[22px] font-semibold tabular-nums">{s.n}</p>
              <p className="text-muted-foreground text-[12px]">{t('{label} · 30 jours', { label: meta?.label ?? s.action })}</p>
            </div>
          );
        })}
      </div>
      <Card>
        {log?.length ? (
          <ul className="-my-1 divide-y divide-border">
            {log.map((entry) => {
              const meta = ACTIONS[entry.action] ?? { label: entry.action, icon: Tag };
              return (
                <li key={entry.id} className="flex items-center gap-3 py-2 text-[13px]">
                  <meta.icon className="text-muted-foreground size-3.5 shrink-0" />
                  <span className="w-32 shrink-0 font-medium">{meta.label}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-muted-foreground">{entry.from_email}</span> {entry.subject ? `— ${entry.subject}` : ''}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-[11.5px]">{formatListDate(entry.at)}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground py-6 text-center text-[13px]">{t('Aucune action enregistrée pour l’instant.')}</p>
        )}
      </Card>
    </SettingsPage>
  );
}
