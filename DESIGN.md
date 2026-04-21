# DESIGN.md

Source of truth for the Green Gate V1 design system. Extracted 2026-04-21 from
`frontend/src/app/globals.css`, the `Os*` primitive components, and decisions
captured in /plan-design-review runs.

**Target audience**: engineers adding UI to the authenticated portal.
**Scope**: V1 emerald dark theme only. V2/V3 themes are abandoned.

---

## Theme classifier

The portal is **App UI** — workspace-driven, data-dense, task-focused. Not
marketing, not a landing page. When in doubt, apply the App UI rules below and
skip hero/brand patterns.

## Colors

All colors live as CSS variables on `[data-skin="emerald"]` in `globals.css`.
Never hardcode hex in components — use the token that expresses intent.

### Surfaces (background → elevated)

| Token | Hex | Usage |
|---|---|---|
| `--os-bg` | `#0A1110` | Page background |
| `--os-surface` | `#111C18` | Cards, panels |
| `--os-surface-2` | `#13231D` | Elevated cards, hover states, skeleton shimmer |
| `--os-surface-3` | `#1A2E25` | Max-elevation, active states |

### Borders

| Token | Value | Usage |
|---|---|---|
| `--os-border` | `rgba(255,255,255,0.06)` | Default surface border |
| `--os-border-strong` | `rgba(255,255,255,0.12)` | Hover, focused, active borders |

### Text

| Token | Hex | Contrast on `--os-bg` | Usage |
|---|---|---|---|
| `--os-text-primary` | `#FFFFFF` | 19:1 AAA | Primary copy, values |
| `--os-text-secondary` | `#E2E8F0` | 14:1 AAA | Secondary copy |
| `--os-text-muted` | `#A8B8CC` | 5.8:1 AA | Labels, hints |
| `--os-text-dim` | `#8A9BB0` | 4.6:1 AA | Deemphasized muted |

### Brand

| Token | Hex | Usage |
|---|---|---|
| `--os-brand-green` | `#10B981` | Primary accent, success, positive action |
| `--os-brand-cyan` | `#34D399` | Secondary accent (used sparingly) |
| `--ais-yellow` | `#EAB308` | Warning, "due soon", highlights |

### Semantic status

| Token | Hex | Usage |
|---|---|---|
| `--os-green` | `#10B981` | Paid, compliant, online, OK |
| `--os-red` | `#EF4444` | Overdue, non-compliant, offline, danger |
| `--os-orange` | `#F97316` | Processing, in-progress |
| `--os-yellow` | `#EAB308` | Approaching, pending, warning |
| `--os-blue` | `#3B82F6` | Exempt, info, neutral status |

**Usage rule**: one accent color per screen default. Adding a 4th status color
breaks the calm-surface hierarchy. Justify each additional accent.

---

## Typography

### Font stack

```css
--ais-font: var(--font-plex), var(--font-plex-arabic), 'Segoe UI', sans-serif;
```

- **Plex Sans** — Latin / Cyrillic text
- **Plex Arabic** — Arabic RTL rendering (wired via `<Html dir="rtl">` on `ar` locale)
- **Segoe UI** — Windows fallback
- **Never use**: Inter, Roboto, Arial, system-ui (AI-slop defaults)

### Scale

Tailwind defaults, used as follows:

| Class | Size | Usage |
|---|---|---|
| `text-[64px]` | 64px | Visual anchor only (NextPaymentCard days-remaining) |
| `text-2xl` | 24px | Stat card value (OsStatCard) |
| `text-xl` | 20px | Page H1 |
| `text-lg` | 18px | Secondary numeric (NextPaymentCard amount) |
| `text-base` | 16px | Body copy in cards |
| `text-sm` | 14px | Default UI copy |
| `text-xs` | 12px | Table cells, sub copy |
| `text-[11px]` | 11px | OsBadge, OsStatCard delta |
| `text-[10px]` | 10px | Uppercase labels (tracking-widest) |

### Labels — the "small-caps" pattern

Recurring pattern for section / stat labels:

```tsx
<span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
    {label}
</span>
```

This signals a label (vs data). Re-use this class string unchanged for
consistency. Do NOT invent new label styles.

---

## Spacing

Tailwind scale. Conventions:

| Context | Spacing |
|---|---|
| Page padding | `p-5` (20px) |
| Card padding | `p-4` or `p-6` for emphasis cards |
| Card gap (grid) | `gap-5` (20px) on desktop, `gap-3` (12px) on mobile |
| Inline icon gap | `gap-1.5` (6px) for dense, `gap-2` (8px) for comfortable |
| Section vertical rhythm | `gap-5` inside `flex flex-col` page layouts |

