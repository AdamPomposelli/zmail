import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Card, GhostButton, Row, SettingsPage } from '@/components/settings/ui';
import { Switch } from '@/components/ui/switch';
import { nativeBridge } from '@/lib/native';
import { t } from '@/lib/i18n';
import { isMac } from '@/lib/utils';

type LockStatus = { available: boolean; enabled: boolean; biometry: 'touchID' | 'faceID' | 'opticID' | 'none' };

const LOCK_KEY = ['native', 'lock'];

/** Security: the optional Touch ID lock, handled by the macOS app itself (see AppLock.swift). */
export default function SecuritySettings() {
  const queryClient = useQueryClient();
  const { data: lock, isPending } = useQuery({ queryKey: LOCK_KEY, queryFn: () => nativeBridge<LockStatus>('/lock') });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => nativeBridge<{ ok: boolean; enabled: boolean }>('/lock', { enabled }),
    onSuccess: (result, enabled) => {
      queryClient.setQueryData(LOCK_KEY, (prev: LockStatus | null | undefined) => (prev ? { ...prev, enabled: result?.enabled ?? prev.enabled } : prev));
      if (result?.ok) toast.success(enabled ? t('Touch ID est demandé à chaque ouverture de ZMail.') : t('ZMail s’ouvre sans Touch ID.'));
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const lockNow = useMutation({ mutationFn: () => nativeBridge('/lock/now', {}) });

  const sensor = lock?.biometry === 'touchID' ? 'Touch ID' : lock?.biometry === 'faceID' ? 'Face ID' : t('le mot de passe du Mac');

  return (
    <SettingsPage title={t('Sécurité')} description={t('Vos mots de passe de messagerie et clés d’API sont chiffrés sur ce Mac. Ici, vous choisissez ce qu’il faut pour ouvrir ZMail.')}>
      <Card title={t('Déverrouillage')}>
        <div className="px-5 py-2">
          {lock === null ? (
            <p className="text-muted-foreground py-2.5 text-[13px]">{t('Disponible dans l’app ZMail pour Mac.')}</p>
          ) : (
            <Row
              label={t('Déverrouiller avec Touch ID')}
              description={
                lock && !lock.available
                  ? t('Ce Mac n’a pas de puce de sécurité (Secure Enclave) : le verrouillage n’est pas disponible.')
                  : t('À chaque ouverture, {sensor} au lieu d’un mot de passe. Tant que ZMail est verrouillé, vos mails et vos clés restent chiffrés. Il se reverrouille après 10 min hors de vue.', { sensor })
              }
            >
              <span className="flex items-center gap-2">
                <Fingerprint className="text-muted-foreground size-4" aria-hidden />
                <Switch
                  checked={Boolean(lock?.enabled)}
                  disabled={isPending || toggle.isPending || !lock?.available}
                  onCheckedChange={(enabled) => toggle.mutate(enabled)}
                  aria-label={t('Déverrouiller avec Touch ID')}
                />
              </span>
            </Row>
          )}
          {lock?.enabled ? (
            <Row label={t('Verrouiller maintenant')} description={t('Raccourci : {keys}', { keys: isMac ? '⇧⌘L' : 'Ctrl+Shift+L' })}>
              <GhostButton onClick={() => lockNow.mutate()}>
                <Lock className="size-3.5" /> {t('Verrouiller')}
              </GhostButton>
            </Row>
          ) : null}
        </div>
      </Card>
      <p className="text-muted-foreground mt-4 px-1 text-[12px] leading-relaxed">
        {t('Activé ou non, ZMail ne demande plus le mot de passe du Trousseau : la clé qui protège vos secrets est gardée par la puce de sécurité du Mac. L’activer comme le désactiver demande {sensor}.', { sensor })}
      </p>
    </SettingsPage>
  );
}
