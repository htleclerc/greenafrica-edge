# Plan 7 — Shipowner Portal v1 ("Owner Experience")

**Date**: 2026-05-01
**Status**: Design approved — pending implementation plan
**Predecessor**: [Plan 6 — Shipowner Portal v0](../plans/2026-04-27-plan-6-shipowner-portal.md) (merged)
**Master spec**: [`2026-04-22-proactive-vessel-detection-and-proforma-design.md`](2026-04-22-proactive-vessel-detection-and-proforma-design.md) §6.7

> Refonte de fond en comble du parcours armateur : self-service hybride, onboarding KYC en deux temps, notifications email + in-app, et une plateforme de paiement multi-rail (10 rails) avec wallet bidirectionnel, multi-devise, paiements partiels, reçus PDF, refunds multi-rail.

---

## 1 — Résumé exécutif

### Ce qui change vs Plan 6 v0

| Domaine | Plan 6 v0 (livré) | Plan 7 v1 (cible) |
|---|---|---|
| Inscription | Invitation admin uniquement | **Self-service hybride** : auto-claim si IMO match GHOST, sinon review admin |
| Onboarding | Magic link → ACTIVE | KYC niveau B au signup (identité + preuve) + niveau C avant 1er paiement (facturation + RIB) |
| Notifications | Email Resend best-effort | **Email + in-app cloche** ; téléphone collecté pour SMS dormant |
| Paiement | 1 rail "déclaration intention" textuelle | **10 rails** : Stripe, Wire, Cash, Cheque, LC, Netting, Third-party, Mobile Money, Bank Guarantee, Wallet |
| Devises | USD only implicite | **Multi-devise** (USD/EUR/GBP/AED/KES/SOS) avec taux figé à validation |
| Paiement partiel | Non supporté | **N paiements par transaction**, status `PENDING → PARTIALLY_PAID → PAID` |
| Wallet | Inexistant | **Bidirectionnel** : top-up volontaire + sur-paiement → crédit ; imputation auto sur PROFORMA |
| Reçu | Aucun (FINAL fait office) | **Reçu PDF dédié** par paiement confirmé, HMAC + QR |
| Refund | Géré comme transaction REFUND négative (Plan 4) | **Table refunds dédiée**, choix admin du rail par dossier |
| Autorisation | Plat | **Matriciel** : FINANCE_ADMIN / SUPERADMIN / dual-control selon rail |

### Différentiateur produit

**"Tous les modes de paiement supportés"** — virement, carte, cash, chèque, LC, compensation, paiement par tiers, mobile money, garantie bancaire, wallet pré-financé. Aucune autre plateforme de taxe carbone maritime régionale n'offre cette amplitude. C'est l'avantage compétitif pour onboarder les majors (Maersk, MSC, CMA CGM) et les opérateurs régionaux mixtes.

### Estimation effort

10 à 14 sessions, soit **3 à 4 semaines** sur cadence actuelle. Phasage en 8 phases (A à H) découplées et déployables indépendamment derrière feature flags.

---

## 2 — Décisions de cadrage (Q&A condensé)

| Q | Décision retenue | Rationale |
|---|---|---|
| Mode d'inscription | **C — Self-service hybride** | Couvre le cas fréquent "armateur déjà GHOST" tout en sécurisant les inconnus |
| Profondeur KYC | **B au signup, C avant 1er paiement** | Conversion + complétude au moment où ça compte |
| Canaux notif | **Email + in-app cloche**, SMS dormant | ROI optimal, infra prête pour SMS Phase 2 |
| Provider en ligne | **Stripe via entité UK** | Confirmé par utilisateur ; couvre carte, Apple/Google Pay, ACH/SEPA |
| Rails simultanés | **Tous en V1** (10 rails) | Différentiateur produit majeur explicitement priorisé |
| Multi-devise | **C — accepter toute devise majeure**, taux du jour figé | Maximise conversion sans risque FX assumé |
| Paiement partiel | **B — N paiements par transaction** | Réflète la réalité opérationnelle (acompte + solde, mix rails) |
| Sur-paiement | **B — wallet credit auto** | Cohérent avec wallet bidirectionnel ; pas de friction |
| Refund rail | **C — choix admin par dossier** | WALLET souvent optimal mais admin garde la main |
| Architecture | **Approche 2 — refonte ciblée** | Schéma propre dès v1, dette minimisée |
| Stripe Checkout vs Elements | **Checkout (hosted)** | PCI-out-of-scope, multilingue natif, redirect acceptable |
| Imputation wallet | **Trigger Postgres** | Atomicité forte sur cas concurrents |
| Validation rails out-of-band | **Manuelle en v1** | Pas de parsing fichier banque automatique |
| Caissier | **Sous-permission `can_record_cash` sur PORT_OFFICER** | Évite création nouveau rôle |
| Reçu PDF | **Systématique à chaque CONFIRMED** | Standard attendu en compta armateur |
| Signataire PDF | **"Director, Solid Technology"** | Mémoire — JAMAIS "Maritime Carbon Tax Authority" |

---

## 3 — Architecture globale

```
                         ┌─────────────────────────┐
                         │   /owner/* (Next.js)    │
                         │   - register / login    │
                         │   - dashboard / wallet  │
                         │   - vessels / alerts    │
                         │   - invoices / pay      │
                         │   - notifications bell  │
                         └────────────┬────────────┘
                                      │ Supabase RLS
                                      ↓
┌──────────────┐  ┌─────────────────────────────────────────┐
│   Stripe     │  │ Postgres (Supabase)                     │
│   webhook    │→ │  ┌────────────────┐   ┌──────────────┐  │
│              │  │  │ shipowners     │   │ profiles     │  │
└──────┬───────┘  │  │ + KYC fields   │   │ (SHIPOWNER)  │  │
       │          │  └────────────────┘   └──────────────┘  │
       │          │  ┌────────────────────────────────────┐ │
       │          │  │ payments (10-rail, JSONB details)  │ │
       ↓          │  │ payment_proofs (Storage URLs)      │ │
┌──────────────┐  │  └────────────────────────────────────┘ │
│ /api/webhooks│  │  ┌──────────────┐ ┌─────────────────┐   │
│ /stripe      │→ │  │ wallets      │ │ wallet_ledger   │   │
└──────────────┘  │  │ (1 per owner)│ │ (double-entry)  │   │
                  │  └──────────────┘ └─────────────────┘   │
                  │  ┌──────────────────────────────────┐   │
                  │  │ transactions (existing, hooked)  │   │
                  │  │  status: PENDING / PARTIALLY_… / │   │
                  │  │          PAID / REFUNDED         │   │
                  │  └──────────────────────────────────┘   │
                  │  ┌──────────────────────────────────┐   │
                  │  │ owner_notifications              │   │
                  │  │ refunds (rail-aware)             │   │
                  │  │ fx_rates (cache)                 │   │
                  │  └──────────────────────────────────┘   │
                  └─────────────────────────────────────────┘
                                      │
                                      ↓
                  ┌──────────────────────────────────┐
                  │ /admin/payments (FINANCE_ADMIN)  │
                  │ /admin/registrations (review)    │
                  │ /admin/refunds                   │
                  │ /admin/cash-desk (PORT_OFFICER+) │
                  │ /admin/wallets (SUPERADMIN)      │
                  └──────────────────────────────────┘
```

