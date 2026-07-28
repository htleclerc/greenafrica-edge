# Consultation des relances + saisie de la réponse débiteur (Chantier B2)

**Date :** 2026-07-28
**Statut :** Design approuvé — prêt pour writing-plans
**Chantier :** B sur 3 (A → émission unifiée, LIVRÉ · B → relance + traçabilité · C → relevé mensuel). B découpé : **B1 = moteur + registre + cron (LIVRÉ/poussé)** ; **B2 = écran de consultation + saisie réponse (ce spec)** ; B3 = escalade manuelle huissier/judiciaire.

## Objectif

Donner au staff un écran pour **consulter l'historique de recouvrement** de chaque créance et **saisir la réponse du débiteur**. Cette saisie n'est pas cosmétique : le moteur B1 lit « la dernière réponse non-SILENT de la transaction » pour décider d'escalader ou de suspendre. Ses branches pause (`DISPUTE`) et grâce (`PAYMENT_PROMISE`) existent mais ne sont **jamais alimentées** aujourd'hui — B2 est ce qui les rend vivantes.

Contrainte forte : **étendre l'existant, ne rien reconstruire.** On réutilise le patron du cockpit `admin/invoices` (page serveur + liste client + service + vue SQL `security_invoker`), le design-system `Os*`, le patron de mutation par server action auditée (`escalateToOwner`/`inviteShipowner`), la RLS par juridiction de `collection_reminders` (mig 099), et le moteur `collectionReminderService` (B1).

## Décisions de conception (approuvées PO 2026-07-28)

1. **Périmètre = consultation + saisie réponse.** L'escalade manuelle BAILIFF/JUDICIAL (notices contentieuses, nouveaux gabarits e-mail, flag `escalated_bailiff`) est **hors périmètre → B3**.
2. **Organisation par créance**, pas liste plate d'événements : une ligne = une transaction ayant ≥1 relance, avec son état de recouvrement agrégé. La réponse du débiteur porte sur la dette, pas sur un palier précis.
3. **Liste + panneau détail sur la même page** (patron cockpit armateurs) : clic sur une créance → timeline de ses paliers + dialogue de saisie. Pas de page détail dédiée.
4. **La saisie stampe la relance la plus récente** de la transaction (`debtor_response_type` + `debtor_response_at`). C'est exactement la ligne que lit `dueTier`.
5. **Audit sans migration d'enum** : `action='TRANSACTION_UPDATED'` + `details_json.event='DEBTOR_RESPONSE_RECORDED'` (l'enum `audit_action` est figé).

## Périmètre

**Inclus (B2) :** vue SQL `v_collection_admin` ; service `collectionAdminService` (parse filtres + liste paginée) ; page `admin/collections` + liste client + panneau détail (timeline) ; server action `recordDebtorResponse` ; entrée nav + permission RBAC ; namespace i18n `AdminCollections` (6 locales).

**Exclus :** escalade manuelle BAILIFF/JUDICIAL et ses gabarits (B3) ; édition de `jurisdiction_billing_cc.bailiff_cc_emails` (B3) ; toute modification du moteur/cron B1 (livré) ; le relevé mensuel (C).

## Architecture & fichiers

### Migration — `supabase/migrations/111_v_collection_admin.sql`

Vue en lecture, une ligne par transaction ayant au moins une relance, agrégeant l'historique. `security_invoker = true` pour hériter de la RLS de `collection_reminders`/`transactions` (le staff ne voit que ses juridictions ; le débiteur, via la policy read-own, ne verrait que les siennes — mais cette vue est réservée au staff par la page).

