# Inscription rationalisée — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `/signup` devient le self-service **opérateur** (maritime / aérien / les deux) ; le self-signup **staff** disparaît au profit d'une **invitation admin** (`inviteStaff`). `/owner/register` redirige vers `/signup`. Flags self-service activés.

**Architecture:** Phase 1 déplace les formulaires opérateur (`RegisterModeSwitcher` + `RegisterForm` + `AirRegisterForm`) de `app/owner/register/` vers `components/auth/operator-register/`, et `/(auth)/signup/page.tsx` (server) lit les flags pour rendre soit le parcours opérateur soit un écran « inscription fermée ». La page staff multi-étapes et l'endpoint public `/api/auth/register` sont retirés. Phase 2 ajoute l'action SUPERADMIN `inviteStaff` (miroir d'`inviteShipowner`) + l'écran `/admin/staff`.

**Tech Stack:** Next.js 16 App Router, TS strict, Supabase (admin API), Vitest, next-intl, Supabase migrations.

**Référence spec :** `docs/superpowers/specs/2026-06-14-signup-rationalization-design.md`.

---

## File Structure

| Fichier | Action |
|---|---|
| `frontend/src/components/auth/operator-register/{RegisterModeSwitcher,RegisterForm,AirRegisterForm}.tsx` (+ `RegisterModeSwitcher.test.tsx`) | **Déplacer** depuis `app/owner/register/` |
| `frontend/src/app/(auth)/signup/page.tsx` | **Réécrire** (server : flags → parcours opérateur / écran fermé) |
| `frontend/src/components/auth/SignupPage.tsx` | **Supprimer** (staff multi-étapes) |
| `frontend/src/app/owner/register/page.tsx` | **Remplacer** par redirection vers `/signup` |
| `frontend/src/app/api/auth/register/route.ts` | **Verrouiller** (410 Gone) |
| `frontend/supabase/migrations/091_*.sql` → en fait `supabase/migrations/091_enable_self_service.sql` | **Créer** (seed flags) |
| `frontend/src/actions/inviteStaff.ts` (+ `.test.ts`) | **Créer** (Phase 2) |
| `frontend/src/app/(dashboard)/admin/staff/page.tsx` + composant client | **Créer** (Phase 2) |
| `frontend/src/lib/rbac.ts` + `DashboardSidebar.tsx` | **Modifier** — nav `staff` (SUPERADMIN) |

---

# PHASE 1 — `/signup` = self-service opérateur

## Task 1 : Déplacer les formulaires opérateur hors du groupe de routes

**Files:** move `app/owner/register/{RegisterModeSwitcher,RegisterForm,AirRegisterForm}.tsx` + `RegisterModeSwitcher.test.tsx` → `components/auth/operator-register/`

- [ ] **Step 1** — `git mv` les 4 fichiers :
```bash
mkdir -p frontend/src/components/auth/operator-register
git mv frontend/src/app/owner/register/RegisterModeSwitcher.tsx frontend/src/components/auth/operator-register/RegisterModeSwitcher.tsx
git mv frontend/src/app/owner/register/RegisterForm.tsx frontend/src/components/auth/operator-register/RegisterForm.tsx
git mv frontend/src/app/owner/register/AirRegisterForm.tsx frontend/src/components/auth/operator-register/AirRegisterForm.tsx
git mv frontend/src/app/owner/register/RegisterModeSwitcher.test.tsx frontend/src/components/auth/operator-register/RegisterModeSwitcher.test.tsx
```
- [ ] **Step 2** — Corriger les imports : `grep -rn "owner/register/RegisterModeSwitcher\|owner/register/RegisterForm\|owner/register/AirRegisterForm\|./RegisterModeSwitcher\|./RegisterForm\|./AirRegisterForm" frontend/src`. Mettre à jour tout référent (notamment `RegisterModeSwitcher.tsx` importe `./RegisterForm` et `./AirRegisterForm` — restent relatifs OK car déplacés ensemble) et l'ancienne `owner/register/page.tsx` (sera réécrite Task 3). Les imports `@/...` internes des formulaires restent valides.
- [ ] **Step 3** — Vérifier : `cd frontend && npx tsc --noEmit` → 0 erreur (la page owner/register importe encore l'ancien chemin → sera corrigée Task 3 ; si tsc casse à cause d'elle, faire Task 3 dans le même commit logique). 
- [ ] **Step 4** — Commit : `refactor(signup): déplace les formulaires opérateur dans components/auth/operator-register`

## Task 2 : `/signup` rend le parcours opérateur (server, flag-gated)

**Files:** Modify `frontend/src/app/(auth)/signup/page.tsx`

Modèle : `frontend/src/app/owner/register/page.tsx` (lecture `readPortalFeatureFlags`).

- [ ] **Step 1 — Réécrire la page** :
```tsx
// (auth)/signup/page.tsx
import { getTranslations } from 'next-intl/server';
import { readPortalFeatureFlags } from '@/lib/feature-flags';
import { RegisterModeSwitcher } from '@/components/auth/operator-register/RegisterModeSwitcher';

export const metadata = { title: 'Inscription opérateur | Green Gate' };

export default async function SignupPage() {
    const flags = await readPortalFeatureFlags();
    const open = flags.selfServiceEnabled || flags.airSelfServiceEnabled;
    const t = await getTranslations('OwnerRegister');
    return (
        <div className="min-h-screen os-bg flex items-center justify-center p-6">
            <div className="os-card max-w-2xl w-full p-8">
                {open ? (
                    <>
                        <h1 className="text-2xl font-semibold mb-2">{t('title')}</h1>
                        <p className="text-sm opacity-80 mb-6">{t('subtitle')}</p>
                        <RegisterModeSwitcher
                            recaptchaSiteKey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? ''}
                            maritimeEnabled={flags.selfServiceEnabled}
                            airEnabled={flags.airSelfServiceEnabled}
                        />
                    </>
                ) : (
                    <div className="text-center">
                        <h1 className="text-2xl font-semibold mb-2">{t('closed_title')}</h1>
                        <p className="text-sm opacity-80 mb-6">{t('closed_body')}</p>
                        <a href="/login" className="os-button inline-block">{t('back_to_login')}</a>
                    </div>
                )}
            </div>
        </div>
    );
}
```
- [ ] **Step 2 — i18n** : ajouter dans `frontend/messages/{en,fr,pt,sw,ar}.json` sous `OwnerRegister` : `closed_title`, `closed_body`, `back_to_login` (traductions réelles). FR ex. : « Inscription fermée », « Les inscriptions sont actuellement sur invitation. Contactez l'administration. », « Retour à la connexion ».
- [ ] **Step 3 — Vérifier** : `cd frontend && npx tsc --noEmit` + `for f in frontend/messages/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))"; done`.
- [ ] **Step 4 — Commit** : `feat(signup): /signup rend le self-service opérateur (flag-gated)`

## Task 3 : `/owner/register` → redirige vers `/signup`

**Files:** Replace `frontend/src/app/owner/register/page.tsx`

- [ ] **Step 1 — Remplacer le contenu** :
```tsx
// owner/register/page.tsx
import { redirect } from 'next/navigation';
// Operator self-service moved to the unified /signup. Keep this route as a 301
// for legacy links (invitation emails, bookmarks).
export default function OwnerRegisterRedirect() {
    redirect('/signup');
}
```
- [ ] **Step 2 — Vérifier** : `cd frontend && npx tsc --noEmit` → 0 erreur (plus aucune référence à l'ancien chemin des formulaires). `grep -rn "app/owner/register/RegisterModeSwitcher" frontend/src` → vide.
- [ ] **Step 3 — Commit** : `feat(signup): /owner/register redirige vers /signup`

## Task 4 : Retirer le self-signup staff + verrouiller `/api/auth/register`

**Files:** delete `components/auth/SignupPage.tsx` ; modify `app/api/auth/register/route.ts`

- [ ] **Step 1 — Vérifier les référents de SignupPage** : `grep -rn "SignupPage" frontend/src` → seul `(auth)/signup/page.tsx` l'importait (réécrit Task 2). Confirmer aucun autre importeur, puis `git rm frontend/src/components/auth/SignupPage.tsx`. Si un test le cible, le supprimer.
- [ ] **Step 2 — Verrouiller l'endpoint** : remplacer le handler POST de `app/api/auth/register/route.ts` par un 410 (l'inscription staff publique n'existe plus) :
```ts
import { NextResponse } from 'next/server';
// Public staff self-registration is retired — staff are created via admin
// invitation (inviteStaff). Operator self-service uses server actions, not this route.
export async function POST() {
    return NextResponse.json({ error: 'Gone — staff registration is invite-only' }, { status: 410 });
}
```
- [ ] **Step 3 — Vérifier l'impact `/api/auth/approve`** : `grep -rn "registration_requests\|api/auth/register" frontend/src/app/api/auth/approve` — l'approbation opérateur (`/admin/registrations` + `approveShipownerRegistration`) est indépendante (shipowners). Si `/api/auth/approve` ne sert qu'au staff self-signup retiré, laisser tel quel (devient inerte) et noter en commentaire ; NE PAS toucher à l'approbation opérateur.
- [ ] **Step 4 — Nettoyer les liens** : `grep -rn "owner_portal_link\|/owner/register\|request_access" frontend/src` — `/signup` reste le lien « Demander un accès » (depuis `LoginPage`), désormais correct (mène au self-service opérateur). Aucun changement requis sauf référence morte.
- [ ] **Step 5 — Vérifier** : `cd frontend && npx tsc --noEmit && npm run build`.
- [ ] **Step 6 — Commit** : `feat(signup): retire le self-signup staff, verrouille /api/auth/register`

## Task 5 : Migration — activer les flags self-service

**Files:** Create `supabase/migrations/091_enable_self_service.sql` (+ test sous `supabase/tests/migrations/091_*.test.sql`)

- [ ] **Step 1 — Migration** :
```sql
-- 091_enable_self_service.sql
-- Open public operator self-service signup (maritime + air) on /signup.
INSERT INTO public.app_config(key, value)
VALUES
  ('feature.shipowner_self_service_enabled', 'true'::jsonb),
  ('feature.air_self_service_enabled',       'true'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```
- [ ] **Step 2 — Test pg** (`supabase/tests/migrations/091_enable_self_service.test.sql`) : `BEGIN; ... ASSERT value=true pour les 2 clés ; ROLLBACK;` + ligne `SELECT '091 ... PASS'`. Suivre le style des tests existants (`090_*.test.sql`).
- [ ] **Step 3 — Vérifier** (local Supabase up) : `psql "$DB" -f supabase/migrations/091_enable_self_service.sql` puis `psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/migrations/091_enable_self_service.test.sql`.
- [ ] **Step 4 — Commit** : `feat(signup): migration 091 — active le self-service opérateur (maritime + aérien)`

## Task 6 : Gates Phase 1

- [ ] **Step 1** : `cd frontend && npx tsc --noEmit && npm run test && npm run build` → tout vert ; route `/signup` présente, `/owner/register` = redirect.
- [ ] **Step 2 — Vérif manuelle (revue)** : `/signup` ouvert (flags ON) montre les onglets Maritime/Aérien ; `/owner/register` redirige ; `/api/auth/register` POST → 410.

---

# PHASE 2 — Invitation staff (admin)

## Task 7 : Action `inviteStaff`

**Files:** Create `frontend/src/actions/inviteStaff.ts` + `.test.ts`

Modèle EXACT : `frontend/src/actions/inviteShipowner.ts` (lis-le). Différences : pas de `shipowners` ; on pose `profiles` (role staff) + `user_jurisdictions` ; redirect du magic link vers `/auth/setup-password`.

- [ ] **Step 1 — Test** (mock `createClient` + `createPlatformClient` ; style `inviteShipowner.test.ts`) : (a) appelant non-SUPERADMIN → `{ok:false, reason:'insufficient role'}` ; (b) input invalide (email/role) → ok:false ; (c) SUPERADMIN + valide → `inviteUserByEmail` appelé, `profiles` upsert (role choisi, is_active=true), `user_jurisdictions` insérées pour chaque jurisdictionId, `{ok:true,userId}` ; (d) email déjà existant → branche listUsers, ok:true alreadyExisted:true.
- [ ] **Step 2 — Échec** : `cd frontend && npx vitest run src/actions/inviteStaff.test.ts` → FAIL.
- [ ] **Step 3 — Implémenter** :
```ts
// inviteStaff.ts (forme — calquée sur inviteShipowner)
'use server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';

const STAFF_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'MANAGER'] as const;
const schema = z.object({
    email: z.email(),
    fullName: z.string().min(2).max(120),
    role: z.enum(STAFF_ROLES),
    jurisdictionIds: z.array(z.string().uuid()).min(1),
});

export type InviteStaffResult =
    | { ok: true; userId: string; alreadyExisted: boolean }
    | { ok: false; reason: string };

export async function inviteStaff(raw: unknown): Promise<InviteStaffResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };
    const { data: me } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    if (me?.role !== 'SUPERADMIN') return { ok: false, reason: 'insufficient role' };

    const { email, fullName, role, jurisdictionIds } = parsed.data;
    const normEmail = email.trim().toLowerCase();
    const admin = createPlatformClient();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3300';

    let userId: string;
    let alreadyExisted = false;
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(normEmail, {
        redirectTo: `${appUrl}/auth/setup-password`,
        data: { full_name: fullName, role },
    });
    if (invited?.user) {
        userId = invited.user.id;
    } else if (inviteErr && (inviteErr.code === 'email_exists' || /already.*registered/i.test(inviteErr.message ?? ''))) {
        const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        if (listErr) return { ok: false, reason: `lookup failed: ${listErr.message}` };
        const existing = list.users.find((u) => u.email?.toLowerCase() === normEmail);
        if (!existing) return { ok: false, reason: 'user exists but cannot be located' };
        userId = existing.id; alreadyExisted = true;
    } else {
        return { ok: false, reason: `invite failed: ${inviteErr?.message ?? 'unknown error'}` };
    }

    const { error: profileErr } = await admin.from('profiles').upsert(
        { id: userId, email: normEmail, full_name: fullName, role, is_active: true },
        { onConflict: 'id' },
    );
    if (profileErr) return { ok: false, reason: `profile upsert failed: ${profileErr.message}` };

    const rows = jurisdictionIds.map((jid) => ({ user_id: userId, jurisdiction_id: jid }));
    const { error: ujErr } = await admin.from('user_jurisdictions').upsert(rows, { onConflict: 'user_id,jurisdiction_id' });
    if (ujErr) return { ok: false, reason: `jurisdiction link failed: ${ujErr.message}` };

    return { ok: true, userId, alreadyExisted };
}
```
⚠️ Vérifier la contrainte d'unicité réelle de `user_jurisdictions` pour `onConflict` (PK `(user_id, jurisdiction_id)` d'après mig 071) ; ajuster si besoin.
- [ ] **Step 4 — Succès** : vitest ciblé vert.
- [ ] **Step 5 — Commit** : `feat(admin): action inviteStaff (SUPERADMIN, profiles + user_jurisdictions + magic link)`

## Task 8 : UI `/admin/staff` + nav RBAC

**Files:** Create `frontend/src/app/(dashboard)/admin/staff/page.tsx` + composant client `StaffInvite.tsx` ; modify `rbac.ts`, `DashboardSidebar.tsx`

- [ ] **Step 1 — Garde + page server** : `app/(dashboard)/admin/staff/page.tsx` appelle `requireRole([UserRole.SUPERADMIN])` (pattern des pages admin existantes) ; charge la liste des juridictions (via `createPlatformClient` ou client de session, `jurisdictions` ACTIVE) pour le sélecteur ; rend `<StaffInvite jurisdictions={...} />`.
- [ ] **Step 2 — Composant client `StaffInvite.tsx`** : formulaire (email, nom, rôle ∈ {PORT_OFFICER, FINANCE_ADMIN, MANAGER}, multi-sélecteur de juridiction(s)) → appelle l'action `inviteStaff` → affiche succès/erreur. i18n nouveau namespace `AdminStaff` (en/fr/pt/sw/ar). Réutilise les primitives `Os*`.
- [ ] **Step 3 — RBAC + nav** : `rbac.ts` → ajouter `'staff': [UserRole.SUPERADMIN]` dans `NAV_PERMISSIONS`. `DashboardSidebar.tsx` → ajouter `{ key: 'staff', icon: <Users .../> (lucide, déjà importé), href: '/admin/staff', labelKey: 'nav_staff', section: 'admin' }`. i18n `Dashboard.nav_staff` (5 locales). `rbac.test.ts` : assertion `canAccess('staff', SUPERADMIN)===true` + refusé pour les autres.
- [ ] **Step 4 — Vérifier** : `cd frontend && npx tsc --noEmit && npx vitest run src/lib/__tests__/rbac.test.ts src/actions/inviteStaff.test.ts`.
- [ ] **Step 5 — Commit** : `feat(admin): écran /admin/staff d'invitation du personnel (SUPERADMIN)`

## Task 9 : Gates Phase 2

- [ ] **Step 1** : `cd frontend && npx tsc --noEmit && npm run test && npm run build` → tout vert ; route `/admin/staff` présente.
- [ ] **Step 2 — Validation locales** : `for f in frontend/messages/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))"; done`.

---

## Self-review (effectuée)

- **Couverture spec** : §4 P1 (signup opérateur ✓ Task 2, déplacement ✓ Task 1, /owner/register→/signup ✓ Task 3, retrait staff + lock register ✓ Task 4, flags ✓ Task 5) ; §4 P2 (inviteStaff ✓ Task 7, /admin/staff + RBAC ✓ Task 8) ; §3 approbation opérateur inchangée (non touchée) ✓ ; §5 droits de mode staff différés (non implémentés) ✓.
- **Placeholders** : code concret pour /signup, redirect, lock, migration, inviteStaff. Les `⚠️` sont des points de vérification d'implémentation (contrainte user_jurisdictions, impact /api/auth/approve), pas des TODO vagues.
- **Cohérence types** : `inviteStaff` renvoie `InviteStaffResult` (miroir d'`InviteShipownerResult`) ; rôles staff `{PORT_OFFICER,FINANCE_ADMIN,MANAGER}` cohérents entre action (Task 7) et UI (Task 8).
- **Risque onboarding gov** : P2 (inviteStaff) livré dans le même chantier que le retrait du self-signup (P1) — pas de fenêtre sans voie d'onboarding staff si on déploie les deux ensemble.
