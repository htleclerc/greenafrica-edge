-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 026 : extend transactions for pro-forma / final / complement / refund
-- + add FKs on arrival_alerts pointing back to transactions
-- ─────────────────────────────────────────────────────────────────────────────

-- document_type enum (orthogonal to existing transaction_type which stays
-- ENTRY_TAX/TRANSIT_FEE/PORT_STAY)
CREATE TYPE public.document_type AS ENUM ('PROFORMA', 'FINAL', 'COMPLEMENT', 'REFUND');

-- Extend transaction_status enum
ALTER TYPE public.transaction_status ADD VALUE IF NOT EXISTS 'CREDIT_NOTE_ISSUED';
ALTER TYPE public.transaction_status ADD VALUE IF NOT EXISTS 'VOID';

-- New columns on transactions
ALTER TABLE public.transactions
  ADD COLUMN document_type            public.document_type NOT NULL DEFAULT 'FINAL',
  ADD COLUMN related_transaction_id   UUID REFERENCES public.transactions(id),
  ADD COLUMN arrival_alert_id         UUID REFERENCES public.arrival_alerts(id),
  ADD COLUMN agent_profile_id         UUID REFERENCES public.profiles(id),
  ADD COLUMN shipowner_id             UUID REFERENCES public.shipowners(id),
  ADD COLUMN distance_eez_nm          NUMERIC(10, 2),
  ADD COLUMN emission_factor_used_id  UUID REFERENCES public.emission_factors(id),
  ADD COLUMN rate_usd_per_tco2        NUMERIC(10, 2) NOT NULL DEFAULT 40.00,
  ADD COLUMN breakdown_json           JSONB;

CREATE INDEX idx_txn_alert         ON public.transactions(arrival_alert_id)
  WHERE arrival_alert_id IS NOT NULL;
CREATE INDEX idx_txn_agent_status  ON public.transactions(agent_profile_id, status)
  WHERE document_type = 'PROFORMA';
CREATE INDEX idx_txn_document_type ON public.transactions(document_type, status);

-- FKs back on arrival_alerts (columns already exist from migration 023)
ALTER TABLE public.arrival_alerts
  ADD CONSTRAINT fk_arrival_alert_proforma_txn
    FOREIGN KEY (proforma_transaction_id) REFERENCES public.transactions(id),
  ADD CONSTRAINT fk_arrival_alert_final_txn
    FOREIGN KEY (final_transaction_id)    REFERENCES public.transactions(id);

COMMENT ON COLUMN public.transactions.document_type IS
  'Invoice document flavor. PROFORMA=estimate pre-arrival; FINAL=reconciled at EEZ exit; COMPLEMENT=additional charge when reconciliation exceeds pro-forma by tolerance; REFUND=credit note when reconciliation is below.';

COMMENT ON COLUMN public.transactions.breakdown_json IS
  'JSON detail: distance_nm, emission_factor_g_co2_per_nm, emission_factor_source, emission_factor_id, rate_usd_per_tco2.';
