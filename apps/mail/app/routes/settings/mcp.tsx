import {
  CheckCircle2,
  Code2,
  Globe,
  Loader2,
  MousePointer2,
  TriangleAlert,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import { Card, GhostButton, PrimaryButton, Row, SettingsPage } from '@/components/settings/ui';
import { CodeBlock, CopyField, SecretDialog } from '@/components/settings/developer';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BrandLogo } from '@/components/brand-logo';
import { useTRPC, type Outputs } from '@/lib/trpc';
import { Switch } from '@/components/ui/switch';
import type { Brand } from '@/lib/brand-logos';
import { useState } from 'react';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';

type Client = Outputs['developer']['clients'][number];
type ClientId = Client['id'];

/** Presentation of each client; what the engine does for it comes from `developer.clients`. */
const META: Record<ClientId, { brand?: Brand; icon?: LucideIcon; blurb: string; paste?: string }> =
  {
    'claude-desktop': {
      brand: 'anthropic',
      blurb:
        t('Ajoute ZMail à claude_desktop_config.json (pont local stdio). Redémarrez Claude Desktop ensuite.'),
    },
    cursor: {
      icon: MousePointer2,
      blurb:
        t('Ajoute ZMail à ~/.cursor/mcp.json (HTTP local). Réinstallez si le port de ZMail change.'),
    },
    windsurf: {
      icon: Wind,
      blurb:
        t('Ajoute ZMail à ~/.codeium/windsurf/mcp_config.json (HTTP local). Réinstallez si le port de ZMail change.'),
    },
    'claude-code': {
      brand: 'anthropic',
      blurb: t('Une commande à lancer dans votre terminal.'),
      paste: t('Collez cette commande dans un terminal.'),
    },
    vscode: {
      icon: Code2,
      blurb: t('Configuration à coller dans mcp.json (utilisateur ou .vscode/mcp.json du projet).'),
      paste: t('Commande « MCP: Open User Configuration », puis fusionnez ce bloc.'),
    },
    codex: {
      brand: 'openai',
      blurb: t('Bloc à ajouter à ~/.codex/config.toml (pont local stdio).'),
      paste: t('Ajoutez ce bloc à la fin de ~/.codex/config.toml.'),
    },
    chatgpt: { brand: 'openai', blurb: '' },
  };

function ClientLogo({ id, name }: { id: ClientId; name: string }) {
  const meta = META[id];
  if (meta.brand) return <BrandLogo brand={meta.brand} tile size={36} />;
  const Icon = meta.icon ?? Globe;
  return (
    <span
      className="bg-muted border-border inline-flex size-9 shrink-0 items-center justify-center rounded-lg border"
      aria-label={name}
    >
      <Icon className="text-muted-foreground size-4.5" />
    </span>
  );
}

function Status({ client }: { client: Client }) {
  if (client.installed) {
    return (
      <span className="text-success bg-success/10 inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px]">
        <CheckCircle2 className="size-3" /> {t('Installé')}
      </span>
    );
  }
  if (client.detected === false)
    return (
      <span className="bg-muted text-muted-foreground rounded-sm px-1.5 py-0.5 text-[11px]">
        {t('Non détecté')}
      </span>
    );
  if (client.detected)
    return (
      <span className="bg-muted text-muted-foreground rounded-sm px-1.5 py-0.5 text-[11px]">
        {t('Détecté')}
      </span>
    );
  return null;
}

