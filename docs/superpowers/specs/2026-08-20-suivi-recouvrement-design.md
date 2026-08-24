# Profil de suivi du recouvrement (armateurs, relances, règlements)

**Date :** 2026-08-20
**Statut :** Design approuvé PO — prêt pour writing-plans
**Branche :** `feat/suivi-recouvrement`
**Rôle porteur :** `FINANCE_ADMIN` (décision PO — voir §1.1)

## Objectif

Donner au gestionnaire du recouvrement un poste de travail complet : voir ce qui a été
facturé et encaissé aujourd'hui / cette semaine / ce mois, savoir qui doit quoi, ouvrir
la fiche d'un armateur pour y corriger ses contacts, et relancer — une facture ou tout
un compte — sans attendre le cron.

Contrainte forte, comme sur les chantiers A/B/C : **étendre l'existant, ne rien
reconstruire.** Le moteur de relance automatique (B1), l'écran collections (B2),
l'escalade huissier (B3), le relevé mensuel (C) et le cockpit armateurs (Sprint 2)
restent en place et ne changent pas de comportement. Ce chantier ajoute une couche de
lecture et un canal manuel **à côté** d'eux.

## 1. Décisions de conception (approuvées PO 2026-08-20)

### 1.1 Le profil s'appuie sur `FINANCE_ADMIN`, pas sur `MANAGER`

`MANAGER` est un rôle *ops* volontairement exclu du money rail : la policy `transactions`
(mig 004) ne liste que `PORT_OFFICER/FINANCE_ADMIN/SUPERADMIN`, alors que
`is_admin_or_officer()` (mig 031) **inclut** MANAGER. Un MANAGER lirait donc `shipowners`
et `collection_reminders` mais **aucun montant** : `v_armateur_recouvrement` et
`v_collection_admin` sont en `security_invoker = true` et lui renverraient du vide. Un
écran qui s'affiche mais ment est le pire cas.

`FINANCE_ADMIN` a déjà tout : `transactions` SELECT, `shipowners` FOR ALL,
`collection_reminders` FOR ALL, `payments` confirm/reject — le tout scopé par juridiction.
**Ce chantier n'écrit aucune policy RLS.**

Un périmètre plus serré (relancer/encaisser sans toucher remboursements ni barèmes) est
souhaité plus tard : il se fera par **sous-permission sur le profil**, sur le patron
`cash_desk_enabled` (mig 061), **jamais** par un nouveau rôle. Hors périmètre ici.

### 1.2 La relance manuelle est un palier `MANUAL`, hors rampe

Une relance envoyée à la main est tracée dans `collection_reminders` avec le palier
`MANUAL`, qui **n'entre pas** dans la rampe J3→J7→J15→J30→J45→BAILIFF→JUDICIAL.

Le moteur automatique y est déjà immunisé sans qu'on écrive une ligne : le cron construit
`sentTiers` avec une liste blanche `['J3','J7','J15','J30','J45']`
(`collection-reminders/route.ts:95`), et `escalateCollection` teste
`sentTiers.includes('J45')`. Une valeur inconnue est écartée d'office.

Conséquence : on peut relancer autant de fois qu'on veut, à tout moment, même sur une
facture pas encore échue, sans jamais consommer ni avancer un palier légal. La chaîne qui
mène à l'huissier reste intégralement machine-générée.

### 1.3 Le récapitulatif consolidé est un envoi ponctuel, non archivé

On réutilise `composeOwnerStatement` pour composer le PDF, on le joint à l'e-mail, et on
**n'écrit ni dans `owner_statements` ni dans le bucket `statements/`**. Le relevé mensuel
officiel du portail armateur reste intact — `owner_statements` porte
`UNIQUE (shipowner_id, period_month)` et le chemin `statements/<id>/<YYYY-MM>.pdf`, qu'un
envoi manuel dans le mois écraserait.

### 1.4 Périmètre maritime uniquement

Dashboard, fiches et relances ne portent que sur `document_type = 'PROFORMA'` et
`mode = 'MARITIME'` — le périmètre de `v_armateur_recouvrement`, celui où le portefeuille
est réel (656 pro-formas, 2,75 M USD) et où le pipeline a tourné en production. L'aérien
(`v_compagnie_recouvrement`, `/admin/airlines`) se branchera plus tard sur les mêmes
briques ; le pipeline AIR n'a jamais été exercé en réel sur l'hébergé.

