-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 124 : shipowners.preferred_language couvre les six locales livrees
--
-- La contrainte posee par la migration 047 (en, fr, ar, pt, sw) exclut le
-- somali, livre en production le 2026-06-21 et place en 2e position des
-- selecteurs (frontend/src/navigation.ts) — sur une plateforme qui opere a
-- Berbera. Un armateur somalien ne peut donc pas voir sa langue enregistree.
--
-- Le meme decalage touche deja updateOwnerKycProfile.ts : ALLOWED_LANGS
-- (frontend/src/lib/kyc/kycSchema.ts) inclut 'so' depuis le depart cote
-- validation Zod, mais l'ecriture echoue en base sur cette contrainte —
-- migration corrective pour les deux chemins (staff et self-service owner)
-- a la fois.
--
-- N'ADD PAS 'so' a un ensemble arbitraire : aligne sur les six locales
-- reellement livrees (frontend/messages/{en,fr,pt,sw,ar,so}.json / ALLOWED_LANGS).
--
-- NE TOUCHE PAS profiles.preferred_language (contrainte posee par
-- 001_create_profiles.sql : en/fr/so/ar, sans pt/sw — divergence symetrique,
-- suivie separement, hors perimetre ici).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.shipowners
  DROP CONSTRAINT IF EXISTS shipowners_preferred_language_check;

ALTER TABLE public.shipowners
  ADD CONSTRAINT shipowners_preferred_language_check
  CHECK (preferred_language IN ('en', 'fr', 'so', 'pt', 'ar', 'sw'));

-- DOWN:
-- ALTER TABLE public.shipowners DROP CONSTRAINT shipowners_preferred_language_check;
-- ALTER TABLE public.shipowners ADD CONSTRAINT shipowners_preferred_language_check
--   CHECK (preferred_language IN ('en', 'fr', 'ar', 'pt', 'sw'));