### Stack & dépendances

- Next.js 16 / React 19 / TypeScript strict / TailwindCSS v4 (existant)
- Supabase Postgres 17 + Auth + Storage (existant)
- Stripe SDK Node + React Stripe.js
- jsPDF + qrcode (existants pour proforma/final)
- React Email pour templates Resend (existant)
- Zod (existant pour validation server actions)
- OpenExchangeRates API (nouveau — pour fx_rates)
- Pas de Go backend modifié en v1 (Stripe webhook = Next.js route)

---

## 4 — Schéma de base de données

8 nouvelles migrations (040-047). Chaque migration livrée avec ses tests SQL d'isolation RLS et d'invariants.

### 4.1 — `040_shipowner_kyc_extensions.sql`

```sql
-- Étend l'enum d'état du compte armateur
ALTER TYPE public.shipowner_account_state
  ADD VALUE 'PENDING_REVIEW' BEFORE 'INVITED';
ALTER TYPE public.shipowner_account_state
  ADD VALUE 'REJECTED' AFTER 'ACTIVE';
ALTER TYPE public.shipowner_account_state
  ADD VALUE 'SUSPENDED' AFTER 'REJECTED';

-- Cycle de vie cible :
--   GHOST → INVITED | PENDING_REVIEW → ACTIVE → (SUSPENDED | REJECTED)

ALTER TABLE public.shipowners ADD COLUMN
  -- KYC niveau B (signup obligatoire)
  imo_company_no_verified_at TIMESTAMPTZ,
  proof_imo_vessel_imo TEXT,                 -- IMO du navire fourni en preuve
  proof_doc_url TEXT,                         -- registre commerce / cert (Storage)
  proof_doc_type TEXT CHECK (proof_doc_type IN
    ('TRADE_REGISTER','CERT_INCORPORATION','MOA','OTHER')),
  phone_e164 TEXT,                            -- collecté pour SMS dormant
  preferred_language TEXT NOT NULL DEFAULT 'en'
    CHECK (preferred_language IN ('en','fr','ar','pt','sw')),

  -- KYC niveau C (avant 1er paiement, bloquant pour tx d'argent)
  billing_legal_name TEXT,
  billing_address_line1 TEXT,
  billing_address_line2 TEXT,
  billing_city TEXT,
  billing_postal_code TEXT,
  billing_country_code TEXT,                  -- ISO-3166-1 alpha-2
  vat_number TEXT,
  iban TEXT,                                  -- chiffré (pgsodium ou Vault)
  swift_bic TEXT,
  bank_name TEXT,
  kyc_level_b_completed_at TIMESTAMPTZ,
  kyc_level_c_completed_at TIMESTAMPTZ,
  rejection_reason TEXT;
```

### 4.2 — `041_payments_polymorphic.sql`

```sql
CREATE TYPE public.payment_rail AS ENUM (
  'STRIPE', 'WIRE_TRANSFER', 'CASH', 'CHEQUE', 'LETTER_OF_CREDIT',
  'NETTING', 'THIRD_PARTY', 'MOBILE_MONEY', 'BANK_GUARANTEE', 'WALLET'
);

CREATE TYPE public.payment_status AS ENUM (
  'INITIATED', 'PROCESSING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'REFUNDED'
);

CREATE TABLE public.payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID REFERENCES public.transactions(id) ON DELETE RESTRICT,
  shipowner_id    UUID NOT NULL REFERENCES public.shipowners(id),
  declared_by     UUID REFERENCES public.profiles(id),
  amount_minor    BIGINT NOT NULL CHECK (amount_minor > 0),
  currency        TEXT   NOT NULL CHECK (length(currency) = 3),
  amount_usd_minor BIGINT NOT NULL,
  fx_rate         NUMERIC(18,8),
  fx_rate_source  TEXT,
  fx_rate_locked_at TIMESTAMPTZ,
  rail            public.payment_rail NOT NULL,
  rail_details    JSONB NOT NULL DEFAULT '{}'::jsonb,
  external_reference TEXT,
  status          public.payment_status NOT NULL DEFAULT 'INITIATED',
  rejected_reason TEXT,
  confirmed_by    UUID REFERENCES public.profiles(id),
  confirmed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (
    (currency = 'USD' AND amount_minor = amount_usd_minor AND fx_rate IS NULL)
    OR (currency <> 'USD' AND fx_rate IS NOT NULL AND fx_rate > 0)
  ),
  CHECK (
    (status <> 'CONFIRMED') OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
  ),
  CHECK (
    NOT (rail = 'STRIPE' AND status IN ('PROCESSING','CONFIRMED','REFUNDED')
         AND external_reference IS NULL)
  )
);

CREATE INDEX idx_payments_owner_status ON public.payments(shipowner_id, status);
CREATE INDEX idx_payments_txn ON public.payments(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX idx_payments_external_ref ON public.payments(external_reference)
  WHERE external_reference IS NOT NULL;
CREATE INDEX idx_payments_pending_admin ON public.payments(rail, status)
  WHERE status IN ('INITIATED','PROCESSING');
```

#### Shape de `rail_details` par rail

Validé Zod côté app, documenté dans `paymentService.ts` :

| Rail | rail_details JSON |
|---|---|
| STRIPE | `{ stripe_payment_intent_id, stripe_charge_id, payment_method_type, last4 }` |
| WIRE_TRANSFER | `{ swift_ref, payer_iban, payer_bic, payer_bank, value_date, narration }` |
| CASH | `{ receipt_number, cashier_id, cash_desk_location }` |
| CHEQUE | `{ cheque_number, cheque_date, drawer_bank, drawer_name, photo_url }` |
| LETTER_OF_CREDIT | `{ lc_number, issuing_bank, confirming_bank, advice_number, expiry_date }` |
| NETTING | `{ counterparty_invoice_ref, agreement_doc_url, justification }` |
| THIRD_PARTY | `{ payer_name, payer_relationship, mandate_doc_url, original_rail }` |
| MOBILE_MONEY | `{ provider, transaction_id, payer_msisdn, screenshot_url }` |
| BANK_GUARANTEE | `{ guarantee_number, issuing_bank, expiry_date, guarantee_doc_url }` |
| WALLET | `{ wallet_id, ledger_entry_id }` |

### 4.3 — `042_payment_proofs.sql`

```sql
CREATE TABLE public.payment_proofs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  storage_path    TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size_bytes      INT  NOT NULL,
  uploaded_by     UUID NOT NULL REFERENCES public.profiles(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  description     TEXT
);
CREATE INDEX idx_proofs_payment ON public.payment_proofs(payment_id);
```

Bucket Supabase Storage **`payment-proofs`** privé. RLS calquée sur `payments` (armateur lit ses preuves, FINANCE_ADMIN lit tout).

### 4.4 — `043_wallets_and_ledger.sql`