### 1.5 Un destinataire principal, plus des copies par armateur

`shipowners.official_email` reste le seul destinataire principal des factures et relances.
On ajoute `shipowners.billing_cc_emails TEXT[]`, alimenté par le gestionnaire, injecté
dans la cascade `resolveInvoiceRecipients` **en copie uniquement**.

`ops_email` et `finance_email` restent des contacts informatifs et sont étiquetés comme
tels dans l'UI. On ne les branche **pas** dans la cascade : ils sont déjà remplis par
l'import d'onboarding sur un nombre inconnu d'armateurs, et les brancher basculerait
silencieusement le routage réel des factures sur un rail qui porte 2,75 M USD de créances.

## 2. Périmètre

**Inclus.**

- *Lot 1 — socle de lecture* : vue `v_reglements_dashboard` ; enrichissement de
  `v_armateur_recouvrement` (retard, échéance, dernière relance) ; tri générique dans
  `OsTable` + hook `useClientSort` ; câblage du tri sur armateurs / collections / factures ;
  correctif du filtre de statut de `/admin/invoices` (§3.2) ; écran `/admin/reglements`.
- *Lot 2 — fiche armateur* : colonne `billing_cc_emails` ; action `updateArmateurContacts`
  (remplace `updateArmateurEmail`) ; représentants visibles et rattachables depuis la fiche ;
  totaux de compte dans la fiche ; colonne « échéance » sur les pro-formas.
- *Lot 3 — envois* : palier `MANUAL` + index unique partiel + `v_collection_admin` v2 ;
  actions `sendManualReminder` et `sendConsolidatedRecap` ; e-mail `sendCollectionRecapEmail` ;
  boutons sur la fiche, le dashboard et l'écran collections.

**Exclus.** L'aérien. Le remplacement de `/admin/revenue` (maquette à données statiques —
dette notée, hors périmètre). Toute modification du cron de relance, de l'escalade huissier
ou du relevé mensuel. La sous-permission de découpage du rôle. Le branchement de
`finance_email`/`ops_email` dans la cascade d'envoi.

## 3. Lot 1 — socle de lecture

### 3.1 Migration `121_reglements_dashboard.sql`

Deux vues, toutes deux `security_invoker = true` : elles héritent de la RLS de
`transactions` / `payments` / `shipowners`, donc le cloisonnement par juridiction est
automatique et il n'y a aucune policy à écrire.

```sql
-- ── v_reglements_dashboard : une ligne par juridiction ──────────────────────
-- Fenêtres CALENDAIRES en UTC (date_trunc), cohérent avec periodBounds() du
-- relevé mensuel et avec le stockage UTC de toute la plateforme. Un port en
-- UTC+3 verra donc « aujourd'hui » basculer à 03:00 locales — assumé, documenté
-- dans l'UI par un libellé « (UTC) ».
CREATE OR REPLACE VIEW public.v_reglements_dashboard
WITH (security_invoker = true) AS
SELECT
  j.id AS jurisdiction_id,

  -- Facturé : pro-formas maritimes émises dans la fenêtre.
  (SELECT COALESCE(SUM(t.tax_amount_usd), 0) FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.created_at >= date_trunc('day', now()))    AS invoiced_today_usd,
  (SELECT COUNT(*) FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.created_at >= date_trunc('day', now()))    AS invoiced_today_count,
  -- ... idem week / month via date_trunc('week', now()) et date_trunc('month', now())

  -- Encaissé : paiements CONFIRMED rattachés à une pro-forma maritime.
  (SELECT COALESCE(SUM(p.amount_usd_minor), 0) / 100.0 FROM public.payments p
     JOIN public.transactions t ON t.id = p.transaction_id
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND p.status = 'CONFIRMED'
      AND p.confirmed_at >= date_trunc('day', now()))  AS collected_today_usd,
  -- ... idem count, week, month

  -- Encours, indépendant de toute fenêtre.
  (SELECT COALESCE(SUM(t.tax_amount_usd - COALESCE(t.partial_paid_usd, 0)), 0)
     FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.status IN ('PENDING','OVERDUE','PARTIALLY_PAID'))           AS total_outstanding_usd,
  (SELECT COALESCE(SUM(t.tax_amount_usd - COALESCE(t.partial_paid_usd, 0)), 0)
     FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.status IN ('PENDING','OVERDUE','PARTIALLY_PAID')
      AND t.due_date < now())                                          AS overdue_usd,
  (SELECT COUNT(*) FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.status IN ('PENDING','OVERDUE','PARTIALLY_PAID')
      AND t.due_date < now())                                          AS overdue_count
FROM public.jurisdictions j;

GRANT SELECT ON public.v_reglements_dashboard TO authenticated, service_role;
```

