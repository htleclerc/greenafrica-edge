BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 039 tests — shipowner portal v0 schema + RLS
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. vessels SELECT RLS for SHIPOWNER exists
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_policies
   WHERE tablename='vessels' AND schemaname='public'
     AND policyname='shipowner reads own vessels';
  ASSERT n = 1, 'SHIPOWNER read policy on vessels missing';
END $$;

-- 2. disputes_insert_own policy was tightened (mig 007 had a single-clause
--    policy; mig 039 added the transaction-ownership EXISTS check)
--
-- La mig 135 (owner_members) a deplace la recherche du proprietaire dans
-- public.current_shipowner_id() : le mot « shipowners » ne figure plus dans le
-- texte de la policy, il est desormais dans le corps de la fonction. La regle
-- de portee est identique (shipowners.profile_id = auth.uid(), plus les
-- membres actifs) et la mig 135 y ajoute la sous-permission can_dispute — la
-- policy est donc plus stricte, pas plus permissive. On teste l'intention,
-- pas la formulation : la portee cote armateur doit passer par l'une des deux
-- formes, jamais etre absente.
DO $$
DECLARE clause TEXT;
BEGIN
  SELECT with_check INTO clause FROM pg_policies
   WHERE tablename='disputes' AND policyname='disputes_insert_own';
  ASSERT clause LIKE '%transactions%',
    'disputes_insert_own should reference transactions for ownership check';
  ASSERT clause LIKE '%shipowners%' OR clause LIKE '%current_shipowner_id%',
    'disputes_insert_own should scope owner-side inserts, either via a direct '
    'shipowners lookup (mig 039) or via current_shipowner_id() (mig 135)';
END $$;

-- 3. shipowners audit columns added
DO $$
DECLARE c TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY['invited_at', 'invited_by'] LOOP
    ASSERT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='shipowners' AND column_name=c
    ), format('shipowners.%s column missing', c);
  END LOOP;
END $$;

-- 4. shipowner_payment_intents was dropped by mig 062 (Plan 7C-5 cutover to the
--    polymorphic public.payments table). Against the full-chain schema the table
--    no longer exists, and `DROP TABLE ... CASCADE` removed everything that
--    depended on it (RLS policies, the amount_usd CHECK, the updated_at trigger).
--    Mig 039's original Tests 4-7 asserted those objects existed; against the
--    final schema that is no longer true. The live payment path is now covered by
--    048_payments_polymorphic.test.sql — here we only assert the drop took effect.
--    (Note: the standalone `shipowner_payment_intent_status` enum type is NOT a
--    table dependency, so CASCADE leaves it in place — we don't assert on it.)
DO $$
BEGIN
  ASSERT NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='shipowner_payment_intents'
  ), 'shipowner_payment_intents should have been dropped by mig 062';

  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename='shipowner_payment_intents' AND schemaname='public'
  ), 'no policies should remain after the table is dropped';
END $$;

ROLLBACK;
