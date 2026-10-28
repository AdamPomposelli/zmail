# Theming rules (shadcn/ui + tweakcn)

A theme is only the CSS variables in `app/globals.css` (same names as tweakcn.com exports).
`lib/themes` swaps them at runtime. So **no colour, radius, shadow or font may be hard-coded**
in components: always go through the Tailwind tokens below.

## Token mapping

| Was (hard-coded) | Use |
|---|---|
| `bg-white`, `bg-panelLight`, `dark:bg-panelDark`, `dark:bg-[#1f1f1f]`, `bg-[#…]` for a surface | `bg-background` (main panels) · `bg-card` (cards, composer) · `bg-popover` (menus, floating) |
| app chrome behind panels, `bg-sidebar` | `bg-sidebar` (unchanged) |
| subtle fill `bg-black/[0.03–0.06] dark:bg-white/[0.04–0.08]` | `bg-muted` (static) · `bg-accent` (selected/active) |
| hover fill `hover:bg-black/[…] dark:hover:bg-white/[…]` | `hover:bg-accent hover:text-accent-foreground` (in the sidebar: `hover:bg-sidebar-accent`) |
| active nav item | `bg-sidebar-accent text-sidebar-accent-foreground` |
| selected row in a list (mails) | `bg-muted` — never `bg-accent` with muted text: some themes have a vivid accent |
| `border-black/[…] dark:border-white/[…]`, `divide-black/[…]` | `border-border`, `divide-border` |
| `ring-1 ring-black/[…] dark:ring-white/[…]` (outlines) | `border border-border` or `ring-1 ring-border` |
| custom `shadow-[0_0_0_1px_…,0_1px_3px_…]` | `border border-border shadow-xs` / `shadow-sm` / `shadow-md` / `shadow-lg` |
| blue actions `bg-[#006FFE] hover:bg-[#0062e0] text-white` | `bg-primary text-primary-foreground hover:bg-primary/90` |
| blue text/links/focus `text-[#006FFE]`, `ring-[#006FFE]/40` | `text-primary`, `ring-ring/50` |
| `text-white` on a coloured fill | the matching `*-foreground` token |
| greys `text-zinc-*`, `text-black/60`, `text-white/70` | `text-muted-foreground` / `text-foreground` |
| success greens `emerald-*`, `green-*` | `text-success`, `bg-success/10`, `bg-success text-success-foreground` |
| warnings `amber-*`, `yellow-*`, `orange-*` (status, not data) | `text-warning`, `bg-warning/10`, `border-warning/30` |
| errors `rose-*`, `red-*` | `text-destructive`, `bg-destructive/10`, `bg-destructive text-destructive-foreground` |
| AI accent `violet-*`, `fuchsia-*`, `purple-*`, AI gradients | `text-ai`, `bg-ai/10`, `bg-ai text-ai-foreground` (no gradients) |
| `rounded-2xl` on panels that touch the window edge | `rounded-panel` |
| other radii | `rounded-sm/md/lg/xl` (they follow `--radius`) — avoid `rounded-[…px]` except pills (`rounded-full`) |
| fonts | `font-sans` / `font-mono` / `font-serif` only |

## Allowed exceptions (data, not theme)
- Tag colours, business colours, account colours: user data, stay inline `style={{ color }}`.
- Brand logos (`components/brand-logo.tsx`) keep their official colours.
- Mail HTML in `email-body.tsx` iframe keeps its own rendering logic.

## Style
Premium and sober (Linear / Superhuman / Vercel): monochrome icons (`text-muted-foreground`,
lucide stroke 1.5 via `.lucide` in globals.css), no rainbow icons, no emoji-like colour blobs,
colour only to carry meaning (status, data, primary action). Prefer shadcn primitives from
`components/ui/*` (Button, Badge, Card, Input, Dialog, DropdownMenu, Tooltip…) over hand-made ones.
