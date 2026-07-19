# Admin Armateurs — Cockpit de recouvrement (Sprint 2, sous-projet 1)

**Date :** 2026-07-20
**Statut :** Design approuvé — prêt pour writing-plans

## Objectif

Donner au staff Green-Gate une page d'administration **dédiée aux armateurs maritimes** : lister tous les débiteurs avec leur statut d'onboarding, leurs drapeaux sanctions OFAC/UN et leurs **montants (facturé / payé / dû)**, avec filtres, et une **fiche détaillée `[id]`** (identité, KYC, navires, pro-formas, paiements, relances) permettant d'**éditer l'email officiel** et d'**inviter** (avec le garde sanctions du Sprint 1).

Contrainte forte : **étendre l'existant, ne pas reconstruire.** On réutilise `ShipownersList`/`shipownerService`, l'action `inviteShipowner` (garde OFAC/UN), `upsertShipownerEmail`, et le design system `Os*`.

## Périmètre

**Inclus :** page liste `admin/armateurs/`, fiche `admin/armateurs/[id]/`, vue SQL d'agrégats, service de lecture, i18n.
**Exclus (autres sous-projets/sprints) :** compagnies aviation (sous-projet 2), proformas globales (sous-projet 3), KYC onboarding (sous-projet 4), `payments/unmatched` et aging analysis (Sprint 3/4).

## Décisions de conception (approuvées)

1. **Montants via une vue SQL** `v_armateur_recouvrement` (agrège par `shipowner_id` : nb pro-formas, facturé, payé, dû) — propre, testable, cohérent avec les `v_*` existantes. 1 migration additive.
2. **Discriminant maritime/aviation** : un armateur = ligne `shipowners` **sans `iata_code`** (les compagnies aviation le portent, mig 092). La page armateurs filtre le maritime ; le sous-projet 2 prendra `iata_code IS NOT NULL`. Même table, deux vues.
3. **Fiche `[id]`** riche (identité, KYC, navires, pro-formas, paiements, relances) + actions éditer-email / inviter.

## Architecture & fichiers

### Migration
- `supabase/migrations/095_v_armateur_recouvrement.sql`
  - Vue `public.v_armateur_recouvrement` : pour chaque `shipowners` **WHERE `iata_code IS NULL`**, agrège depuis `transactions` (document_type = 'PROFORMA', mode = 'MARITIME') :
    - `proforma_count` = COUNT(*)
    - `total_invoiced_usd` = SUM(tax_amount_usd)
    - `total_paid_usd` = SUM(COALESCE(partial_paid_usd, 0))
    - `total_outstanding_usd` = SUM(tax_amount_usd - COALESCE(partial_paid_usd, 0))
    - `sanctioned` = (s.is_ofac_sdn OR s.is_un_prohibited)
  - Colonnes shipowner exposées : id, name, country_code, account_state, is_ofac_sdn, is_un_prohibited, official_email, imo_company_no.
  - `LEFT JOIN` transactions pour inclure les armateurs sans pro-forma (montants à 0).
  - RLS : la vue s'appuie sur les tables sous-jacentes ; exposée en lecture au staff via `GRANT SELECT ... TO authenticated` + une policy équivalente au pattern admin (les vues n'ont pas de RLS propre → on la crée avec `security_invoker = true` pour hériter des RLS de `shipowners`/`transactions`, sinon `GRANT` restreint + accès service-role). Décision : `WITH (security_invoker = true)` (PG15+) pour hériter des policies existantes.
  - Commentaire `-- DOWN:` (`DROP VIEW`).

### Service — `frontend/src/services/armateurService.ts`
- `type ArmateurCockpitRow` = { id, name, country_code, account_state, is_ofac_sdn, is_un_prohibited, official_email, imo_company_no, proforma_count, total_invoiced_usd, total_paid_usd, total_outstanding_usd }.
- `async function listArmateursCockpit(db): Promise<ArmateurCockpitRow[]>` — `SELECT * FROM v_armateur_recouvrement ORDER BY total_outstanding_usd DESC`.
- `type ArmateurDetail` = row + vessels[] + proformas[] + payments[] + reminders[] + KYC fields.
- `async function getArmateurDetail(db, id): Promise<ArmateurDetail | null>` — lit `shipowners` (tous champs KYC), ses `vessels` (via shipowner_id), ses `transactions` PROFORMA (ref/date/montant/statut/dû), ses `payments` (via transactions), ses `collection_reminders` (via transactions).
- Aucun `any`. Types dérivés/explicites.

### Pages
- `frontend/src/app/(dashboard)/admin/armateurs/page.tsx` (server component) : garde staff (pattern admin existant : SUPERADMIN/FINANCE_ADMIN/PORT_OFFICER), fetch via `listArmateursCockpit(adminClient)`, rend `<ArmateursCockpit rows canInvite={role===SUPERADMIN} />`.
- `frontend/src/app/(dashboard)/admin/armateurs/ArmateursCockpit.tsx` (client) : `OsTable` (colonnes ci-dessous) + barre de filtres + dialogues **inviter** (réutilise le flux de `ShipownersList` : `inviteShipowner`) et **éditer email** (`upsertShipownerEmail`). Clic ligne → `/dashboard/admin/armateurs/[id]`.
- `frontend/src/app/(dashboard)/admin/armateurs/[id]/page.tsx` (server) : fetch `getArmateurDetail`, 404 si absent, rend `<ArmateurDetail />`.
- `frontend/src/app/(dashboard)/admin/armateurs/[id]/ArmateurDetail.tsx` (client) : sections OsCard.