```sql
CREATE TABLE public.wallets (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipowner_id             UUID NOT NULL UNIQUE REFERENCES public.shipowners(id),
  balance_usd_minor        BIGINT NOT NULL DEFAULT 0,
  auto_apply_to_proforma   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (balance_usd_minor >= 0)
);

CREATE TYPE public.ledger_entry_kind AS ENUM (
  'TOPUP', 'OVERPAYMENT_CREDIT', 'REFUND_CREDIT',
  'PROFORMA_APPLY', 'ADMIN_ADJUSTMENT', 'FX_DIFFERENCE'
);

CREATE TABLE public.wallet_ledger (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id                UUID NOT NULL REFERENCES public.wallets(id),
  amount_signed_usd_minor  BIGINT NOT NULL,
  kind                     public.ledger_entry_kind NOT NULL,
  payment_id               UUID REFERENCES public.payments(id),
  transaction_id           UUID REFERENCES public.transactions(id),
  refund_id                UUID,                       -- forward decl. → 045
  created_by               UUID NOT NULL REFERENCES public.profiles(id),
  justification            TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (amount_signed_usd_minor <> 0),
  CHECK (kind <> 'ADMIN_ADJUSTMENT' OR justification IS NOT NULL)
);

CREATE INDEX idx_ledger_wallet_created ON public.wallet_ledger(wallet_id, created_at DESC);

CREATE FUNCTION public.apply_ledger_to_wallet() RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.wallets
     SET balance_usd_minor = balance_usd_minor + NEW.amount_signed_usd_minor,
         updated_at = NOW()
   WHERE id = NEW.wallet_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_apply
  AFTER INSERT ON public.wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION public.apply_ledger_to_wallet();
```

**Invariant testé** : `wallets.balance_usd_minor = SUM(wallet_ledger WHERE wallet_id=wallet.id)`. Test SQL bloquant en CI.

### 4.5 — `044_transactions_partial_payment.sql`

```sql
ALTER TYPE public.transaction_status ADD VALUE 'PARTIALLY_PAID' AFTER 'PENDING';

CREATE OR REPLACE VIEW public.transaction_paid_summary AS
  SELECT t.id AS transaction_id,
         t.tax_amount_usd_minor AS due_usd_minor,
         COALESCE(SUM(p.amount_usd_minor), 0) AS paid_usd_minor,
         t.tax_amount_usd_minor - COALESCE(SUM(p.amount_usd_minor), 0) AS remaining_usd_minor
    FROM public.transactions t
    LEFT JOIN public.payments p
      ON p.transaction_id = t.id AND p.status = 'CONFIRMED'
   GROUP BY t.id;

CREATE FUNCTION public.recompute_transaction_status(txn_id UUID) RETURNS VOID AS $$
DECLARE
  s RECORD;
BEGIN
  SELECT * INTO s FROM public.transaction_paid_summary WHERE transaction_id = txn_id;
  UPDATE public.transactions SET status =
    CASE
      WHEN s.paid_usd_minor >= s.due_usd_minor THEN 'PAID'::public.transaction_status
      WHEN s.paid_usd_minor > 0 THEN 'PARTIALLY_PAID'::public.transaction_status
      ELSE 'PENDING'::public.transaction_status
    END
   WHERE id = txn_id;
END $$ LANGUAGE plpgsql;
```

Trigger sur `payments` AFTER UPDATE OF `status` appelle `recompute_transaction_status` quand `NEW.status = 'CONFIRMED'`.

### 4.6 — `045_refunds.sql`

```sql
CREATE TYPE public.refund_status AS ENUM
  ('REQUESTED', 'APPROVED', 'EXECUTED', 'REJECTED');

CREATE TABLE public.refunds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES public.transactions(id),
  shipowner_id    UUID NOT NULL REFERENCES public.shipowners(id),
  amount_usd_minor BIGINT NOT NULL CHECK (amount_usd_minor > 0),
  refund_rail     public.payment_rail NOT NULL,
  rail_details    JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          public.refund_status NOT NULL DEFAULT 'REQUESTED',
  requested_by    UUID REFERENCES public.profiles(id),
  approved_by     UUID REFERENCES public.profiles(id),
  executed_by     UUID REFERENCES public.profiles(id),
  executed_at     TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_refunds_owner ON public.refunds(shipowner_id, status);

ALTER TABLE public.wallet_ledger
  ADD CONSTRAINT fk_ledger_refund
  FOREIGN KEY (refund_id) REFERENCES public.refunds(id);
```

### 4.7 — `046_owner_notifications.sql`

```sql
CREATE TYPE public.owner_notification_kind AS ENUM (
  'KYC_APPROVED', 'KYC_REJECTED', 'KYC_C_REQUIRED',
  'ALERT_DETECTED', 'PROFORMA_ISSUED', 'PROFORMA_REMINDER',
  'PAYMENT_RECEIVED', 'PAYMENT_REJECTED',
  'FINAL_ISSUED', 'COMPLEMENT_ISSUED', 'REFUND_ISSUED',
  'WALLET_TOPPED_UP', 'WALLET_APPLIED', 'WALLET_LOW_BALANCE',
  'DISPUTE_UPDATED', 'OWNER_ESCALATION'
);

CREATE TABLE public.owner_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipowner_id    UUID NOT NULL REFERENCES public.shipowners(id) ON DELETE CASCADE,
  kind            public.owner_notification_kind NOT NULL,
  title_key       TEXT NOT NULL,
  body_key        TEXT NOT NULL,
  body_params     JSONB NOT NULL DEFAULT '{}'::jsonb,
  deep_link       TEXT,
  read_at         TIMESTAMPTZ,
  emailed_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notif_owner_unread ON public.owner_notifications(shipowner_id, read_at)
  WHERE read_at IS NULL;
```

### 4.8 — `047_fx_rates_cache.sql`

```sql
CREATE TABLE public.fx_rates (
  base_ccy        TEXT NOT NULL,
  quote_ccy       TEXT NOT NULL,
  rate            NUMERIC(18,8) NOT NULL,
  source          TEXT NOT NULL,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (base_ccy, quote_ccy, fetched_at)
);
CREATE INDEX idx_fx_recent ON public.fx_rates(quote_ccy, fetched_at DESC);
```

`pg_cron` job `fx-refresh` toutes les heures pour devises listées dans `app_config.fx.allowed_currencies`.

### 4.9 — Migration vers Plan 7 depuis Plan 6 v0

`041` renomme `shipowner_payment_intents` → `payments` avec colonnes étendues. Script de migration des lignes existantes (probablement vide en prod, présent par sécurité) :

```sql
-- Mapper Plan 6 v0 (textual reference) → Plan 7 polymorphe
INSERT INTO public.payments (
  id, transaction_id, shipowner_id, declared_by, amount_minor, currency,
  amount_usd_minor, rail, rail_details, status, ..., created_at
)
SELECT
  id, transaction_id, owner_profile_id::UUID, declared_by,
  -- Plan 6 v0 n'avait pas de montant : on reprend transaction.tax_amount
  (SELECT tax_amount_usd_minor FROM public.transactions WHERE id = pi.transaction_id),
  'USD',
  (SELECT tax_amount_usd_minor FROM public.transactions WHERE id = pi.transaction_id),
  'WIRE_TRANSFER',                       -- v0 default
  jsonb_build_object('legacy_reference', reference),
  CASE pi.status
    WHEN 'DECLARED' THEN 'INITIATED'::public.payment_status
    WHEN 'CONFIRMED' THEN 'CONFIRMED'::public.payment_status
    WHEN 'REJECTED' THEN 'REJECTED'::public.payment_status
  END,
  ...
  pi.created_at
FROM public.shipowner_payment_intents pi;

DROP TABLE public.shipowner_payment_intents CASCADE;
```

