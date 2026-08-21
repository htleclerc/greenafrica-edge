-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 123 : valeur d'audit dédiée SHIPOWNER_UPDATED
--
-- Ajoute la valeur d'enum audit_action 'SHIPOWNER_UPDATED', pour l'action
-- staff updateArmateurContacts (édition des contacts d'un armateur : e-mail
-- officiel, copies de facturation, coordonnées). Créée au lieu de réutiliser
-- 'TRANSACTION_UPDATED', pour garder une taxonomie d'audit propre — même
-- choix que la migration 105 pour 'SHIPOWNER_ANONYMIZED' (« au lieu de
-- réutiliser TRANSACTION_UPDATED »).
-- ADDITIVE.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'SHIPOWNER_UPDATED';

-- DOWN:
-- (aucune action possible : Postgres ne supporte pas DROP VALUE sur un type enum — no-op au rollback)
