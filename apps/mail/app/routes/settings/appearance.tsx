import { Check, ExternalLink, Monitor, Moon, Sun, Trash2, Upload } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useState } from 'react';
import { toast } from 'sonner';
import { Card, SettingsPage } from '@/components/settings/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useSetLocale } from '@/hooks/use-locale';
import { LOCALES, locale, t } from '@/lib/i18n';
import { ThemeAppPreview } from '@/components/settings/theme-preview';
import { SolarIcon } from '@/components/ui/solar-icon';
import { useIconLibraryChoice } from '@/hooks/use-app-theme';
import { ICON_LIBRARIES, IconLibraryPreview, type IconLibraryId } from '@/lib/icon-library';
import { PRESETS, parseThemeCss, swatches, type ThemePreset } from '@/lib/themes';
import { cn, isMac } from '@/lib/utils';

const SHORTCUTS = [
  ['C', t('Nouveau message')],
  [`${isMac ? '⌘' : 'Ctrl'} K`, t('Palette de commandes')],
  [`${isMac ? '⌘' : 'Ctrl'} J`, t('Chat IA')],
  ['J / K', t('Conversation suivante / précédente')],
  [t('Entrée'), t('Ouvrir')],
  ['E', t('Archiver')],
  ['#', t('Supprimer')],
  ['!', t('Spam')],
  ['S', t('Suivre')],
  ['U', t('Marquer comme non lu')],
  ['X', t('Sélectionner')],
  ['/', t('Rechercher')],
  [t('G puis I / P / O'), t('Inbox / Important / Opportunités')],
  [t('Échap'), t('Fermer')],
];

/** A miniature of the app in the theme's colours: sidebar, panel, a line of text, the primary button. */
function ThemePreview({ preset, mode }: { preset: ThemePreset; mode: 'light' | 'dark' }) {
  const s = mode === 'dark' ? preset.dark : preset.light;
  const c = swatches(preset, mode);
  const sidebar = s.sidebar ?? (mode === 'dark' ? '#131314' : '#f7f7f8');
  const border = s.border ?? (mode === 'dark' ? '#2c2c2f' : '#e7e7ea');
  const muted = s['muted-foreground'] ?? (mode === 'dark' ? '#a1a1aa' : '#71717a');
  return (
    <div className="flex h-16 overflow-hidden rounded-md border border-border" style={{ backgroundColor: sidebar }} aria-hidden>
      <div className="flex w-1/4 flex-col gap-1 p-1.5">
        <span className="h-1.5 rounded-full" style={{ backgroundColor: c.primary, opacity: 0.85 }} />
        <span className="h-1 w-3/4 rounded-full" style={{ backgroundColor: muted, opacity: 0.5 }} />
        <span className="h-1 w-2/3 rounded-full" style={{ backgroundColor: muted, opacity: 0.5 }} />
      </div>
      <div className="m-1 ml-0 flex flex-1 flex-col justify-between rounded-sm p-1.5" style={{ backgroundColor: c.background, border: `1px solid ${border}` }}>
        <div className="space-y-1">
          <span className="block h-1.5 w-2/3 rounded-full" style={{ backgroundColor: c.foreground, opacity: 0.8 }} />
          <span className="block h-1 w-1/2 rounded-full" style={{ backgroundColor: muted, opacity: 0.6 }} />
        </div>
        <div className="flex items-center gap-1">
          <span className="h-2.5 w-8 rounded-sm" style={{ backgroundColor: c.primary }} />
          <span className="h-2.5 w-5 rounded-sm" style={{ backgroundColor: c.secondary }} />
          <span className="h-2.5 w-5 rounded-sm" style={{ backgroundColor: c.accent }} />
        </div>
      </div>
    </div>
  );
}

