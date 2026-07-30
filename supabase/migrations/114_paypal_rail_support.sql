-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 114 : support du rail PAYPAL (index, autorisation, feature flag)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Dépend de la migration 113 (valeur d'enum 'PAYPAL'), appliquée dans une
-- transaction distincte — voir le commentaire de 113.

-- 1. Index UNIQUE partiel sur l'identifiant d'ordre PayPal.
--
-- Double rôle :
--   - lookup rapide depuis la route de retour, le webhook et le cron
--     (external_reference = paypal order id) ;
--   - garde d'idempotence en dernier ressort : deux lignes payments pour le
--     même ordre PayPal sont impossibles au niveau DB.
--
-- Plus strict que idx_payments_stripe_pi (mig 063), non-unique : côté Stripe
-- l'unicité n'avait pas été posée. Même politique que mig 087 pour les rails
-- MOBILE_MONEY / THIRD_PARTY.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_paypal_order
    ON public.payments (external_reference)
    WHERE rail = 'PAYPAL' AND external_reference IS NOT NULL;

COMMENT ON INDEX public.idx_payments_paypal_order IS
    'Rail PAYPAL : lookup par paypal order id + garde d''idempotence (une ligne par ordre).';

-- 1b. Une ligne PAYPAL engagée doit porter son identifiant d'ordre.
--
-- Jumelle de la contrainte `payments_stripe_external_ref` (mig 048) : sans
-- external_reference, ni la route de retour, ni le webhook, ni le cron ne
-- peuvent retrouver la ligne — le paiement serait encaissé chez PayPal et
-- introuvable chez nous. L'index unique de l'étape 1 ne suffit pas : un index
-- partiel n'interdit pas les NULL.
ALTER TABLE public.payments
    ADD CONSTRAINT payments_paypal_external_ref CHECK (
        NOT (rail = 'PAYPAL' AND status IN ('PROCESSING','CONFIRMED','REFUNDED')
             AND external_reference IS NULL)
    );

-- 2. can_confirm_payment (mig 057) : PAYPAL est confirmé par le système
--    (route de retour / webhook / cron), JAMAIS par un humain — comme WALLET et
--    STRIPE. Sans ça, un FINANCE_ADMIN pourrait confirmer à la main un paiement
--    PayPal jamais encaissé.
CREATE OR REPLACE FUNCTION public.can_confirm_payment(
  p_payment_id UUID,
  p_profile_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  v_rail        public.payment_rail;
  v_status      public.payment_status_v7;
  v_declared_by UUID;
  v_role        public.user_role;
BEGIN
  SELECT rail, status, declared_by INTO v_rail, v_status, v_declared_by
    FROM public.payments WHERE id = p_payment_id;

  IF NOT FOUND OR v_status NOT IN ('INITIATED', 'PROCESSING') THEN
    RETURN FALSE;
  END IF;

  SELECT role INTO v_role FROM public.profiles
    WHERE id = p_profile_id AND is_active = true;

  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;

  -- WALLET, STRIPE et PAYPAL sont confirmés par le système, jamais par un humain
  IF v_rail IN ('WALLET', 'STRIPE', 'PAYPAL') THEN
    RETURN FALSE;
  END IF;

  -- NETTING et BANK_GUARANTEE exigent SUPERADMIN
  IF v_rail IN ('NETTING', 'BANK_GUARANTEE') THEN
    RETURN v_role = 'SUPERADMIN';
  END IF;

  -- CASH exige 4 yeux : FINANCE_ADMIN/SUPERADMIN ET ≠ déclarant
  IF v_rail = 'CASH' THEN
    RETURN v_role IN ('FINANCE_ADMIN', 'SUPERADMIN')
       AND v_declared_by IS DISTINCT FROM p_profile_id;
  END IF;

  -- Rails par défaut (WIRE_TRANSFER, MOBILE_MONEY, CHEQUE, LC, THIRD_PARTY) :
  -- FINANCE_ADMIN ou SUPERADMIN
  RETURN v_role IN ('FINANCE_ADMIN', 'SUPERADMIN');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.can_confirm_payment(UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.can_confirm_payment(UUID, UUID) IS
  'Plan 7C : matrice d''autorisation spec §7.2. Mig 114 ajoute PAYPAL aux rails système.';

-- 3. Feature flag, OFF par défaut : la bascule est un geste explicite au
--    déploiement, après vérification des credentials et du webhook.
INSERT INTO public.app_config (key, value)
VALUES ('feature.online_payment_paypal_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- DOWN :
-- DROP INDEX IF EXISTS public.idx_payments_paypal_order;
-- DELETE FROM public.app_config WHERE key = 'feature.online_payment_paypal_enabled';
-- (restaurer can_confirm_payment depuis la migration 057)
