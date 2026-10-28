import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PenLine, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { BrandLogo, brandForProvider } from '@/components/brand-logo';
import { SignatureEditor, useSignatures, type Signature } from '@/components/mail/signatures';
import { Card, GhostButton, PrimaryButton, SettingsPage } from '@/components/settings/ui';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCatalog } from '@/hooks/use-catalog';
import { useTRPC } from '@/lib/trpc';
import { t } from '@/lib/i18n';

type Draft = { id?: string; name: string; html: string };
const NONE = 'none';

export default function SignatureSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const signatures = useSignatures();
  const [draft, setDraft] = useState<Draft | null>(null);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: trpc.signatures.list.queryKey() });
  const save = useMutation(trpc.signatures.save.mutationOptions({ onSuccess: () => (invalidate(), setDraft(null), toast.success(t('Signature enregistrée'))) }));
  const remove = useMutation(trpc.signatures.remove.mutationOptions({ onSuccess: invalidate }));
  const setDefaults = useMutation(trpc.signatures.setDefaults.mutationOptions({ onSuccess: invalidate }));

  // `?new=1` (composer shortcut, settings search) opens a blank signature right away.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('new') !== '1') return;
    setDraft({ name: '', html: '' });
    setParams({}, { replace: true });
  }, [params, setParams]);

  const editor = (value: Draft) => (
    <div className="space-y-3">
      <Input value={value.name} onChange={(e) => setDraft({ ...value, name: e.target.value })} placeholder={t('Nom de la signature (ex. Pro, Perso, Courte)')} className="h-9 text-[13.5px]" autoFocus={!value.id} />
      <SignatureEditor html={value.html} onChange={(html) => setDraft((d) => (d ? { ...d, html } : d))} autoFocus={Boolean(value.id)} />
      <div className="flex justify-end gap-2">
        <GhostButton onClick={() => setDraft(null)}>{t('Annuler')}</GhostButton>
        <PrimaryButton disabled={!value.html || save.isPending} onClick={() => save.mutate({ id: value.id, name: value.name, html: value.html })}>
          {t('Enregistrer')}
        </PrimaryButton>
      </div>
    </div>
  );

  const row = (signature: Signature) =>
    draft?.id === signature.id ? (
      <li key={signature.id} className="py-3">
        {editor(draft)}
      </li>
    ) : (
      <li key={signature.id} className="flex items-start gap-3 py-3">
        <PenLine className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium">{signature.name}</p>
          <div className="prose prose-sm dark:prose-invert text-muted-foreground mt-1 max-w-none text-[12.5px] leading-snug [&_p]:my-0" dangerouslySetInnerHTML={{ __html: signature.html }} />
        </div>
        <div className="flex gap-1">
          <GhostButton onClick={() => setDraft({ id: signature.id, name: signature.name, html: signature.html })}>{t('Modifier')}</GhostButton>
          <GhostButton className="hover:text-destructive" onClick={() => window.confirm(t('Supprimer la signature « {name} » ?', { name: signature.name })) && remove.mutate({ id: signature.id })} aria-label={t('Supprimer')}>
            <Trash2 className="size-3.5" />
          </GhostButton>
        </div>
      </li>
    );

  const picker = (accountId: string, kind: 'newMail' | 'reply') => {
    const current = signatures.defaults[accountId] ?? { newMail: null, reply: null };
    return (
      <Select value={current[kind] ?? NONE} onValueChange={(value) => setDefaults.mutate({ accountId, ...current, [kind]: value === NONE ? null : value })}>
        <SelectTrigger className="h-8 w-full text-[13px]" aria-label={kind === 'newMail' ? t('Signature des nouveaux mails') : t('Signature des réponses')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('Aucune signature')}</SelectItem>
          {signatures.items.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  };

  return (
    <SettingsPage
      title={t('Signatures')}
      description={t('Ajoutée automatiquement en bas de vos mails, au-dessus du message cité. Changez-la au moment d’écrire grâce au bouton signature, à côté d’« Envoyer ».')}
      actions={
        <PrimaryButton onClick={() => setDraft({ name: '', html: '' })}>
          <Plus className="size-4" />
          {t('Nouvelle signature')}
        </PrimaryButton>
      }
    >
      <Card title={t('Mes signatures')} description={t('Créez-en autant que nécessaire : professionnelle, personnelle, courte pour les réponses…')}>
        {draft && !draft.id ? <div className="border-border mb-3 border-b pb-4">{editor(draft)}</div> : null}
        {signatures.items.length ? (
          <ul className="-my-1 divide-y divide-border">{signatures.items.map(row)}</ul>
        ) : draft ? null : (
          <p className="text-muted-foreground text-[13px]">{t('Aucune signature pour l’instant. La première créée sera utilisée par défaut sur tous vos comptes.')}</p>
        )}
      </Card>

      <Card title={t('Signature par défaut')} description={t('Pour chaque compte d’envoi, comme dans Gmail : une signature pour les nouveaux mails, une pour les réponses et transferts.')}>
        {catalog.accounts.length ? (
          <>
            <div className="text-muted-foreground grid grid-cols-[1fr_180px_180px] gap-3 pb-1 text-[11px] font-medium tracking-wide uppercase">
              <span>{t('Compte')}</span>
              <span>{t('Nouveaux mails')}</span>
              <span>{t('Réponses et transferts')}</span>
            </div>
            <div className="divide-y divide-border">
              {catalog.accounts.map((a) => (
                <div key={a.id} className="grid grid-cols-[1fr_180px_180px] items-center gap-3 py-2">
                  <span className="flex min-w-0 items-center gap-2 text-[13px]">
                    <BrandLogo brand={brandForProvider(a.provider)} tile size={20} fallback={a.email} />
                    <span className="truncate">{a.email}</span>
                  </span>
                  {picker(a.id, 'newMail')}
                  {picker(a.id, 'reply')}
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-[13px]">{t('Connectez une boîte mail pour choisir ses signatures.')}</p>
        )}
      </Card>
    </SettingsPage>
  );
}