export default function AppearanceSettings() {
  const { theme, setTheme: setMode, resolvedTheme } = useTheme();
  const { current, setTheme, imported, importTheme, removeImported } = useAppTheme();
  const setLanguage = useSetLocale();
  const mode = resolvedTheme === 'dark' ? 'dark' : 'light';
  const [hovered, setHovered] = useState<ThemePreset | null>(null);
  const icons = useIconLibraryChoice();
  const [hoveredIcons, setHoveredIcons] = useState<IconLibraryId | null>(null);
  const hoveredIconLabel = ICON_LIBRARIES.find((l) => l.id === hoveredIcons)?.label;
  const [css, setCss] = useState('');
  const [name, setName] = useState('');

  const doImport = () => {
    const preset = parseThemeCss(css, name.trim() || t('Thème importé'));
    if (!preset) return toast.error(t('Aucune variable de thème trouvée. Collez le CSS exporté par tweakcn (bouton « Code »).'));
    importTheme(preset);
    setCss('');
    setName('');
    toast.success(t('Thème « {name} » appliqué', { name: preset.label }));
  };

  const tile = (preset: ThemePreset) => {
    const selected = current.id === preset.id;
    return (
      <div key={preset.id} className="group relative" onMouseEnter={() => setHovered(preset)} onMouseLeave={() => setHovered(null)}>
        <button
          type="button"
          onClick={() => setTheme(preset)}
          aria-pressed={selected}
          className={cn('w-full space-y-2 rounded-lg border p-2 text-left transition-colors', selected ? 'border-primary ring-2 ring-ring/30' : 'border-border hover:bg-accent')}
        >
          <ThemePreview preset={preset} mode={mode} />
          <span className="flex items-center gap-1.5 px-0.5 text-[12.5px] font-medium">
            <span className="truncate">{preset.label}</span>
            {selected ? <Check className="text-primary ml-auto size-3.5 shrink-0" /> : null}
          </span>
        </button>
        {preset.custom ? (
          <button
            type="button"
            onClick={() => removeImported(preset.id)}
            className="bg-background text-muted-foreground hover:text-destructive absolute top-3 right-3 hidden size-6 items-center justify-center rounded-md border border-border group-hover:flex"
            aria-label={t('Supprimer {name}', { name: preset.label })}
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <SettingsPage wide title={t('Apparence et langue')} description={t('Langue, mode clair ou sombre, thème de couleurs et raccourcis clavier.')}>
      <Card id="langue" title={t('Langue')} description={t('La langue de toute l’application, notifications et résumés de l’IA compris.')}>
        <div className="grid grid-cols-2 gap-3">
          {LOCALES.map((l) => (
            <button
              key={l.id}
              onClick={() => l.id !== locale && void setLanguage(l.id)}
              aria-pressed={locale === l.id}
              className={cn('rounded-lg border p-4 text-[13px] transition-colors', locale === l.id ? 'border-primary bg-accent ring-2 ring-ring/30' : 'border-border hover:bg-accent')}
            >
              {l.label}
            </button>
          ))}
        </div>
      </Card>

      <Card title={t('Mode')}>
        <div className="grid grid-cols-3 gap-3">
          {[
            { id: 'light', label: t('Clair'), icon: Sun },
            { id: 'dark', label: t('Sombre'), icon: Moon },
            { id: 'system', label: t('Système'), icon: Monitor },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              aria-pressed={theme === id}
              className={cn('flex flex-col items-center gap-2 rounded-lg border p-4 text-[13px] transition-colors', theme === id ? 'border-primary bg-accent ring-2 ring-ring/30' : 'border-border hover:bg-accent')}
            >
              <Icon className="size-5" />
              {label}
            </button>
          ))}
        </div>
      </Card>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="space-y-6">
        <Card id="icones" title={t('Icônes')} description={t('La bibliothèque d’icônes de toute l’application : barre latérale, catégories, réglages. Toutes gratuites et libres.')}>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2" onMouseLeave={() => setHoveredIcons(null)}>
            {ICON_LIBRARIES.map((library) => {
              const selected = icons.current === library.id;
              return (
                <button
                  key={library.id}
                  type="button"
                  onMouseEnter={() => setHoveredIcons(library.id)}
                  onClick={() => icons.choose(library.id)}
                  aria-pressed={selected}
                  className={cn('rounded-lg border p-3 text-left transition-colors', selected ? 'border-primary ring-2 ring-ring/30' : 'border-border hover:bg-accent')}
                >
                  <IconLibraryPreview.Provider value={library.id}>
                    <span className="text-foreground/85 flex items-center gap-2.5" aria-hidden>
                      {['_inbox', 'flame', 'reply', 'bell', 'package', 'calendar', 'tag', '_settings'].map((key) => (
                        <SolarIcon key={key} name={key} className="size-[18px]" />
                      ))}
                    </span>
                  </IconLibraryPreview.Provider>
                  <span className="mt-2.5 flex items-center gap-1.5 text-[13px] font-medium">
                    {library.label}
                    {library.id === 'akar-icons' ? <span className="text-muted-foreground text-[11px] font-normal">· {t('par défaut')}</span> : null}
                    {selected ? <Check className="text-primary ml-auto size-3.5" /> : null}
                  </span>
                  <span className="text-muted-foreground block text-[11.5px]">
                    {t(library.hint)} · {library.license}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
        <Card id="theme" title={t('Thème de couleurs')} description={t('{n} thèmes shadcn/ui, dont ceux de tweakcn.com. Chacun s’applique à toute l’application, en clair comme en sombre.', { n: PRESETS.length })}>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
            {imported.map(tile)}
            {PRESETS.map(tile)}
          </div>
        </Card>
        </div>
        <div className="space-y-2 xl:sticky xl:top-4">
          <IconLibraryPreview.Provider value={hoveredIcons}>
            <ThemeAppPreview preset={hovered ?? current} mode={mode} />
          </IconLibraryPreview.Provider>
          <p className="text-muted-foreground px-1 text-[12px]">
            {hoveredIconLabel && hoveredIcons !== icons.current
              ? t('Aperçu des icônes : {name} — cliquez pour l’appliquer.', { name: hoveredIconLabel })
              : hovered && hovered.id !== current.id ? t('Aperçu : {name} — cliquez pour l’appliquer.', { name: hovered.label }) : mode === 'dark' ? t('Thème actuel : {name} (sombre).', { name: current.label }) : t('Thème actuel : {name} (clair).', { name: current.label })}
          </p>
        </div>
      </div>

      <Card
        id="importer-un-theme"
        title={t('Importer un thème tweakcn')}
        description={t('Créez ou modifiez un thème sur tweakcn.com, cliquez sur « Code », copiez le CSS et collez-le ici.')}
        action={
          <Button variant="outline" size="xs" asChild>
            <a href="https://tweakcn.com/editor/theme" target="_blank" rel="noreferrer">
              <ExternalLink />
              {t('Ouvrir tweakcn')}
            </a>
          </Button>
        }
      >
        <div className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Nom du thème')} className="h-9" />
          <Textarea value={css} onChange={(e) => setCss(e.target.value)} rows={6} placeholder={':root {\n  --background: oklch(1 0 0);\n  --primary: oklch(0.6 0.2 260);\n  …\n}\n.dark { … }'} className="font-mono text-[12px]" />
          <div className="flex justify-end">
            <Button size="sm" onClick={doImport} disabled={!css.trim()}>
              <Upload />
              {t('Importer et appliquer')}
            </Button>
          </div>
        </div>
      </Card>

      <Card title={t('Raccourcis clavier')}>
        <ul className="grid grid-cols-2 gap-x-8 gap-y-2">
          {SHORTCUTS.map(([keys, label]) => (
            <li key={label} className="flex items-center justify-between text-[13px]">
              <span className="text-muted-foreground">{label}</span>
              <kbd className="bg-muted rounded-md px-1.5 py-0.5 font-sans text-[11.5px]">{keys}</kbd>
            </li>
          ))}
        </ul>
      </Card>
    </SettingsPage>
  );
}
