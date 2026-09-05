-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 147 : référence publique opaque pour les navires
--
-- Même principe que la mig 144 pour les armateurs. Le détail d'un navire du
-- portail exposait l'UUID de la ligne dans l'URL
-- (/dashboard/vessels/34841384-e3de-4ff5-9055-8127f5691f49) : un identifiant
-- interne qui finit dans l'historique, les Referer et les captures d'écran.
--
-- `public_ref` est TIRÉE AU HASARD, pas dérivée — ni de l'UUID, ni du nom, ni
-- de l'IMO. L'IMO aurait été la clé « naturelle », mais une partie de la
-- flotte n'en a pas (navires « à identifier ») et une autre porte un IMO
-- synthétique : une URL ne peut pas reposer sur une valeur absente ou
-- changeante.
--
-- Ce n'est PAS une autorisation : les pages restent gardées par la session,
-- le rattachement au compte et la RLS. La colonne arrête une fuite
-- d'identifiants, elle n'ouvre rien.
--
-- Séquence en trois temps (colonne, backfill, verrou) : un défaut volatil
-- comme gen_random_bytes() n'est pas garanti d'être évalué par ligne lors de
-- l'ajout de colonne ; un UPDATE explicite l'est.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Colonne nullable, sans défaut.
ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS public_ref TEXT;

-- 2. Backfill : une valeur distincte par ligne (12 hexadécimaux = 48 bits).
UPDATE public.vessels
   SET public_ref = 'ves_' || encode(gen_random_bytes(6), 'hex')
 WHERE public_ref IS NULL;

-- 3. Verrouillage : obligatoire, unique, tirée au hasard pour les lignes à venir.
ALTER TABLE public.vessels
  ALTER COLUMN public_ref SET NOT NULL,
  ALTER COLUMN public_ref SET DEFAULT 'ves_' || encode(gen_random_bytes(6), 'hex');

CREATE UNIQUE INDEX IF NOT EXISTS vessels_public_ref_unique
  ON public.vessels(public_ref);

COMMENT ON COLUMN public.vessels.public_ref IS
  'Mig 147 : référence opaque exposée dans les URL du portail (détail navire, relevé par navire), à la place de l''UUID. Tirée au hasard — ne jamais la dériver de l''id, du nom ou de l''IMO.';

-- DOWN:
-- DROP INDEX IF EXISTS public.vessels_public_ref_unique;
-- ALTER TABLE public.vessels DROP COLUMN IF EXISTS public_ref;
