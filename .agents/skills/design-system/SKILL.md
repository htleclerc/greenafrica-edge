# Os* Design System Specialist

## Trigger
When creating or modifying UI components, styling, theming, or layout.

## Context
- 6 primitives in `frontend/src/components/ui/`:
  - `OsBadge.tsx` — Status badges (COMPLIANT, PAYMENT_DUE, etc.)
  - `OsButton.tsx` — Button variants (primary/secondary/ghost/danger/outline)
  - `OsCard.tsx` — Card + CardHeader containers
  - `OsInput.tsx` — Input + Select form elements
  - `OsStatCard.tsx` — KPI stat card with delta indicator
  - `OsTable.tsx` — Data table with dark theme
- Libraries: class-variance-authority (CVA), tailwind-merge, clsx
- Framework: TailwindCSS v4

## Theme V1 (unique)
- Background: `#0A1110` (`--os-bg`)
- Surface: `#111C18` (`--os-surface`)
- Brand green: `#10B981` (`--os-brand-green`)
- Yellow accent: `#EAB308`
- Sidebar width: 56px (`--os-sidebar-w`)
- CSS vars public pages: `--ais-*`
- CSS vars dashboard: `--os-*`

## Utility Classes
- `os-card` — card with dark surface background
- `os-bg` — main background
- `os-dot-online` — green status dot

## Rules
1. New UI primitives MUST use `Os*` prefix
2. No inline hex colors — use CSS variables or Tailwind theme tokens
3. All components must accept `className` prop for composition via `cn()` (clsx + tailwind-merge)
4. Use CVA for variant management (see OsButton.tsx for reference pattern)
5. Dark theme ONLY — no light mode toggle, no light variant needed
6. Sidebar is 56px icon-only — no text labels in collapsed state
7. Responsive: mobile-first approach, breakpoints sm/md/lg/xl
8. Animations via framer-motion (already installed)
9. Icons from lucide-react (already installed)
