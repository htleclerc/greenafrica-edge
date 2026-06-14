# Inscription rationalisée — un signup opérateur, staff sur invitation

> **Statut** : design validé en brainstorming le 2026-06-14 (PO : Loïc Leclerc).
> Suite de la refonte « GreenGate simplifié » (un login / un shell). Ici on rationalise les **deux flux d'inscription** qui se chevauchaient.

---

## 1. Problème

Aujourd'hui il y a **deux inscriptions distinctes et confuses** :

- **`/signup`** (`SignupPage`, multi-étapes) : inscription **staff** — Autorité portuaire / « Agent maritime » — via `/api/auth/register` → crée un `profiles` `is_active=false` + `registration_requests`. Le « Agent maritime » crée en fait un compte **staff** rôle `SHIPPING_AGENT`. **Aucune voie aérienne.**
- **`/owner/register`** (`RegisterModeSwitcher`) : self-service **opérateur** — maritime (`RegisterForm`) + aérien (`AirRegisterForm`) — gardé par des flags → `registerShipowner` / `registerAirOperator` → crée un `shipowners` (`PENDING_REVIEW`, ou auto-claim `GHOST→ACTIVE`).

Conséquences : un transporteur aérien n'a **aucun chemin découvrable** pour faire une demande ; et la notion « armateur » existe en double (staff `SHIPPING_AGENT` vs opérateur `shipowners`).

## 2. Décisions (brainstorming 2026-06-14)

1. **Public `/signup` = self-service OPÉRATEUR uniquement** (armateur). Le **mode est un sous-choix** : maritime / aérien / les deux. Consolide le contenu de `/owner/register` dans `/signup`.
2. **Plus de self-signup staff.** Le staff (gouvernement / ministère) est créé par **invitation de l'admin** (SUPERADMIN), qui lui donne sa/ses juridiction(s).
3. **Droits de mode pour le staff = DIFFÉRÉS** (chantier RBAC ultérieur). Le staff voit tous les modes de sa juridiction, comme aujourd'hui.
4. **Activer le self-service** maritime **et** aérien dans le cadre de ce chantier (seed des flags à `true`).
5. **Approbation opérateur inchangée** (`/admin/registrations`, `PENDING_REVIEW→ACTIVE`).

## 3. Architecture cible

```
                         /signup  (public)
                            │  flags self-service
            ┌───────────────┴─────────────────┐
       les deux ON                      tout OFF
            ▼                                ▼
   RegisterModeSwitcher              « Inscription fermée —
   (onglets Maritime/Aérien)          contactez l'administration »
   → registerShipowner / registerAirOperator
   → shipowners PENDING_REVIEW (ou GHOST→ACTIVE)
   → /admin/registrations (validation admin, inchangé)

   /owner/register ──301──► /signup   (consolidation)

   STAFF : aucune inscription publique.
   SUPERADMIN → /admin/staff → inviteStaff(email, nom, rôle, juridiction(s))
   → auth user + profiles(actif) + user_jurisdictions + magic link
```

## 4. Composants & livrables

### Phase 1 — `/signup` = self-service opérateur
- **`/(auth)/signup/page.tsx`** : rend désormais le parcours opérateur. Lecture serveur des flags (`readPortalFeatureFlags`) ; si `selfServiceEnabled || airSelfServiceEnabled` → rend `RegisterModeSwitcher` (déplacé/réutilisé depuis `owner/register`) avec les bons `maritimeEnabled`/`airEnabled` ; sinon → écran « inscription fermée, contactez l'administration » (+ lien `/login`).
- **Déplacer** `RegisterModeSwitcher` + `RegisterForm` + `AirRegisterForm` de `app/owner/register/` vers `components/auth/operator-register/` (hors groupe de routes, réutilisables) ; corriger les imports.
- **`/owner/register/page.tsx`** → **redirection 301** vers `/signup` (conserver le param `?` éventuel). Garder `/owner/onboarding`, `/owner/auth/callback`, `/owner/reset-password`.
- **Retirer le self-signup staff** : supprimer `components/auth/SignupPage.tsx` (le multi-étapes staff) ; **verrouiller** `/api/auth/register` (retour 410/404 — plus d'inscription publique staff). Vérifier l'impact sur `/api/auth/approve` + `registration_requests` (déprécier le flux staff sans casser l'approbation opérateur, qui est séparée).
- **Activer les flags** : migration qui upsert `app_config` `feature.shipowner_self_service_enabled=true` et `feature.air_self_service_enabled=true` (inscription opérateur ouverte au déploiement).
- **Tests** : `/signup` rend le parcours opérateur quand un flag est ON ; écran fermé quand tout OFF ; `/owner/register`→`/signup` ; `/api/auth/register` verrouillé.

### Phase 2 — Invitation staff (minimale)
- **`inviteStaff`** (server action, miroir d'`inviteShipowner`, gardée **SUPERADMIN**) : `{ email, fullName, role: PORT_OFFICER|FINANCE_ADMIN|MANAGER, jurisdictionIds[] }` → crée l'auth user (admin API, email_confirm) + `profiles` (`is_active=true`, role) + lignes `user_jurisdictions` + envoie un magic link (réutilise le pattern d'invitation/`emailService` existant). Idempotent / fail-safe comme `inviteShipowner`.
- **UI `/admin/staff`** (nouvel onglet admin, gardé SUPERADMIN) : formulaire d'invitation (email, nom, rôle, juridiction(s)) + liste des invitations/staff récents (optionnel, simple).
- **RBAC nav** : ajouter `'staff'` à `rbac.ts` pour SUPERADMIN + entrée sidebar.
- **Tests** : `inviteStaff` (rôle gate SUPERADMIN, création profiles+user_jurisdictions, magic link), UI.

## 5. Hors scope (différé)

- **Droits de mode pour le staff** (restriction maritime/aéro/les deux) — nouvelle dimension RBAC, chantier séparé.
- Refonte du look des formulaires opérateur (on réutilise l'existant).
- Migration des `registration_requests` historiques.

## 6. Risques & mitigations

| Risque | Mitigation |
|---|---|
| Retirer le self-signup staff casse l'onboarding gov | La Phase 2 livre `inviteStaff` AVANT/avec le retrait ; le staff a toujours une voie (invitation admin) |
| Verrouiller `/api/auth/register` casse `/api/auth/approve` ou l'approbation opérateur | Vérifié : l'approbation opérateur (`/admin/registrations`, `approveShipownerRegistration`) est indépendante ; n'auditer/déprécier que le chemin staff |
| Activer les flags ouvre l'inscription en prod | Effet uniquement quand les migs sont poussées à l'hébergé (contrôlé par le PO) ; documenté |
| Imports cassés après déplacement des formulaires | grep + tsc/build à chaque étape |

## 7. Critères de succès

- `/signup` = parcours opérateur (maritime/aérien/les deux selon flags) ; écran « fermé » si tout OFF.
- Aucune inscription publique staff ; `/api/auth/register` verrouillé ; `SignupPage` staff supprimée.
- `/owner/register` → `/signup`.
- SUPERADMIN peut inviter un agent staff (`/admin/staff` + `inviteStaff`) avec rôle + juridiction(s).
- Flags self-service maritime + aérien activés (migration).
- Approbation opérateur inchangée. Gates verts : tsc, vitest, build, pg si migration.
