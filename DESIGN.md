# Design

Source: the "SaaS CRM UI Kit" Figma file the owner chose (file key `6dFxRBgxIo5fwLfWQTcLXx`), adapted for Hebrew right-to-left and WCAG AA. All values live as tokens in `src/app/globals.css`; components never use raw colors.

## Color

| Token | Light | Use |
|---|---|---|
| `--bg` | `#F5F6F8` | Page background |
| `--surface` | `#FFFFFF` | Cards, sidebar, top bar |
| `--ink` | `#192A3E` | Primary text |
| `--ink-2` | `#334D6E` | Navigation text |
| `--muted` | `#6A707E` | Secondary text, table headers |
| `--icon` | `#C2CFE0` | Idle icons only, never text |
| `--line` | `#EBEFF2` | Dividers |
| `--brand` | `#109CF1` | Kit blue: active nav bar and icon, focus ring, chart fills. Never small text (2.98:1). |
| `--accent` | `#0A73B5` | Buttons, links, active text. Kit blue darkened to 5.08:1 against white. |
| `--dot-ok / warn / danger / info` | `#2ED47A` `#FFB946` `#F7685B` `#885AF8` | Kit status colors for dots, bars and charts |
| `--ok / warn / danger / info` (+ `-soft`) | darkened kit hues | Badge text on tinted backgrounds, all ≥4.5:1 |

Dark mode keeps the same roles on a navy surface (`#0F151D` / `#1A2433`) and swaps shadows for a 1px line.

## Type

Poppins (400/500/600) for Latin letters and digits, Rubik for Hebrew through the font stack. Page titles are 22px medium; body 14px; meta 11–13px. Tabular figures everywhere.

## Shape and depth

- Cards: white, 6px radius, no border, shadow `0 6px 18px rgb(0 0 0 / .06)`.
- Buttons and inputs: 40px tall, 4px radius. Primary carries the blue shadow `0 4px 10px rgb(16 156 241 / .24)`.
- Sidebar: 256px, white, shadow toward the content; logo row 60px; profile block (46px avatar, name, email, org and role); nav rows 40px with a 3px brand bar on the active item; settings under a divider; sign-out at the foot.
- Top bar: 60px white, borderless search with icon, notification bell at the far end.

## Components

- Tables: white header with muted 13px labels, 64px rows, hover to `--surface-2`.
- Filter tabs: active is `--accent-soft` with `--accent` text.
- Ticket thread: customer messages are filled `--accent` bubbles with white text; team replies are white bordered bubbles; internal notes are dashed amber.
- Avatars: initials on deepened kit hues, stable per name.