---

## 5 — Onboarding & inscription

### 5.1 — Self-service `/owner/register` (page publique)

Formulaire 1 étape, KYC niveau B obligatoire :

| Champ | Type | Obligatoire | Validation |
|---|---|---|---|
| Email | input | ✓ | RFC 5322 + DNS MX check |
| Nom société | input | ✓ | 2-200 chars |
| IMO Company Number | input | ✓ | 7 chiffres exactement |
| Pays (ISO-2) | select | ✓ | liste ISO-3166-1 |
| Adresse | textarea | ✓ | 5-500 chars |
| IMO d'un de vos navires | input | ✓ | 7 chiffres + DOIT exister dans `vessels` |
| Document de preuve | file | ✓ | PDF ou image, ≤ 5 Mo |
| Type de document | select | ✓ | TRADE_REGISTER / CERT_INCORPORATION / MOA / OTHER |
| Téléphone E.164 | input | ✗ | format E.164 si rempli |
| Langue préférée | select | ✓ | en/fr/ar/pt/sw |
| reCAPTCHA v3 | hidden | ✓ | score ≥ 0.5 |

**Rate limit** `/api/auth/register-shipowner` : 3/jour/IP, 10/heure/IP (plus strict que `/api/auth/register` à 5/min).

### 5.2 — Décision auto-claim vs review (`registerShipowner` action)

```
Soumission formulaire
  ↓
Validation Zod + reCAPTCHA + rate limit
  ↓
Lookup vessels.imo_no = proof_imo
  ├─ trouvé ET vessels.shipowner_id = X
  │    ↓
  │  Lookup shipowners X
  │    ├─ X.account_state = 'GHOST' AND X.imo_company_no = req.imo_company
  │    │    ↓ AUTO-CLAIM
  │    │  UPDATE shipowners X (name, address, phone, lang, proof_*,
  │    │    imo_company_no_verified_at=NOW(), kyc_level_b_completed_at=NOW(),
  │    │    account_state='ACTIVE')
  │    │  INSERT profiles (role=SHIPOWNER, is_active=true)
  │    │  shipowners.profile_id = profiles.id
  │    │  INSERT wallets (balance=0, auto_apply=true)
  │    │  supabase.auth.admin.inviteUserByEmail(email)
  │    │  INSERT owner_notifications kind=KYC_APPROVED
  │    │  audit_logs kind='SHIPOWNER_AUTO_CLAIM'
  │    │
  │    ├─ X.account_state = 'GHOST' MAIS imo_company mismatch
  │    │    ↓ HARD REJECT (anti-enumeration)
  │    │  Generic message "Demande reçue, traitement sous 48h"
  │    │  INSERT shipowners (PENDING_REVIEW)
  │    │
  │    └─ X.account_state ∈ ('INVITED','ACTIVE','SUSPENDED','REJECTED')
  │         ↓ HARD REJECT, message identique
  │       Pas d'insert (alerte admin si vol de compte présumé)
  │
  ├─ vessel trouvé MAIS vessels.shipowner_id IS NULL
  │    ↓ INSERT shipowners PENDING_REVIEW + notif admin
  │
  └─ vessel non trouvé
       ↓ INSERT shipowners PENDING_REVIEW (admin tranche)
```

**Trois invariants** :
1. Le message de retour est **identique** dans tous les cas non-auto-claim.
2. L'auto-claim **n'écrase JAMAIS** un `shipowners` non-GHOST.
3. L'IMO company doit correspondre **exactement** au GHOST row pour auto-claim.

### 5.3 — Page admin `/admin/registrations`

Liste paginée des `shipowners` en `account_state='PENDING_REVIEW'`. Action gated `SUPERADMIN | MANAGER`.

Par ligne : aperçu, "Voir document", **Approuver** / **Rejeter** (modale motif) / **Demander complément** (email semi-pré-rempli).

Filtres : "À traiter" (default), "Rejetés", "Approuvés". Badge rouge si âge demande > 48h (SLA visible).

### 5.4 — KYC niveau C — wizard post-login

Au login d'un armateur ACTIVE sans `kyc_level_c_completed_at`, `OwnerShell` affiche un **banner persistant** : "Complétez votre profil de facturation avant votre premier paiement". Click → `/owner/onboarding/billing`.

Banner **non bloquant** pour lecture (alerts/vessels/invoices/dashboard) mais **bloquant** pour : `PayDialog`, `topUpWallet`, `openDispute`.

Wizard 3 étapes :
1. **Identité légale facturation** : raison sociale facturation, adresse complète, ISO-2 pays, ville, code postal, n° TVA optionnel.
2. **Coordonnées bancaires REFUND** : IBAN, SWIFT/BIC, banque. Stocké chiffré (pgsodium ou Supabase Vault selon dispo).
3. **Récap + accept Terms & Privacy** : checkbox CGV + horodatage `audit_logs`.

À soumission : `kyc_level_c_completed_at = NOW()`, banner disparaît.

---

## 6 — Notifications email + in-app

### 6.1 — Service central `notificationService.notifyOwner`

```typescript
notifyOwner(shipownerId, kind, params, { deepLink? })
  → INSERT owner_notifications
  → si kind ∈ EMAIL_KINDS : SEND email Resend (async, non-bloquant)
  → si feature.sms_enabled && phone_e164 && kind ∈ SMS_KINDS : SEND SMS (dormant v1)
```

### 6.2 — Mapping kind → canal

| kind | in-app | email | SMS (dormant) |
|---|:---:|:---:|:---:|
| KYC_APPROVED / REJECTED / C_REQUIRED | ✓ | ✓ | — |
| ALERT_DETECTED | ✓ | ✓ | — |
| PROFORMA_ISSUED | ✓ | ✓ | ✓ |
| PROFORMA_REMINDER (J+3, J+7) | ✓ | ✓ | ✓ |
| PAYMENT_RECEIVED | ✓ | ✓ | — |
| PAYMENT_REJECTED | ✓ | ✓ | ✓ |
| FINAL_ISSUED / COMPLEMENT_ISSUED | ✓ | ✓ | — |
| REFUND_ISSUED | ✓ | ✓ | — |
| WALLET_TOPPED_UP | ✓ | ✓ | — |
| WALLET_APPLIED | ✓ | — | — |
| WALLET_LOW_BALANCE | ✓ | ✓ | — |
| DISPUTE_UPDATED | ✓ | ✓ | — |
| OWNER_ESCALATION | ✓ | ✓ | ✓ |

### 6.3 — `<NotificationBell>` dans OwnerShell

- Badge count non-lus (max "9+")
- Dropdown 10 dernières + lien "Voir tout" → `/owner/notifications`
- Polling 60s (pas de WebSocket en v1)
- Click notif → `read_at = NOW()` + suit `deep_link`

