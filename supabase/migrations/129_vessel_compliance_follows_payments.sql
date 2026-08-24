-- ─────────────────────────────────────────────────────────────────────────────
-- Green-Gate — la conformité du navire suit réellement les paiements
-- Migration 129
--
-- PROBLÈME
-- `vessels.compliance_status` est une colonne dénormalisée lue par la flotte
-- armateur, la carte, les alertes et le scanner MMSI. Un seul chemin la mettait
-- à jour : `/api/transactions/mark-paid` (encaissement saisi par un agent).
-- Tous les autres — webhook Stripe, retour PayPal, application de portefeuille,
-- confirmation manuelle par le service financier — appellent
-- `recompute_transaction_status` et ne touchaient jamais au navire.
--
-- Résultat observé le 2026-08-22 : le pro-forma 81be7109 (GG DEMO PIONEER) est
-- PAID, le navire reste affiché PAYMENT_DUE.
--
-- CORRECTIF
-- La synchronisation est ajoutée à `recompute_transaction_status`, seul point
-- de passage commun à tous les chemins d'encaissement. Elle est calculée sur
-- l'ENSEMBLE des transactions du navire, pas sur celle qu'on vient de payer :
-- un navire qui solde une facture mais en laisse une autre ouverte reste dû.
--
-- Deux états ne sont jamais écrasés :
--   - EXEMPT       — décision administrative, pas un état de paiement ;
--   - NON_COMPLIANT — sanction en cours ; solder les factures la lève
--                     (retour à COMPLIANT), mais un reliquat ne la rétrograde
--                     pas en simple PAYMENT_DUE.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Helper réutilisable ───────────────────────────────────────────────────
-- Extrait pour que le backfill ci-dessous et la RPC partagent exactement la
-- même règle : deux définitions divergeraient au premier changement.
CREATE OR REPLACE FUNCTION public.sync_vessel_compliance(p_vessel_id UUID)
RETURNS VOID AS $$
DECLARE
  outstanding_usd NUMERIC(12,2);
  curr public.compliance_status;
BEGIN
  IF p_vessel_id IS NULL THEN RETURN; END IF;

  SELECT compliance_status INTO curr FROM public.vessels WHERE id = p_vessel_id;
  IF NOT FOUND OR curr = 'EXEMPT'::public.compliance_status THEN RETURN; END IF;

  SELECT COALESCE(SUM(tax_amount_usd), 0) INTO outstanding_usd
    FROM public.transactions
   WHERE vessel_id = p_vessel_id
     AND status IN (
       'PENDING'::public.transaction_status,
       'PARTIALLY_PAID'::public.transaction_status,
       'OVERDUE'::public.transaction_status,
       -- Une contestation en cours ne vaut pas conformite : le montant reste
       -- du tant que le litige n'est pas tranche.
       'DISPUTED'::public.transaction_status
     );

  IF outstanding_usd = 0 THEN
    UPDATE public.vessels
       SET compliance_status = 'COMPLIANT'::public.compliance_status,
           tax_liability_usd = 0
     WHERE id = p_vessel_id
       AND (compliance_status <> 'COMPLIANT'::public.compliance_status
            OR tax_liability_usd <> 0);
  ELSE
    UPDATE public.vessels
       SET compliance_status = CASE
             -- Une sanction en cours n'est pas rétrogradée par un simple solde dû.
             WHEN compliance_status = 'NON_COMPLIANT'::public.compliance_status
               THEN compliance_status
             ELSE 'PAYMENT_DUE'::public.compliance_status
           END,
           tax_liability_usd = outstanding_usd
     WHERE id = p_vessel_id;
  END IF;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.sync_vessel_compliance IS
  'mig 129: aligne vessels.compliance_status / tax_liability_usd sur le reste dû de TOUTES les transactions du navire. EXEMPT et NON_COMPLIANT ne sont jamais rétrogradés.';

-- ── 2. recompute_transaction_status appelle le helper ────────────────────────
-- Corps identique à la version mig 090 (garde VOID incluse), plus l'appel final.
CREATE OR REPLACE FUNCTION public.recompute_transaction_status(p_txn_id UUID)
RETURNS VOID AS $$
DECLARE
  s RECORD;
  new_status public.transaction_status;
  curr_collections_status TEXT;
  curr_status public.transaction_status;
  v_vessel_id UUID;
BEGIN
  -- ── VOID TERMINAL GUARD (mig 090) ───────────────────────────────────────────
  SELECT status INTO curr_status FROM public.transactions WHERE id = p_txn_id;
  IF curr_status = 'VOID'::public.transaction_status THEN
    RAISE WARNING 'recompute_transaction_status: transaction % is VOID — payment confirmed against a void document; drift view alarm expected. Investigate payments table.',
      p_txn_id;
    RETURN;
  END IF;

  -- ── Corps mig-051 / mig-090 (inchangé) ──────────────────────────────────────
  SELECT * INTO s FROM public.transaction_paid_summary WHERE transaction_id = p_txn_id;
  IF NOT FOUND THEN RETURN; END IF;

  new_status := CASE
    WHEN s.paid_usd_minor >= s.due_usd_minor THEN 'PAID'::public.transaction_status
    WHEN s.paid_usd_minor > 0                THEN 'PARTIALLY_PAID'::public.transaction_status
    ELSE                                          'PENDING'::public.transaction_status
  END;

  SELECT collections_status INTO curr_collections_status
    FROM public.transactions WHERE id = p_txn_id;

  UPDATE public.transactions SET
    status = new_status,
    collections_status = CASE
      WHEN new_status = 'PAID'::public.transaction_status THEN 'PAID'
      WHEN curr_collections_status = 'PAID' AND new_status <> 'PAID'::public.transaction_status THEN 'CURRENT'
      ELSE curr_collections_status
    END,
    settlement_effective_at = CASE WHEN new_status = 'PAID'::public.transaction_status AND settlement_effective_at IS NULL THEN NOW() ELSE settlement_effective_at END
  WHERE id = p_txn_id
  RETURNING vessel_id INTO v_vessel_id;

  -- ── Nouveau (mig 129) : la flotte suit l'encaissement ───────────────────────
  PERFORM public.sync_vessel_compliance(v_vessel_id);
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.recompute_transaction_status IS
  'mig 129: synchronise aussi vessels.compliance_status via sync_vessel_compliance. mig 090: garde VOID-terminale. Logique de statut mig-051 inchangée.';

-- ── 3. Rattrapage des navires laissés en PAYMENT_DUE ─────────────────────────
-- Tous les navires portant au moins une transaction sont recalculés une fois.
DO $$
DECLARE
  v UUID;
BEGIN
  FOR v IN SELECT DISTINCT vessel_id FROM public.transactions WHERE vessel_id IS NOT NULL LOOP
    PERFORM public.sync_vessel_compliance(v);
  END LOOP;
END $$;
