# Phase 1 — Login unifié + routage par rôle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une seule page `/login` authentifie tout le monde (maritime, aérien, staff, dirigeant, admin) ; après auth, un resolver route chaque principal vers son shell actuel ; `/owner/login` redirige vers `/login`.

**Architecture:** Le login client (`LoginPage`) authentifie via Supabase puis résout le *type de principal* (opérateur = a une ligne `shipowners` ; sinon staff via `profiles.role`) avec une fonction pure testable `loginDestination()`. Le routage **vers les shells existants est préservé** (opérateur → `/owner/dashboard`, staff → `/dashboard`, SUPERADMIN → `/post-login`) — la fusion du shell est en Phase 2. `requireOwner` et le middleware cessent de renvoyer vers `/owner/login` et pointent vers `/login`.

**Tech Stack:** Next.js 16 (App Router), TypeScript strict, Supabase SSR (`@supabase/ssr`), Vitest, next-intl.

**Périmètre borné (couplage P1/P2) :** Phase 1 ne supprime PAS le bounce shipowner→`/owner/*` du middleware (il protège du chemin de paiement legacy cassé sous `/dashboard`). Ce bounce et la fusion du shell sont traités en Phase 2.

---

## File Structure

| Fichier | Rôle | Action |
|---|---|---|
| `frontend/src/lib/auth/loginDestination.ts` | Fonction pure : `{isOperator, role} → chemin de destination` | **Créer** |
| `frontend/src/lib/auth/loginDestination.test.ts` | Tests unitaires de la fonction pure | **Créer** |
| `frontend/src/components/auth/LoginPage.tsx` | Formulaire de login unique : auth + résolution principal + redirection | **Modifier** |
| `frontend/src/app/owner/login/page.tsx` | Ancienne page login owner → redirection serveur vers `/login` | **Remplacer** |
| `frontend/src/lib/auth/requireOwner.ts` | Garde owner : rediriger vers `/login` (plus `/owner/login`) | **Modifier** |
| `frontend/src/middleware.ts` | Owner non-authentifié → `/login` ; `/owner/login` traité comme route publique→login | **Modifier** |

---

## Task 1 : Fonction pure `loginDestination()`

**Files:**
- Create: `frontend/src/lib/auth/loginDestination.ts`
- Test: `frontend/src/lib/auth/loginDestination.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

```typescript
// frontend/src/lib/auth/loginDestination.test.ts
import { describe, it, expect } from 'vitest';
import { loginDestination } from './loginDestination';
import { UserRole } from '@/types/secure';

