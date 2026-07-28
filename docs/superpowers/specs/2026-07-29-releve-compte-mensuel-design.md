# Relevé de compte mensuel armateur (Chantier C)

**Date :** 2026-07-29
**Statut :** Design approuvé — prêt pour writing-plans
**Chantier :** C sur 3 (A → émission unifiée, LIVRÉ · B → relance + traçabilité, LIVRÉ B1/B2/B3 · **C → relevé mensuel, ce spec**). Indépendant de la série B.

## Objectif

Produire, en début de chaque mois pour le mois écoulé, un **relevé de compte** par armateur : la liste de ses pro-formas ouvertes, les paiements confirmés reçus dans le mois, et le total dû en clôture. Document **informatif** (ni facture, ni mise en demeure — pas de référence fiscale, pas de QR, pas de HMAC), envoyé par e-mail et consultable dans le portail armateur.

Contrainte forte : **étendre l'existant, ne rien reconstruire.** On réutilise le patron du cron `collection-reminders` (auth, `createPlatformClient`, `scopedLogger`, `__setClientForTest`), le générateur PDF `invoiceService` (helpers `fmtUsd`, en-tête/pied souverain), la vue `v_armateur_recouvrement`/`v_compagnie_recouvrement`, `notifyOwner` + `notification-email-loop`, et le portail `OperatorInvoicesPage`.

## Décisions de conception (approuvées PO 2026-07-29)

1. **Un relevé par juridiction** (par ligne `shipowners`). Chaque État souverain facture sa propre taxe ; le relevé reflète la dette envers cet État, avec son souverain en pied de page. Colle au modèle « un armateur par pays » (Model B, mig 072) et à la RLS par juridiction. Un groupe multi-pays reçoit un relevé par pays.
2. **Relevé de période, pas simple instantané.** Trois blocs : pro-formas ouvertes (réf, navire, âge, montant), paiements `CONFIRMED` du mois écoulé, total dû en clôture. Pas de solde d'ouverture reconstitué (aucun snapshot mensuel stocké aujourd'hui — hors périmètre).
3. **Maritime + aviation.** Le relevé interroge `transactions` par `shipowner_id`, **tous modes** (les compagnies aviation sont aussi des lignes `shipowners`, avec `iata_code`). Un relevé par ligne shipowner couvre ses pro-formas quel que soit le mode.
4. **Document informatif.** PDF sans QR/HMAC/sceau fiscal ; téléchargement par URL signée **owner-scopée** (RLS), pas la route HMAC des factures.
5. **Table de métadonnées `owner_statements`** (pas de listing du bucket) : porte la RLS, le listing portail et l'idempotence `(shipowner_id, period_month)`.

## Périmètre

**Inclus (C) :** migration `owner_statements` + valeur enum `STATEMENT_READY` ; `generateStatementPdf` + `StatementData` ; `statementService` (composition données + stockage) ; cron `monthly-statements` ; notification `STATEMENT_READY` (email + dispatch) ; section « Relevés » + route de téléchargement owner-scopée sur le portail.

