# Design

## Theme

Dark. Operator tool running on a server — ambient context is low-light focus, not bright office daylight. Background is near-black with very slight blue-grey tint (not warm). Surface layers stack upward in lightness: base → panel → card → elevated. No light mode.

## Color Palette

OKLCH throughout.

| Token | OKLCH | Role |
|---|---|---|
| `--bg` | `oklch(0.10 0.008 250)` | Page background (near-black, cool tint) |
| `--surface` | `oklch(0.14 0.008 250)` | Panel / sidebar backgrounds |
| `--surface-2` | `oklch(0.18 0.007 250)` | Card / row backgrounds |
| `--border` | `oklch(0.24 0.006 250)` | Dividers, table borders |
| `--border-subtle` | `oklch(0.20 0.005 250)` | Subtle separators |
| `--ink` | `oklch(0.96 0.004 250)` | Primary text |
| `--ink-2` | `oklch(0.72 0.008 250)` | Secondary text, labels |
| `--ink-3` | `oklch(0.50 0.008 250)` | Muted / disabled text |
| `--accent` | `oklch(0.72 0.17 155)` | Emerald — primary action, running status |
| `--accent-dim` | `oklch(0.22 0.06 155)` | Emerald tint bg (hover states, highlights) |
| `--ok` | `oklch(0.72 0.17 155)` | Success / done — same as accent |
| `--warn` | `oklch(0.78 0.14 85)` | Warning / slow / pending |
| `--error` | `oklch(0.65 0.20 25)` | Error / failed / banned |
| `--info` | `oklch(0.72 0.12 240)` | Info / idle / debug |

## Typography

One family: **Inter** (system-ui fallback). Weight does the hierarchy work.

| Role | Size | Weight | Color |
|---|---|---|---|
| Page heading | 1rem / 16px | 600 | `--ink` |
| Section label | 0.75rem / 12px | 500 | `--ink-3` (uppercase, 0.06em tracking) |
| Body / table cell | 0.875rem / 14px | 400 | `--ink` |
| Secondary / meta | 0.8125rem / 13px | 400 | `--ink-2` |
| Monospace (logs, IDs) | 0.8125rem / 13px | 400 | `--ink-2`, `font-family: 'JetBrains Mono', monospace` |
| Stat number | 1.5rem / 24px | 700 | `--ink` |

Line height: 1.5 for body. No decorative display type — this is a tool.

## Components

### Status badge
Pill with colored dot + label. Dot is 6px circle. Four states:
- `idle` → `--info` dot, `--ink-3` text
- `running` → `--accent` dot + pulse animation, `--accent` text
- `done` → `--ok` dot, `--ink-2` text
- `failed` / `banned` / `error` → `--error` dot, `--error` text

### Data table
Full-width, 40px row height. `--border-subtle` between rows. Hover: `--surface-2` row bg. Sticky header with `--surface` bg. Column headers: `--ink-3`, uppercase, 12px, 0.06em tracking.

### Sidebar nav
64px wide icon-only (collapsed) or 220px wide (expanded). Active item: `--accent-dim` bg + `--accent` left indicator (2px). Icon color: `--ink-3` default, `--ink` hover, `--accent` active.

### Log line
Monospace, 13px. Timestamp in `--ink-3`. Level indicator: colored prefix `[INFO]` / `[WARN]` / `[ERROR]`. Full line fades in on appear.

### Primary button
`--accent` bg, `--bg` text (near-black for contrast), no border. Hover: 8% brighter. 32px height, 8px h-padding, 4px radius.

### Action row (tables)
Icon buttons appear on row hover only. `--ink-3` default, `--ink` hover. No persistent action columns.

## Layout

Sidebar + main content shell. Sidebar fixed at left. Main area scrollable. Max content width: none (full width, with 24px padding). Data tables use full available width.

Z-index scale: `dropdown: 100` → `modal-backdrop: 200` → `modal: 300` → `toast: 400`.

## Motion

Minimal. Data tool; motion should not distract.
- Log line entrance: `opacity 0 → 1`, `translateY(4px) → 0`, `120ms ease-out`. Staggered only within a batch of new lines.
- Toast: slide in from bottom-right, `200ms ease-out`. Slide out `150ms ease-in`.
- Sidebar expand/collapse: `width` + `opacity` of labels, `200ms ease-out`.
- Status badge pulse (running only): `box-shadow` scale 0→6px, `1.4s` infinite, `ease-in-out`.
- `@media (prefers-reduced-motion: reduce)`: remove pulse, skip translate on log entrance (fade only).

## Spacing Scale

4px base unit. Common values: `4 8 12 16 24 32 48`. Sidebar padding: `16px`. Table cell padding: `10px 16px`. Card padding: `16px`.