export default function McpSettings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const info = useQuery(trpc.developer.info.queryOptions());
  const clients = useQuery(trpc.developer.clients.queryOptions());
  const [allowWrite, setAllowWrite] = useState(true);
  const [snippet, setSnippet] = useState<{ client: ClientId; name: string; code: string } | null>(
    null,
  );

  const install = useMutation(
    trpc.developer.install.mutationOptions({
      onSuccess: (result) => {
        void queryClient.invalidateQueries({ queryKey: trpc.developer.clients.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.developer.list.queryKey() });
        const name = clients.data?.find((c) => c.id === result.client)?.name ?? result.client;
        if (result.mode === 'file') {
          toast.success(t('ZMail ajouté à {name}', { name }), {
            description: result.backupPath
              ? t('{path} — sauvegarde : {backup}. Redémarrez {name}.', { path: result.path, backup: result.backupPath, name })
              : t('{path}. Redémarrez {name}.', { path: result.path, name }),
            duration: 8000,
          });
        } else {
          setSnippet({ client: result.client, name, code: result.snippet });
        }
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const run = (client: ClientId) =>
    install.mutate({ client, scopes: allowWrite ? ['read', 'write'] : ['read'] });
  const pending = (client: ClientId) => install.isPending && install.variables?.client === client;

  const installable = clients.data?.filter((c) => c.mode !== 'manual') ?? [];
  const chatgpt = clients.data?.find((c) => c.id === 'chatgpt');

  return (
    <SettingsPage
      title={t('Connecteurs IA (MCP)')}
      description={t('MCP (Model Context Protocol) permet à vos assistants IA — Claude, Cursor, Codex… — de lire, chercher et trier vos mails ZMail, sans que rien ne quitte votre Mac.')}
    >
      <Card
        title={t('Accès accordé')}
        description={t('Chaque installation crée sa propre clé API, révocable dans Réglages → API.')}
      >
        <Row
          label={t('Autoriser les actions')}
          description={t('Envoyer, archiver, marquer lu, étoiler, mettre à la corbeille, taguer, signaler en spam, et l’assistant ZMail (ask_inbox). Sinon : lecture seule.')}
        >
          <Switch
            checked={allowWrite}
            onCheckedChange={setAllowWrite}
            aria-label={t('Autoriser les actions')}
          />
        </Row>
        {info.data && !info.data.bridgeAvailable ? (
          <p className="text-warning bg-warning/10 border-warning/30 mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-[12.5px]">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            {t('Pont stdio introuvable ({path}) : Claude Desktop et Codex CLI ne pourront pas se connecter. Reconstruisez le moteur.', { path: info.data.bridgePath })}
          </p>
        ) : null}
      </Card>

      <div className="grid gap-3">
        {installable.map((client) => (
          <section
            key={client.id}
            id={client.id}
            className="bg-card text-card-foreground border-border flex scroll-mt-4 items-start gap-4 rounded-xl border px-5 py-4"
          >
            <ClientLogo id={client.id} name={client.name} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-[14px] font-semibold">{client.name}</h2>
                <Status client={client} />
              </div>
              <p className="text-muted-foreground mt-0.5 text-[12.5px] leading-relaxed">
                {META[client.id].blurb}
              </p>
            </div>
            {client.mode === 'file' ? (
              <PrimaryButton onClick={() => run(client.id)} disabled={install.isPending}>
                {pending(client.id) ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {client.installed ? t('Réinstaller') : t('Installer')}
              </PrimaryButton>
            ) : (
              <GhostButton onClick={() => run(client.id)} disabled={install.isPending}>
                {pending(client.id) ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {t('Générer la configuration')}
              </GhostButton>
            )}
          </section>
        ))}
      </div>

      {chatgpt ? (
        <Card title="ChatGPT" description={t('Pas d’installation en un clic, et c’est volontaire.')}>
          <div className="flex items-start gap-4">
            <ClientLogo id="chatgpt" name="ChatGPT" />
            <div className="text-muted-foreground min-w-0 flex-1 space-y-2 text-[12.5px] leading-relaxed">
              <p>
                {t('Les connecteurs de ChatGPT n’acceptent que des serveurs MCP {remote}, joints depuis les serveurs d’OpenAI : ils ne peuvent pas atteindre ZMail, qui n’écoute que sur votre Mac (127.0.0.1).')
                  .split('{remote}')
                  .flatMap((part, i) => (i === 0 ? [part] : [<span key={i} className="text-foreground">{t('distants en HTTPS')}</span>, part]))}
              </p>
              <p>
                {t('Pour l’utiliser quand même, il faut exposer l’adresse ci-dessous via un tunnel HTTPS (Cloudflare Tunnel, ngrok…) avec une clé API dédiée. Vos mails deviennent alors joignables depuis Internet par quiconque détient la clé : à réserver à un usage averti.')}
              </p>
              {info.data ? <CopyField value={info.data.mcpUrl} className="max-w-[420px]" /> : null}
            </div>
          </div>
        </Card>
      ) : null}

      <Card title={t('Configuration manuelle')} description={t('Pour tout autre client compatible MCP.')}>
        <div className="space-y-3">
          <Row
            label={t('Serveur HTTP (Streamable HTTP)')}
            description={t('En-tête Authorization: Bearer <clé API>.')}
          >
            {info.data ? <CopyField value={info.data.mcpUrl} className="w-[320px]" /> : null}
          </Row>
          <Row
            label={t('Pont stdio')}
            description={t('Commande à lancer avec la variable ZMAIL_API_KEY ; il retrouve seul le port de ZMail.')}
          >
            {info.data ? (
              <CopyField
                value={`"${info.data.nodePath}" "${info.data.bridgePath}"`}
                className="w-[320px]"
              />
            ) : null}
          </Row>
        </div>
      </Card>

      <SecretDialog
        open={Boolean(snippet)}
        onClose={() => setSnippet(null)}
        title={t('Configuration pour {name}', { name: snippet?.name ?? '' })}
        description={snippet ? (META[snippet.client].paste ?? '') : ''}
        secret={snippet?.code ?? ''}
      >
        {snippet?.client === 'vscode' && info.data ? (
          <CodeBlock
            label={t('Ou en une commande')}
            code={`code --add-mcp '${JSON.stringify({ name: 'zmail', ...JSON.parse(snippet.code).servers.zmail })}'`}
          />
        ) : null}
      </SecretDialog>
    </SettingsPage>
  );
}
