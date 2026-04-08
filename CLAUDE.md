CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000

# Africgreen — Sovereign Carbon Intelligence Platform

## Stack
- **Frontend**: Next.js 16, React 19, TypeScript (strict), TailwindCSS v4, Supabase SSR
- **Backend**: Go (DDD) — `backend/`
- **Dev server**: `cd frontend && npm run dev` → port 3300
- **i18n**: next-intl — 5 locales (en/fr/ar/pt/sw) in `frontend/messages/`
- **Architecture**: DDD — `domain/` for business logic, `components/` for UI only

## Theme (V1 unique)
- Background: `#0A1110` — Emerald: `#10B981` — Yellow: `#EAB308`
- CSS vars public: `--ais-*` | dashboard: `--os-*`
- Sidebar: 56px icon-only (`--os-sidebar-w`)
- Dark theme ONLY — no light mode

---

## Rules — ALWAYS
1. TypeScript strict mode — no `any`, no `as unknown as X`
2. All user-visible strings via `useTranslations()` from next-intl — zero hardcoded text
3. Validate inputs with Zod schemas
4. UI primitives use `Os*` prefix (OsBadge, OsButton, OsCard, OsInput, OsStatCard, OsTable)
5. CSS variables only — no inline hex colors
6. Commits: `type(scope): description` (feat/fix/docs/style/refactor/test/chore)
7. Read existing code before creating new files
8. Mock data only in `src/mock/datas/secureMock.ts`
9. RBAC via `canAccess()` / `filterNavItems()` from `@/lib/rbac.ts`
10. New pages MUST be added to NAV_PERMISSIONS in rbac.ts
11. New i18n keys MUST be added to ALL 5 locale files simultaneously
12. Use `TodoWrite` for complex tasks (> 3 steps)

## Rules — NEVER
1. Commit secrets (.env, API keys, passwords, service_role tokens)
2. Push directly to main
3. Hardcode colors outside CSS variables
4. Import from `@/mock/` in production code paths
5. Use `eslint-disable` without an explaining comment
6. Embed Supabase keys in bash commands or settings files
7. Skip i18n for any user-visible string
8. Use `any` in TypeScript
9. Ignore TypeScript or ESLint errors

---

## Key Files
| Purpose | Path |
|---------|------|
| Types | `frontend/src/types/secure/index.ts` |
| RBAC | `frontend/src/lib/rbac.ts` |
| Mock data | `frontend/src/mock/datas/secureMock.ts` |
| Test profiles | `frontend/src/mock/datas/testProfiles.ts` |
| UI primitives | `frontend/src/components/ui/Os*.tsx` (6 components) |
| Data hooks | `frontend/src/hooks/use*.ts` (14 hooks) |
| Locales | `frontend/messages/{en,fr,ar,pt,sw}.json` |
| Dashboard layout | `frontend/src/components/dashboard/layout/` |
| Auth pages | `frontend/src/components/auth/` |

## Naming Conventions
| Type | Convention | Example |
|------|------------|---------|
| Variables | camelCase | `userName` |
| Constants | UPPER_SNAKE | `API_URL` |
| Classes/Types | PascalCase | `UserService` |
| Component files | PascalCase | `UserProfile.tsx` |
| UI primitives | Os* prefix | `OsButton.tsx` |

## Commands
```bash
cd frontend
npm run dev        # Dev server (port 3300)
npm run build      # Production build
npm run lint       # ESLint
npm run test       # Vitest (unit tests)
npm run test:watch # Vitest watch mode
```

## Slash Commands (Claude Code)
- `/i18n-check` — Sync check across 5 locales
- `/new-page` — Scaffold dashboard page (page + rbac + i18n + sidebar)
- `/new-hook` — Create data hook following existing pattern
- `/security-scan` — Scan for leaked secrets
- `/rbac-audit` — Verify rbac.ts / routes / sidebar consistency
- `/build-check` — Full validation: tsc + lint + JSON + build
- `/sprint-status` — Git-based sprint progress report
- `/test` — Run tests + analyze failures

## RBAC Roles (8)
PORT_OFFICER, FINANCE_ADMIN, COMPLIANCE_AUDITOR, SHIPPING_AGENT, FLEET_MANAGER, FINANCE_CONTACT, LEGAL_REP, SUPERADMIN

All roles: `/login` → `/post-login` (role selection) → `/dashboard`

## References
- `instructions.md` — Business rules & principles
- `startup-package/docs/standards/ENTERPRISE_STANDARDS.md` — Enterprise standards
- `skills.md` — Domain-specific agent skills