---

## Layout breakpoints

- Mobile (< 768px): everything stacks vertically
- Tablet (768-1279): 2-column grids, table retains horizontal scroll
- Desktop (≥ 1280, `xl:`): 3-column grids (2/3 + 1/3 pattern for armateur dashboard)

**Dashboard armateur grid**: `grid grid-cols-1 xl:grid-cols-3 gap-5`, with the
primary widget taking `xl:col-span-2` and the stat column taking `xl:col-span-1`.

**Sidebar**: fixed `--os-sidebar-w: 56px`, icon-only, expandable on hover.

---

## Primitives (`Os*`)

Located in `frontend/src/components/ui/`. Compose from these before building
custom elements. If a new primitive is needed, it earns its place when 3+
callers would use it.

### Reference

| Primitive | Props summary | Use when |
|---|---|---|
| `OsButton` | `variant=primary\|secondary\|ghost\|danger\|outline`, `size`, `loading`, `icon`, `iconRight` | Any interactive click target |
| `OsCard` | `className`, header children | Container for a bounded info unit |
| `OsBadge` | `variant`, `label`, `dot`, `size` | Status indicator in tables / cards |
| `OsStatCard` | `label`, `value`, `delta`, `unit`, `icon`, `highlight` | Numeric KPI |
| `OsInput` + `OsSelect` | standard form props | Forms |
| `OsTable<T>` | `columns`, `rows`, `keyExtractor`, `onRowClick`, `emptyMessage`, `loading` | Data list with sort/filter |
| `OsTabs` + `OsTabsList/Trigger/Content` | radix-tabs-based | Tabbed panel inside cards / slide-overs |

### One accent rule

`OsButton` variants exist for a reason — staff "generate" and armateur "view"
both use `variant="primary"` because they're both positive primary actions.
Do NOT reserve a different variant "just so they look different." Affordance is
carried by **copy**, not color.

---

## Status → color mapping

Mirrors `--os-*` tokens. Always wrap in `OsBadge` with the matching variant
rather than hand-rolling the color.

| Status | Variant | Color |
|---|---|---|
| `PAID`, `COMPLIANT`, `OK`, `ONLINE` | `paid` / `compliant` / `online` | `--os-green` |
| `PENDING`, `DUE_SOON`, `WARNING` | `pending` / `warning` | `--ais-yellow` |
| `OVERDUE`, `NON_COMPLIANT`, `CRITICAL` | `overdue` / `critical` | `--os-red` |
| `PROCESSING` | `processing` | `--os-orange` |
| `EXEMPT`, `DISPUTED`, `INFO`, `DRAFT` | `exempt` / `info` | `--os-blue` |

---

## Days-remaining color ramp (armateur pattern)

Used by `NextPaymentCard` to signal payment urgency on the 64px days-remaining
anchor. Re-use this pattern for any "countdown-to-deadline" visual.

```ts
if (days <= 0) return 'text-[var(--os-red)]';      // OVERDUE — act now
if (days <= 5) return 'text-[var(--ais-yellow)]';  // soon — prepare
return 'text-[var(--os-text-primary)]';            // comfortable — calm
```

Do not color below 1-5 days with yellow (too much noise); do not color 1+
overdue days with orange (mixed message — red is unambiguous).

---

## Patterns

### Empty states are features

