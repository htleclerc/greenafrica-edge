-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 159 : la vue des encours porte la date d'émission
--
-- `v_reglements_dashboard` sait agréger par fenêtre, mais avec des colonnes
-- figées (aujourd'hui / semaine / mois) : impossible d'en tirer une cohorte
-- choisie par l'utilisateur, ni l'année.
--
-- Découper par période demande la date d'émission de la facture. Elle manquait
-- à `v_transaction_outstanding`, ce qui obligeait soit à interroger
-- `transactions` en parallèle, soit — bien pire — à recalculer l'encours à
-- côté de la vue. La mig 132 l'interdit explicitement : cette vue est la
-- source unique du reste dû, et la colonne `partial_paid_usd` est gelée.
--
-- Définition de la mig 134 recopiée à l'identique, `created_at` ajoutée EN FIN
-- (seule position qu'autorise CREATE OR REPLACE VIEW).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_transaction_outstanding
WITH (security_invoker = true) AS
SELECT
  t.id                                       AS transaction_id,
  t.shipowner_id,
  t.jurisdiction_id,
  t.document_type,
  t.mode,
  t.status,
  t.due_date,
  t.tax_amount_usd,
  -- Encaissement réel, NON borné au montant de la facture : un trop-perçu doit
  -- rester visible pour être remboursé, pas être silencieusement absorbé.
  GREATEST(COALESCE(p.paid_usd, 0), COALESCE(t.partial_paid_usd, 0)) AS paid_usd,
  CASE
    WHEN t.status IN ('VOID', 'EXEMPT', 'CREDIT_NOTE_ISSUED', 'PAID') THEN 0
    ELSE GREATEST(
      t.tax_amount_usd - GREATEST(COALESCE(p.paid_usd, 0), COALESCE(t.partial_paid_usd, 0)),
      0
    )
  END                                        AS outstanding_usd,
  (t.status NOT IN ('VOID', 'EXEMPT', 'CREDIT_NOTE_ISSUED')) AS is_claimable,
  -- ── nouvelle colonne (mig 159) ────────────────────────────────────────────
  -- Date d'ÉMISSION, pas d'échéance : elle définit la cohorte « factures de
  -- ce mois », que l'échéance ne dit pas (NET-30 la décale d'un mois).
  t.created_at
FROM public.transactions t
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(pm.amount_usd_minor), 0) / 100.0 AS paid_usd
  FROM public.payments pm
  WHERE pm.transaction_id = t.id
    AND pm.status = 'CONFIRMED'
) p ON TRUE;

COMMENT ON VIEW public.v_transaction_outstanding IS
  'Mig 132 + 134 + 159 : montant encaissé, reste dû et date d''émission par facture. Encaissé = le plus grand des paiements CONFIRMED (rail v7) et de partial_paid_usd (backfill mig 022, seule trace des règlements antérieurs). Source unique de l''encours.';

GRANT SELECT ON public.v_transaction_outstanding TO authenticated, service_role;

-- DOWN:
-- restaurer la définition de la mig 134 (sans created_at).