Sous-requêtes scalaires plutôt qu'un `GROUP BY` avec jointure `payments` : une jointure
directe `transactions × payments` produirait un fan-out et fausserait `SUM(tax_amount_usd)`
dès qu'une facture porte deux règlements partiels.

**Complétude de l'encaissé — vérifiée.** Un règlement par wallet n'échappe pas à la mesure :
le trigger `auto_apply_wallet_to_proforma` (mig 059) insère bien une ligne `payments`
(`rail='WALLET'`, `status='CONFIRMED'`, `transaction_id` renseigné, `confirmed_at=NOW()`)
avant de recalculer le statut. La jointure ci-dessus les capte donc, et reste cohérente avec
`partial_paid_usd`, qui dérive du même `transaction_paid_summary`.

**Ce que l'encaissé exclut, volontairement.** `payments.transaction_id` est *nullable* — les
alimentations de wallet non encore affectées à une facture n'ont pas de transaction. Elles
sont donc hors du chiffre. C'est le bon sens métier pour un tableau de recouvrement :
« encaissé » y désigne **des créances éteintes**, pas de la trésorerie reçue. À ne pas
« corriger » plus tard sans y repenser.

**Statuts de transaction — l'énumération réelle** est `PAID, PENDING, OVERDUE, EXEMPT,
DISPUTED, CREDIT_NOTE_ISSUED, VOID, PARTIALLY_PAID` (migs 003, 026, 051). Les trois statuts
ouverts retenus partout ici — `PENDING`, `OVERDUE`, `PARTIALLY_PAID` — sont exactement ceux
de `composeOwnerStatement`.

**Enrichissement de `v_armateur_recouvrement`.** `CREATE OR REPLACE VIEW` ne peut
qu'**ajouter des colonnes en fin** — les colonnes existantes gardent leur ordre et leur
type, la même migration ajoute :

| Colonne | Source | Rôle |
|---|---|---|
| `overdue_count` | `transactions` où `due_date < now()` et statut ouvert | badge « en retard » dans la liste |
| `next_due_date` | `MIN(due_date)` sur les pro-formas ouvertes | prochaine échéance |
| `last_auto_tier` | dernier `collection_reminders.tier` **∈ paliers auto** | où en est la rampe |
| `last_reminder_at` | `MAX(sent_at)` tous paliers confondus | dernière action de relance |
| `latest_response_type` | dernière réponse débiteur non `SILENT` | contestation / promesse |

C'est ce qui rend le résumé lisible « d'un coup d'œil » depuis la liste, comme demandé,
sans ouvrir la fiche.

### 3.2 Tri générique — `OsTable` + `useClientSort`

`OsTable` est consommé par **23 écrans**. Toute prop nouvelle est donc **optionnelle** ;
aucun appelant existant ne change.

`OsTable` ne trie jamais lui-même — il rend l'affordance d'en-tête et remonte l'intention.
La politique de tri appartient à l'écran, parce qu'elle diffère radicalement selon qu'il
pagine ou non.

```ts
export interface OsColumn<T> {
    key: string;
    header: string;
    render: (row: T) => React.ReactNode;
    className?: string;
    sortable?: boolean;                          // nouveau — affiche l'affordance
    sortValue?: (row: T) => string | number | null;  // nouveau — clé de tri côté client
}

export type OsSort = { key: string; dir: 'asc' | 'desc' };

