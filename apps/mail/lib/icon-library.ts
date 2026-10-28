import { createContext, useContext, useSyncExternalStore } from 'react';
import { SOLAR_BODIES, SOLAR_NAMES } from '@/lib/solar-icons';
import akar from '@/lib/icon-sets/akar-icons';
import lucide from '@/lib/icon-sets/lucide';
import phosphorDuotone from '@/lib/icon-sets/phosphor-duotone';
import systemUicons from '@/lib/icon-sets/system-uicons';
import iconoir from '@/lib/icon-sets/iconoir';
import mynaui from '@/lib/icon-sets/mynaui';
import feather from '@/lib/icon-sets/feather';
import proicons from '@/lib/icon-sets/proicons';
import humbleicons from '@/lib/icon-sets/humbleicons';

/** One glyph: an SVG body (Iconify format) and its viewBox size. */
export type IconSet = Record<string, { body: string; w: number; h: number }>;

/**
 * The icon libraries ZMail can draw with, chosen in Settings → Appearance. Every library covers the
 * same keys (the names stored in `tags.icon`, and UI roles like `_inbox`), generated from Iconify
 * (see lib/icon-sets). All are free for any project: MIT, ISC, Unlicense, or CC BY for Solar
 * (credited here and in its file).
 */
export const ICON_LIBRARIES = [
  { id: 'akar-icons', label: 'Akar Icons', hint: 'Contour arrondi, doux et lisible', license: 'MIT', set: akar },
  { id: 'lucide', label: 'Lucide', hint: 'Trait fin uniforme, très sobre', license: 'ISC', set: lucide },
  { id: 'phosphor-duotone', label: 'Phosphor Duotone', hint: 'Contour et aplat léger, premium', license: 'MIT', set: phosphorDuotone },
  { id: 'system-uicons', label: 'System UIcons', hint: 'Le plus dépouillé, le moins de traits', license: 'Unlicense', set: systemUicons },
  { id: 'iconoir', label: 'Iconoir', hint: 'Formes pures, trait régulier', license: 'MIT', set: iconoir },
  { id: 'mynaui', label: 'Mynaui', hint: 'Arrondi, détails réduits', license: 'MIT', set: mynaui },
  { id: 'feather', label: 'Feather', hint: 'L’ancêtre de Lucide, encore plus simple', license: 'MIT', set: feather },
  { id: 'proicons', label: 'ProIcons', hint: 'Sobre et rond, façon Windows 11', license: 'MIT', set: proicons },
  { id: 'humbleicons', label: 'Humbleicons', hint: 'Petit, compact, minimaliste', license: 'MIT', set: humbleicons },
  { id: 'solar-duotone', label: 'Solar Bold Duotone', hint: 'Pleins doux à deux tons', license: 'CC BY 4.0 (480 Design)', set: solarSet() },
] as const satisfies readonly { id: string; label: string; hint: string; license: string; set: IconSet }[];

export type IconLibraryId = (typeof ICON_LIBRARIES)[number]['id'];
export const DEFAULT_ICON_LIBRARY: IconLibraryId = 'akar-icons';
const STORAGE_KEY = 'zmail.iconLibrary';

function solarSet(): IconSet {
  return Object.fromEntries(Object.entries(SOLAR_NAMES).map(([key, name]) => [key, SOLAR_BODIES[name]!]).filter(([, icon]) => icon));
}

const byId = new Map<string, (typeof ICON_LIBRARIES)[number]>(ICON_LIBRARIES.map((l) => [l.id, l]));
export const iconLibrary = (id: string | null | undefined) => byId.get(id ?? '') ?? byId.get(DEFAULT_ICON_LIBRARY)!;

/** The glyph for a key in a library; a key the library lacks is drawn with Lucide, then Solar. */
export function iconFor(library: string, key: string) {
  return iconLibrary(library).set[key] ?? lucide[key] ?? SOLAR_BODIES[SOLAR_NAMES[key] ?? key];
}

// The active library: kept in localStorage (instant at launch) and in the engine's UI settings.
let active: IconLibraryId = (() => {
  try {
    return iconLibrary(localStorage.getItem(STORAGE_KEY)).id;
  } catch {
    return DEFAULT_ICON_LIBRARY;
  }
})();
const listeners = new Set<() => void>();

export function setActiveIconLibrary(id: string) {
  const next = iconLibrary(id).id;
  if (next === active) return;
  active = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage unavailable: the choice still comes back from the engine's settings.
  }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => (listeners.add(listener), () => listeners.delete(listener));

/** Lets a preview draw with another library (Settings → Appearance, on hover). */
export const IconLibraryPreview = createContext<IconLibraryId | null>(null);

export function useIconLibrary(): IconLibraryId {
  const current = useSyncExternalStore(subscribe, () => active, () => DEFAULT_ICON_LIBRARY);
  return useContext(IconLibraryPreview) ?? current;
}
