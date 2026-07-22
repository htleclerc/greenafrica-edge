-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 107: Corrige les 8 erreurs du Supabase Security Advisor (prod)
--
-- 1. « Security Definer View » (7 vues) — les vues créées sans clause explicite
--    s'exécutent avec les droits de leur propriétaire (postgres/superadmin), ce
--    qui contourne les RLS des tables sous-jacentes. On les bascule en
--    security_invoker = true : la vue hérite alors des droits ET des RLS de
--    l'appelant. Aucun impact sur les consommateurs actuels — ils passent tous
--    par le client service_role (bypass RLS de toute façon), et les vues
--    d'invariants ne sont grant qu'à service_role. Même convention que les vues
--    récentes (migs 095/096/097).
--      • public.profile_credit_usage        (mig 022)
--      • public.orphan_transactions         (mig 022)
--      • public.transaction_paid_summary    (mig 051)
--      • public.v_payments_initiated_overdue (mig 067)
--      • public.v_stripe_webhook_failures    (mig 067)
--      • public.v_wallet_balance_drift       (mig 067)
--      • public.v_transaction_payment_drift  (mig 067 + 068)
--
-- 2. « RLS Disabled in Public » sur public.fx_rates (mig 054) — cache de taux de
--    change (données de référence non sensibles). On active RLS avec une policy
--    de lecture publique (comme emission_factors / app_config). Les écritures
--    restent réservées au service_role (fxRateService tourne côté serveur, le
--    service_role bypass RLS) — aucune policy INSERT/UPDATE nécessaire.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Vues → security_invoker ──────────────────────────────────────────────
ALTER VIEW public.profile_credit_usage        SET (security_invoker = true);
ALTER VIEW public.orphan_transactions         SET (security_invoker = true);
ALTER VIEW public.transaction_paid_summary    SET (security_invoker = true);
ALTER VIEW public.v_payments_initiated_overdue SET (security_invoker = true);
ALTER VIEW public.v_stripe_webhook_failures    SET (security_invoker = true);
ALTER VIEW public.v_wallet_balance_drift       SET (security_invoker = true);
ALTER VIEW public.v_transaction_payment_drift  SET (security_invoker = true);

-- ── 2. RLS sur fx_rates ─────────────────────────────────────────────────────
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;

-- Lecture publique : les taux de change sont des données de référence.
CREATE POLICY "anyone reads fx rates"
  ON public.fx_rates FOR SELECT
  USING (TRUE);

-- Pas de policy d'écriture : seul le service_role (côté serveur, bypass RLS)
-- alimente le cache via fxRateService.

-- DOWN:
-- ALTER VIEW public.profile_credit_usage        SET (security_invoker = false);
-- ALTER VIEW public.orphan_transactions         SET (security_invoker = false);
-- ALTER VIEW public.transaction_paid_summary    SET (security_invoker = false);
-- ALTER VIEW public.v_payments_initiated_overdue SET (security_invoker = false);
-- ALTER VIEW public.v_stripe_webhook_failures    SET (security_invoker = false);
-- ALTER VIEW public.v_wallet_balance_drift       SET (security_invoker = false);
-- ALTER VIEW public.v_transaction_payment_drift  SET (security_invoker = false);
-- DROP POLICY IF EXISTS "anyone reads fx rates" ON public.fx_rates;
-- ALTER TABLE public.fx_rates DISABLE ROW LEVEL SECURITY;
