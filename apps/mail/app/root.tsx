import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TRPCProvider, createClient } from '@/lib/trpc';
import { ThemeSync } from '@/hooks/use-app-theme';
import { LocaleSync } from '@/hooks/use-locale';
import { ThemeProvider } from 'next-themes';
import { useState, type PropsWithChildren } from 'react';
import { Toaster } from 'sonner';
import { useTheme } from 'next-themes';
import { APP_BRAND } from '@/lib/app-brand';
import type { Route } from './+types/root';
import './globals.css';
import { locale, t } from '@/lib/i18n';

export const meta: Route.MetaFunction = () => [{ title: 'ZMail' }];

export function Layout({ children }: PropsWithChildren) {
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <link rel="icon" href={APP_BRAND.faviconIco} sizes="48x48" />
        <link rel="icon" href={APP_BRAND.favicon} type="image/svg+xml" />
        <link rel="apple-touch-icon" href={APP_BRAND.appleTouchIcon} />
        {/* Light or dark before the first paint (same key and classes as next-themes): no white flash. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('theme')||'system',d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches),e=document.documentElement;e.classList.toggle('dark',d);e.classList.toggle('light',!d);e.style.colorScheme=d?'dark':'light'}catch(e){}` }} />
        <Meta />
        <Links />
        <link rel="stylesheet" href="/boot.css" />
        <script src="/boot.js" />
        {/* Paints the chosen theme before React starts, so there is no flash of the default one. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var c=localStorage.getItem('zmail.theme.css');if(c){var s=document.createElement('style');s.id='zmail-theme';s.textContent=c;document.head.appendChild(s)}}catch(e){}` }} />
      </head>
      <body className="bg-sidebar text-foreground overscroll-none antialiased">
        {/* Boot skeleton, outside React's tree: painted before the app hydrates, removed by bootDone(). */}
        <div id="zmail-boot" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: '' }} />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var r=document.getElementById('zmail-boot');if(r&&r.childElementCount===0&&window.ZMailBoot){window.zmailAppBoot=window.ZMailBoot.mount(r,{progress:82,label:${JSON.stringify(t('Ouverture de votre boîte de réception'))},cap:90,instant:true})}}catch(e){}`,
          }}
        />
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 } } }),
  );
  const [trpcClient] = useState(createClient);
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider delayDuration={300}>
            <ThemeSync />
            <LocaleSync />
            <Outlet />
            <ThemedToaster />
          </TooltipProvider>
        </ThemeProvider>
      </TRPCProvider>
    </QueryClientProvider>
  );
}

/** Toasts follow the app's light/dark mode (sonner defaults to light). */
function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster position="bottom-right" theme={resolvedTheme === 'dark' ? 'dark' : 'light'} toastOptions={{ className: 'font-sans' }} />;
}

export function HydrateFallback() {
  // The boot skeleton (#zmail-boot) covers the screen until the app is ready.
  return <div className="bg-sidebar h-dvh w-full" />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : t('Erreur inconnue');
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold">{t('Oups, quelque chose s’est mal passé')}</h1>
      <p className="text-muted-foreground max-w-md text-sm">{message}</p>
      <button className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-sm" onClick={() => window.location.reload()}>
        {t('Recharger')}
      </button>
    </div>
  );
}
