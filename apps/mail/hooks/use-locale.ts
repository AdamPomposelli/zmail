import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { locale, setLocale, type Locale } from '@/lib/i18n';
import { postNative } from '@/lib/native';
import { useTRPC } from '@/lib/trpc';

/** Tells the engine and the Mac app which language the UI speaks, once per launch. */
export function LocaleSync() {
  const trpc = useTRPC();
  const save = useMutation(trpc.settings.setLocale.mutationOptions());
  useEffect(() => {
    save.mutate({ locale });
    postNative({ type: 'setLocale', locale });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Changes the language of the whole app (engine and Mac app included), then reloads. */
export function useSetLocale() {
  const trpc = useTRPC();
  const save = useMutation(trpc.settings.setLocale.mutationOptions());
  return (next: Locale) => setLocale(next, (l) => save.mutateAsync({ locale: l }));
}