```sql
CREATE OR REPLACE VIEW public.v_collection_admin WITH (security_invoker = true) AS
SELECT
  t.id                       AS transaction_id,
  t.invoice_ref,
  t.status,
  t.tax_amount_usd,
  (t.tax_amount_usd - COALESCE(t.partial_paid_usd, 0)) AS outstanding_usd,
  t.created_at,
  t.shipowner_id,
  s.name                     AS debtor_name,
  s.country_code             AS flag_country,
  t.jurisdiction_id,
  j.code                     AS jurisdiction_code,
  j.name                     AS jurisdiction_name,
  cr.reminder_count,
  cr.latest_tier,
  cr.latest_sent_at,
  cr.latest_response_type,
  cr.latest_response_at
FROM public.transactions t
JOIN LATERAL (
  SELECT
    count(*)                                        AS reminder_count,
    (array_agg(r.tier ORDER BY r.sent_at DESC))[1]  AS latest_tier,
    max(r.sent_at)                                  AS latest_sent_at,
    (array_agg(r.debtor_response_type ORDER BY r.sent_at DESC))[1] AS latest_response_type,
    (array_agg(r.debtor_response_at   ORDER BY r.sent_at DESC))[1] AS latest_response_at
  FROM public.collection_reminders r
  WHERE r.transaction_id = t.id
) cr ON cr.reminder_count > 0
LEFT JOIN public.shipowners s   ON s.id = t.shipowner_id
LEFT JOIN public.jurisdictions j ON j.id = t.jurisdiction_id;

GRANT SELECT ON public.v_collection_admin TO authenticated, service_role;
```

**Note :** `latest_*` via `array_agg(... ORDER BY sent_at DESC)[1]` plutôt qu'une sous-corrélation multiple, pour une seule passe. La jointure `LATERAL … ON cr.reminder_count > 0` exclut les transactions sans relance.

### Service — `frontend/src/services/collectionAdminService.ts`

Miroir de `invoiceAdminService` :

```ts
export interface CollectionAdminRow {
  transaction_id: string;
  invoice_ref: string | null;
  status: string;
  tax_amount_usd: number;
  outstanding_usd: number;
  created_at: string;
  shipowner_id: string | null;
  debtor_name: string | null;
  flag_country: string | null;
  jurisdiction_id: string | null;
  jurisdiction_code: string | null;
  jurisdiction_name: string | null;
  reminder_count: number;
  latest_tier: string | null;
  latest_sent_at: string | null;
  latest_response_type: string | null;
  latest_response_at: string | null;
}

export interface CollectionFilters {
  q: string;                 // recherche débiteur / invoice_ref
  jurisdictionId: string;    // '' = toutes
  status: string;            // '' = tous
  latestTier: string;        // '' = tous
  latestResponse: string;    // '' = toutes
  page: number;
  pageSize: number;          // clamp 1..100, défaut 25
}

export function parseCollectionFilters(sp: Record<string, string | string[] | undefined>): CollectionFilters;
export function listCollectionsAdmin(db, f: CollectionFilters): Promise<{ rows: CollectionAdminRow[]; total: number; page: number; pageSize: number }>;
export function listCollectionFilterOptions(db): Promise<{ jurisdictions: { id: string; name: string }[] }>;
```

