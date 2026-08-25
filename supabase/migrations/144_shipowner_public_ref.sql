-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 144 : référence publique opaque pour les armateurs
--
-- Les écrans d'administration exposaient l'UUID de la ligne dans l'URL
-- (/admin/armateurs/5265aa3b-bd3a-4bfe-9ddf-8bc94898fd4a). Un identifiant
-- interne n'a rien à faire là : il finit dans l'historique du navigateur, les
-- en-têtes Referer, les captures d'écran et les tickets de support.
--
-- `public_ref` est TIRÉE AU HASARD, pas dérivée : ni de l'UUID, ni du nom, ni
-- de l'IMO. On ne peut donc pas la calculer à partir de ce qu'on sait de
-- l'armateur, et l'énumération devient impraticable.
--
-- Ce n'est PAS une autorisation. Les pages restent gardées par le rôle, la
-- juridiction et la RLS : une référence devinée se fait refuser exactement
-- comme avant. Ce que la colonne achète, c'est l'arrêt d'une fuite
-- d'identifiants, pas un contrôle d'accès.
--
-- Séquence en trois temps plutôt qu'un ADD COLUMN ... DEFAULT : un défaut
-- volatil comme gen_random_bytes() n'est pas garanti d'être évalué par ligne
-- lors de l'ajout de colonne. Un UPDATE explicite l'est, lui.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Colonne nullable, sans défaut.
ALTER TABLE public.shipowners
  ADD COLUMN IF NOT EXISTS public_ref TEXT;

-- 2. Backfill : une valeur distincte par ligne, garantie par l'UPDATE.
--    12 caractères hexadécimaux = 48 bits ; le préfixe rend la référence
--    lisible dans une URL et dit ce qu'elle désigne.
UPDATE public.shipowners
   SET public_ref = 'arm_' || encode(gen_random_bytes(6), 'hex')
 WHERE public_ref IS NULL;

-- 3. Verrouillage : obligatoire, unique, et tirée au hasard pour les lignes
--    à venir.
ALTER TABLE public.shipowners
  ALTER COLUMN public_ref SET NOT NULL,
  ALTER COLUMN public_ref SET DEFAULT 'arm_' || encode(gen_random_bytes(6), 'hex');

CREATE UNIQUE INDEX IF NOT EXISTS shipowners_public_ref_unique
  ON public.shipowners(public_ref);

COMMENT ON COLUMN public.shipowners.public_ref IS
  'Mig 144 : référence opaque exposée dans les URL d''administration, à la place de l''UUID. Tirée au hasard — ne jamais la dériver de l''id, du nom ou de l''IMO.';

-- DOWN:
-- DROP INDEX IF EXISTS public.shipowners_public_ref_unique;
-- ALTER TABLE public.shipowners DROP COLUMN IF EXISTS public_ref;
