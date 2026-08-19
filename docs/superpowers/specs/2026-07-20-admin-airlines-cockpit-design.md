# Admin Compagnies aviation — Cockpit de recouvrement (Sprint 2, sous-projet 2)

**Date :** 2026-07-20
**Statut :** Design approuvé — prêt pour writing-plans

## Objectif

Donner au staff Green-Gate un cockpit d'administration **dédié aux compagnies aviation** (débiteurs aériens) : lister toutes les compagnies avec statut d'onboarding, drapeaux sanctions OFAC/UN et **montants recouvrement (facturé / payé / dû)** sur leurs pro-formas aériennes, avec filtres, et une **fiche détaillée `[id]`** (identité aviation, KYC, flotte, pro-formas AIR, paiements, relances) permettant d'**éditer l'email officiel** et d'**inviter** (garde sanctions).

C'est le **miroir aérien du cockpit armateurs** (sous-projet 1) : même table `shipowners`, discriminant `iata_code IS NOT NULL`, pro-formas `mode='AIR'`.

Contrainte forte : **étendre l'existant, ne pas reconstruire.** On réutilise `shipownerService`, `inviteShipowner` (garde OFAC/UN), `upsertShipownerEmail`/`updateArmateurEmail`, `maskIban`, et le design system `Os*`.

## Décisions de conception (approuvées PO 2026-07-20)

