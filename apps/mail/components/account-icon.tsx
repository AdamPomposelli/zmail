import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { BrandLogo, brandForProvider } from '@/components/brand-logo';
import { IconPicker } from '@/components/icon-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCatalog } from '@/hooks/use-catalog';
import { BRAND_LOGOS, type Brand } from '@/lib/brand-logos';
import { TAG_ICONS, customIcon } from '@/lib/tag-icons';
import { useTRPC, type Outputs } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

type Account = Outputs['accounts']['list'][number];

/** Mail providers' logos first, then the rest of the collection. */
const BRANDS = Object.keys(BRAND_LOGOS) as Brand[];
const FREE_DOMAINS = /^(gmail|googlemail|icloud|me|mac|outlook|hotmail|live|msn|yahoo|gmx|orange|free|laposte|proton|protonmail|aol|mailbox)\./i;

/**
 * An account's icon: what the user picked (an icon in its colour, a brand's logo, an image such
 * as the company's own logo), else the provider's logo, else a dot in the account colour.
 */
export function AccountIcon({ account, size = 15 }: { account: Pick<Account, 'icon' | 'color' | 'provider'>; size?: number }) {
  const icon = account.icon;
  if (icon?.startsWith('emoji:')) return customIcon(icon, undefined, size);
  if (icon?.startsWith('image:')) return <img src={icon.slice(6)} alt="" className="shrink-0 rounded-[3px] object-contain" style={{ width: size, height: size }} />;
  if (icon?.startsWith('brand:')) return <BrandLogo brand={icon.slice(6) as Brand} size={size} />;
  if (icon?.startsWith('icon:')) {
    const Icon = TAG_ICONS[icon.slice(5)];
    if (Icon) return <Icon className="shrink-0" style={{ width: size, height: size, color: account.color }} />;
  }
  const brand = brandForProvider(account.provider);
  if (brand) return <BrandLogo brand={brand} size={size} />;
  return <span className="size-1.5 rounded-full" style={{ backgroundColor: account.color }} />;
}

/**
 * Picker for an account's icon, the same as everywhere in the sidebar (icon, emoji, image), plus
 * a « Logos » tab: the company's own logo (from its website) and brand logos. Saved at once.
 */
export function AccountIconPopover({ account, children, open, onOpenChange }: { account: Account; children: ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: trpc.accounts.list.queryKey() });
  const setIcon = useMutation(trpc.accounts.setIcon.mutationOptions({ onSuccess: refresh, onError: (e) => toast.error(e.message) }));
  const update = useMutation(trpc.accounts.update.mutationOptions({ onSuccess: refresh }));
  const siteLogo = useMutation(trpc.accounts.siteLogo.mutationOptions());

  // The company behind the mailbox: its own domain, and the domains of its business.
  const business = account.businessId ? catalog.businessById.get(account.businessId) : undefined;
  const own = account.email.split('@')[1] ?? '';
  const domains = [...new Set([...(FREE_DOMAINS.test(own) ? [] : [own]), ...(business?.matchers.filter((m) => m.type === 'domain').map((m) => m.value) ?? [])])].slice(0, 3);
  const fetchLogo = (domain: string) =>
    siteLogo.mutate(
      { domain },
      {
        onSuccess: (image) => (image ? setIcon.mutate({ id: account.id, icon: `image:${image}` }) : toast(t('Pas de logo trouvé sur {domain}', { domain }), { description: t('Importez plutôt une image depuis l’onglet Image.') })),
      },
    );

  // The account stores library icons as « icon:<name> »; the picker speaks plain names.
  const current = account.icon;
  const value = current?.startsWith('icon:') ? current.slice(5) : current;
  const logos = (
    <div className="space-y-3">
      {domains.map((domain) => (
        <button
          key={domain}
          type="button"
          disabled={siteLogo.isPending}
          onClick={() => fetchLogo(domain)}
          className="ring-border hover:bg-accent flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12.5px] ring-1 disabled:opacity-60"
        >
          {siteLogo.isPending && siteLogo.variables?.domain === domain ? <Loader2 className="size-3.5 animate-spin" /> : <Globe className="size-3.5" />}
          <span className="min-w-0 flex-1 truncate">{t('Logo du site {domain}', { domain })}</span>
        </button>
      ))}
      <div className="grid grid-cols-9 gap-0.5">
        {BRANDS.map((brand) => (
          <button
            key={brand}
            type="button"
            title={BRAND_LOGOS[brand].label}
            aria-label={BRAND_LOGOS[brand].label}
            onClick={() => setIcon.mutate({ id: account.id, icon: `brand:${brand}` })}
            className={cn('hover:bg-accent flex size-8 items-center justify-center rounded-md', current === `brand:${brand}` && 'bg-accent ring-border ring-1')}
          >
            <BrandLogo brand={brand} size={16} />
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" side="right" className="w-auto p-3">
        <IconPicker
          title={account.label || account.email}
          value={value ?? null}
          color={account.color}
          preview={<AccountIcon account={account} size={22} />}
          fallback={<AccountIcon account={{ ...account, icon: null }} size={22} />}
          extraTab={{ label: t('Logos'), content: logos, active: Boolean(current?.startsWith('brand:') || current?.startsWith('image:')) }}
          onChange={(next) => setIcon.mutate({ id: account.id, icon: next === null ? null : next.startsWith('emoji:') || next.startsWith('image:') || next.startsWith('brand:') ? next : `icon:${next}` })}
          onColor={(color) => update.mutate({ id: account.id, patch: { color } })}
        />
      </PopoverContent>
    </Popover>
  );
}