### 6.4 — Templates email Resend

Tous dans `frontend/src/email-templates/owner/*.tsx` (React Email, déjà utilisé). Sélection langue via `shipowners.preferred_language`, fallback EN.

| Template | Trigger |
|---|---|
| `welcome.tsx` | KYC_APPROVED |
| `kyc-rejected.tsx` | KYC_REJECTED |
| `kyc-c-required.tsx` | reminder J+7 ACTIVE sans KYC C |
| `proforma-issued.tsx` | PROFORMA_ISSUED (PDF en pj, réutilise Plan 3) |
| `proforma-reminder.tsx` | J+3 et J+7 |
| `payment-received.tsx` | PAYMENT_RECEIVED (reçu PDF en pj) |
| `payment-rejected.tsx` | PAYMENT_REJECTED + motif |
| `refund-issued.tsx` | REFUND_ISSUED |
| `wallet-topup-confirmed.tsx` | WALLET_TOPPED_UP |

EN/FR en v1. AR/PT/SW reportés P2 (cohérent dette i18n existante).

### 6.5 — Triggers de notifications dans pipeline existant

| Endroit | Quand | Quoi |
|---|---|---|
| `proformaPipelineService.ts` (Plan 3) | après PROFORMA_SENT | `notifyOwner(...,'PROFORMA_ISSUED', {amount,vessel,dueDate}, {deepLink:/owner/invoices?focus=X})` |
| `pg_cron proforma-reminders` (NEW) | quotidien | scan PROFORMA PENDING age=3,7 → enqueue notif |
| `confirmPayment` action | confirmation | `notifyOwner(...,'PAYMENT_RECEIVED', {receiptUrl})` |
| `reconcilePipelineService.ts` (Plan 4) | FINAL/COMPLEMENT/REFUND | notifs correspondantes |
| `escalateToOwner` action (Plan 5) | escalation | déjà email — ajouter notif in-app si shipowner ACTIVE |

---

## 7 — Paiements & wallet

### 7.1 — `<PayDialog>` armateur multi-rail

Wizard 3 étapes :
1. **Choix du rail** (radio) : Stripe / Wire / Mobile Money / LC / Wallet / Third-party. Rails CASH/CHEQUE/NETTING/BANK_GUARANTEE = admin-only.
2. **Saisie paramètres rail-spécifique** : devise, montant, champs JSONB rail, upload preuve si applicable.
3. **Récap + confirm**.

### 7.2 — Flow par rail

#### STRIPE (en ligne, instantané)

```
initiatePayment({ rail:'STRIPE', txnId, amount, currency })
  → INSERT payments INITIATED
  → stripe.checkout.sessions.create(...)
  → UPDATE payments external_reference, status=PROCESSING
  → return checkout_url
↓
[Armateur paie sur Stripe Checkout]
↓
Webhook payment_intent.succeeded → /api/webhooks/stripe
  → Verify Stripe-Signature (HMAC)
  → Idempotent (skip si déjà CONFIRMED)
  → UPDATE payments status=CONFIRMED
  → recompute_transaction_status(transaction_id)
  → si overpayment : INSERT wallet_ledger OVERPAYMENT_CREDIT
  → INSERT owner_notifications PAYMENT_RECEIVED
  → generate receipt PDF
```

Webhook secret dans `app_config.stripe.webhook_secret` + `STRIPE_WEBHOOK_SECRET` env. Cron `stripe-reconcile-pending` toutes les 15 min ré-interroge Stripe pour paiements `PROCESSING` âgés > 10 min.

#### WIRE_TRANSFER (out-of-band, validation manuelle)

```
initiatePayment({ rail:'WIRE_TRANSFER', ... })
  → INSERT payments INITIATED
  → upload preuves Storage payment-proofs/<owner>/<payment_id>/
  → INSERT payment_proofs
  → email FINANCE_ADMIN
↓
FINANCE_ADMIN /admin/payments?status=INITIATED
  → drawer paiement, télécharge preuve, compare relevé bancaire
  → confirmPayment → CONFIRMED + recompute + wallet credit si overpay + notif + receipt
  OU rejectPayment(motif) → REJECTED + notif PAYMENT_REJECTED
```

CANCEL possible côté armateur jusqu'à validation.

#### Rails 3-9 — Initiation côté admin

`CASH`, `CHEQUE`, `LC`, `NETTING`, `THIRD_PARTY`, `MOBILE_MONEY`, `BANK_GUARANTEE` : armateur ne voit pas dans `<PayDialog>`. L'admin INSERT le row depuis `/admin/payments` → "Enregistrer paiement manuel".

`<RecordManualPaymentDialog>` :
- Sélection armateur (autocomplete) + transaction (filtré shipowner)
- Choix rail dans liste 7 admin-only
- Champs spécifiques + upload preuve(s)
- Choix : "Confirmé immédiatement" (CONFIRMED, admin = validation) ou "À valider" (INITIATED, second admin valide via 4-eyes)

#### Matrice d'autorisation

Encodée dans Postgres function `can_confirm_payment(payment_id, profile_id) RETURNS BOOLEAN` réutilisée RLS + server actions.

| Rail | Initiator | Confirmer |
|---|---|---|
| STRIPE | armateur | webhook (système) |
| WIRE_TRANSFER | armateur OU admin | FINANCE_ADMIN |
| MOBILE_MONEY | armateur OU admin | FINANCE_ADMIN |
| CASH | admin (caissier) | FINANCE_ADMIN ≠ caissier (4-eyes) |
| CHEQUE | admin | FINANCE_ADMIN |
| LETTER_OF_CREDIT | admin | FINANCE_ADMIN |
| THIRD_PARTY | armateur OU admin | FINANCE_ADMIN |
| NETTING | admin | SUPERADMIN |
| BANK_GUARANTEE | admin | SUPERADMIN |
| WALLET | armateur OU système | aucune (auto) |

#### WALLET

Imputation depuis solde — armateur clique "Imputer mon wallet" :
```
applyWallet({ txnId, amount }) [transaction PG atomique]
  → INSERT payments rail=WALLET status=CONFIRMED
  → INSERT wallet_ledger PROFORMA_APPLY -amount
  → recompute_transaction_status(txnId)
  → notif WALLET_APPLIED (in-app only, pas d'email)
```

**Imputation auto** (option C par défaut) : trigger Postgres sur INSERT PROFORMA :
```sql
IF (auto_apply_to_proforma=TRUE AND wallet.balance >= NEW.tax_amount):
  INSERT wallet_ledger PROFORMA_APPLY -amount
  UPDATE transactions status='PAID' (ou PARTIALLY_PAID)
END IF
```

`SELECT … FOR UPDATE` sur wallet pour éviter race condition.

### 7.3 — Sur-paiement → wallet credit

À chaque `confirmPayment` :
```
remaining = transaction.due - transaction.paid_so_far
si payment.amount_usd > remaining :
  excess = payment.amount_usd - remaining
  payment.amount_usd_minor = remaining       -- ajusté
  INSERT wallet_ledger OVERPAYMENT_CREDIT +excess
  notif WALLET_TOPPED_UP
```

