-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 113 : valeur d'enum PAYPAL sur payment_rail
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Cette migration ne contient QUE le ALTER TYPE, volontairement.
--
-- PostgreSQL interdit d'utiliser une valeur d'enum dans la même transaction que
-- le `ALTER TYPE … ADD VALUE` qui l'a créée. Or les migrations Supabase sont
-- appliquées dans une transaction. Un index partiel `WHERE rail = 'PAYPAL'` ou
-- un `INSERT … rail = 'PAYPAL'` placé ici échouerait avec
-- « unsafe use of new value "PAYPAL" of enum type payment_rail ».
--
-- Tout ce qui *utilise* la valeur vit donc dans la migration 114.
--
-- Le rail PAYPAL est un rail de checkout en ligne auto-confirmé, jumeau de
-- STRIPE : la ligne payments naît en PROCESSING, et seul le système la confirme
-- (voir 114 pour can_confirm_payment).

ALTER TYPE public.payment_rail ADD VALUE IF NOT EXISTS 'PAYPAL';

-- DOWN :
-- Postgres ne sait pas retirer une valeur d'enum. Un rollback exigerait de
-- recréer le type et de réécrire toutes les colonnes qui l'utilisent
-- (payments.rail, refunds.refund_rail). À ne faire qu'en connaissance de cause.