interface OsTableProps<T> {
    // ... existant inchangé
    sort?: OsSort | null;                        // nouveau
    onSortChange?: (next: OsSort) => void;       // nouveau
}
```

Deux câblages, un seul composant :

- **Écrans non paginés** (`/admin/armateurs`, tableaux de la fiche) : hook
  `useClientSort(rows, columns)` → `{ sort, onSortChange, sortedRows }`. Tri en mémoire via
  `sortValue`, `null` toujours en fin quel que soit le sens.
- **Écrans paginés serveur** (`/admin/collections`, `/admin/invoices`) : `sort` vient des
  paramètres d'URL, `onSortChange` les réécrit, le service traduit en `.order()`. Un tri
  client y serait faux — il ne trierait que la page affichée.

Les services paginés valident la clé de tri contre une **liste blanche** de colonnes
triables ; une clé inconnue retombe sur l'ordre par défaut, jamais d'interpolation dans
`.order()`.

**Correctif embarqué — filtre de statut de `/admin/invoices`.** L'écran propose
`['PENDING','PARTIAL','PAID','OVERDUE','CANCELLED']` (`InvoicesAdminList.tsx:29`) alors que
`PARTIAL` et `CANCELLED` n'existent pas dans `transaction_status` : le service les passe tels
quels à `.eq('status', …)`, donc ces deux filtres ne peuvent rien rendre. Corrigé en
`PARTIALLY_PAID` et `VOID` pendant qu'on retouche ce fichier pour le tri — c'est le même
écran, la même ligne de code, et laisser un filtre mort à côté d'un tri neuf n'aurait pas
de sens. Aucun autre changement sur cet écran.

### 3.3 Écran `/admin/reglements`

Nouvelle route, `dynamic = 'force-dynamic'`, garde `['FINANCE_ADMIN','SUPERADMIN']` —
alignée sur `revenue` et `payments`, pas sur `armateurs` : l'écran expose des totaux
d'encaissement.

`/admin/revenue` n'est pas touché. Sa dette (données statiques codées en dur) est notée
au §7 mais reste hors périmètre.

Contenu :

1. Trois lignes **Aujourd'hui / Cette semaine / Ce mois-ci**, chacune avec facturé
   (montant + nombre) et encaissé (montant + nombre).
2. Deux cartes d'encours : **total impayé**, dont **en retard** (avec le nombre).
3. Un tableau **« À relancer »** — les armateurs de `v_armateur_recouvrement` avec
   `overdue_count > 0`, triable et filtrable, avec le bouton de récap consolidé (lot 3).

Nav : clé `reglements` dans `NAV_PERMISSIONS` et dans `MONEY_RAIL_KEYS` (l'écran touche à
l'argent, il doit tomber sous le refus par défaut des clés inconnues).

## 4. Lot 2 — fiche armateur

### 4.1 Migration `122_shipowner_billing_cc.sql`

```sql
ALTER TABLE public.shipowners
  ADD COLUMN IF NOT EXISTS billing_cc_emails TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.shipowners.billing_cc_emails IS
  'Copies propres à l''armateur sur factures et relances. Destinataire principal = official_email.';
