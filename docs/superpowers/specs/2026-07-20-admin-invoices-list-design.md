# Admin Factures — Liste globale (Sprint 2, sous-projet 3)

**Date :** 2026-07-20
**Statut :** Design approuvé — prêt pour writing-plans

## Objectif

Donner au staff Green-Gate une page d'administration **listant toutes les factures** (transactions à document type `PROFORMA`, `FINAL`, `COMPLEMENT`, `REFUND`), maritime **et** aviation confondus, à plat (une ligne = une transaction), avec **filtres serveur** (type, mode, statut, juridiction émettrice, pavillon du débiteur, période, dû>0, recherche) et **pagination**. Lecture seule : liens PDF + vérification (QR/hash) et navigation vers la fiche du débiteur. Aucune mutation.

Contrainte forte : **étendre l'existant, ne pas reconstruire.** On réutilise `transactions`, le pattern des vues `v_*`, le pattern de page admin du cockpit armateurs (sous-projet 1), le design system `Os*`, et le patron de liens signés PDF/vérif.

## Décisions de conception (approuvées PO 2026-07-20)

1. **Périmètre = toutes les factures** : `document_type ∈ {PROFORMA, FINAL, COMPLEMENT, REFUND}`, avec un filtre « type de document ». (Pas seulement PROFORMA.)
2. **Filtrage côté serveur + pagination** : le portefeuille fait 656 proformas et grossit à chaque import/génération ; on ne charge pas tout en mémoire. Filtres → paramètres de requête SQL (`WHERE`/`ILIKE`/`range`) + `count:'exact'`, état porté par l'URL (`searchParams`).
3. **Lecture seule + navigation** : PDF (lien signé), « vérifier » (QR/hash), clic ligne → fiche débiteur. Aucune action de mutation (les transactions sont immuables, mig 089 ; génération/relance = Sprint 3).
4. **Deux filtres « pays »** distincts : **juridiction émettrice** (`jurisdiction_id` → `jurisdictions.name/code`, ex. Somaliland / Djibouti) **et** **pavillon du débiteur** (`shipowners.country_code`).
5. **Source = vue SQL jointe** `v_invoice_admin` (plutôt que des resources imbriquées PostgREST) : filtrer/compter/paginer sur des colonnes de tables jointes (pays) est propre et testable via une vue. 1 migration additive.

## Périmètre

**Inclus :** vue SQL `v_invoice_admin`, service `invoiceAdminService` (parse filtres + liste paginée + options de dropdown), page `admin/invoices/` (serveur) + composant liste (client), i18n `AdminInvoices`, entrée de navigation + permission RBAC.

**Exclus (autres sous-projets/sprints) :** cockpit armateurs (sous-projet 1, livré), compagnies aviation (sous-projet 2), KYC onboarding (sous-projet 4), génération/envoi/relance de proformas et réconciliation (Sprint 3), toute mutation sur les transactions, page de détail d'une facture dédiée (on navigue vers la fiche débiteur existante).

## Architecture & fichiers

### Migration
- `supabase/migrations/096_v_invoice_admin.sql`
  - Vue `public.v_invoice_admin` `WITH (security_invoker = true)` (hérite des RLS de `transactions`/`shipowners`/`jurisdictions`) :
    - `FROM transactions t`
    - `LEFT JOIN shipowners s ON t.shipowner_id = s.id`
    - `LEFT JOIN jurisdictions j ON t.jurisdiction_id = j.id`
    - `WHERE t.document_type IN ('PROFORMA','FINAL','COMPLEMENT','REFUND')` (exclut les autres `document_type` éventuels ; la vue est la surface « factures »).
  - Colonnes exposées : `id`, `invoice_ref`, `content_hash`, `verify_signature`, `document_type`, `mode`, `status`, `tax_amount_usd`, `partial_paid_usd`, `outstanding_usd` (= `tax_amount_usd - COALESCE(partial_paid_usd,0)`), `created_at`, `due_date`, `paid_at`, `vessel_name`, `vessel_imo`, `shipowner_id`, `debtor_name` (`s.name`), `flag_country` (`s.country_code`), `jurisdiction_id`, `jurisdiction_code` (`j.code`), `jurisdiction_name` (`j.name`), `is_aviation` (`t.mode = 'AIR' OR s.iata_code IS NOT NULL`).
  - `GRANT SELECT ON public.v_invoice_admin TO authenticated, service_role;`
  - Bannière d'en-tête, style `NNN_description.sql`, `CREATE OR REPLACE VIEW`, commentaire `-- DOWN: DROP VIEW public.v_invoice_admin;` en fin de fichier.