Every empty state must have:
1. **Visual anchor** — lucide icon 40px in an intent color (green for "all
   good", muted for "no data yet"). No custom SVG illustrations in V1.
2. **Headline** — what the state *means* (not "No items found"). E.g. "Compte
   à jour", "Aucun paiement sur ce vessel".
3. **Sub copy** — one sentence explaining why it's empty.
4. **CTA (when applicable)** — one action that's valuable from the empty state.
   E.g. "Simuler un paiement" from the "Compte à jour" empty.

Negative example (don't):
```tsx
<div>No items found.</div>
```

Positive example (NextPaymentCard empty state):
```tsx
<Link href="/dashboard/simulator" className="os-card p-6 flex flex-col items-center gap-3">
  <CheckCircle2 className="w-10 h-10 text-[var(--os-brand-green)]" aria-hidden />
  <div className="text-base font-semibold text-[var(--os-text-primary)]">Compte à jour</div>
  <div className="text-xs text-[var(--os-text-muted)]">Aucun paiement en cours pour vos vessels.</div>
  <div className="text-xs text-[var(--os-brand-green)]">Simuler un paiement →</div>
</Link>
```

### Banners

Two kinds:

**Info banner** (onboarding, hints) — left-border accent, subtle gradient background:
```tsx
<div className="os-card p-4 flex items-center justify-between gap-4
                border-l-2 border-l-[var(--os-brand-green)]
                bg-gradient-to-r from-[var(--os-surface-2)] to-[var(--os-surface)]">
```

**Alert banner** (overdue, error) — border-non-fill + `role="alert"` for SR announcement:
```tsx
<div role="alert" className="os-card p-4
                             border border-[var(--os-red)]/40
                             bg-[var(--os-red)]/5">
```

**Never** use solid-fill red/yellow backgrounds — too saturating, signals panic.

### Role-aware rendering

UI decisions that depend on the signed-in role should read from `useRole()` and
branch **in the component**, not in the data layer. This lets the hooks stay
generic and lets components express intent.

```tsx
// Good
const { role } = useRole();
const isArmateur = role === UserRole.SHIPPING_AGENT;
return isArmateur ? <ArmateurFoo /> : <StaffFoo />;

// Bad — couples data layer to UI decision
const data = useFoo(role === 'SHIPPING_AGENT' ? 'armateur' : 'staff');
```

For **data** scoping, prefer RLS over client-side filters. The SSR-scoped
Supabase client already returns owner-scoped rows to `SHIPPING_AGENT` — don't
add a second filter in the service layer.

---

## Motion policy

Calm-surface App UI. Budget:

| Transition | Duration | Easing |
|---|---|---|
| Data reveal (skeleton → content) | `duration-150` | `ease` (default) |
| Hover on card | `duration-150` | `ease` |
| Tab switch (OsTabs) | instant — no transition |
| Slide-over (radix-dialog) | `duration-200` | `ease-out` |
| Button hover | `duration-150` | `ease` |

**Never**: bouncing numbers, spring on mount, card tilt on hover, shimmer on
static content, scroll-linked parallax. Those are slop patterns for B2G /
App UI contexts.

---

## Accessibility baseline

| Concern | Requirement |
|---|---|
| Contrast | WCAG AA minimum (4.5:1 for body, 3:1 for large) |
| Touch target | 44×44px minimum on mobile (check `OsButton` size sm) |
| Focus ring | `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-brand-green)]` — never remove without replacement |
| Status info | Never color-only — always a text label alongside (`OsBadge` enforces this) |
| Tabs | Use `OsTabs` (radix-based) — arrow keys + ARIA roles included |
| Disabled buttons | `aria-disabled="true"` + tooltip via `title` attribute, not display:none |
| Live regions | `role="alert"` on overdue banners so SR announces on page load |
| RTL | Arabic locale sets `dir="rtl"` at `<Html>` — never override direction on child elements |

---

## i18n

- 5 locales: `en`, `fr`, `pt`, `sw`, `ar` (see `frontend/src/navigation.ts`)
- RTL: `ar` only; other locales are LTR
- `next-intl` message namespaces grouped by component (e.g. `NextPaymentCard`,
  `ProformaActionButton`)
- Every new user-facing string adds the key to **all 5** locale files —
  untranslated strings render the key verbatim, a UX bug at deploy time
- Use plural formatting for count-dependent strings:
  `{count, plural, =1 {1 item} other {# items}}`
- Never hardcode text in JSX — always `t('key')` from a namespace
- Native-speaker review for `ar` and `sw` is a TODO (see `TODOS.md`)

---

## File conventions

```
frontend/src/
  components/
    ui/                    ← primitives (Os*)
    dashboard/
      overview/            ← home widgets (KPIs, map, NextPaymentCard, banners)
      fleet/               ← vessel list + detail views
      invoices/            ← /dashboard/invoices
      shared/              ← cross-page components (ProformaActionButton)
  hooks/                   ← data hooks returning DataSourceResult<T>
  services/                ← Supabase queries (no React)
  lib/
    RoleContext.tsx        ← useRole() — source of truth for signed-in role
  types/secure/            ← domain types + mappers
  app/(dashboard)/         ← authenticated pages
  app/(auth)/              ← login + onboarding
```

---

## When you're about to add a new primitive

Before creating `Os<Thing>`:
1. Can it be composed from existing primitives?
2. Will 3+ different callers use it? (If only 1-2, keep it inline where used.)
3. Does it need new design tokens? If yes, add tokens to `globals.css` FIRST,
   document them here, then build the primitive.
4. Does it duplicate something radix-ui ships? Use the radix version and thin-
   wrap it for style (see `OsTabs`).

---

## References

- `frontend/src/app/globals.css` — CSS variable source
- `frontend/src/components/ui/` — primitive implementations
- `TODOS.md` — deferred design debt (native-speaker i18n review, live /design-review QA)
- /plan-design-review transcripts in `~/.ostack/projects/htleclerc-africgreen/`
