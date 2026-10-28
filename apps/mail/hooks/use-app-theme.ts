import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { isNativeApp, postNative } from '@/lib/native';
import { CSS_KEY } from '@/lib/themes';
import { applyTheme, rememberTheme, storedTheme, type ThemePreset } from '@/lib/themes';
import { useTRPC } from '@/lib/trpc';
import { setActiveIconLibrary, useIconLibrary, type IconLibraryId } from '@/lib/icon-library';

/** The colour theme (tweakcn preset or imported), shared by the whole app and kept in the engine. */
export function useAppTheme() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: ui } = useQuery(trpc.settings.get.queryOptions());
  const key = trpc.settings.get.queryKey();
  const save = useMutation(
    trpc.settings.save.mutationOptions({
      onMutate: (patch) => queryClient.setQueryData(key, (prev: Record<string, unknown> | undefined) => ({ ...prev, ...patch })),
    }),
  );
  const [current, setCurrent] = useState<ThemePreset>(storedTheme);
  const imported = Array.isArray(ui?.importedThemes) ? (ui.importedThemes as ThemePreset[]) : [];

  const setTheme = (preset: ThemePreset) => {
    applyTheme(preset);
    rememberTheme(preset);
    setCurrent(preset);
    save.mutate({ theme: preset });
  };
  const importTheme = (preset: ThemePreset) => {
    save.mutate({ importedThemes: [preset, ...imported.filter((t) => t.id !== preset.id)], theme: preset });
    applyTheme(preset);
    rememberTheme(preset);
    setCurrent(preset);
  };
  const removeImported = (id: string) => save.mutate({ importedThemes: imported.filter((t) => t.id !== id) });

  return { current, setTheme, imported, importTheme, removeImported };
}

/** The icon library (Settings → Appearance): applied at once, kept in the engine like the theme. */
export function useIconLibraryChoice() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const key = trpc.settings.get.queryKey();
  const save = useMutation(
    trpc.settings.save.mutationOptions({
      onMutate: (patch) => queryClient.setQueryData(key, (prev: Record<string, unknown> | undefined) => ({ ...prev, ...patch })),
    }),
  );
  const current = useIconLibrary();
  const choose = (id: IconLibraryId) => {
    setActiveIconLibrary(id);
    save.mutate({ iconLibrary: id });
  };
  return { current, choose };
}

/**
 * The macOS app paints its boot screen before this page exists: it keeps the current mode and
 * theme colours so that screen opens in the right colours (no white flash at launch).
 */
function tellNative(mode: string | undefined) {
  if (!isNativeApp()) return;
  let css = '';
  try {
    css = localStorage.getItem(CSS_KEY) ?? '';
  } catch {
    // Storage unavailable: the boot screen falls back to the default colours.
  }
  postNative({ type: 'setAppearance', mode: mode ?? 'system', css });
}

/** Applies the stored theme on launch and follows the engine's copy (e.g. after a reinstall). */
export function ThemeSync() {
  const { theme } = useTheme();
  const trpc = useTRPC();
  const { data: ui } = useQuery(trpc.settings.get.queryOptions());
  useEffect(() => {
    applyTheme(storedTheme());
  }, []);
  // Mode or colour theme changed: tell the native app (after applyTheme stored the CSS).
  const appliedId = (ui?.theme as ThemePreset | undefined)?.id;
  useEffect(() => {
    const id = setTimeout(() => tellNative(theme), 50);
    return () => clearTimeout(id);
  }, [theme, appliedId]);
  // The icon library follows the engine's copy too (another device, a reinstall).
  useEffect(() => {
    if (typeof ui?.iconLibrary === 'string') setActiveIconLibrary(ui.iconLibrary);
  }, [ui?.iconLibrary]);
  useEffect(() => {
    const remote = ui?.theme as ThemePreset | undefined;
    if (!remote?.id || remote.id === storedTheme().id) return;
    applyTheme(remote);
    rememberTheme(remote);
  }, [ui?.theme]);
  return null;
}
