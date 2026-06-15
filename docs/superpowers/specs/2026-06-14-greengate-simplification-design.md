# GreenGate simplifié — un login, un shell, une vision

> **Statut** : design validé en brainstorming le 2026-06-14 (PO : Loïc Leclerc).
> **But** : réduire l'enveloppe applicative à sa forme la plus simple et la plus usuelle,
> sans toucher au cœur (calcul fiscal, RLS multi-tenant, multi-pays/multi-mode backend).
> Document de référence pour le plan d'implémentation.

---

## 1. Problème

L'application a une structure **dédoublée** qui la rend complexe à utiliser et à maintenir :

| Axe | Aujourd'hui | Cible |
|---|---|---|
| Login | 2 entrées : `(auth)/login` **+** `owner/login` | **1** login unifié (maritime, aérien, staff, dirigeant, admin) |
| Portail | 2 shells : `(dashboard)/*` (staff/admin) **+** `owner/(portal)/*` qui **reduplique** dashboard/vessels/invoices/simulator/tco/disputes/alerts | **1** shell unique routé par rôle |
| Rôle dirigeant | `MANAGER` existe (« no money, runs daily ops ») mais nav large | `MANAGER` recentré sur **une** vision board lecture seule |
| Détection→proforma | Événementiel (Go AIS/ADS-B continu + worker queue, déclenché au claim/ingest) | + **cron quotidien** garanti qui précalcule tout et rafraîchit le dashboard |
| Admin | `(dashboard)/admin/*` | **Inchangé** |

## 2. Décisions (brainstorming 2026-06-14)

