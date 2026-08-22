-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 134 : l'encours ne doit pas oublier les règlements d'avant la table
--                 `payments`.
--
-- DÉFAUT INTRODUIT PAR LA MIGRATION 132. Elle calcule le reste dû comme
-- `tax_amount_usd - SUM(paiements CONFIRMED)` et abandonne `partial_paid_usd`,
-- au motif que cette colonne n'est jamais écrite. C'est vrai pour toute facture
-- postérieure au rail v7 — mais faux pour celles d'avant : la table `payments`
-- a démarré VIDE (mig 048), et le backfill de la mig 022 a inscrit dans
-- `partial_paid_usd` le montant réglé des factures déjà soldées à cette date.
-- Cette colonne porte donc la SEULE trace de ces encaissements-là.
--
-- Conséquence observée sur staging après application de la 132 : cinq factures
-- FINAL au statut PAID ressortaient dues pour 32 482,00 USD — leur montant
-- plein — dans `v_invoice_admin` et `v_collection_admin`. Exactement la faute
-- que la 132 corrigeait, retournée : réclamer ce qui a déjà été payé.
--
-- CORRECTION. Le montant encaissé est le PLUS GRAND des deux montants connus,
-- comme le fait déjà le code (`lib/outstanding.ts`) :
--   · les paiements CONFIRMED, seule source pour tout ce qui suit le rail v7 ;
--   · `partial_paid_usd`, seule source pour ce qui le précède.
-- Les additionner compterait deux fois : les deux colonnes ne portent jamais
-- deux règlements distincts d'une même facture, elles couvrent deux époques.
--
-- SECOND CORRECTIF : une facture au statut PAID ne doit plus rien, point.
-- `recompute_transaction_status` (mig 051) ne pose ce statut que lorsque les
-- encaissements couvrent le montant dû : c'est l'affirmation de règlement de la
-- plateforme elle-même. S'en écarter revient à réclamer sur la foi d'une trace
-- manquante — staging porte ainsi INV-2026-TEST02, marquée payée le 22/04 pour
-- une facture émise le 27/04, sans aucune ligne de paiement. Une telle
-- incohérence se signale dans une vue d'anomalies (`v_transaction_payment_drift`),
-- elle ne se réclame pas au débiteur.
--
-- PAID reste en revanche RÉCLAMABLE au sens de `is_claimable` : la colonne sert
-- aux totaux facturé/payé des cockpits, et en sortir les factures soldées ferait
-- diminuer le total facturé d'un dossier à mesure qu'il règle.
--
-- Seule `v_transaction_outstanding` est redéfinie ; les cinq vues qui la
-- consomment héritent du calcul corrigé sans modification.
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
  (t.status NOT IN ('VOID', 'EXEMPT', 'CREDIT_NOTE_ISSUED')) AS is_claimable
FROM public.transactions t
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(pm.amount_usd_minor), 0) / 100.0 AS paid_usd
  FROM public.payments pm
  WHERE pm.transaction_id = t.id
    AND pm.status = 'CONFIRMED'
) p ON TRUE;

COMMENT ON VIEW public.v_transaction_outstanding IS
  'Mig 132 + 134 : montant encaissé et reste dû par facture. Encaissé = le plus grand des paiements CONFIRMED (rail v7) et de partial_paid_usd (backfill mig 022, seule trace des règlements antérieurs). Source unique de l''encours.';

GRANT SELECT ON public.v_transaction_outstanding TO authenticated, service_role;

-- DOWN : restaurer la définition de la migration 132. Les factures soldées
-- avant le rail v7 redeviendraient alors dues pour leur montant plein.
