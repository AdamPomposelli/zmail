import { Check, ImageUp, Search, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { TAG_ICONS, customIcon } from '@/lib/tag-icons';
import { PALETTE, cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * One picker for every icon of the sidebar (categories, fixed views, accounts), Notion-like:
 * an icon from the library in a colour, an emoji, or your own image (PNG, JPEG, SVG, WebP,
 * animated GIF). Values: an icon name, « emoji:🎯 », « image:data:image/… ».
 *
 * The current icon is shown at the top; « Retirer » sits right next to it, in red, and only
 * when there is something to remove — never a vague « Remove » lost on the right.
 */
export function IconPicker({
  title,
  value,
  color,
  onChange,
  onColor,
  fallback,
  extraTab,
  dot = false,
  preview: previewOverride,
}: {
  title: string;
  value: string | null;
  /** The colour library icons are drawn in; null hides the colour row. */
  color?: string | null;
  onChange: (value: string | null) => void;
  onColor?: (color: string) => void;
  /** What « no icon » looks like (the default icon), shown in the preview. */
  fallback: ReactNode;
  /** A tab of its own (accounts: brand logos and the company's logo). */
  extraTab?: { label: string; content: ReactNode; active?: boolean };
  /** Offer the plain coloured dot (categories). */
  dot?: boolean;
  /** Draws the current icon when the caller knows better (an account's brand logo). */
  preview?: ReactNode;
}) {
  const initial = value?.startsWith('emoji:') ? 'emoji' : value?.startsWith('image:') ? (extraTab?.active ? 'extra' : 'image') : extraTab?.active ? 'extra' : 'icons';
  const [tab, setTab] = useState<'icons' | 'emoji' | 'image' | 'extra'>(initial);
  const tint = color ?? undefined;
  const preview = previewOverride ?? (value ? (customIcon(value, undefined, 22) ?? renderLibrary(value, tint, 22)) : fallback);

  const tabs: { id: typeof tab; label: string }[] = [
    { id: 'icons', label: t('Icônes') },
    { id: 'emoji', label: t('Emoji') },
    { id: 'image', label: t('Image') },
    ...(extraTab ? [{ id: 'extra' as const, label: extraTab.label }] : []),
  ];

  return (
    <div className="w-[320px]">
      {/* What it looks like now, and how to take it off. */}
      <div className="flex items-center gap-3 pb-3">
        <span className="bg-muted ring-border flex size-10 shrink-0 items-center justify-center rounded-xl ring-1">{preview}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{title}</p>
          <p className="text-muted-foreground text-[11.5px]">
            {!value ? t('Icône par défaut') : value.startsWith('emoji:') ? t('Emoji') : value.startsWith('image:') ? t('Image importée') : value.startsWith('brand:') ? t('Logo de marque') : t('Icône')}
          </p>
        </div>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-destructive hover:bg-destructive/10 flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors"
            title={t('Revenir à l’icône par défaut')}
          >
            <Trash2 className="size-3.5" /> {t('Retirer')}
          </button>
        ) : null}
      </div>

      <div className="bg-muted mb-3 grid rounded-lg p-0.5 text-[12px]" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map((x) => (
          <button key={x.id} type="button" onClick={() => setTab(x.id)} className={cn('rounded-md py-1 transition-colors', tab === x.id ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            {x.label}
          </button>
        ))}
      </div>

      {tab === 'icons' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-10 gap-0.5">
            {dot ? (
              <Cell selected={!value} onClick={() => onChange(null)} label={t('Pastille de couleur')}>
                <span className="size-2 rounded-full" style={{ backgroundColor: tint ?? 'currentColor' }} />
              </Cell>
            ) : null}
            {Object.entries(TAG_ICONS).map(([name, Icon]) => (
              <Cell key={name} selected={value === name} onClick={() => onChange(name)} label={name}>
                <Icon className="size-4" style={{ color: tint }} />
              </Cell>
            ))}
          </div>
          {color !== null && onColor ? (
            <div className="grid grid-cols-12 gap-1">
              {PALETTE.map((c) => (
                <button key={c} type="button" onClick={() => onColor(c)} className="flex aspect-square w-full items-center justify-center rounded-full" style={{ backgroundColor: c }} aria-label={c}>
                  {/* White on a user-data swatch (not a theme surface): readable on every colour. */}
                  {color === c ? <Check className="size-3.5 text-white" /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : tab === 'emoji' ? (
        <EmojiGrid value={value} onPick={(e) => onChange(`emoji:${e}`)} />
      ) : tab === 'image' ? (
        <ImageDrop onImage={(src) => onChange(`image:${src}`)} />
      ) : (
        extraTab?.content
      )}
    </div>
  );
}

function renderLibrary(name: string, color: string | undefined, size: number) {
  const Icon = TAG_ICONS[name];
  return Icon ? <Icon style={{ width: size, height: size, color }} /> : null;
}

function Cell({ selected, onClick, label, children }: { selected: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={cn('hover:bg-accent flex size-7 items-center justify-center rounded-md', selected && 'bg-accent ring-border ring-1')}>
      {children}
    </button>
  );
}

/** Emoji with a few words each (French and English), to find one by typing. */
const EMOJI: [string, string][] = [
  ['📥', 'inbox boîte réception'], ['📨', 'mail courrier entrant'], ['✉️', 'mail lettre enveloppe'], ['📧', 'email'], ['📬', 'boîte aux lettres mailbox'], ['📮', 'poste'],
  ['⭐', 'étoile star favori'], ['🌟', 'étoile brillante'], ['🔥', 'feu urgent important fire'], ['⚡', 'éclair rapide flash'], ['🎯', 'cible objectif target'], ['🚨', 'alerte urgence alarm'],
  ['❗', 'important attention'], ['❓', 'question'], ['✅', 'fait done valide check'], ['☑️', 'case cochée'], ['⏰', 'réveil rappel alarm'], ['⏳', 'attente sablier pending'],
  ['📅', 'calendrier date calendar'], ['🗓️', 'agenda planning'], ['🤝', 'accord partenariat deal handshake'], ['💼', 'business travail work'], ['🏢', 'entreprise bureau company office'], ['🏭', 'usine factory'],
  ['💰', 'argent money'], ['💵', 'dollar billet'], ['💶', 'euro billet'], ['💳', 'carte paiement card payment'], ['🧾', 'facture reçu invoice receipt'], ['📈', 'croissance hausse growth chart'],
  ['📉', 'baisse chart'], ['📊', 'statistiques graphique stats'], ['🏦', 'banque bank'], ['⚖️', 'litige justice legal dispute'], ['🛡️', 'sécurité bouclier security'], ['🔒', 'cadenas verrouillé lock'],
  ['🔑', 'clé code key otp'], ['🔐', 'sécurisé secure'], ['🛒', 'panier achat shopping cart'], ['🛍️', 'shopping sacs'], ['📦', 'colis livraison package delivery'], ['🚚', 'camion livraison truck'],
  ['✈️', 'avion voyage plane travel'], ['🚆', 'train'], ['🚗', 'voiture car'], ['🏠', 'maison home'], ['🏡', 'maison jardin house'], ['🏖️', 'vacances plage holiday'],
  ['🌍', 'monde world globe'], ['📰', 'journal news newsletter'], ['🗞️', 'presse journal'], ['📣', 'annonce marketing megaphone'], ['📢', 'haut-parleur annonce'], ['🔔', 'cloche notification bell'],
  ['🔕', 'silence mute'], ['💬', 'message chat bulle'], ['🗨️', 'discussion'], ['📞', 'téléphone appel phone'], ['📱', 'mobile smartphone'], ['💻', 'ordinateur laptop'],
  ['🖥️', 'écran desktop'], ['⌨️', 'clavier keyboard'], ['🧑‍💻', 'développeur developer code'], ['🐛', 'bug'], ['⚙️', 'réglages settings gear'], ['🔧', 'outil clé tool'],
  ['🛠️', 'outils tools'], ['🧰', 'boîte à outils toolbox'], ['📝', 'note memo écrire'], ['📄', 'document page'], ['📎', 'trombone pièce jointe attachment'], ['📌', 'épingle pin'],
  ['📁', 'dossier folder'], ['🗂️', 'classeur archive'], ['🗃️', 'archives boîte'], ['🗑️', 'corbeille poubelle trash'], ['🧹', 'ménage nettoyage clean'], ['✂️', 'ciseaux'],
  ['🎓', 'école études diplôme school'], ['📚', 'livres books'], ['📖', 'lecture livre read'], ['🎨', 'design art peinture'], ['🎬', 'film vidéo video'], ['🎵', 'musique music'],
  ['🎮', 'jeu game'], ['⚽', 'sport football'], ['🏋️', 'sport gym'], ['🍽️', 'restaurant repas'], ['☕', 'café coffee'], ['🍕', 'pizza'],
  ['❤️', 'cœur amour heart love'], ['💙', 'cœur bleu'], ['💚', 'cœur vert'], ['🧡', 'cœur orange'], ['💜', 'cœur violet'], ['🖤', 'cœur noir'],
  ['👨‍👩‍👧', 'famille family'], ['👥', 'équipe personnes team people'], ['👤', 'personne contact'], ['🙋', 'question main levée'], ['👋', 'bonjour salut hello'], ['🙏', 'merci thanks'],
  ['👍', 'ok pouce like'], ['👀', 'à voir regarder look'], ['🧠', 'cerveau idée brain'], ['💡', 'idée ampoule idea'], ['🚀', 'fusée lancement launch rocket'], ['🏆', 'trophée victoire win'],
  ['🎁', 'cadeau gift'], ['🎉', 'fête célébration party'], ['✨', 'magie ia sparkles ai'], ['🤖', 'robot ia ai bot'], ['🔮', 'boule prédiction'], ['🧪', 'test labo lab'],
  ['🩺', 'santé médecin health'], ['💊', 'médicament santé'], ['🏥', 'hôpital'], ['🌱', 'plante croissance plant'], ['🌸', 'fleur flower'], ['☀️', 'soleil sun'],
  ['🌙', 'lune nuit moon'], ['❄️', 'neige hiver snow'], ['🌈', 'arc-en-ciel rainbow'], ['🐶', 'chien dog'], ['🐱', 'chat cat'], ['🦄', 'licorne unicorn'],
  ['🔴', 'rouge rond red'], ['🟠', 'orange rond'], ['🟡', 'jaune rond yellow'], ['🟢', 'vert rond green'], ['🔵', 'bleu rond blue'], ['🟣', 'violet rond purple'],
  ['⚫', 'noir rond black'], ['⚪', 'blanc rond white'], ['🟥', 'carré rouge'], ['🟩', 'carré vert'], ['🟦', 'carré bleu'], ['🏳️', 'drapeau flag'],
  ['🇫🇷', 'france drapeau'], ['🇪🇺', 'europe'], ['🇺🇸', 'usa états-unis'], ['🇬🇧', 'royaume-uni uk'], ['🇩🇪', 'allemagne germany'], ['🇪🇸', 'espagne spain'],
];

function EmojiGrid({ value, onPick }: { value: string | null; onPick: (emoji: string) => void }) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return q ? EMOJI.filter(([e, words]) => e === q || words.normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q)) : EMOJI;
  }, [query]);
  return (
    <div className="space-y-2">
      <label className="border-border focus-within:ring-ring/40 flex h-8 items-center gap-2 rounded-md border px-2.5 focus-within:ring-2">
        <Search className="text-muted-foreground size-3.5" />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Chercher : facture, voyage, urgent…')} className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none" />
      </label>
      <div className="grid max-h-[200px] grid-cols-9 gap-0.5 overflow-y-auto">
        {shown.map(([emoji]) => (
          <Cell key={emoji} selected={value === `emoji:${emoji}`} onClick={() => onPick(emoji)} label={emoji}>
            <span className="text-[17px] leading-none">{emoji}</span>
          </Cell>
        ))}
        {shown.length === 0 ? <p className="text-muted-foreground col-span-9 py-4 text-center text-[12px]">{t('Aucun emoji pour « {q} »', { q: query })}</p> : null}
      </div>
    </div>
  );
}

/** Drop or choose an image; kept light so it lives with the settings. */
function ImageDrop({ onImage }: { onImage: (src: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = async (file: File | undefined) => {
    if (!file) return;
    try {
      onImage(await toIconDataUrl(file));
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  return (
    <div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void take(e.dataTransfer.files[0]);
        }}
        className={cn('border-border hover:bg-accent/50 flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-center transition-colors', over && 'border-primary bg-primary/5')}
      >
        <ImageUp className="text-muted-foreground size-5" />
        <span className="text-[12.5px] font-medium">{t('Glissez une image ici, ou cliquez')}</span>
        <span className="text-muted-foreground text-[11.5px]">{t('PNG, JPEG, SVG, WebP ou GIF animé · 300 Ko max')}</span>
      </button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" className="hidden" onChange={(e) => (void take(e.target.files?.[0]), (e.target.value = ''))} />
    </div>
  );
}

/**
 * A picked image as a small data URL. Animated GIFs and SVGs are kept as they are (an animation
 * or a vector must not be flattened); other bitmaps are redrawn at 64 px.
 */
export async function toIconDataUrl(file: File): Promise<string> {
  const read = () =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(t('Image illisible')));
      reader.readAsDataURL(file);
    });
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
    if (file.size > 290_000) throw new Error(t('Image trop lourde (300 Ko maximum)'));
    return read();
  }
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error(t('Image illisible : choisissez un PNG, un JPEG, un SVG, un WebP ou un GIF.'));
  const bitmap = await createImageBitmap(file);
  const side = 64;
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d')!;
  const scale = Math.min(side / bitmap.width, side / bitmap.height);
  ctx.drawImage(bitmap, (side - bitmap.width * scale) / 2, (side - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
  return canvas.toDataURL('image/png');
}
