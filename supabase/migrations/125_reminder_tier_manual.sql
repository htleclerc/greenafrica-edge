-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 125 : palier de relance MANUAL — la valeur d'enum, SEULE.
--
-- Les usages (index partiel, vue) vivent en 126 : ADD VALUE ne peut pas
-- cohabiter avec un usage de la valeur dans la même transaction.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TYPE public.reminder_tier ADD VALUE IF NOT EXISTS 'MANUAL';

-- DOWN: aucun — Postgres ne supporte pas DROP VALUE sur un enum.
