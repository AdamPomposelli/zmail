import {
  CodeBlock,
  CopyField,
  SecretDialog,
  formatDate,
  formatLastUsed,
} from '@/components/settings/developer';
import { Card, GhostButton, PrimaryButton, Row, SettingsPage } from '@/components/settings/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { openExternal } from '@/lib/native';
import { useTRPC } from '@/lib/trpc';
import { t } from '@/lib/i18n';
import { useState } from 'react';
import { toast } from 'sonner';

const SCOPE_LABELS = {
  read: { name: t('Lecture'), hint: t('Comptes, catégories, conversations, recherche') },
  write: {
    name: t('Écriture'),
    hint: t('Envoyer, archiver, marquer lu, étoiler, corbeille, catégories, spam'),
  },
} as const;

export default function ApiSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const info = useQuery(trpc.developer.info.queryOptions());
  const keys = useQuery(trpc.developer.list.queryOptions());
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: trpc.developer.list.queryKey() });

  const [draft, setDraft] = useState<{ name: string; write: boolean } | null>(null);
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const create = useMutation(
    trpc.developer.create.mutationOptions({
      onSuccess: (result) => (
        invalidate(), setDraft(null), setCreated({ name: result.apiKey.name, key: result.key })
      ),
      onError: (error) => toast.error(error.message),
    }),
  );
  const revoke = useMutation(
    trpc.developer.revoke.mutationOptions({
      onSuccess: () => (invalidate(), toast.success(t('Clé révoquée'))),
    }),
  );

  const baseUrl = info.data?.baseUrl ?? 'http://127.0.0.1:47812/api/v1';
  const curl = [
    `export ZMAIL_API_KEY="zm_live_…"`,
    ``,
    `# ${t('5 dernières conversations non lues')}`,
    `curl -s "${baseUrl}/threads?view=inbox&unread=true&limit=5" \\`,
    `  -H "Authorization: Bearer $ZMAIL_API_KEY"`,
    ``,
    `# ${t('Archiver une conversation (clé avec le droit d’écriture)')}`,
    `curl -s -X POST "${baseUrl}/threads/actions" \\`,
    `  -H "Authorization: Bearer $ZMAIL_API_KEY" -H "Content-Type: application/json" \\`,
    `  -d '{"threadIds":["t_…"],"action":"archive"}'`,
  ].join('\n');

  return (
    <SettingsPage
      title="API"
      description={t('Accédez à vos mails depuis vos scripts et outils, en local : l’API REST du moteur ZMail n’écoute que sur cette machine (127.0.0.1).')}
    >
      <Card
        title={t('Adresse de l’API')}
        description={t('Le port peut changer si 47812 est déjà pris : cette page affiche toujours le bon.')}
      >
        <div className="space-y-3">
          <Row label={t('URL de base')}>
            <CopyField value={baseUrl} className="w-[360px]" />
          </Row>
          <Row
            label={t('Documentation OpenAPI')}
            description={t('Description complète des endpoints (OpenAPI 3.1).')}
          >
            <GhostButton
              onClick={() => info.data && openExternal(info.data.openapiUrl)}
              disabled={!info.data}
            >
              openapi.json <ExternalLink />
            </GhostButton>
          </Row>
        </div>
      </Card>

      <Card
        title={t('Clés API')}
        description={t('Chaque outil a sa clé : vous pouvez la révoquer sans toucher aux autres. Seule une empreinte (SHA-256) est conservée.')}
        action={
          draft ? null : (
            <PrimaryButton onClick={() => setDraft({ name: '', write: false })}>
              <Plus className="size-3.5" /> {t('Nouvelle clé')}
            </PrimaryButton>
          )
        }
      >
        {draft ? (
          <form
            className="border-border mb-4 space-y-3 rounded-lg border p-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate({
                name: draft.name,
                scopes: draft.write ? ['read', 'write'] : ['read'],
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="api-key-name">{t('Nom')}</Label>
              <Input
                id="api-key-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={t('ex. Script de facturation, Raycast, n8n')}
                autoFocus
                className="h-9 text-[13.5px]"
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="mb-1.5 text-[13px] font-medium">{t('Droits')}</legend>
              <label className="flex items-start gap-2.5 text-[13px]">
                <Checkbox checked disabled className="mt-0.5" />
                <span>
                  {SCOPE_LABELS.read.name}{' '}
                  <span className="text-muted-foreground">— {SCOPE_LABELS.read.hint}</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
                <Checkbox
                  checked={draft.write}
                  onCheckedChange={(v) => setDraft({ ...draft, write: v === true })}
                  className="mt-0.5"
                />
                <span>
                  {SCOPE_LABELS.write.name}{' '}
                  <span className="text-muted-foreground">— {SCOPE_LABELS.write.hint}</span>
                </span>
              </label>
            </fieldset>
            <div className="flex justify-end gap-2">
              <GhostButton onClick={() => setDraft(null)}>{t('Annuler')}</GhostButton>
              <PrimaryButton type="submit" disabled={!draft.name.trim() || create.isPending}>
                {create.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {t('Créer la clé')}
              </PrimaryButton>
            </div>
          </form>
        ) : null}

        {keys.data?.length ? (
          <ul className="divide-border -my-2 divide-y">
            {keys.data.map((key) => (
              <li key={key.id} className="flex items-center gap-3 py-3">
                <KeyRound className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">{key.name}</p>
                  <p className="text-muted-foreground text-[12px]">
                    <code className="font-mono">{key.prefix}…</code> ·{' '}
                    {t('créée le {date}', { date: formatDate(key.createdAt) })} · {formatLastUsed(key.lastUsedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {key.scopes.map((scope) => (
                    <span
                      key={scope}
                      className={
                        scope === 'write'
                          ? 'bg-warning/10 text-warning rounded-sm px-1.5 py-0.5 text-[11px]'
                          : 'bg-muted text-muted-foreground rounded-sm px-1.5 py-0.5 text-[11px]'
                      }
                    >
                      {SCOPE_LABELS[scope].name}
                    </span>
                  ))}
                </div>
                <GhostButton
                  className="hover:text-destructive"
                  aria-label={t('Révoquer {name}', { name: key.name })}
                  onClick={() =>
                    window.confirm(
                      t('Révoquer la clé « {name} » ? Les outils qui l’utilisent perdront l’accès immédiatement.', { name: key.name }),
                    ) && revoke.mutate({ id: key.id })
                  }
                >
                  <Trash2 /> {t('Révoquer')}
                </GhostButton>
              </li>
            ))}
          </ul>
        ) : draft ? null : (
          <p className="text-muted-foreground text-[13px]">{t('Aucune clé pour l’instant.')}</p>
        )}
      </Card>

      <Card
        title={t('Exemple')}
        description={t('Toutes les réponses sont en JSON ; une clé absente ou révoquée renvoie 401.')}
      >
        <CodeBlock code={curl} label="Terminal" />
      </Card>

      <SecretDialog
        open={Boolean(created)}
        onClose={() => setCreated(null)}
        title={t('Clé « {name} » créée', { name: created?.name ?? '' })}
        description={t('Utilisez-la dans l’en-tête Authorization: Bearer <clé>.')}
        secret={created?.key ?? ''}
      />
    </SettingsPage>
  );
}
