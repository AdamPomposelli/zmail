import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Copy, ExternalLink, Loader2, RotateCw, ShieldCheck, Stethoscope } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BrandLogo } from '@/components/brand-logo';
import { Input } from '@/components/ui/input';
import { copyText, openExternal } from '@/lib/native';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

const ZMAIL_APP_ID = '5230b5e2-07c5-41b5-9657-2bfb91661209';
const REDIRECT_URI = 'http://localhost/oauth/microsoft';
/** Microsoft Entra, straight on « New registration ». */
const ENTRA_NEW_APP = 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade/quickStartType~/null/isMSAApp~/false';
type Check = 'ok' | 'tenant' | 'not-personal' | 'redirect' | 'unknown';

/**
 * Outlook.com, Hotmail, Live and Microsoft 365 refuse passwords (app passwords included) for
 * third-party apps since September 2024: the user signs in on Microsoft's own page instead, in
 * the browser, and ZMail receives a token. `onSigned` gets the sign-in to connect the mailbox with.
 *
 * ZMail ships with its own app ID. If Microsoft refuses it (or the user prefers their own app),
 * the guide below walks through creating one, checks it with Microsoft as soon as it is pasted,
 * and comes back here: nothing else in the wizard is lost.
 */
export function MicrosoftSignIn({ email, signed, onSigned }: { email: string; signed: boolean; onSigned: (state: string) => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: clientId, isLoading } = useQuery(trpc.accounts.microsoftClientId.queryOptions());
  const [guide, setGuide] = useState(false);
  const [state, setState] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const start = useMutation(
    trpc.accounts.microsoftStart.mutationOptions({
      onSuccess: (r) => {
        setState(r.state);
        setStartedAt(Date.now());
        openExternal(r.url);
      },
    }),
  );
  // Followed while the user signs in in the browser.
  const { data: status } = useQuery({
    ...trpc.accounts.microsoftStatus.queryOptions({ state: state ?? '' }),
    enabled: Boolean(state),
    refetchInterval: (q) => (q.state.data?.done ? false : 1000),
  });
  useEffect(() => {
    if (state && status?.done && !status.error) onSigned(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.done, status?.error, state]);
  const waiting = Boolean(state) && !status?.done;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waiting]);

  if (isLoading) return null;
  if (guide || !clientId)
    return (
      <MicrosoftAppGuide
        current={clientId ?? null}
        onDone={() => {
          setGuide(false);
          setState(null);
          void queryClient.invalidateQueries({ queryKey: trpc.accounts.microsoftClientId.queryKey() });
        }}
        onCancel={clientId ? () => setGuide(false) : undefined}
      />
    );

  const done = signed || (status?.done && !status.error);
  const signIn = () => start.mutate({ email: email || undefined });
  // Microsoft shows its errors on its own page and never comes back: after a while, offer help.
  const stuck = waiting && now - startedAt > 20_000;
  const failed = Boolean(status?.error || start.error);

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-[13px] leading-relaxed">
        {t('Microsoft n’accepte plus les mots de passe (même d’application) pour les apps de messagerie : vous vous connectez sur sa propre page, ZMail ne voit jamais votre mot de passe.')}
      </p>
      {done ? (
        <p className="border-success/30 bg-success/[0.07] text-success flex items-center gap-2 rounded-xl border px-4 py-3 text-[13.5px] font-medium">
          <CheckCircle2 className="size-4.5" />
          {t('Connecté avec Microsoft{email}', { email: status?.email ? ` : ${status.email}` : '' })}
        </p>
      ) : (
        <button
          type="button"
          disabled={start.isPending || waiting}
          onClick={signIn}
          className="ring-border hover:bg-accent flex h-12 w-full items-center justify-center gap-2.5 rounded-xl text-[14.5px] font-semibold ring-1 transition disabled:opacity-70"
        >
          {waiting || start.isPending ? <Loader2 className="size-4.5 animate-spin" /> : <BrandLogo brand="microsoft" size={18} />}
          {waiting ? t('Terminez la connexion dans votre navigateur…') : t('Se connecter avec Microsoft')}
        </button>
      )}
      {waiting ? (
        <button type="button" onClick={signIn} className="text-muted-foreground hover:text-foreground mx-auto flex items-center gap-1 text-[12px]">
          <ExternalLink className="size-3" /> {t('Rouvrir la page Microsoft')}
        </button>
      ) : null}

      {stuck || failed ? (
        <div className="border-warning/30 bg-warning/[0.06] space-y-2.5 rounded-xl border px-4 py-3">
          <p className="flex items-center gap-2 text-[13px] font-medium">
            <AlertTriangle className="text-warning size-4" />
            {failed ? (status?.error ?? start.error?.message) : t('Microsoft affiche une erreur dans le navigateur ?')}
          </p>
          <p className="text-muted-foreground text-[12.5px] leading-relaxed">
            {t('Le plus souvent « unauthorized_client » : l’application Microsoft n’est pas ouverte aux comptes personnels. Vérifiez-la, ou créez la vôtre en 4 étapes guidées : vous revenez ici ensuite, sans rien ressaisir.')}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={signIn} className="ring-border hover:bg-accent flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] ring-1">
              <RotateCw className="size-3.5" /> {t('Réessayer')}
            </button>
            <button type="button" onClick={() => setGuide(true)} className="bg-foreground text-background hover:bg-foreground/90 flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium">
              <Stethoscope className="size-3.5" /> {t('Vérifier ou créer l’application Microsoft')}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <p className="text-muted-foreground flex items-start gap-1.5 text-[11.5px]">
          <ShieldCheck className="mt-px size-3.5 shrink-0" />
          {t('ZMail demande seulement à lire et envoyer vos mails. Vous pouvez retirer cet accès à tout moment sur account.microsoft.com.')}
        </p>
        {!stuck && !failed ? (
          <button type="button" onClick={() => setGuide(true)} className="text-muted-foreground hover:text-foreground shrink-0 text-[11.5px] underline-offset-2 hover:underline">
            {clientId === ZMAIL_APP_ID ? t('Utiliser ma propre application') : t('Mon application Microsoft')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Creating one's own app in Microsoft Entra, step by step, with Microsoft's exact labels, values
 * to copy, and the pasted ID checked with Microsoft right away (wrong ID, accounts, redirect).
 */
function MicrosoftAppGuide({ current, onDone, onCancel }: { current: string | null; onDone: () => void; onCancel?: () => void }) {
  const trpc = useTRPC();
  const [opened, setOpened] = useState(false);
  const [value, setValue] = useState(current && current !== ZMAIL_APP_ID ? current : '');
  const [result, setResult] = useState<Check | null>(null);
  const check = useMutation(trpc.accounts.checkMicrosoftClientId.mutationOptions({ onSuccess: setResult }));
  const save = useMutation(trpc.accounts.setMicrosoftClientId.mutationOptions({ onSuccess: onDone }));
  const reset = useMutation(trpc.accounts.resetMicrosoftClientId.mutationOptions({ onSuccess: onDone }));
  const id = value.trim().toLowerCase();
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
  // Checked with Microsoft as soon as a well-formed ID is pasted.
  const last = useRef('');
  useEffect(() => {
    if (!valid || last.current === id) return;
    last.current = id;
    setResult(null);
    check.mutate({ clientId: id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, valid]);

  return (
    <div className="space-y-4">
      {onCancel ? (
        <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground -mt-1 flex items-center gap-1 text-[12px]">
          <ArrowLeft className="size-3.5" /> {t('Retour à la connexion Microsoft')}
        </button>
      ) : null}
      <p className="text-muted-foreground text-[13px] leading-relaxed">
        {t('Déclarez ZMail une fois auprès de Microsoft (gratuit, 2 minutes). Suivez les étapes : ZMail vérifie votre application dès que vous collez son ID.')}
      </p>
      <ol className="space-y-3">
        <Step n={1} done={opened || result === 'ok'} title={t('Ouvrez Microsoft Entra et connectez-vous')}>
          <p>{t('Avec votre compte Microsoft (le même que la boîte, ou un autre). La page « Inscrire une application » s’ouvre directement.')}</p>
          <button
            type="button"
            onClick={() => (setOpened(true), openExternal(ENTRA_NEW_APP))}
            className="ring-border hover:bg-accent mt-2 flex h-8 items-center gap-2 rounded-lg px-3 text-[12.5px] font-medium ring-1"
          >
            <BrandLogo brand="microsoft" size={13} /> {t('Ouvrir Microsoft Entra')} <ExternalLink className="size-3" />
          </button>
        </Step>
        <Step n={2} done={result === 'ok'} title={t('Remplissez « Register an application »')}>
          <Field label="Name" value="ZMail" />
          <p className="mt-1.5">
            {t('« Supported account types » : choisissez')} <Exact>Any Entra ID Tenant + Personal Microsoft accounts</Exact>
          </p>
          <p className="text-muted-foreground/80 mt-1 text-[11.5px]">{t('Ancien libellé : « Accounts in any organizational directory and personal Microsoft accounts ».')}</p>
        </Step>
        <Step n={3} done={result === 'ok'} title={t('Ajoutez l’adresse de retour, puis « Register »')}>
          <p>
            {t('« Redirect URI » : plateforme')} <Exact>Public client/native (mobile & desktop)</Exact>
          </p>
          <Field label="URI" value={REDIRECT_URI} />
        </Step>
        <Step n={4} done={result === 'ok'} title={t('Collez l’« Application (client) ID »')}>
          <p>{t('Sur la page « Overview » de l’application, c’est la première ligne. Pas « Object ID », ni « Directory (tenant) ID ».')}</p>
          <div className="relative mt-2">
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              className={cn('h-9 pr-9 font-mono text-[12.5px]', result === 'ok' && 'border-success/60', result && result !== 'ok' && result !== 'unknown' && 'border-warning/60')}
              spellCheck={false}
            />
            <span className="absolute top-1/2 right-3 -translate-y-1/2">
              {check.isPending ? <Loader2 className="text-muted-foreground size-4 animate-spin" /> : result === 'ok' ? <Check className="text-success size-4" /> : null}
            </span>
          </div>
          {value && !valid ? <p className="text-muted-foreground mt-1.5 text-[12px]">{t('Un ID ressemble à 5230b5e2-07c5-41b5-9657-2bfb91661209 (36 caractères).')}</p> : null}
          {result ? <Diagnosis result={result} onRecheck={() => check.mutate({ clientId: id })} checking={check.isPending} /> : null}
        </Step>
      </ol>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          disabled={!valid || save.isPending || check.isPending || (result !== 'ok' && result !== 'unknown')}
          onClick={() => save.mutate({ clientId: id })}
          className="bg-primary text-primary-foreground h-9 rounded-lg px-4 text-[13px] font-medium disabled:opacity-40"
        >
          {result === 'unknown' ? t('Utiliser cet ID quand même') : t('Utiliser cette application')}
        </button>
        {current && current !== ZMAIL_APP_ID ? (
          <button type="button" onClick={() => reset.mutate()} className="text-muted-foreground hover:text-foreground h-9 px-2 text-[12.5px]">
            {t('Revenir à l’application de ZMail')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** What Microsoft said about the pasted ID, and the exact fix. */
function Diagnosis({ result, onRecheck, checking }: { result: Check; onRecheck: () => void; checking: boolean }) {
  if (result === 'ok')
    return (
      <p className="text-success mt-2 flex items-center gap-1.5 text-[12.5px] font-medium">
        <CheckCircle2 className="size-4" /> {t('Microsoft reconnaît l’application, ouverte aux comptes personnels.')}
      </p>
    );
  const fixes: Record<Exclude<Check, 'ok'>, { title: string; steps: ReactNode[] }> = {
    tenant: {
      title: t('C’est l’ID de l’annuaire (« Directory (tenant) ID »), pas celui de l’application.'),
      steps: [t('Sur la page « Overview », copiez la ligne « Application (client) ID », juste au-dessus.')],
    },
    'not-personal': {
      title: t('Microsoft ne trouve pas cette application pour les comptes personnels.'),
      steps: [
        t('Vérifiez que c’est bien l’« Application (client) ID » (pas l’« Object ID »).'),
        <>
          {t('Dans « Authentication » → « Supported accounts », choisissez')} <Exact>Any Entra ID Tenant + Personal Microsoft accounts</Exact> {t('et enregistrez.')}
        </>,
        <>
          {t('Si Microsoft refuse ce choix : dans « Manifest », mettez')} <Exact>"requestedAccessTokenVersion": 2</Exact>{t(', enregistrez, puis recommencez l’étape précédente.')}
        </>,
      ],
    },
    redirect: {
      title: t('L’adresse de retour n’est pas déclarée.'),
      steps: [
        <>
          {t('Dans « Authentication » → « Redirect URI configuration », ajoutez la plateforme')} <Exact>Mobile and desktop applications</Exact> {t('avec')} <Exact>{REDIRECT_URI}</Exact>.
        </>,
      ],
    },
    unknown: {
      title: t('Microsoft n’a pas répondu clairement (connexion lente ?).'),
      steps: [t('Vous pouvez revérifier, ou utiliser cet ID quand même : la connexion dira s’il convient.')],
    },
  };
  const fix = fixes[result];
  return (
    <div className="border-warning/30 bg-warning/[0.06] mt-2 rounded-lg border px-3 py-2.5 text-[12.5px]">
      <p className="flex items-start gap-1.5 font-medium">
        <AlertTriangle className="text-warning mt-0.5 size-3.5 shrink-0" /> {fix.title}
      </p>
      <ul className="text-muted-foreground mt-1.5 space-y-1 pl-5">
        {fix.steps.map((step, i) => (
          <li key={i} className="list-disc leading-relaxed">
            {step}
          </li>
        ))}
      </ul>
      <button type="button" onClick={onRecheck} disabled={checking} className="text-foreground mt-2 flex items-center gap-1.5 text-[12px] font-medium hover:underline">
        {checking ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />} {t('Revérifier')}
      </button>
    </div>
  );
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={cn('mt-px flex size-6 shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold transition-colors', done ? 'bg-success text-white' : 'bg-muted text-foreground')}>
        {done ? <Check className="size-3.5" /> : n}
      </span>
      <div className="text-muted-foreground min-w-0 flex-1 text-[12.5px] leading-relaxed">
        <p className="text-foreground text-[13px] font-medium">{title}</p>
        <div className="mt-0.5">{children}</div>
      </div>
    </li>
  );
}

/** A field label and the value to type in it, with a copy button. */
function Field({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-muted/60 mt-1.5 flex items-center gap-2 rounded-md px-2.5 py-1.5">
      <span className="text-muted-foreground w-10 shrink-0 text-[11.5px]">{label}</span>
      <code className="text-foreground min-w-0 flex-1 truncate font-mono text-[12px]">{value}</code>
      <button
        type="button"
        onClick={() => void copyText(value).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11.5px]"
        aria-label={t('Copier')}
      >
        {copied ? <Check className="text-success size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

/** Microsoft's exact wording, to spot in its interface. */
function Exact({ children }: { children: ReactNode }) {
  return <span className="bg-muted text-foreground rounded px-1.5 py-0.5 font-mono text-[11.5px] whitespace-nowrap">{children}</span>;
}