1. **Un seul shell**, routé par rôle (pas deux portails).
2. **MANAGER** réutilisé comme vision board lecture seule (pas de nouveau rôle DB).
3. **Cron quotidien EN PLUS** du temps réel (le Go continu reste la source réactive).
4. **Opérateur unifié** : armateur (maritime) + transporteur (aérien) = même expérience, le mode est un **contexte** (badges), pas une UI séparée — conforme au design doc v8.
5. Opérateur garde **toutes** ses fonctions actuelles : Ma flotte, Mes factures, Wallet, Simulateur, TCO, Litiges, Notifications.
6. **Filtre de mode** (maritime / aérien / les deux) pour **admin & manager** → **inclus** (net-new, petit).
7. **Sélecteur de pays** (un pays) → **déjà présent** (Wedge 2), réutilisé et exposé.
8. **Vue « ensemble » multi-pays (agrégée cross-pays)** → **différée** (rouvre l'analytics pan-africain §9 v8 + répartition par pays). Le défaut mono-pays reste le pays de l'utilisateur ; multi-pays = il choisit un pays.

## 3. Modèle d'authentification (existant, réutilisé)

Un utilisateur authentifié est **soit** :
- **Opérateur** : possède une ligne `shipowners` liée par `profile_id` (résolu par `requireOwner`). Périmètre = son shipowner (RLS).
- **Staff** : possède une ligne `profiles` avec un `role` ∈ {PORT_OFFICER, FINANCE_ADMIN, SUPERADMIN, MANAGER} (résolu par `requireRole`).

La simplification **converge ces deux lanes** derrière un login unique et un garde unique qui résout *type de principal* (opérateur | staff) + *périmètre* (shipowner | juridiction(s)).

## 4. Architecture cible

```
                       /login  (unique)
                          │  auth Supabase
                          ▼
                  post-login resolver
        ┌──────────────────┼─────────────────────┐
        ▼                  ▼                       ▼
   a une ligne        profiles.role           profiles.role
   shipowners ?       = MANAGER               = OFFICER/FINANCE/SUPERADMIN
        │                  │                       │
        ▼                  ▼                       ▼
  Shell — vues       Shell — vision         Shell — vues ops
  OPÉRATEUR          board (read-only)      + admin/* (inchangé)
  (RLS shipowner)    (5 widgets)            (RLS juridiction)
        └──────────────────┴───────────────────────┘
                   UN SEUL shell (dashboard)
   Contexte header : [Sélecteur pays] [Filtre mode: Mar/Air/Both]  (admin & manager)
```

## 5. Composants & livrables par phase

### Phase 1 — Login unifié + routage par rôle  *(faible risque, débloque le reste)*
- `/login` unique. `owner/login` → **redirection** vers `/login` (301).
- `post-login` devient le **resolver** unique : opérateur → vues opérateur ; MANAGER → vision board ; autres staff → ops/admin.
- Inscription self-service opérateur conservée, déplacée sous `/register` (le sélecteur Maritime/Aérien existant est repris). `owner/register` → redirige.
- `requireOwner` + `requireRole` → un garde commun `requirePrincipal()` qui renvoie `{ kind: 'operator'|'staff', role?, shipowner?, jurisdictionId }`.
- **Tests** : routage par type de principal, redirections legacy, fail-closed sans session.

### Phase 2 — Shell unique (fin du `/owner` séparé)  *(le gros morceau)*
- Fusion de `owner/(portal)/*` dans `(dashboard)`. Suppression des pages owner dupliquées.
- Les pages partagées (flotte, factures, simulateur, tco, litiges) deviennent **adaptatives au principal** :
  - opérateur → scope RLS shipowner (ne voit que le sien) ;
  - staff → scope juridiction (voit tout son périmètre).
- Nav filtrée par `canAccess`/`filterNavItems` (RBAC existant), **étendu au principal opérateur**.
- Charte/design unifiés (primitives `Os*`).
- **Filtre de mode** (maritime/aérien/les deux) : nouveau composant header miroir du `JurisdictionSwitcher` — cookie `gg-active-mode` + action `setActiveMode` (valide que le mode est activé pour la juridiction ; `both` = pas de filtre). Visible pour admin & manager (et opérateurs bimodaux le cas échéant). Les listes (flotte, alertes, vision board) lisent ce filtre.
- **Sélecteur de pays** : `JurisdictionSwitcher` existant réutilisé tel quel.
- **Tests** : une page adaptative par principal (opérateur vs staff), filtrage mode, RLS inchangée, non-régression des fonctions opérateur.

### Phase 3 — Vision board dirigeant (MANAGER)  *(visible en démo)*
- Page unique `dashboard/vision`, **lecture seule**, zéro action argent (principe MANAGER « no money »).
- Nav de MANAGER réduite à cette seule page (le reste retiré de sa nav).
- Widgets (respectent le filtre mode + le pays actif) :
  1. **Navires au port** + **avions au sol** (alerts ARRIVED)
  2. **Navires/avions en approche** (DETECTED/APPROACHING)
  3. **Derniers départs** (DEPARTED_EEZ récents)
  4. **Factures payées — 7 derniers jours**
  5. **Factures impayées en cours**
- **Tests** : chaque widget, lecture seule (aucune mutation accessible), respect filtre mode/pays.

### Phase 4 — Automatisation quotidienne  *(filet garanti)*
- Cron **`/api/cron/daily-precompute`** (~05:00 UTC), sécurisé `CRON_SECRET`, enregistré dans `vercel.json`.
- Itère **toutes les juridictions actives** ; pour chaque navire/avion **en approche sans proforma fraîche**, déclenche `proformaPipelineService` (maritime + air) de façon **idempotente** (pas de double-émission).
- Le temps réel (Go AIS/ADS-B + worker queue) reste la source réactive ; le cron est le **filet quotidien** + garantit que le dashboard de tout le monde reflète l'état du jour.
- **Tests** : idempotence (re-run sans doublon), itération multi-juridiction, fail-closed tarif absent (déjà géré par le pipeline), auth cron.

## 6. Hors scope (on ne touche pas)

- Moteur de calcul fiscal (IMO / ICAO LTO), RLS multi-tenant, tables tarifs/split, admin `*`.
- **Vue agrégée « ensemble » multi-pays** (analytics pan-africain) — différée.
- Backend Go de détection (réutilisé tel quel).

## 7. Risques & mitigations

| Risque | Mitigation |
|---|---|
| Fusion des deux portails casse le scope RLS (opérateur voit trop / staff voit trop peu) | Garde unique `requirePrincipal()` + tests d'adaptation par principal sur chaque page partagée ; RLS inchangée (défense en profondeur) |
| Redirections legacy cassent des liens (`/owner/*`, emails d'invitation) | Redirections 301 conservées de `/owner/*` → équivalents du shell unique ; audit des liens d'email |
| Cron quotidien double-émet des proformas | Idempotence stricte (lookup proforma fraîche avant émission), réutilise le pipeline existant déjà fail-closed |
| Filtre mode mal câblé masque des données | `both` = aucun filtre (défaut sûr) ; tests sur les 3 états |

## 8. Critères de succès

- Un seul login ; `owner/login` n'existe plus (redirige).
- Un seul shell ; aucune page `owner/(portal)/*` dupliquée ne subsiste.
- Admin inchangé (mêmes pages, mêmes droits).
- MANAGER = une seule vision board lecture seule avec les 5 widgets.
- Cron quotidien vert, idempotent, dashboards à jour chaque matin.
- Admin & manager peuvent filtrer maritime/aérien/les deux et choisir leur pays.
- Gates pleins : tsc, vitest, go test, pg `.test.sql`, build.