-- DOWN: ALTER TABLE public.shipowners DROP COLUMN IF EXISTS billing_cc_emails;
```

`resolveInvoiceRecipients` gagne un champ `ownerCcEmails: string[]`, fusionné dans `cc`
après l'agent et avant les copies de juridiction, avec la déduplication existante. Les
trois appelants le passent : `invoiceIssuanceService`, le cron `collection-reminders`,
`escalateCollection`.

Le défaut `'{}'` rend le changement **inerte** tant que le gestionnaire n'a rien saisi :
aucun e-mail sortant ne change au déploiement.

### 4.2 Action `updateArmateurContacts`

Remplace `updateArmateurEmail` (dont elle reprend intégralement les gardes : rôles
`['PORT_OFFICER','FINANCE_ADMIN','SUPERADMIN']`, isolation de juridiction pour les
non-SUPERADMIN, `upsertShipownerEmail` avec la source `PORT_OFFICER`).

Champs éditables : `official_email`, `billing_cc_emails[]`, `ops_email`, `finance_email`,
`phone_e164`, `address`, `preferred_language`, `notes`.

- `official_email` passe **toujours** par `upsertShipownerEmail` — c'est lui qui porte la
  comparaison de tiers de confiance. Un staff écrit en `PORT_OFFICER` (confiance 3, la plus
  haute) : jamais refusé silencieusement.
- Les autres champs sont un `UPDATE` direct sur le client tenant.
- Zod valide chaque adresse de `billing_cc_emails`, normalise en minuscules, déduplique, et
  **plafonne à 10 entrées** (une liste de copie n'est pas une liste de diffusion).
- Une entrée de `billing_cc_emails` égale à `official_email` est retirée — pas de doublon
  destinataire/copie.
- Écrit un `audit_logs` `SHIPOWNER_UPDATED` listant les champs modifiés, sans recopier les
  valeurs (données personnelles).

`updateArmateurEmail` est supprimée ; ses deux appelants (cockpit et fiche) migrent.

### 4.3 Représentants dans la fiche

`getArmateurDetail` renvoie `representatives[]` : jointure `owner_agent_mappings` ×
`profiles` (nom, e-mail, priorité, `active`, `valid_from`, `valid_until`).

La fiche affiche une carte « Représentants » avec le rattachement et la révocation, en
réutilisant `createOwnerAgentMapping` et `deactivateOwnerAgentMapping` (mêmes gardes de
rôle). L'écran `/admin/owner-agent-mappings` reste, la fiche y renvoie.

Le représentant prioritaire actif est déjà le premier `cc` de la cascade d'envoi : la carte
l'indique explicitement, pour que le gestionnaire comprenne qui reçoit copie et pourquoi.

### 4.4 Compléments de fiche

- Carte **totaux de compte** en tête : facturé / payé / dû / en retard / prochaine échéance,
  lues sur `v_armateur_recouvrement` enrichie (une ligne, pas de recalcul).
- Tableau des pro-formas : colonnes **échéance** (`due_date`) et **âge**, badge de retard,
  tri sur toutes les colonnes chiffrées via `useClientSort`.
- `getArmateurDetail` ajoute `due_date` et `collections_status` au `select` sur
  `transactions` — ils existent depuis la mig 022 et n'étaient simplement jamais lus.

## 5. Lot 3 — envois

### 5.1 Migrations `123` puis `124` — **impérativement deux fichiers**

`ALTER TYPE ... ADD VALUE` ne peut pas cohabiter avec un **usage** de la valeur dans la
même transaction. L'index partiel et la vue référencent littéralement `'MANUAL'` : les
fusionner avec l'`ADD VALUE` casse le déploiement.

```sql
-- 123_reminder_tier_manual.sql — la valeur d'enum, SEULE.
ALTER TYPE public.reminder_tier ADD VALUE IF NOT EXISTS 'MANUAL';
-- DOWN: aucun (Postgres ne supporte pas DROP VALUE).
```

```sql
-- 124_manual_reminders_index_and_view.sql — usages de la valeur.

-- L'unicité (transaction_id, tier) porte l'idempotence du cron : elle doit rester
-- entière sur les paliers automatiques, et ne pas s'appliquer aux relances manuelles,
-- qui sont répétables par nature.
DROP INDEX IF EXISTS public.idx_creminders_txn_tier;
CREATE UNIQUE INDEX IF NOT EXISTS idx_creminders_txn_tier
  ON public.collection_reminders(transaction_id, tier)
  WHERE tier <> 'MANUAL';

CREATE INDEX IF NOT EXISTS idx_creminders_manual
  ON public.collection_reminders(transaction_id, sent_at DESC)
  WHERE tier = 'MANUAL';

