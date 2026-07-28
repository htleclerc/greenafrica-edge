-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 112: relevé de compte mensuel (chantier C)
--
-- Métadonnées d'un relevé mensuel par armateur (une ligne par shipowner × mois),
-- porteuse de la RLS (armateur lit les siens, staff par juridiction) et de
-- l'idempotence du cron. Le PDF vit dans le bucket documents sous statements/.
-- Ajoute la valeur enum STATEMENT_READY pour la notification owner.
-- ─────────────────────────────────────────────────────────────────────────────

-- Valeur enum (usée par owner_notifications, PAS dans cette migration → pas de
-- conflit ADD VALUE / usage même transaction). En tête, isolée.
ALTER TYPE public.owner_notification_kind ADD VALUE IF NOT EXISTS 'STATEMENT_READY';

CREATE TABLE IF NOT EXISTS public.owner_statements (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipowner_id             UUID NOT NULL REFERENCES public.shipowners(id) ON DELETE CASCADE,
  jurisdiction_id          UUID NOT NULL REFERENCES public.jurisdictions(id),
  period_month             DATE NOT NULL,
  pdf_path                 TEXT NOT NULL,
  total_outstanding_usd    NUMERIC(14,2) NOT NULL,
  payments_in_month_usd    NUMERIC(14,2) NOT NULL DEFAULT 0,
  open_count               INT NOT NULL DEFAULT 0,
  generated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shipowner_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_owner_statements_owner
  ON public.owner_statements(shipowner_id, period_month DESC);

ALTER TABLE public.owner_statements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner reads own statements" ON public.owner_statements;
CREATE POLICY "owner reads own statements" ON public.owner_statements FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.shipowners s
    WHERE s.id = owner_statements.shipowner_id AND s.profile_id = auth.uid()
  ));

DROP POLICY IF EXISTS "staff reads statements" ON public.owner_statements;
CREATE POLICY "staff reads statements" ON public.owner_statements FOR SELECT
  USING (public.is_admin_or_officer() AND jurisdiction_id = ANY(public.current_jurisdiction_ids()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_statements TO service_role;

-- DOWN:
-- DROP TABLE IF EXISTS public.owner_statements;
-- (l'enum ADD VALUE n'est pas réversible — Postgres ne supporte pas DROP VALUE)