describe('loginDestination', () => {
    it('routes an operator (has shipowners row) to the operator shell', () => {
        // role is irrelevant for an operator — the shipowners row wins.
        expect(loginDestination({ isOperator: true, role: UserRole.PORT_OFFICER })).toBe('/owner/dashboard');
        expect(loginDestination({ isOperator: true, role: null })).toBe('/owner/dashboard');
    });

    it('routes a SUPERADMIN to the impersonation step', () => {
        expect(loginDestination({ isOperator: false, role: UserRole.SUPERADMIN })).toBe('/post-login');
    });

    it('routes other staff roles to the staff dashboard', () => {
        for (const role of [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.MANAGER]) {
            expect(loginDestination({ isOperator: false, role })).toBe('/dashboard');
        }
    });

    it('falls back to the staff dashboard when role is unknown', () => {
        expect(loginDestination({ isOperator: false, role: null })).toBe('/dashboard');
    });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `cd frontend && npx vitest run src/lib/auth/loginDestination.test.ts`
Expected: FAIL — `loginDestination` introuvable (module non résolu).

- [ ] **Step 3 : Implémenter la fonction pure**

```typescript
// frontend/src/lib/auth/loginDestination.ts
import { UserRole } from '@/types/secure';

export interface LoginPrincipal {
    /** True if the authenticated user owns a shipowners row (maritime OR air operator). */
    isOperator: boolean;
    /** profiles.role for staff; null/unknown is treated as ordinary staff. */
    role: UserRole | null;
}

/**
 * Pure routing decision after a successful sign-in. Operator status wins over
 * role (an operator never lands in the staff shell). SUPERADMIN goes through
 * the impersonation step; every other staff role goes straight to /dashboard.
 *
 * NOTE (Phase 1): operators still route to the legacy /owner shell. Phase 2
 * merges the shells and changes the operator destination to /dashboard.
 */
export function loginDestination({ isOperator, role }: LoginPrincipal): string {
    if (isOperator) return '/owner/dashboard';
    if (role === UserRole.SUPERADMIN) return '/post-login';
    return '/dashboard';
}
```

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `cd frontend && npx vitest run src/lib/auth/loginDestination.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5 : Commit**

```bash
git add frontend/src/lib/auth/loginDestination.ts frontend/src/lib/auth/loginDestination.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(auth): fonction pure de routage post-login (opérateur vs staff)"
```

---

## Task 2 : Brancher le resolver dans `LoginPage`

**Files:**
- Modify: `frontend/src/components/auth/LoginPage.tsx` (bloc `handleSubmit`, lignes ~77-98)

Contexte : actuellement `handleSubmit` lit `profiles.role` via `.single()` (qui échoue si pas de ligne — OK pour staff, mais on doit aussi détecter l'opérateur) puis route SUPERADMIN→`/post-login`, sinon `/dashboard`. On remplace la fin de `handleSubmit` pour : (1) lire le profil en `.maybeSingle()`, (2) détecter l'opérateur via la table `shipowners`, (3) router via `loginDestination()`.

- [ ] **Step 1 : Ajouter l'import**

En tête de `LoginPage.tsx`, après l'import de `UserRole` :

```typescript
import { loginDestination } from '@/lib/auth/loginDestination';
```

- [ ] **Step 2 : Remplacer le bloc post-auth de `handleSubmit`**

Remplacer **exactement** ce bloc existant :

```typescript
        // Fetch the user's profile to get their role
        const { data: profile } = await supabase
            .from('profiles')
            .select('role, is_active')
            .eq('id', data.user.id)
            .single();

        if (profile && !profile.is_active) {
            await supabase.auth.signOut();
            window.location.href = '/pending-approval';
            return;
        }

        const role = (profile?.role as UserRole) ?? UserRole.PORT_OFFICER;

        // SUPERADMIN → post-login to optionally impersonate another role
        if (role === UserRole.SUPERADMIN) {
            window.location.href = '/post-login';
        } else {
            window.location.href = '/dashboard';
        }
```

par :

```typescript
        // Detect operator (shipowners row) — own-row read is allowed by RLS.
        const { data: shipowner } = await supabase
            .from('shipowners')
            .select('id')
            .eq('profile_id', data.user.id)
            .maybeSingle();
        const isOperator = !!shipowner;

        // Staff role (profiles row may be absent for pure operators).
        const { data: profile } = await supabase
            .from('profiles')
            .select('role, is_active')
            .eq('id', data.user.id)
            .maybeSingle();

        // Inactive staff (not operators) await approval.
        if (!isOperator && profile && !profile.is_active) {
            await supabase.auth.signOut();
            window.location.href = '/pending-approval';
            return;
        }

        const role = (profile?.role as UserRole) ?? null;
        window.location.href = loginDestination({ isOperator, role });
```

- [ ] **Step 3 : Supprimer le lien séparé vers le portail owner**

Supprimer **exactement** ce bloc (le login est désormais unifié) :

```tsx
                        <p className="text-center text-xs mt-2" style={{ color: 'var(--os-text-muted)' }}>
                            <a href="/owner/login" className="text-emerald-400 hover:underline font-semibold">{t('owner_portal_link')}</a>
                        </p>
```

- [ ] **Step 4 : Vérifier la compilation et les tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run src/lib/auth`
Expected: tsc sans erreur ; tests verts.

- [ ] **Step 5 : Commit**

```bash
git add frontend/src/components/auth/LoginPage.tsx
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(auth): login unifié — détecte opérateur/staff et route via le resolver"
```

---

## Task 3 : `/owner/login` redirige vers `/login`

**Files:**
- Replace: `frontend/src/app/owner/login/page.tsx`

On supprime la page de login owner séparée : elle devient une redirection serveur permanente vers `/login`, en propageant un éventuel code d'erreur en query (`?error=…`) pour ne pas perdre les messages des liens d'invitation existants.

- [ ] **Step 1 : Remplacer tout le contenu du fichier**

```tsx
// frontend/src/app/owner/login/page.tsx
import { redirect } from 'next/navigation';

export const metadata = {
    title: 'Sign in — Green Gate',
};

// The owner portal no longer has its own login page. Everyone signs in at
// /login; this route exists only to redirect legacy links (invitation emails,
// bookmarks) and to preserve any error code as a query param.
export default async function OwnerLoginRedirect({
    searchParams,
}: {
    searchParams: Promise<{ error?: string }>;
}) {
    const { error } = await searchParams;
    redirect(error ? `/login?error=${encodeURIComponent(error)}` : '/login');
}
```

- [ ] **Step 2 : Supprimer le formulaire owner devenu orphelin (si présent)**

Run: `ls frontend/src/app/owner/login/OwnerLoginForm.tsx 2>/dev/null && echo EXISTS || echo ABSENT`

S'il existe ET n'est importé nulle part ailleurs (vérifier), le supprimer :

Run: `cd frontend && grep -rl "OwnerLoginForm" src | grep -v "owner/login/OwnerLoginForm.tsx"`
Expected: aucune sortie (aucun autre importeur).
Si aucune sortie : `git rm frontend/src/app/owner/login/OwnerLoginForm.tsx`
Sinon : le laisser et noter l'importeur résiduel.

- [ ] **Step 3 : Vérifier la compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add frontend/src/app/owner/login/
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(auth): /owner/login redirige vers le login unifié"
```

---

## Task 4 : `requireOwner` redirige vers `/login`

**Files:**
- Modify: `frontend/src/lib/auth/requireOwner.ts` (3 occurrences de `/owner/login`)

- [ ] **Step 1 : Remplacer les 3 redirections**

Remplacer `redirect('/owner/login');` par `redirect('/login');`

Remplacer `redirect('/owner/login?error=no_owner_record');` par `redirect('/login?error=no_owner_record');`

Remplacer `redirect(\`/owner/login?error=state_${shipowner.account_state.toLowerCase()}\`);` par `redirect(\`/login?error=state_${shipowner.account_state.toLowerCase()}\`);`

Mettre aussi à jour le commentaire d'en-tête : remplacer la phrase « Redirects to /owner/login (not /login) … » par « Redirects to /login (the unified sign-in) on auth failure. »

- [ ] **Step 2 : Vérifier**

Run: `cd frontend && grep -n "owner/login" src/lib/auth/requireOwner.ts`
Expected: aucune sortie.

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3 : Commit**

```bash
git add frontend/src/lib/auth/requireOwner.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(auth): requireOwner redirige vers le login unifié"
```

---

## Task 5 : Middleware — owner non-authentifié → `/login`

**Files:**
- Modify: `frontend/src/middleware.ts`

Aujourd'hui le middleware renvoie les visites owner non authentifiées vers `/owner/login` et garde `/owner/login` dans les chemins publics. On pointe vers `/login`. On **conserve** le bounce shipowner→`/owner/*` (retiré en Phase 2).

- [ ] **Step 1 : Owner protégé non authentifié → `/login`**

Remplacer **exactement** :

```typescript
    // Owner portal — unauthenticated visits redirect to /owner/login (not /login)
    if (isOwnerProtected && !user) {
        const url = request.nextUrl.clone();
        url.pathname = '/owner/login';
        url.searchParams.set('redirectTo', pathname);
        return NextResponse.redirect(url);
    }
```

par :

```typescript
    // Owner portal — unauthenticated visits go to the unified /login.
    if (isOwnerProtected && !user) {
        const url = request.nextUrl.clone();
        url.pathname = '/login';
        url.searchParams.set('redirectTo', pathname);
        return NextResponse.redirect(url);
    }
```

- [ ] **Step 2 : Garder `/owner/login` joignable (c'est une redirection serveur)**

`OWNER_PUBLIC_PATHS` contient déjà `/owner/login` — le laisser : la route est publique et exécute la redirection serveur vers `/login` (Task 3). Aucun changement ici.

Vérifier aussi le commentaire du master-switch (lignes ~132-148) : la logique `pathname.startsWith('/owner/')` exclut déjà `/owner/login`, donc une visite owner avec portail désactivé tombe sur `/login?portal_disabled=1` — comportement correct, aucun changement.

- [ ] **Step 3 : Vérifier la compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add frontend/src/middleware.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(auth): middleware renvoie les routes owner non auth vers le login unifié"
```

---

## Task 6 : Vérification d'intégration + gates

- [ ] **Step 1 : Suite frontend complète**

Run: `cd frontend && npx tsc --noEmit && npm run test && npm run build`
Expected: tsc clean ; vitest vert (dont les 4 nouveaux tests `loginDestination`) ; build Next réussi.

- [ ] **Step 2 : Vérif manuelle des chemins de redirection (revue de code, pas d'exécution)**

Confirmer par lecture :
- `/owner/login` → `/login` (Task 3).
- `requireOwner` échec → `/login` (Task 4).
- middleware owner non auth → `/login` (Task 5).
- aucun lien `href="/owner/login"` résiduel : `cd frontend && grep -rn "owner/login" src` → ne doit rester que la page de redirection elle-même et d'éventuels commentaires.

- [ ] **Step 3 : Commit final éventuel (clé i18n orpheline)**

Si `t('owner_portal_link')` n'est plus utilisé nulle part, le retrait de la clé est **différé** (nettoyage i18n = lot P2/P3) — ne pas y toucher ici. Aucun commit si rien d'autre n'a changé.

---

## Critères de succès Phase 1

- Une seule page de login (`/login`) authentifie opérateurs et staff.
- Après login : opérateur → `/owner/dashboard` (shell inchangé en P1), SUPERADMIN → `/post-login`, autres staff → `/dashboard`.
- `/owner/login` redirige vers `/login` (liens d'invitation préservés via `?error=`).
- `requireOwner` et le middleware ne référencent plus `/owner/login` comme destination.
- Gates verts : tsc, vitest (+4), build.
- **Non touché** (Phase 2) : bounce shipowner→`/owner/*`, fusion du shell, suppression des pages `/owner/(portal)/*`.

## Self-review (effectuée)

- **Couverture spec §5 P1** : login unifié ✓, resolver par rôle ✓, `owner/login`→redirect ✓, `requireOwner`/middleware vers `/login` ✓. Le garde commun `requirePrincipal()` mentionné dans le spec est **reporté en Phase 2** (il n'a de sens qu'avec le shell fusionné ; en P1 la résolution vit côté login). Écart assumé et documenté.
- **Placeholders** : aucun — tout le code des steps est concret.
- **Cohérence des types** : `loginDestination({isOperator, role})` identique entre définition (Task 1) et appel (Task 2) ; `role: UserRole | null` cohérent.