-- v_collection_admin v2 : latest_tier redevient le dernier palier LÉGAL.
-- Sans ce filtre, une relance manuelle du jour afficherait « MANUAL » à la place
-- de « J15 » et masquerait où en est réellement la rampe.
CREATE OR REPLACE VIEW public.v_collection_admin WITH (security_invoker = true) AS
-- ... identique, sauf le LATERAL :
--   latest_tier            → array_agg(r.tier ORDER BY r.sent_at DESC) FILTER (WHERE r.tier <> 'MANUAL')
--   latest_sent_at         → max(r.sent_at) FILTER (WHERE r.tier <> 'MANUAL')
--   reminder_count         → count(*) FILTER (WHERE r.tier <> 'MANUAL')   [rampe seule]
-- + colonnes ajoutées en fin : manual_count, last_manual_at
```

**Note de portée connue.** `v_collection_admin` conserve son `JOIN LATERAL ... ON
cr.reminder_count > 0` : une créance échue jamais relancée reste absente de
`/admin/collections`. Ce trou est réel mais il est **couvert autrement** par ce chantier —
le tableau « À relancer » du dashboard (§3.3) part de `v_armateur_recouvrement`, qui ne
dépend d'aucune relance préalable. Modifier le `LATERAL` changerait le sens de l'écran B2
(« relances en cours ») et n'est pas fait ici.

### 5.2 Action `sendManualReminder` — une facture

Gardes `['PORT_OFFICER','FINANCE_ADMIN','SUPERADMIN']` et isolation de juridiction, sur le
patron exact de `escalateCollection`.

1. Charger la transaction : doit être `document_type='PROFORMA'`, `mode='MARITIME'`, statut
   ∈ `PENDING|OVERDUE|PARTIALLY_PAID`. Sinon refus explicite.
2. Résoudre les destinataires : cascade + `billing_cc_emails` de l'armateur + CC juridiction
   + CC plateforme. Aucun destinataire joignable → refus **clair** (`no reachable recipient`).
3. Télécharger le PDF stocké **s'il existe**. Contrairement à l'escalade huissier, un PDF
   manquant ne bloque pas : un rappel de courtoisie n'est pas une notice légale. La pièce
   jointe devient optionnelle sur `sendProformaReminderEmail`.
4. Envoyer sans `tier` — la fonction retombe alors sur son ton courtois générique, ce qui est
   exactement le registre voulu pour un geste humain hors procédure.
5. **Échec d'envoi ⇒ abandon**, aucune écriture. Même règle que B3 : le registre ne doit
   contenir que ce qui est réellement parti.
6. Succès ⇒ `audit_logs` (`severity: 'INFO'`, `event: 'MANUAL_REMINDER_SENT'`) puis insert
   `collection_reminders` : `tier='MANUAL'`, `template_used='manual_reminder'`,
   `escalated_bailiff=false`, `debtor_response_type='SILENT'`, `sent_email` et `cc_emails`
   renseignés.

### 5.3 Action `sendConsolidatedRecap` — un armateur

1. Mêmes gardes, isolation de juridiction sur la ligne `shipowners`.
2. `composeOwnerStatement(admin, { shipownerId, periodStart, periodEnd, now })` avec les
   bornes du **mois en cours** (du 1er à maintenant) — nouveau helper `currentMonthBounds`
   à côté de `periodBounds`, qui, lui, vise le mois écoulé et reste réservé au cron.
   Les lignes ouvertes ne dépendent d'aucune fenêtre : c'est bien tout l'encours qui part.
3. Zéro ligne ouverte ⇒ refus explicite (`nothing outstanding`) : on n'envoie pas un
   récapitulatif vide.
4. Générer le PDF **en mémoire**. Aucune écriture dans `owner_statements`, aucun objet dans
   `statements/`.
5. `sendCollectionRecapEmail` — nouvelle fonction d'e-mail sur le patron existant : ton
   recouvrement, tableau des factures ouvertes, total dû, PDF joint. Distincte de
   `sendStatementReadyEmail`, qui annonce un relevé mensuel informatif et renvoie au portail :
   mélanger les deux brouillerait le message.
6. Échec ⇒ abandon, aucune écriture.
7. Succès ⇒ `audit_logs` sur l'armateur, puis **un insert groupé** de
   `collection_reminders` : une ligne `MANUAL` par facture incluse, toutes avec le **même**
   `sent_at` et `template_used='manual_recap'`.

Une ligne par facture est la vérité — chacune a bien été relancée — et c'est ce qui fait
apparaître le récap dans la timeline de chaque pro-forma. L'affichage regroupe les lignes
`MANUAL` partageant `(sent_at, template_used)` en une seule entrée « Récapitulatif
consolidé — N factures », pour ne pas noyer la timeline : l'armateur `arm-014` porte 83
pro-formas, un récap y produirait 83 lignes.

### 5.4 Surfaces d'appel

| Écran | Action | Emplacement |
|---|---|---|
| Fiche armateur | `sendManualReminder` | bouton par ligne du tableau des pro-formas |
| Fiche armateur | `sendConsolidatedRecap` | carte « Actions » |
| `/admin/reglements` | `sendConsolidatedRecap` | bouton par ligne du tableau « À relancer » |
| `/admin/collections` | `sendManualReminder` | panneau de détail, à côté de l'escalade |

Tout envoi passe par une **confirmation** rappelant le destinataire résolu et le nombre de
factures concernées. L'action est sortante et irréversible ; elle ne doit jamais partir sur
un clic isolé.

## 6. Tests

Sur les patrons du dépôt (vitest, client Supabase mocké, `__setClientForTest`).

**Logique pure** — le cœur, testable sans base :
- comparateur de `useClientSort` : ordres croissant/décroissant, `null` toujours en fin dans
  les deux sens, stabilité sur valeurs égales ;
- `currentMonthBounds` : bornes UTC, passage de mois, 1er du mois à 00:00 ;
- regroupement des lignes `MANUAL` par `(sent_at, template_used)` ;
- liste blanche de tri des services paginés : clé inconnue ⇒ ordre par défaut.

**Services** : `reglementsService` normalise les `NUMERIC`/`BIGINT` renvoyés en `string` par
PostgREST (le piège déjà rencontré sur `listArmateursCockpit`) ; `getArmateurDetail` remonte
représentants, `due_date` et totaux.

**Actions** — une assertion par garde :
- rôle insuffisant ⇒ refus ;
- armateur d'une autre juridiction ⇒ refus, pour un non-SUPERADMIN ;
- aucun destinataire joignable ⇒ refus, **aucune** écriture ;
- échec d'envoi ⇒ **aucune** ligne `collection_reminders` ni `audit_logs` de succès ;
- succès ⇒ une ligne `MANUAL` (relance) ou N lignes de même `sent_at` (récap) ;
- deux relances manuelles successives sur la même facture ⇒ **deux** lignes (l'index partiel
  ne bloque pas) ;
- une relance `MANUAL` ne modifie ni le `sentTiers` du cron ni la porte `J45 → BAILIFF`
  — test de non-régression explicite sur `dueTier` et `escalateCollection` ;
- `billing_cc_emails` : plafond à 10, déduplication, retrait de l'adresse principale.

**E2E** (Playwright, `frontend/e2e`) : un scénario de tri sur `/admin/armateurs` (clic
d'en-tête, inversion, ordre effectif) et un chargement de `/admin/reglements`. Léger — la
couverture de fond est unitaire.

## 7. Risques et points d'attention

1. **Migrations 123/124 à ne jamais fusionner.** `ADD VALUE` puis usage dans la même
   transaction = échec de déploiement. Le patron est déjà documenté dans la mig 110.
2. **`CREATE OR REPLACE VIEW` n'ajoute qu'en fin.** Les colonnes existantes de
   `v_armateur_recouvrement` et `v_collection_admin` gardent ordre et types ; toute
   réorganisation impose un `DROP VIEW`, qui casserait les appelants.
3. **Fenêtres en UTC.** Assumé et cohérent avec le reste de la plateforme, mais visible pour
   un port en UTC+3 : le libellé de l'écran porte la mention.
4. **`arm-014` « À identifier »** : 83 pro-formas, 1,63 M USD, sans `official_email`. Le récap
   consolidé doit y échouer proprement avec `no reachable recipient`, pas planter. Cas de
   test obligatoire.
5. **Copies additives.** `billing_cc_emails` modifie des e-mails sortants réels. Défaut vide
   ⇒ inerte au déploiement, mais le plafond de 10 et la déduplication sont les garde-fous à
   ne pas retirer.
6. **Dette laissée en place** : `/admin/revenue` reste une maquette à données statiques, et
   `v_collection_admin` continue de masquer les créances jamais relancées. Les deux sont
   documentées ici, aucune n'est traitée.

## 8. Séquencement

Trois lots, du plus inoffensif au plus engageant. Rien ne sort de la plateforme avant le
lot 3.

| Lot | Contenu | Sortant ? | Migrations |
|---|---|---|---|
| 1 | Vues, tri, dashboard | non | 121 |
| 2 | Fiche éditable, copies, représentants | non | 122 |
| 3 | Relance manuelle, récap consolidé | **oui** | 123, 124 |

Le lot 1 livre le tri une fois pour toutes sur un composant partagé par 23 écrans, avant que
les lots suivants n'ajoutent des colonnes. Le lot 3 se pose sur un socle déjà validé en
conditions réelles et concentre à lui seul la revue serrée.