1. **Cockpit parallèle dédié** (pas de généralisation des composants armateurs) : nouveau `airlineService`, vue `v_compagnie_recouvrement`, pages/composants propres, calqués sur armateurs. **Branche `feat/admin-airlines` stackée sur `feat/admin-armateurs`** (PR #92) → réutilise les helpers armateurs par import (`maskIban`, `updateArmateurEmail`) sans les copier. Chaîne de merge : **#92 avant cette PR**.
2. **Route `/admin/airlines`**, libellé de navigation « Airlines ».
3. **Angle recouvrement identique à armateurs** : facturé/payé/dû sur les pro-formas `mode='AIR'`.
4. **Numéro de migration `097`** (pas 096) pour éviter la collision au niveau de `develop` avec la migration 096 du sous-projet 3 (PR #93).
5. **Correctifs de #92 intégrés dès l'origine** : dans `getAirlineDetail`, IBAN **masqué côté serveur** (jamais le chiffré vers le client, gaté par rôle) et garde `iata_code IS NOT NULL` (une ligne non-aviation → `null` → notFound).

## Périmètre

**Inclus :** vue SQL `v_compagnie_recouvrement`, service `airlineService`, page liste `admin/airlines/`, fiche `admin/airlines/[id]/`, filtres, actions invite/edit-email réutilisées, i18n, nav + RBAC.
**Exclus (autres sous-projets/sprints) :** cockpit armateurs (sous-projet 1), liste globale des factures (sous-projet 3), KYC onboarding (sous-projet 4), génération/envoi/relance de pro-formas et réconciliation (Sprint 3), toute mutation sur les transactions, aging buckets, édition des flags sanctions.

## Architecture & fichiers

### Migration
- `supabase/migrations/097_v_compagnie_recouvrement.sql`
  - Vue `public.v_compagnie_recouvrement` `WITH (security_invoker = true)` — miroir de `v_armateur_recouvrement` (mig 095) :
    - `FROM shipowners s LEFT JOIN transactions t ON t.shipowner_id = s.id`
    - `WHERE s.iata_code IS NOT NULL`
    - `GROUP BY s.id`
    - Agrégats **FILTER `WHERE t.document_type='PROFORMA' AND t.mode='AIR'`** : `proforma_count` = COUNT, `total_invoiced_usd` = COALESCE(SUM(tax_amount_usd),0), `total_paid_usd` = COALESCE(SUM(partial_paid_usd),0), `total_outstanding_usd` = COALESCE(SUM(tax_amount_usd - COALESCE(partial_paid_usd,0)),0).
  - Colonnes shipowner exposées : `id, name, country_code, account_state, is_ofac_sdn, is_un_prohibited, (is_ofac_sdn OR is_un_prohibited) AS sanctioned, official_email, iata_code, icao_code, hub_code, aoc_number`.
  - `GRANT SELECT TO authenticated, service_role`. `COMMENT ON VIEW`. `-- DOWN: DROP VIEW IF EXISTS public.v_compagnie_recouvrement;`

### Service — `frontend/src/services/airlineService.ts`
- `type AirlineCockpitRow` = { id, name, country_code, account_state, is_ofac_sdn, is_un_prohibited, sanctioned, official_email, iata_code, icao_code, hub_code, aoc_number, proforma_count, total_invoiced_usd, total_paid_usd, total_outstanding_usd } — champs numériques normalisés `Number()`.
- `listAirlinesCockpit(db): Promise<AirlineCockpitRow[]>` — `SELECT * FROM v_compagnie_recouvrement ORDER BY total_outstanding_usd DESC` ; `if (error) throw`.
- `import { maskIban } from './armateurService';` (réutilisé, non copié).
- `type AirlineAircraftRow` = { id, registration, icao_type, icao24, mtow_kg, compliance_status }.
- `type AirlineProformaRow` = { id, invoice_ref, created_at, tax_amount_usd, partial_paid_usd, status, content_hash, verify_signature }.
- `type AirlinePaymentRow`, `type AirlineReminderRow` (mêmes formes que côté armateurs).
- `type AirlineDetail` = champs identité aviation + KYC (account_state, kyc levels, billing, `iban_masked: string | null`, swift_bic, bank_name, proof_doc) + `aircraft: AirlineAircraftRow[]` + `proformas: AirlineProformaRow[]` + `payments: AirlinePaymentRow[]` + `reminders: AirlineReminderRow[]`.
- `getAirlineDetail(db, id, canViewBilling: boolean): Promise<AirlineDetail | null>` — lit `shipowners` avec **`.is('iata_code', null)` inversé** (garde `iata_code IS NOT NULL` : si la ligne n'est pas une compagnie aviation → renvoie `null`), sa flotte `aircraft` (via `operator_id = id`), ses `transactions` PROFORMA `mode='AIR'`, `payments`, `collection_reminders`. **IBAN** : si `canViewBilling` et `iban` présent → `iban_masked = maskIban(await decryptIban(iban))` (try/catch → null) ; sinon `null`. Le champ `iban` chiffré **n'entre jamais** dans le DTO retourné.
- Client Supabase : patron repo (`SupabaseClient` typé comme dans `armateurService`). Aucun `any` hors ce patron.

### Actions
- Réutilise `inviteShipowner` (SUPERADMIN, garde sanctions `contactGuard`) et l'action serveur `updateArmateurEmail` (déjà générique sur `shipowners` + isolation juridiction) pour éditer l'email officiel d'une compagnie.

### Pages
- `frontend/src/app/(dashboard)/admin/airlines/page.tsx` (server) : garde staff `['PORT_OFFICER','FINANCE_ADMIN','SUPERADMIN']` (patron armateurs) ; `listAirlinesCockpit` ; rend `<AirlinesCockpit rows canInvite={role==='SUPERADMIN'} />`. Route `/admin/airlines`.
- `frontend/src/app/(dashboard)/admin/airlines/AirlinesCockpit.tsx` (client) : `OsTable` (colonnes ci-dessous) + barre de filtres + dialogues **inviter** (réutilise `inviteShipowner`, désactivé si sanctionné) et **éditer email** (`updateArmateurEmail`). Clic ligne → `/admin/airlines/[id]`.
- `frontend/src/app/(dashboard)/admin/airlines/airlineFilters.ts` (+ `.test.ts`) : `filterAirlines(rows, state)` pur (statut, sanctions tous/OFAC/UN/clean, pays, recherche nom/IATA/ICAO, toggle dû>0).
- `frontend/src/app/(dashboard)/admin/airlines/[id]/page.tsx` (server) : `canViewBilling = ['SUPERADMIN','FINANCE_ADMIN'].includes(role)` ; `getAirlineDetail(supabase, id, canViewBilling)` ; `notFound()` si null.
- `frontend/src/app/(dashboard)/admin/airlines/[id]/AirlineDetail.tsx` (client) : sections `OsCard`.

### Liste — colonnes & filtres
- Colonnes : **Compagnie** (nom) · **IATA** · **ICAO** · **Pays** · **Statut** (OsBadge account_state) · **Sanctions** (OsBadge `critical` si OFAC/UN) · **Pro-formas** (count) · **Facturé** · **Payé** · **Dû** (surligné si >0) · actions.
- Filtres (client, sur la liste chargée) : statut, sanctions, pays, recherche (nom/IATA/ICAO), toggle dû>0. Tri par défaut : dû décroissant.

### Fiche `[id]` — sections
- **Bandeau** : nom + OsBadge statut ; si sanctionné → bandeau rouge « Contact interdit — {OFAC SDN | UN prohibited}. Procédure consulaire uniquement. »
- **Identité** (OsCard) : IATA, ICAO, hub, AOC (aoc_number), applicable_modes, official_email (+ source), ops/finance emails, pays, adresse, alias, phone, langue, notes.
- **KYC** (OsCard) : account_state, KYC-B/KYC-C, billing (legal_name/ville/pays/TVA), **IBAN masqué** (`iban_masked`, jamais en clair), swift_bic, bank_name, proof_doc (lien signé si présent).
- **Flotte** (OsCard + OsTable) : registration, icao_type, icao24, mtow_kg, compliance_status.
- **Pro-formas AIR** (OsCard + OsTable) : référence, date, montant, statut, dû, liens « vérifier » + « PDF » (rendus si content_hash+verify_signature).
- **Paiements** (OsCard + OsTable) : montant, date, rail, réf externe, statut.
- **Relances** (OsCard) : timeline `collection_reminders` (lecture seule).
- **Actions** (OsCard) : **Éditer email** (dialogue → `updateArmateurEmail` + refresh) ; **Inviter** (dialogue → `inviteShipowner`, désactivé + tooltip si sanctionné).

### i18n
- Namespace `AdminAirlines` dans les 6 locales (`en`, `fr`, `so`, `pt`, `ar`, `sw`) : titres colonnes, filtres, sections fiche, libellés d'action, messages. Réutiliser les clés partagées quand pertinent.
- `Dashboard.nav_airlines` dans les 6 locales.

### Permissions / RLS / Navigation
- Accès pages réservé staff via le patron admin en place (garde de rôle server component).
- `inviteShipowner` reste SUPERADMIN-only ; bouton inviter masqué/désactivé pour non-SUPERADMIN (`canInvite`).
- La vue hérite des RLS via `security_invoker`.
- `frontend/src/lib/rbac.ts` : permission de navigation `'airlines': [SUPERADMIN, FINANCE_ADMIN, PORT_OFFICER]`.
- `frontend/src/components/dashboard/layout/DashboardSidebar.tsx` : entrée nav → `/admin/airlines` (libellé `Dashboard.nav_airlines`).

## Tests
- **Service** (`airlineService.test.ts`, mock du query builder — patron sous-projet 3, pas de DB live) : `listAirlinesCockpit` interroge `v_compagnie_recouvrement`, tri dû↓, normalisation `Number()` ; `getAirlineDetail` avec `iata_code IS NOT NULL` (une ligne maritime → `null`), `iban_masked` null quand `canViewBilling=false`, flotte/proformas/paiements mappés.
- **Filtres** (`airlineFilters.test.ts`, unitaire pur) : sanctions=OFAC et dû>0 réduisent bien la liste ; recherche par IATA retrouve la ligne.
- **Vue** : intégrité en commentaire (count = compagnies `iata_code IS NOT NULL` ; exclut le maritime).
- Couverture > 80 % sur le nouveau code. `tsc --noEmit` + `lint` clean.

## Contraintes globales (rappel)
- TypeScript strict, **jamais `any`** (sauf `SupabaseClient<any>` pour une vue hors types générés, patron repo).
- Composants **`Os*`** uniquement. Réutiliser `OsTable/OsBadge/OsButton/OsInput/OsSelect/OsCard`.
- Migration : style `NNN_description.sql` (**097**), bannière, ADDITIVE, `-- DOWN:` final, RLS/GRANT.
- IBAN **jamais** exposé en clair (masqué côté serveur, gaté rôle — leçon #92).
- Lecture seule sauf les actions invite/edit-email existantes.
- Commits : auteur `Loïc Leclerc <leclerc@drwintech.com>`, messages humanisés, **jamais** de trailer IA, staging explicite. Branche `feat/admin-airlines` (base `feat/admin-armateurs`), PR vers `develop`.

## Non-objectifs
- Pas de génération/envoi de pro-forma (Sprint 3).
- Pas d'édition des flags sanctions depuis l'UI.
- Pas d'aging buckets dans la liste (fiche seulement / Sprint 4).
- Pas de page de détail d'aéronef dédiée (flotte en tableau dans la fiche).