Choix : ajuster le payment + ledger entry séparée pour préserver l'invariant `SUM(payments WHERE txn_id=X) = txn.due`.

### 7.4 — Multi-devise

`fxRateService.lockRate(currency, baseUsd=true)` :
1. Lit `fx_rates` ORDER BY fetched_at DESC LIMIT 1
2. Si > 24h → fetch OpenExchangeRates (avec retries) puis insert
3. Renvoie `{ rate, source, locked_at }`

Taux figé dans `payments.fx_rate / fx_rate_source / fx_rate_locked_at` à INSERT (status=INITIATED). Confirmation 3 jours plus tard utilise le taux d'INITIATION.

**Stripe particulier** : compte configuré "settle in USD". Taux Stripe stocké `fx_rate_source='STRIPE_SETTLE'` dans le webhook handler.

### 7.5 — Paiements partiels

N rows `payments` toutes liées à même `transaction_id`. Status calculé via `recompute_transaction_status` :
```sql
CASE
  WHEN paid >= due THEN 'PAID'
  WHEN paid > 0    THEN 'PARTIALLY_PAID'
  ELSE                  'PENDING'
END
```

Reconciliation Plan 4 (DEPARTED_EEZ) interagit :
- Si `paid<due` au moment DEPARTED_EEZ → FINAL calculé sur `tax_amount_usd_minor` ; arriéré entre en escalation Plan 5.
- Si PARTIALLY_PAID et FINAL ≤ paid → différence émise en COMPLEMENT négatif → REFUND.

### 7.6 — Wallet bidirectionnel

#### `/owner/wallet` — page dédiée

```
╔══ Mon Wallet ══════════════════════════════════════════════╗
║  Solde actuel        : $ 12 450.00 USD                     ║
║  Imputation auto     : ☑ activée  [Désactiver]             ║
║  Prochaine facture   : ~ $ 8 200 (estimation 3 passages)   ║
║                                                             ║
║  [+] Recharger mon wallet                                   ║
╠═════════════════════════════════════════════════════════════╣
║  Mouvements                            Filtre : [Tous ▼]    ║
║  2026-04-25  +$5 000.00  TOPUP        Stripe                ║
║  2026-04-23  −$2 800.00  PROFORMA_APPLY  INV-1234           ║
║  ...                                                        ║
╚═════════════════════════════════════════════════════════════╝
```

#### `<TopUpDialog>` = `<PayDialog>` mode top-up

`payment.transaction_id = NULL`, à CONFIRMED → ledger TOPUP + notif WALLET_TOPPED_UP.

#### `predictNextTax(shipownerId)`

1. Compte `arrival_alerts` 90 derniers jours
2. Médiane `tax_amount_usd_minor`
3. Tendance fréquence (alerts/jour × 30 = projection)
4. Renvoie `{ estimated_count_30d, estimated_amount_30d_usd, confidence }`

Dashboard : "Estimation 30 prochains jours : ~3 passages = ~$18 600 ; solde : $12 450 → ⚠ insuffisant, top-up de $7 000 recommandé". Si confidence faible (< 5 alerts), "Pas assez de données".

### 7.7 — Refunds (table dédiée, choix admin par dossier)

```
Plan 4 reconcile → INSERT transaction REFUND
  → INSERT refunds (status=REQUESTED, refund_rail=NULL)
  → notif admin
↓
Admin /admin/refunds
  → choisit rail :
    - WALLET (recommandé, instantané)
    - WIRE_TRANSFER (IBAN pré-rempli, admin ordonne externe → marque executed)
    - STRIPE refund (si payment original=STRIPE refundable)
    - autre rail (justification obligatoire)
  → Approuver → APPROVED
  → Exécuter → EXECUTED
↓
Effets :
  - WALLET → INSERT wallet_ledger REFUND_CREDIT +amount
  - WIRE  → aucun effet auto (admin a viré manuellement)
  - STRIPE → API stripe.refunds.create + webhook charge.refunded
↓
notif armateur REFUND_ISSUED
```

---

## 8 — Admin UX

### 8.1 — `/admin/payments` (refonte)

```
Filtres : [À valider ▼] [Tous rails ▼] [Toutes devises ▼] [Recherche]
Onglets : (12) À valider | (3) En cours Stripe | (88) Confirmés | (2) Rejetés

+ Enregistrer paiement manuel  (admin-only)

# Date Armateur Facture Montant Rail Status
12 04-25 CMA CGM INV-1234 $30 000 (USD) WIRE ⏳ INITIATED
11 04-25 Maersk  INV-1235 €18 500       WIRE ⏳ INITIATED
...
```

Click ligne → `<PaymentDetailDrawer>` :
- Identité armateur + lien `/admin/registrations/<id>`
- Facture liée + remaining
- Devise + équivalent USD figé + taux + source
- rail_details JSON formaté KV
- Liste preuves (download + viewer inline)
- **Confirmer** / **Rejeter** (RBAC-gated, désactivés si pas autorisé)
- Pour NETTING/BANK_GUARANTEE non-SUPERADMIN : message "Validation SUPERADMIN requise"
- Pour CASH si confirmer = caissier original : "4-eyes : un autre admin doit confirmer"
- Audit log inline

Métriques : "À valider depuis > 24h : N", "Volume confirmé (7j) : $X", "Taux de rejet (30j) : X%".

### 8.2 — `/admin/cash-desk` (caissier port)

Sous-permission `can_record_cash` sur PORT_OFFICER. Saisie rapide :
- Armateur (autocomplete)
- Facture (filtré shipowner)
- Montant + devise
- N° reçu (auto: `CASH-YYYY-MM-DD-NNN`)
- Photo bordereau

Workflow : caissier crée INITIATED, FINANCE_ADMIN distinct valide depuis `/admin/payments`. 4-eyes via contrainte `confirmed_by != declared_by`.

### 8.3 — `/admin/refunds`

Onglets : À arbitrer / Approuvés / Exécutés. Click ligne → `<RefundDetailDrawer>` (cf 7.7).

### 8.4 — `/admin/wallets` (audit + adjustments)

Liste tous wallets : armateur, balance, last activity, auto-apply. Click → ledger complet + bouton SUPERADMIN-only "Ajustement manuel" (justification obligatoire, INSERT `kind='ADMIN_ADJUSTMENT'`).

Cas d'usage : erreur ops à corriger, geste commercial, fusion deux shipowners doublons.

### 8.5 — Reçu PDF de paiement (`receiptService.generatePaymentReceipt`)

Calqué sur `invoiceService` (jsPDF + HMAC + QR existants).

Contenu :
- Header AfricGreen + logo + numéro `RCP-YYYY-NNNN`
- "Reçu de paiement"
- Identité armateur + adresse facturation (kyc_level_c)
- Facture liée (référence, dû, payé)
- Détails paiement : date, rail (libellé lisible), devise + montant + équivalent USD + taux figé, référence externe
- Signataire : **"Director, Solid Technology"**
- QR vers `/api/receipts/<ref>/verify`
- Footer légal