### Service — `frontend/src/services/invoiceAdminService.ts`
- `type InvoiceDocumentType = 'PROFORMA' | 'FINAL' | 'COMPLEMENT' | 'REFUND'`.
- `type InvoiceAdminRow` = { id, invoice_ref, content_hash, verify_signature, document_type, mode, status, tax_amount_usd, partial_paid_usd, outstanding_usd, created_at, due_date, paid_at, vessel_name, vessel_imo, shipowner_id, debtor_name, flag_country, jurisdiction_id, jurisdiction_code, jurisdiction_name, is_aviation } — champs numériques normalisés via `Number()`.
- `type InvoiceAdminFilters` = { documentType?: InvoiceDocumentType; mode?: 'MARITIME'|'AIR'; status?: string; jurisdictionId?: string; flagCountry?: string; dueOnly?: boolean; search?: string; dateFrom?: string; dateTo?: string; page: number; pageSize: number }.
- **`invoiceFiltersSchema`** (Zod) + **`parseInvoiceFilters(searchParams: Record<string,string|string[]|undefined>): InvoiceAdminFilters`** — pur, testable : `page` coercé `≥1` (défaut 1), `pageSize` coercé et **clampé `1..100`** (défaut 25), énumérations validées (valeur invalide → ignorée, pas d'erreur 500), `dueOnly` = `'1'|'true'`, `search` trim (vide → undefined), dates ISO `YYYY-MM-DD` (invalide → undefined).
- **`listInvoicesAdmin(db, filters): Promise<{ rows: InvoiceAdminRow[]; total: number; page: number; pageSize: number }>`** — `from('v_invoice_admin').select('*', { count: 'exact' })` + application conditionnelle : `.eq('document_type'|'mode'|'status'|'jurisdiction_id'|'flag_country', …)`, `.gt('outstanding_usd', 0)` si `dueOnly`, `.gte('created_at', dateFrom)` / `.lte('created_at', dateTo + fin de journée)`, recherche `.or('invoice_ref.ilike.%q%,vessel_name.ilike.%q%,vessel_imo.ilike.%q%,debtor_name.ilike.%q%')` (échapper `%`,`,` de `q`), `.order('created_at', { ascending: false })`, `.range(offset, offset+pageSize-1)`. `total = count ?? 0`.
- **`listInvoiceFilterOptions(db): Promise<{ jurisdictions: {id,name}[]; flagCountries: string[] }>`** — juridictions depuis `jurisdictions` (id,name, order name) ; pavillons distincts non nuls depuis `v_invoice_admin` (dédupliqués côté service). Alimente les dropdowns.
- Aucun `any` ; types dérivés/explicites ; `Client` typé sur `SupabaseClient<Database>`.

### Pages
- `frontend/src/app/(dashboard)/admin/invoices/page.tsx` (server component) : `dynamic='force-dynamic'` ; garde staff (`['PORT_OFFICER','FINANCE_ADMIN','SUPERADMIN']`, sinon `redirect('/dashboard')`, pas d'utilisateur → `redirect('/login')`) — même patron que `admin/armateurs/page.tsx` ; `const filters = parseInvoiceFilters(await searchParams)` ; `const [{rows,total,page,pageSize}, options] = await Promise.all([listInvoicesAdmin(supabase, filters), listInvoiceFilterOptions(supabase)])` ; rend `<InvoicesAdminList rows total page pageSize filters options />`. Route = **`/admin/invoices`** (route group `(dashboard)` non incluse dans l'URL).
- `frontend/src/app/(dashboard)/admin/invoices/InvoicesAdminList.tsx` (client) :
  - **Barre de filtres** : `OsSelect` (type de document, mode, statut, juridiction, pavillon), `OsInput` recherche, deux `OsInput type="date"` (dateFrom/dateTo), toggle « dû > 0 ». Chaque changement met à jour l'URL via `useRouter().push('?'+params)` (reset `page=1` sur changement de filtre) → refetch serveur. `useSearchParams` pour l'état courant.
  - **`OsTable`** colonnes (ci-dessous). Clic ligne (`onRowClick`) → `router.push('/admin/armateurs/'+row.shipowner_id)` si `shipowner_id` non nul (la fiche aviation dédiée arrivera au sous-projet 2 ; pour l'instant tous les débiteurs pointent vers `/admin/armateurs/[id]`, qui rend la fiche maritime — un `shipowner_id` nul → pas de navigation).
  - **Pagination** : boutons Précédent/Suivant (`OsButton`, désactivés aux bornes) + libellé « {start}–{end} sur {total} » ; navigation via URL (`page`).
  - **Liens par ligne** : PDF (`/api/invoices/[ref]/download`) + « vérifier » (`/verify/[ref]?h=<content_hash>&s=<verify_signature>`), rendus **uniquement** si `invoice_ref && content_hash && verify_signature` (même garde que le cockpit armateurs).

### Liste — colonnes
Référence (`invoice_ref`, mono) · Type (OsBadge document_type) · Mode (OsBadge `MARITIME`/`AIR`) · Débiteur (`debtor_name`) · Pavillon (`flag_country`) · Juridiction (`jurisdiction_name`) · Émission (`created_at`) · Montant (`tax_amount_usd`) · Dû (`outstanding_usd`, surligné si >0) · Statut (OsBadge) · actions (PDF/vérifier).

### Filtres (serveur)
Type de document · Mode · Statut · Juridiction émettrice · Pavillon débiteur · Période (created_at de/à) · toggle dû>0 · recherche (invoice_ref / vessel_name / vessel_imo / debtor_name). Tri par défaut : `created_at` décroissant.

### i18n
- Namespace `AdminInvoices` dans les 6 locales (`en`, `fr`, `so`, `pt`, `ar`, `sw`) : titre, sous-titre, libellés de colonnes, libellés et options de filtres (types de document, modes, statuts), libellés de pagination, libellés d'action (PDF, vérifier), message vide.
- `Dashboard.nav_invoices` dans les 6 locales.

### Permissions / RLS / Navigation
- Accès page réservé staff via le patron admin en place (garde de rôle server component).
- La vue hérite des RLS via `security_invoker` (staff voit tout ; les policies sous-jacentes s'appliquent).
- `frontend/src/lib/rbac.ts` : ajouter la permission de navigation `'invoices': ['SUPERADMIN','FINANCE_ADMIN','PORT_OFFICER']`.
- `frontend/src/components/dashboard/layout/DashboardSidebar.tsx` : entrée de navigation → `/admin/invoices` (libellé `Dashboard.nav_invoices`), gardée par la permission `invoices`.

## Tests
- **`parseInvoiceFilters`** (unitaire pur) : défauts (page=1, pageSize=25) ; clamp `pageSize` (0→1, 500→100) ; page négative/0 → 1 ; énumération invalide (documentType/mode) ignorée ; `dueOnly` `'1'`/`'true'`→true, autre→false ; `search` trim + vide→undefined ; date invalide→undefined.
- **`listInvoicesAdmin`** (DB-backed, skipIf env manquante) : sur les seeds importés — un filtre `mode='AIR'` ne renvoie que des lignes AIR ; `dueOnly` ne renvoie que `outstanding_usd>0` ; `total` reflète le count total du filtre (indépendant de `pageSize`) ; `pageSize`/`page` bornent bien via `range` (page 2 ≠ page 1) ; recherche par `invoice_ref` retrouve la ligne.
- **Intégrité vue** (migration appliquée) : `count(*) FROM v_invoice_admin` = nb transactions dont `document_type` ∈ périmètre ; `outstanding_usd` = `tax_amount_usd - COALESCE(partial_paid_usd,0)` ; `is_aviation` vrai pour une ligne AIR.
- Couverture > 80 % sur le nouveau code. `tsc --noEmit` + `lint` clean.

## Contraintes globales (rappel)
- TypeScript strict, **jamais `any`** ; validation **Zod** des `searchParams`.
- Composants **`Os*`** uniquement (jamais shadcn) : `OsTable/OsBadge/OsButton/OsInput/OsSelect`.
- Migration : style `NNN_description.sql` (next = **096**), bannière, ADDITIVE, `-- DOWN:` final, `GRANT`.
- **Lecture seule** : aucune écriture/mutation sur les transactions.
- Commits : auteur `Loïc Leclerc <leclerc@drwintech.com>`, messages humanisés, **jamais** de trailer IA, staging explicite. Branche `feat/admin-invoices`, PR vers `develop`.

## Non-objectifs
- Pas de page de détail de facture dédiée (navigation vers la fiche débiteur existante).
- Pas d'export CSV/PDF de la liste (éventuel Sprint 4).
- Pas d'agrégats/buckets d'aging (cockpit armateurs / Sprint 4).
- Pas de mutation (annuler/marquer payé/régénérer/renvoyer) — hors périmètre, Sprint 3.
