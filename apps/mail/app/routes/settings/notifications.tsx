import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Card, GhostButton, Row, SettingsPage } from '@/components/settings/ui';
import { useCatalog } from '@/hooks/use-catalog';
import { useTRPC, type Inputs } from '@/lib/trpc';
import { formatListDate } from '@/lib/utils';
import { t, tp } from '@/lib/i18n';
import { BrandLogo, brandForProvider } from '@/components/brand-logo';

type Settings = Inputs['notifications']['saveSettings'];

export default function NotificationSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const { data: settings } = useQuery(trpc.notifications.settings.queryOptions());
  const { data: history } = useQuery(trpc.notifications.list.queryOptions());
  const { data: rules } = useQuery(trpc.rules.list.queryOptions());
  const save = useMutation(trpc.notifications.saveSettings.mutationOptions({ onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.notifications.settings.queryKey() }) }));
  const test = useMutation(trpc.notifications.test.mutationOptions({ onSuccess: (r) => toast(r.delivered === 'native' ? t('Notification envoyée au Centre de notifications') : r.delivered === 'osascript' ? t('Notification envoyée (mode navigateur)') : t('Notification non délivrée — vérifiez les autorisations')) }));
  if (!settings) return null;
  const set = (patch: Partial<Settings>) => save.mutate({ ...settings, ...patch });
  const notifyRules = rules?.filter((r) => r.actions.some((a) => a.type === 'notify')) ?? [];

  return (
    <SettingsPage title={t('Notifications')} description={t('ZMail ne vous dérange que pour l’essentiel. Tout le reste est trié en silence.')} actions={<GhostButton onClick={() => test.mutate({ kind: 'otp' })}><BellRing className="size-3.5" />{t('Tester')}</GhostButton>}>
      <Card>
        <Row label={t('Notifications macOS')} description={t('Interrupteur général.')}>
          <Switch checked={settings.enabled} onCheckedChange={(enabled) => set({ enabled })} />
        </Row>
      </Card>
      <BadgeCard />
      <Card title={t('Me notifier pour')}>
        <div className="-my-1 divide-y divide-border">
          <Row label={t('Codes OTP')} description={t('Le code apparaît dans la notification avec un bouton « Copier le code ».')}>
            <Switch checked={settings.otp} onCheckedChange={(otp) => set({ otp })} disabled={!settings.enabled} />
          </Row>
          <Row label={t('Mails urgents')} description={t('Litiges, chargebacks, paiements échoués, clients mécontents…')}>
            <Switch checked={settings.urgent} onCheckedChange={(urgent) => set({ urgent })} disabled={!settings.enabled} />
          </Row>
          <Row label={t('Opportunités business')} description={t('Demandes de devis, partenariats, leads entrants.')}>
            <Switch checked={settings.opportunity} onCheckedChange={(opportunity) => set({ opportunity })} disabled={!settings.enabled} />
          </Row>
          <Row label={t('Priorité haute')} description={t('Personnes qui attendent une réponse, échéances proches.')}>
            <Switch checked={settings.high} onCheckedChange={(high) => set({ high })} disabled={!settings.enabled} />
          </Row>
          <Row label={t('Règles personnalisées')} description={notifyRules.length ? notifyRules.map((r) => r.name).join(' · ') : t('Ex. demandez à l’agent : « notifie-moi des chargebacks ».')}>
            <Switch checked={settings.rules} onCheckedChange={(rules) => set({ rules })} disabled={!settings.enabled} />
          </Row>
          <Row label={t('Échecs de désinscription')} description={t('Quand l’agent n’arrive pas à vous désinscrire d’une liste.')}>
            <Switch checked={settings.unsubscribeFailed} onCheckedChange={(unsubscribeFailed) => set({ unsubscribeFailed })} disabled={!settings.enabled} />
          </Row>
        </div>
      </Card>
      {catalog.businesses.length ? (
        <Card title={t('Par business')} description={t('Coupez les notifications d’une activité (les codes OTP restent notifiés).')}>
          <div className="-my-1 divide-y divide-border">
            {catalog.businesses.map((b) => (
              <Row key={b.id} label={`${b.emoji ?? ''} ${b.name}`.trim()}>
                <Switch
                  checked={!settings.mutedBusinesses.includes(b.id)}
                  onCheckedChange={(on) => set({ mutedBusinesses: on ? settings.mutedBusinesses.filter((id) => id !== b.id) : [...settings.mutedBusinesses, b.id] })}
                />
              </Row>
            ))}
          </div>
        </Card>
      ) : null}
      <Card title={t('Historique')}>
        {history?.length ? (
          <ul className="-my-1 divide-y divide-border">
            {history.slice(0, 20).map((n) => (
              <li key={n.id} className="flex items-center gap-3 py-2 text-[13px]">
                <span className="text-muted-foreground w-24 shrink-0 text-[11.5px]">{formatListDate(n.at)}</span>
                <span className="min-w-0 flex-1 truncate">
                  <b className="font-medium">{n.title}</b> <span className="text-muted-foreground">— {n.body}</span>
                </span>
                <span className="text-muted-foreground text-[11px]">{n.delivered === 'native' ? 'macOS' : n.delivered}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-[13px]">{t('Aucune notification envoyée.')}</p>
        )}
      </Card>
    </SettingsPage>
  );
}

type BadgeSettings = { enabled?: boolean; excludedAccounts?: string[] };

/** The number on ZMail's Dock icon: unread conversations, from the accounts you choose (99+ max). */
function BadgeCard() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const { data: ui } = useQuery(trpc.settings.get.queryOptions());
  const { data: counts } = useQuery(trpc.mail.counts.queryOptions());
  const key = trpc.settings.get.queryKey();
  const save = useMutation(
    trpc.settings.save.mutationOptions({
      onMutate: (patch) => queryClient.setQueryData(key, (prev: Record<string, unknown> | undefined) => ({ ...prev, ...patch })),
    }),
  );
  const badge = (ui?.badge ?? {}) as BadgeSettings;
  const enabled = badge.enabled !== false;
  const excluded = new Set(badge.excludedAccounts ?? []);
  const update = (patch: BadgeSettings) => save.mutate({ badge: { enabled, excludedAccounts: [...excluded], ...patch } });
  const total = catalog.accounts.reduce((sum, a) => (excluded.has(a.id) ? sum : sum + (counts?.accounts[a.id] ?? 0)), 0);

  return (
    <Card id="pastille-du-dock" title={t('Pastille de l’icône ZMail')} description={t('Le nombre rouge sur l’icône du Dock : vos conversations non lues, plafonné à « 99+ ».')}>
      <Row label={t('Afficher la pastille')} description={enabled ? tp(total, 'En ce moment : {count} non lu.', 'En ce moment : {count} non lus.', { count: total > 99 ? '99+' : total }) : t('Aucun nombre sur l’icône du Dock.')}>
        <Switch checked={enabled} onCheckedChange={(value) => update({ enabled: value })} />
      </Row>
      {catalog.accounts.length > 1 ? (
        <div className="mt-2 border-t border-border pt-3">
          <p className="text-muted-foreground mb-1 text-[12.5px]">{t('Boîtes comptées dans la pastille')}</p>
          <div>
            {catalog.accounts.map((a) => (
              <Row key={a.id} label={a.email} description={tp(counts?.accounts[a.id] ?? 0, '{n} non lu', '{n} non lus')}>
                <span className="flex items-center gap-3">
                  <BrandLogo brand={brandForProvider(a.provider)} size={16} fallback={a.email} />
                  <Switch
                    checked={!excluded.has(a.id)}
                    disabled={!enabled}
                    aria-label={t('Compter {email} dans la pastille', { email: a.email })}
                    onCheckedChange={(value) => update({ excludedAccounts: value ? [...excluded].filter((id) => id !== a.id) : [...excluded, a.id] })}
                  />
                </span>
              </Row>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