Généré à chaque transition `payments.status → CONFIRMED`. Stocké `receipts/<owner>/<receipt_ref>.pdf`. URL signée envoyée par email (`payment-received.tsx`). Téléchargeable depuis `/owner/invoices` et `/admin/payments`.

Paiements partiels : un reçu **par paiement confirmé** (pas cumulatif). À PAID : email "Facture intégralement réglée" séparé.

---

## 9 — RBAC & RLS

### 9.1 — Matrice rôles consolidée

| Rôle | Capacités |
|---|---|
| **SHIPOWNER** | self-service signup, login magic link, lecture sa flotte/alerts/invoices/wallet, initiate STRIPE/WIRE/MOBILE_MONEY/THIRD_PARTY/WALLET, top-up, dispute, KYC C, prefs |
| **SHIPPING_AGENT** | claim alerts (existant), proxy WIRE/MOBILE_MONEY/THIRD_PARTY pour son armateur, ne voit que armateurs liés via `owner_agent_mappings` |
| **PORT_OFFICER** | escalation, accès `/admin/cash-desk` si `can_record_cash` |
| **FINANCE_ADMIN** | confirmer/rejeter paiements rails 1-5,7,8 ; valider refunds WALLET/WIRE/STRIPE ; lire tous wallets |
| **MANAGER** | tout PORT_OFFICER + approuver registrations PENDING_REVIEW + lire tous wallets |
| **SUPERADMIN** | tout MANAGER + valider NETTING/BANK_GUARANTEE + ajuster wallets + override + activer feature flags |

Centralisé dans `frontend/src/lib/rbac.ts`.

### 9.2 — Politiques RLS clés

```sql
-- payments : SHIPOWNER lit ses propres
CREATE POLICY "owner reads own payments" ON public.payments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.shipowners s
     WHERE s.id = payments.shipowner_id
       AND s.profile_id = auth.uid()
       AND s.account_state = 'ACTIVE'
  ));

-- payments : SHIPOWNER initie INITIATED, rails autorisés
CREATE POLICY "owner initiates own payments" ON public.payments FOR INSERT
  WITH CHECK (
    status = 'INITIATED' AND
    rail IN ('STRIPE','WIRE_TRANSFER','MOBILE_MONEY','THIRD_PARTY','WALLET') AND
    EXISTS (... shipowner check ...) AND
    declared_by = auth.uid()
  );

-- payments : SHIPOWNER cancel INITIATED
CREATE POLICY "owner cancels own initiated payments" ON public.payments FOR UPDATE
  USING (status='INITIATED' AND ...)
  WITH CHECK (status='CANCELLED' AND ...);

-- wallets / wallet_ledger : SHIPOWNER lit ses propres ; INSERT impossible (service_role)
-- payment_proofs : SHIPOWNER lit + insert sur ses payments
-- refunds : SHIPOWNER lit ses propres ; INSERT/UPDATE service_role
-- owner_notifications : SHIPOWNER lit + UPDATE read_at sur ses propres
```

Tests SQL d'isolation A/B systématiques.

### 9.3 — Audit log (tamper chain mig 018)

| Action | kind audit |
|---|---|
| Signup auto-claim | SHIPOWNER_AUTO_CLAIM |
| Signup admin approve | SHIPOWNER_REVIEW_APPROVED |
| Signup admin reject | SHIPOWNER_REVIEW_REJECTED |
| KYC C complete | SHIPOWNER_KYC_C_COMPLETED |
| Payment confirm | PAYMENT_CONFIRMED (rail, amount, admin) |
| Payment reject | PAYMENT_REJECTED (motif) |
| Wallet adjust | WALLET_MANUAL_ADJUSTMENT (SUPERADMIN, justification) |
| Refund executed | REFUND_EXECUTED (rail, amount) |

---

## 10 — i18n

### 10.1 — Namespaces

Existant à étendre : `OwnerPortal`. Nouveaux : `OwnerRegister`, `OwnerOnboarding`, `OwnerWallet`, `OwnerNotifications`, `Payment`, `AdminPayments`, `AdminRegistrations`, `AdminRefunds`, `AdminCashDesk`.

### 10.2 — Plan livraison

- **EN + FR complets en v1** (phase H, blocking pour merge final)
- **AR + PT + SW** : keys EN comme fallback ; traduction humaine reportée P2

### 10.3 — Templates email

EN/FR uniquement v1, sélection `shipowners.preferred_language` avec fallback EN. Convention namespaces **PascalCase** strict (gotcha QA ISSUE-001).

---

## 11 — Tests

### 11.1 — SQL (migrations 040-047)

1 fichier par migration. Chacun couvre :
- Schema valide + CHECK + FK
- RLS isolation A/B
- Triggers (ledger → wallet, recompute_transaction_status)
- Invariants : `SUM(ledger) = wallet.balance`, `SUM(payments confirmed) = transaction.paid`
- État machine `account_state`

### 11.2 — Vitest unitaire

- `paymentService.test.ts` — chaque rail : initiate, validate Zod, lock fx_rate
- `walletService.test.ts` — apply, topup, ledger, prediction
- `kycService.test.ts` — registerShipowner décision tree, 6 scénarios
- `notificationService.test.ts` — mapping, mocking email
- `receiptService.test.ts` — génération avec snapshot golden file
- `fxRateService.test.ts` — cache freshness, fallback API
- Server actions : ≥ 1 happy + ≥ 2 unhappy chacune

### 11.3 — E2E (Playwright/Vitest)

1. Signup auto-claim
2. Signup review path
3. KYC C wizard
4. Stripe payment happy path (mock webhook)
5. Wire payment happy path
6. Partial payment (2 wires moitié)
7. Overpayment Stripe → wallet credit
8. Wallet topup + auto-apply
9. Refund WALLET path
10. RLS isolation (DB direct)
11. Multi-currency EUR

### 11.4 — Tests de charge

- 100 webhooks Stripe parallèles → tous CONFIRMED idempotemment
- 50 PROFORMA concurrent même shipowner solde limité → un seul auto-apply réussit

---

## 12 — Phasage & rollout

### 12.1 — 8 phases découplées

```
A — Schema foundation        (1-2 sessions) Migrations 040-047 + tests SQL
B — Onboarding               (2 sessions)   /owner/register, KYC wizard, /admin/registrations
C — Payments core out-of-band (2-3 sessions) payments table, /admin/payments, cash-desk, PayDialog rails 2-9, reçu PDF
D — Stripe online             (1-2 sessions) Stripe Checkout, webhook, reconcile cron — gated par entité UK
E — Wallet UX + top-up        (1-2 sessions) /owner/wallet, top-up, prediction, auto-apply trigger
F — Notifications             (1 session)    owner_notifications, bell, 16 templates email, reminders cron
G — Refunds                   (1 session)    /admin/refunds, multi-rail flow, hookage Plan 4
H — i18n EN/FR + E2E + rollout (1-2 sessions) Traductions FR, suite Playwright, canary
```

A→H = ordre de mergeabilité. Chaque phase ship-able derrière feature flag.

### 12.2 — Feature flags