### Liste — colonnes & filtres
- Colonnes : **Armateur** (nom) · **Pays** · **Statut** (OsBadge account_state) · **Sanctions** (OsBadge rouge OFAC/UN si flag, sinon rien) · **Pro-formas** (count) · **Facturé** · **Payé** · **Dû** (surligné si > 0).
- Filtres (client, sur la liste chargée) : statut (account_state), sanctions (tous / OFAC / UN / clean), pays, recherche texte (nom ou imo_company_no), toggle « dû > 0 ».
- Tri par défaut : dû décroissant.

### Fiche `[id]` — sections
- **Bandeau** : nom + OsBadge statut. Si `is_ofac_sdn || is_un_prohibited` → **bandeau rouge** « Contact interdit — {OFAC SDN | UN prohibited}. Procédure in rem / consulaire uniquement. »
- **Identité** (OsCard) : official_email (+ source), ops/finance emails, pays, adresse, imo_company_no, equasis_id, alias, phone, langue, notes.
- **KYC** (OsCard) : account_state, KYC-B (`kyc_level_b_completed_at`), KYC-C (`kyc_level_c_completed_at`), billing (legal_name, ville, pays, TVA), IBAN **masqué** (jamais en clair), swift_bic, bank_name, proof_doc (lien signé si présent).
- **Navires** (OsCard + OsTable) : IMO, nom, type, GT, pavillon.
- **Pro-formas** (OsCard + OsTable) : référence (invoice_ref), date_emission (created_at), montant (tax_amount_usd), statut (OsBadge), dû, lien « vérifier » (`/verify`) + « PDF » (`/api/invoices/[ref]/download`).
- **Paiements** (OsCard + OsTable) : montant, date, rail, référence externe, statut.
- **Relances** (OsCard) : timeline `collection_reminders` (tier J15/J30/J45, sent_at, réponse) — lecture seule.
- **Actions** (OsCard) : bouton **Éditer email** (dialogue → `upsertShipownerEmail` + `router.refresh`) ; bouton **Inviter** (dialogue → `inviteShipowner`) — **désactivé + tooltip** si sanctionné (le garde renverrait de toute façon `{ok:false, sanctioned}`).

### i18n
- Namespace `AdminArmateurs` dans les 6 locales (`en`, `fr`, `so`, `pt`, `ar`, `sw`) : titres colonnes, filtres, sections fiche, libellés d'action, messages d'erreur. Réutiliser les clés existantes `AdminMappings` quand pertinent (invite/email).

### Permissions / RLS
- Accès pages réservé staff via le pattern admin déjà en place (helper de garde de rôle côté server component ; sinon `is_admin_or_officer()`).
- `inviteShipowner` reste SUPERADMIN-only (déjà imposé). Bouton inviter masqué/désactivé pour les non-SUPERADMIN (`canInvite`).
- La vue hérite des RLS via `security_invoker`.

## Tests

- **Service** (`armateurService.test.ts`, Vitest, DB-backed skipIf env) : sur les seeds réels importés, `listArmateursCockpit` renvoie les armateurs maritimes (sans compagnies aviation), et les agrégats correspondent (ex. somme des `total_invoiced_usd` = total maritime 1 889 653.34 ; un armateur sanctionné a `is_ofac_sdn`).
- **Vue SQL** : test d'intégrité (migration appliquée → `SELECT count(*) FROM v_armateur_recouvrement` = nb armateurs maritimes ; exclut les compagnies `iata_code IS NOT NULL`).
- **Composant filtres** (`ArmateursCockpit`) : test que le filtre « sanctions = OFAC » et le toggle « dû > 0 » réduisent bien les lignes (test unitaire pur sur une liste mock).
- **Garde sanctions** : déjà couvert (contactGuard) ; ajouter un cas d'intégration si `inviteShipowner.test.ts` le permet (armateur OFAC → bouton produit `{ok:false}`).
- Couverture > 80 % sur le nouveau code. `tsc --noEmit` + `lint` clean.

## Contraintes globales (rappel)

- TypeScript strict, **jamais `any`** ; validation Zod pour toute entrée externe.
- Composants **`Os*`** uniquement (jamais shadcn). Réutiliser `OsTable/OsBadge/OsButton/OsInput/OsCard/OsStatCard`.
- Migration : style `NNN_description.sql` (next = **095**), bannière, ADDITIVE, `IF NOT EXISTS`, `-- DOWN:` final, RLS/GRANT.
- Commits : auteur `Loïc Leclerc <leclerc@drwintech.com>`, messages humanisés, **jamais** de trailer IA, staging explicite. Branche `feat/admin-armateurs`, PR vers `develop`.
- IBAN **jamais** exposé en clair (déchiffrement réservé au flux sécurisé existant ; ici on affiche masqué).

## Non-objectifs

- Pas d'édition des flags sanctions depuis l'UI (données de screening, hors périmètre).
- Pas d'aging buckets dans la liste (fiche seulement / Sprint 4).
- Pas de génération/envoi de pro-forma ici (Sprint 3).
