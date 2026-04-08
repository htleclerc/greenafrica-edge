---
trigger: always_on
---

# AfricGreen Agent Rules

## File Modification Rules
- Before creating any file in `components/ui/`, verify it follows the Os* naming convention
- Before modifying `rbac.ts`, check that all existing nav keys still have valid routes in `(dashboard)/`
- After modifying any `messages/*.json`, validate all 5 locale files have matching key structures
- After modifying `types/secure/index.ts`, verify all importing files still compile with `npx tsc --noEmit`
- New dashboard pages MUST be added to NAV_PERMISSIONS in rbac.ts

## Domain Rules
- Carbon tax calculations: always reference TaxConfig, never hardcode rates or emission factors
- Vessel compliance flow: APPROACHING → PROCESSING → COMPLIANT | PAYMENT_DUE → NON_COMPLIANT
- MMSI codes are exactly 9 digits — validate on input
- Currency displays use `Intl.NumberFormat` with USD
- All date/number formatting via `useFormatter()` from next-intl

## Security Rules
- NEVER embed Supabase keys, passwords, or tokens in bash commands
- NEVER read or display contents of .env.local
- All Supabase queries go through the SSR client in lib/supabase/
- No secrets in `.claude/settings.json` — use .env.local only

## i18n Rules
- en.json is the reference — all other locales must match its key structure
- NEVER add a key to one locale without adding to ALL 5 (en, fr, ar, pt, sw)
- NEVER hardcode user-visible strings in .tsx files — use `useTranslations()`
- Arabic (ar) requires RTL layout consideration

## Quality Rules
- All new logic in `lib/` and `hooks/` should have corresponding test files
- Run `npm run test` after modifying existing hooks or lib functions
- Run `npx tsc --noEmit` before considering TypeScript changes complete
- Use existing Os* components — don't create raw HTML elements for cards, buttons, tables, etc.

## Architecture Rules
- Business logic goes in `domain/` or `hooks/`, not in components
- Components are UI-only — no direct Supabase calls, no business logic
- Mock data only in `mock/datas/secureMock.ts` — not scattered in components
- Follow DDD: domain → hooks → components (data flows one direction)

## References
- PRD: @prd_afrigreen.md
- User stories: @user_stories.md
- Design system docs: @/docs
- Project runs locally on port 3300