```
feature.shipowner_portal_v1_enabled         (master kill switch — défaut false)
  ├─ feature.shipowner_self_service_enabled (signup public — défaut false)
  ├─ feature.online_payment_stripe_enabled  (Stripe — défaut false)
  ├─ feature.wallet_topup_enabled           (top-up volontaire — défaut false)
  └─ feature.notification_sms_enabled       (SMS dormant — toujours false v1)
```

### 12.3 — Plan de déploiement prod

1. **Staging** : tous flags ON, smoke par admin + 1 armateur test
2. **Prod canary 7j** : portal_v1=true ; self-service=false ; stripe=false ; topup=false → inviter 2-3 armateurs réguliers connus
3. **Prod J+7** : activer wallet topup
4. **Prod J+14** : activer Stripe (après validation entité UK + clés live)
5. **Prod J+21** : activer self-service public

### 12.4 — Monitoring critique

- Sentry/log structuré sur tous server actions paiement/wallet/refund
- Dashboard Grafana :
  - Paiements INITIATED > 24h non validés (alarm si > 5)
  - Webhooks Stripe en échec (alarm si > 0)
  - `SUM(ledger) ≠ wallet.balance` (alarm immédiat — bug critique)
  - `SUM(payments confirmed) ≠ transaction.paid` (idem)

### 12.5 — Rollback

- Chaque migration a son `-- DOWN:` block en commentaire
- Feature flag master coupe l'UI sans rollback DB nécessaire pour 90% des incidents
- Données de paiement préservées même en rollback feature

---

## 13 — Risques & mitigations

| Risque | Proba | Impact | Mitigation |
|---|---|---|---|
| Entité UK Stripe pas prête | Moyenne | v1 amputé Stripe | Phase D découplée — A-C-E-F-G-H ship sans bloquer ; fallback Flutterwave architecturalement prévu |
| pgsodium absent (Supabase managed) | Faible | KYC C bloqué | Fallback Supabase Vault. Vérif phase A pré-impl. |
| Webhook Stripe perdu/dupliqué | Inévitable | Paiement non-confirmé / double | Idempotence par `external_reference` ; cron reconcile 15min ; retry queue |
| Wallet auto-apply race condition | Faible | Double imputation | Trigger Postgres `FOR UPDATE` ; CHECK balance ≥ 0 garantit échec atomique |
| FX dérive INITIATED → CONFIRMED | Réelle | Différence FX | Taux figé à INITIATED ; FX_DIFFERENCE entry possible ; affiché clairement |
| Spam self-service / bot | Forte | Charge review admin | reCAPTCHA v3 + rate limit + IMO vessel doit exister ; mode invitation-only safety-net |
| Admin oublie REFUND wire | Réelle | Argent dû non remboursé | Status APPROVED ≠ EXECUTED + age tracking ; alarme si APPROVED > 7j |
| Cash desk mismatch | Faible | Erreur comptable | Double-entry + 4-eyes ; rapport quotidien caisse vs ledger |
| Régression Plan 6 v0 | Moyenne | Casse fonctionnalité existante | Migration data + tests E2E ancien flow ; staging avant prod |
| Charge email Resend | Faible | Coûts / spam folder | Quotas connus ; templates EN/FR ; opt-out P2 |
| CI mémoire E2E | Faible | CI rouge | Suites parallèles ; smoke seul en CI principal, full nightly |

---

## 14 — Questions ouvertes (résoudre en phase A pré-implémentation)

1. **Entité UK Stripe** — confirmation officielle (numéro Companies House, IBAN GBP, account_id Stripe).
2. **Provider FX** — OpenExchangeRates free tier 1k req/mois suffit-il ?
3. **Chiffrement IBAN** — pgsodium vs Vault selon dispo Supabase managed.
4. **Devises supportées** — défaut USD/EUR/GBP/AED/KES/SOS. Ajouter Yuan/Won/Yen pour armateurs asiatiques ?
5. **SLA validation paiement** — 24h ? 48h ? J+0 si reçu avant 14h ?
6. **Multi-utilisateurs futurs** — table `shipowner_users(shipowner_id, profile_id, role)` réservée mais non créée v1.
7. **Texte CGV** — existe-t-il, ou à rédiger (hors scope tech) ?
8. **Privacy Policy** — liens présents ?

---

## 15 — Hors scope explicite

- Mobile Money provider direct (Hormuud API) — manuel en v1, automatisé Phase 2
- Flutterwave — feature flag prêt, activable si Stripe-UK bloque
- Cashout wallet — jamais en v1
- Auto-réconciliation bancaire (parsing MT940) — Phase 2
- SMS Twilio — dormant
- Multi-utilisateurs par armateur — Phase 2
- Real-time WebSocket — polling 60s suffit
- Crypto, escrow, trade credit — non priorisés
- Wallet multi-devise — wallet toujours en USD, conversions à l'entrée

---

## 16 — Composants à créer / modifier (récap)

| Type | Existant Plan 6 v0 | Nouveau / Refondu |
|---|---|---|
| Migrations | 024, 031, 033, 039 | **040–047** (renaming `payment_intents` → `payments` + 6 nouvelles) |
| Routes Next | `/owner/login`, `/owner/auth/callback`, `/owner/dashboard`, `/owner/vessels`, `/owner/invoices`, `/owner/alerts` | + `/owner/register`, `/owner/onboarding/*`, `/owner/wallet`, `/owner/notifications`, `/api/webhooks/stripe`, `/api/payments/*` |
| Server actions | `inviteShipowner`, `declarePaymentIntent`, `openDispute` | + `registerShipowner`, `submitKyc`, `topUpWallet`, `declarePayment`, `confirmPayment`, `rejectPayment`, `issueRefund`, `creditWallet` |
| Composants | `OwnerShell`, `PayProformaDialog`, `OpenDisputeDialog`, `InvoicesTable`, `AlertsTable`, `VesselsTable` | + `RegisterForm`, `KycWizard`, `WalletPanel`, `NotificationBell`, `PayDialog` (multi-rail), `ProofUploader`, `CurrencyPicker` |
| Services | `shipownerService`, `ownerPortalService` | + `paymentService`, `walletService`, `kycService`, `notificationService`, `fxRateService`, `receiptService` |
| Admin pages | `/admin/payments` (refonte), `/admin/owner-agent-mappings` | + `/admin/registrations`, `/admin/refunds`, `/admin/cash-desk`, `/admin/wallets` |
| Backend Go | `tax`, `corridor`, `eez`, `reconcile`, `originport` | (inchangé v1 — Stripe webhook = Next.js) |

---

## 17 — Références

- Plan 6 v0 : [`plans/2026-04-27-plan-6-shipowner-portal.md`](../plans/2026-04-27-plan-6-shipowner-portal.md)
- Master spec : [`specs/2026-04-22-proactive-vessel-detection-and-proforma-design.md`](2026-04-22-proactive-vessel-detection-and-proforma-design.md)
- Roadmap : [`ROADMAP.md`](../ROADMAP.md)
- A2 audit signup : [`audits/2026-04-24-a2-signup-audit.md`](../audits/2026-04-24-a2-signup-audit.md)
- Migration 018 (audit_logs tamper chain) : [`supabase/migrations/018_audit_logs.sql`](../../../supabase/migrations/018_audit_logs.sql)