**Exclus :** la **pro-forma consolidée payable** (phase 2 distincte : sa propre référence fiscale + répartition d'un règlement groupé sur les transactions filles) ; le solde d'ouverture comptable reconstitué ; tout relevé consolidé cross-juridiction ; toute modification de la série B.

## Architecture & fichiers

### Migration — `supabase/migrations/112_owner_statements.sql`

```sql
-- Valeur enum pour la notification (usée par owner_notifications, pas dans cette
-- migration → pas de conflit ADD VALUE / usage même transaction).
ALTER TYPE public.owner_notification_kind ADD VALUE IF NOT EXISTS 'STATEMENT_READY';

CREATE TABLE IF NOT EXISTS public.owner_statements (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipowner_id             UUID NOT NULL REFERENCES public.shipowners(id) ON DELETE CASCADE,
  jurisdiction_id          UUID NOT NULL REFERENCES public.jurisdictions(id),
  period_month             DATE NOT NULL,          -- 1er du mois couvert (mois écoulé)
  pdf_path                 TEXT NOT NULL,          -- statements/<shipowner_id>/<YYYY-MM>.pdf
  total_outstanding_usd    NUMERIC(14,2) NOT NULL,
  payments_in_month_usd    NUMERIC(14,2) NOT NULL DEFAULT 0,
  open_count               INT NOT NULL DEFAULT 0,
  generated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shipowner_id, period_month)              -- idempotence du cron
);

CREATE INDEX IF NOT EXISTS idx_owner_statements_owner ON public.owner_statements(shipowner_id, period_month DESC);

ALTER TABLE public.owner_statements ENABLE ROW LEVEL SECURITY;

-- Armateur : lit ses propres relevés (via shipowners.profile_id = auth.uid()).
CREATE POLICY "owner reads own statements" ON public.owner_statements FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.shipowners s WHERE s.id = owner_statements.shipowner_id AND s.profile_id = auth.uid()));

-- Staff : lit les relevés de ses juridictions (même patron que collection_reminders, mig 099).
CREATE POLICY "staff reads statements" ON public.owner_statements FOR SELECT
  USING (public.is_admin_or_officer() AND jurisdiction_id = ANY(public.current_jurisdiction_ids()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_statements TO service_role;

-- DOWN:
-- DROP TABLE IF EXISTS public.owner_statements;
-- (l'enum ADD VALUE n'est pas réversible — Postgres ne supporte pas DROP VALUE)
```

### PDF — `frontend/src/services/invoiceService.ts` (ou `statementService.ts`)

```ts
export interface StatementLine { invoiceRef: string; vesselName: string; issuedAt: string; ageDays: number; outstandingUsd: number; }
export interface StatementPayment { confirmedAt: string; receiptRef: string | null; amountUsd: number; }
export interface StatementData {
  ownerName: string;
  jurisdiction: string;          // nom souverain, pied de page
  periodLabel: string;           // ex. "July 2026"
  openLines: StatementLine[];
  payments: StatementPayment[];
  totalOutstandingUsd: number;
  paymentsInMonthUsd: number;
}
export function generateStatementPdf(data: StatementData): Promise<Uint8Array>;
```

Réutilise `fmtUsd`, `drawSomalilandFlag`/l'en-tête et le pied souverain de `generateInvoicePdf`, **sans** `resolveInvoiceArtifacts`/QR/HMAC/préambule légal/sceau. En pied ou en tête : mention « Informational account statement — not an invoice or formal notice ».

### Service — `frontend/src/services/statementService.ts`

```ts
export interface OwnerStatementInput { shipownerId: string; periodStart: Date; periodEnd: Date; /* [1er mois écoulé, 1er mois courant) */ }
export interface OwnerStatementResult {
  openLines: StatementLine[]; payments: StatementPayment[];
  totalOutstandingUsd: number; paymentsInMonthUsd: number; openCount: number;
}
/** Compose les données du relevé d'un armateur : pro-formas ouvertes + paiements du mois. */
export async function composeOwnerStatement(admin: SupabaseClient, input: OwnerStatementInput & { shipowner: { name; jurisdiction_id } }): Promise<OwnerStatementResult>;
/** Chemin de stockage du PDF. */
export function statementStoragePath(shipownerId: string, periodStart: Date): string; // statements/<shipownerId>/<YYYY-MM>.pdf
```

`composeOwnerStatement` : pro-formas ouvertes = `transactions` `document_type='PROFORMA'`, `status ∈ {PENDING,OVERDUE}`, `shipowner_id`, avec `outstanding = tax_amount_usd - COALESCE(partial_paid_usd,0)` ; paiements = `payments` `status='CONFIRMED'`, `shipowner_id`, `confirmed_at ∈ [periodStart, periodEnd)`, montant `amount_usd_minor/100`. Fonctions pures/isolées testables (le calcul de total, l'agrégation) séparées du I/O.

### Cron — `frontend/src/app/api/cron/monthly-statements/route.ts`

Patron `collection-reminders` : `runtime='nodejs'`, `dynamic='force-dynamic'`, auth `Bearer CRON_SECRET` → 401, `createPlatformClient` (hook `__setClientForTest`), `scopedLogger('cron.monthly-statements')`. `?dryRun=1` supporté (patron `monthly-settlement-export`).

Période = **mois écoulé** : `periodStart = 1er du mois précédent`, `periodEnd = 1er du mois courant`. Par armateur à solde dû > 0 (charge `shipowners` joints à leur outstanding, ou itère les lignes `v_armateur_recouvrement`/`v_compagnie_recouvrement` avec `total_outstanding_usd > 0`, dédupliqué par `shipowner_id`) :
1. `composeOwnerStatement(...)`.
2. `generateStatementPdf(...)` → `admin.storage.from('documents').upload(statementStoragePath(...), buf, { contentType:'application/pdf', upsert:true })`.
3. `upsert owner_statements` sur `(shipowner_id, period_month)` (idempotent).
4. `notifyOwner(admin, { shipownerId, kind:'STATEMENT_READY', params:{ period, total_outstanding_usd, statement_id }, deepLink:'/owner/invoices', attachments:{ pdfBuffer, filename:'statement-<YYYY-MM>.pdf' } })`.

Ajout à `vercel.json` : `{ "path": "/api/cron/monthly-statements", "schedule": "0 6 1 * *" }`.

### Notification — `STATEMENT_READY`

- `notificationService.ts` : `NotificationKind` gagne `'STATEMENT_READY'` ; ajout à `EMAIL_KINDS` ; branche `case 'STATEMENT_READY'` dans `notifyOwner`.
- `emailService.ts` : `sendStatementReadyEmail({ to, recipientName, periodLabel, totalOutstandingUsd, pdfBuffer })` (patron `sendProformaIssuedEmail`) — PDF joint + bouton portail `${appUrl()}/owner/invoices`.
- `notificationEmailDispatch.ts` : branche `case 'STATEMENT_READY'` (le loop rejoue les rows non envoyées).

### Portail — section « Relevés » + téléchargement

- `OperatorInvoicesPage.tsx` : charge `owner_statements` de l'armateur (`principal.supabase`, RLS), rend une section/table « Statements » (période, total dû, lien télécharger). Miroir léger d'`InvoicesTable`, sans wizard/paiement.
- Route de téléchargement owner-scopée `frontend/src/app/api/statements/[id]/download/route.ts` : **(1)** avec le client **session armateur** (`createClient` serveur, RLS), lit `owner_statements` par `id` — la policy `owner reads own statements` garantit que seul le propriétaire obtient une ligne (sinon 404, indistinct de « inexistant »). **(2)** la ligne trouvée, mint l'URL signée avec un client **service** (`createPlatformClient`) car le bucket `documents` est privé : `createSignedUrl(pdf_path, 300)`, puis 302. **Pas de HMAC** (informatif) — l'autorisation vient de la RLS de l'étape 1, pas d'une signature d'URL.
- i18n : clés de la section relevés dans le namespace du portail owner, 6 locales.

## Flux de données

```
Vercel cron 0 6 1 * *  → /api/cron/monthly-statements (auth CRON_SECRET)
   période = mois écoulé
   pour chaque armateur (outstanding > 0, maritime + aviation) :
     composeOwnerStatement → { openLines, payments, totals }
     generateStatementPdf  → upload statements/<owner>/<YYYY-MM>.pdf
     upsert owner_statements (idempotent (owner, month))
     notifyOwner(STATEMENT_READY, attach pdfBuffer, deepLink /owner/invoices)
        → notification-email-loop → sendStatementReadyEmail (PDF joint + lien)

Portail armateur → OperatorInvoicesPage
   section Relevés (owner_statements, RLS) → /api/statements/<id>/download (URL signée 5 min)
```

## Gestion des erreurs

| Cas | Comportement |
|---|---|
| Armateur sans e-mail | PDF stocké + ligne `owner_statements` créée (consultable au portail) ; notif insérée, l'envoi e-mail est sauté par le loop (pas de destinataire). |
| Échec PDF/upload d'un armateur | Loggé (WARN), on continue — un armateur ne bloque pas les autres. |
| Solde dû nul | Armateur ignoré (pas de relevé « rien à payer »). |
| Relance du cron même mois | `upsert` réécrit le PDF + la ligne ; pas de doublon (unique `(owner, month)`). |
| Auth cron absente/mauvaise | 401. |
| Téléchargement d'un relevé d'autrui | RLS `owner reads own statements` filtre → introuvable. |

## Tests

**Composition (`statementService`).** Pro-formas ouvertes filtrées PENDING/OVERDUE + `outstanding = tax - partial_paid` ; paiements du mois sommés depuis `amount_usd_minor/100` avec bornes `[start,end)` ; total dû = somme des outstanding ; `open_count`. Nomenclature `statementStoragePath` (YYYY-MM). Fonctions pures testées sans I/O.

**PDF (`generateStatementPdf`).** Produit un `Uint8Array` non vide ; ne contient pas de QR/verifyUrl ; le nom souverain de la juridiction figure ; la mention informative figure. (Test léger — présence, pas rendu pixel.)

**Cron.** Faux client : un armateur à solde > 0 → compose + upload + upsert + `notifyOwner` appelé avec `STATEMENT_READY` + `attachments.pdfBuffer` ; un armateur à solde 0 → ignoré ; idempotence (2ᵉ passe upsert, pas d'insert doublon) ; `?dryRun=1` n'écrit rien ; sans `CRON_SECRET` → 401.

**Notif/portail.** `dispatchNotificationEmail` route `STATEMENT_READY` → `sendStatementReadyEmail`. Téléchargement : relevé d'autrui refusé par RLS.

## Risques et points ouverts

- **Volume du cron** : 656 pro-formas / N armateurs — le cron génère N PDF en une passe mensuelle. Borner par un `limit` raisonnable et logguer si des armateurs sont tronqués (patron `ROW_LIMIT` du loop) ; à N actuel c'est négligeable, mais ne pas tronquer silencieusement.
- **`INVOICE_SIGNING_SECRET`** n'est **pas** requis (le relevé n'est pas signé) — contrairement à l'émission fiscale.
- **Souverain du PDF** : réutiliser `fetchJurisdictionName` pour nommer l'État, jamais coder « Somaliland » en dur (leçon du chantier A).
- **Traductions non-anglaises** = baseline auto à relire natif.
- **Extraction PDF** : les helpers `fmtUsd`/en-tête/pied sont module-privés dans `invoiceService.ts` ; `generateStatementPdf` y vit donc (ou on extrait ces helpers dans un module partagé). Rester dans `invoiceService.ts` évite une extraction risquée — recommandé.

## Phase 2 (hors périmètre, notée)

Pro-forma **consolidée payable** : un document fiscal avec sa propre référence, regroupant les créances ouvertes d'un armateur, et la mécanique de répartition d'un règlement unique sur les transactions filles (paiement groupé → ventilation `partial_paid_usd`/`payments`). Chantier distinct, à spécifier séparément.