`listCollectionsAdmin` : `db.from('v_collection_admin').select('*', { count: 'exact' })` + `.eq()` par filtre + recherche `.or('invoice_ref.ilike.%q%,debtor_name.ilike.%q%')` (échappement `%,()`) + `.order('latest_sent_at', { ascending: false }).range(offset, offset+pageSize-1)`. `parseCollectionFilters` : Zod `.catch()` par champ, `first()` pour collapser `string|string[]`, page/pageSize clampés (`DEFAULT_PAGE_SIZE=25`, `MAX_PAGE_SIZE=100`). Le type client est `SupabaseClient<any>` (la vue n'est pas dans les types générés) — seule exception `any` tolérée, comme `invoiceAdminService`.

### Page + liste — `frontend/src/app/(dashboard)/admin/collections/`

- `page.tsx` (serveur) : `export const dynamic = 'force-dynamic'`. Garde staff **inline** (patron `admin/invoices/page.tsx`) : `getUser()` → `profiles.role` → `redirect('/dashboard')` si `role ∉ ['PORT_OFFICER','FINANCE_ADMIN','SUPERADMIN']`. `parseCollectionFilters(await searchParams)`, `Promise.all([listCollectionsAdmin, listCollectionFilterOptions])`, `getTranslations('AdminCollections')`. Rend `<CollectionsAdminList …/>`.
- `CollectionsAdminList.tsx` (client) : filtres portés par l'URL (`useRouter`/`useSearchParams`, `setParam` supprime `page` sur tout changement non-page), `OsTable<CollectionAdminRow>`, badges palier/réponse via mappings locaux `tierVariant`/`responseVariant` → `BadgeVariant` (ex. `BAILIFF/JUDICIAL→critical`, `DISPUTE→disputed`, `PAYMENT_PROMISE→warning`, `PAID→paid`, `SILENT→draft`). Clic ligne → ouvre le panneau détail pour `transaction_id`. Pagination footer (`OsButton` prev/next).
- Panneau détail (dans le même composant client) : au clic, requête client RLS-scopée `createClient().from('collection_reminders').select('*').eq('transaction_id', id).order('sent_at', { ascending: true })` → **timeline** (palier, date d'envoi, `sent_email`+`cc_emails`, `template_used`, réponse). Bouton « Saisir la réponse » ouvre le dialogue Radix (patron `ArmateursCockpit`).

### Server action — `frontend/src/actions/recordDebtorResponse.ts`

```ts
'use server';
// input: { transactionId: string, responseType: DebtorResponseType, note?: string }
// retour: { ok: true, tier: string } | { ok: false, reason: string }
```

Flux (patron `escalateToOwner`/`inviteShipowner`) :
1. `createClient()` → `getUser()` (sinon `not authenticated`). Rôle depuis `profiles`, refus si `∉ ['PORT_OFFICER','FINANCE_ADMIN','SUPERADMIN']`.
2. Résout la `jurisdiction_id` de la transaction via `createPlatformClient()`. **Isolation explicite** : si le staff n'est pas SUPERADMIN et `jurisdiction_id ≠ getServerJurisdictionId()` → `{ ok:false, reason:'forbidden' }` (403). ⚠️ `collection_reminders` **n'est pas** une table tenant-scopée (`createTenantClient` la laisse passer sans filtre `jurisdiction_id`) — l'isolation doit donc être vérifiée ici, pas déléguée au client. Le reste écrit via `createPlatformClient()` (write ciblé par `id`).
3. Charge **la relance la plus récente** de la transaction (`collection_reminders … order by sent_at desc limit 1`). **Aucune relance → `{ ok:false, reason:'no reminder to annotate' }`** (rien à stamper).
4. `update collection_reminders set debtor_response_type = <responseType>, debtor_response_at = now() where id = <latest.id>`.
5. Audit : `audit_logs.insert({ action:'TRANSACTION_UPDATED', severity:'INFO', entity_type:'Transaction', entity_id:transactionId, jurisdiction_id, details_json:{ event:'DEBTOR_RESPONSE_RECORDED', tier:latest.tier, previousResponse:latest.debtor_response_type, newResponse:responseType, note } })`.
6. `revalidatePath('/admin/collections')`.

Validation Zod : `responseType` doit appartenir à l'enum `debtor_response_type` (`SILENT|ACKNOWLEDGE|DISPUTE|PAYMENT_PROMISE|PARTIAL_PAYMENT|PAID|REFUSED`) ; `note` optionnelle, longueur bornée.

### RBAC + nav — `frontend/src/lib/rbac.ts`, `DashboardSidebar.tsx`

- `NAV_PERMISSIONS['admin-collections'] = [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SUPERADMIN]` (deny-by-default : `canAccess` refuse toute clé non listée, sauf SUPERADMIN).
- `NAV_ITEMS` : entrée `{ key:'admin-collections', icon:<Scale/> (lucide), href:'/admin/collections', labelKey:'nav_admin_collections', section:'admin' }`.

### i18n — `frontend/messages/{en,fr,pt,so,sw,ar}.json`

Namespace `AdminCollections` (title, subtitle, colonnes, filtres, timeline, dialogue de réponse, pagination, empty) + clé `nav_admin_collections` dans le namespace `Dashboard`. `en` = référence ; pt/sw/ar/so traduits (baseline à relire natif, cf. dette connue).

## Flux de données

```
admin/collections/page.tsx (serveur, garde staff)
      │  parseCollectionFilters(searchParams)
      ▼
listCollectionsAdmin ── v_collection_admin (RLS staff/juridiction) ──▶ rows paginées
      ▼
CollectionsAdminList (client)  ── clic créance ──▶ panneau détail
      │                                              │ client.from('collection_reminders').eq(txn)
      │                                              ▼  timeline des paliers
      │  « Saisir la réponse » (dialogue)
      ▼
recordDebtorResponse (server action, requireRole + juridiction + audit)
      │  update la relance la plus récente (debtor_response_type/at)
      ▼
[boucle B1] le prochain passage du cron lit cette réponse via dueTier :
   DISPUTE → pause escalade ; PAYMENT_PROMISE → grâce 7 j.
```

## Gestion des erreurs

| Cas | Comportement |
|---|---|
| Transaction sans relance | `recordDebtorResponse` refuse (`no reminder to annotate`) — rien à stamper. |
| `responseType` invalide | Rejet Zod, `{ ok:false }`. |
| Staff hors juridiction | 403 (isolation via `getServerJurisdictionId`). |
| Filtre URL malformé | `.catch()` par champ ramène au défaut ; la page ne casse jamais. |
| Vue vide (aucune relance en base) | Liste vide + message `empty` ; normal tant que le cron B1 n'a pas tourné en prod. |

## Tests

**Unitaires.** `parseCollectionFilters` : clamp page/pageSize, `.catch` sur champ invalide, collapse `string[]`. Mappings `tierVariant`/`responseVariant` → `BadgeVariant` exhaustifs (chaque palier, chaque réponse).

**Service.** `listCollectionsAdmin` (faux client) : filtres `.eq` appliqués, recherche `.or` échappée, pagination `range` correcte, `total` = count.

**Server action.** `recordDebtorResponse` : stampe bien la relance la plus récente (pas une ancienne) ; refuse une transaction sans relance ; insère l'audit `DEBTOR_RESPONSE_RECORDED` ; respecte l'isolation juridiction (refus hors juridiction).

**Intégration (boucle B1).** Après un `DISPUTE` stampé sur la dernière relance, `dueTier({ status:'PENDING', ageDays:45, sentTiers:[…], latestResponse:'DISPUTE', … })` renvoie `null` (pause). Après `PAYMENT_PROMISE` daté d'aujourd'hui, `null` (grâce) ; daté de 8 j, le palier reprend. (Ces assertions réutilisent le `collectionReminderService` de B1 sans le modifier.)

## Risques et points ouverts

- **Réponse attachée à un palier, pas à la créance.** Le schéma B1 stocke la réponse sur une ligne de relance ; on stampe la plus récente. Si une créance n'a **aucune** relance encore, on ne peut pas enregistrer de réponse (refus explicite). Acceptable : sans relance, il n'y a pas encore de dialogue de recouvrement à annoter.
- **`v_collection_admin` non typée** (comme `v_invoice_admin`) → `SupabaseClient<any>` toléré dans le service uniquement.
- **Traductions non-anglaises** = baseline auto à relire natif (dette i18n connue du projet).
- **Concurrence** : deux staff annotant la même créance en même temps écrasent la même ligne ; dernier gagne. Acceptable pour une saisie manuelle rare ; pas de verrou.

## Entrées pour B3

L'escalade manuelle BAILIFF/JUDICIAL réutilisera le panneau détail (nouveaux boutons « Escalader »), une server action `escalateCollection` (modelée sur `escalateToOwner` : `resolveInvoiceRecipients` + `fetchJurisdictionBailiffCc` + nouveaux gabarits e-mail contentieux + insert `collection_reminders` tier BAILIFF/JUDICIAL + `escalated_bailiff=true`, garde anti-doublon via l'index unique `(transaction_id, tier)`), et l'édition de `bailiff_cc_emails`. `reminderTemplate` devra être étendu (ou un service dédié) pour couvrir ces deux paliers, absents du moteur auto.
