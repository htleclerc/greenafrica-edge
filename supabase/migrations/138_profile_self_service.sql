-- 138 — Le profil devient modifiable, et le verrou cesse d'être une liste noire
--
-- Deux choses, liées : on ouvre l'écriture de quelques champs à leur
-- propriétaire, donc il faut d'abord s'assurer que TOUT le reste est fermé.

-- ── 1. Ce qu'un profil porte en propre ──────────────────────────────────────
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS bio   TEXT,
    -- Préférences d'envoi. En JSONB plutôt qu'en colonnes : la liste change au
    -- rythme des canaux, et une clé inconnue vaut « valeur par défaut » côté
    -- application plutôt qu'une migration à chaque ajout.
    ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.notification_prefs IS
'Mig 138 : préférences d''envoi, {clé: booléen}. Une clé absente vaut le défaut
applicatif. Ne gouverne QUE les notifications d''information — les faits de
sécurité et d''argent partent toujours.';

-- ── 2. Le verrou passe en liste blanche ─────────────────────────────────────
--
-- La mig 119 énumérait les colonnes interdites (role, is_active, id, email),
-- la mig 130 en a ajouté une (can_settle_payments). Une liste noire ne protège
-- que ce qu'on a pensé à y mettre : au moment d'écrire ceci, huit colonnes
-- sensibles restaient modifiables par leur propre titulaire via un simple PATCH
-- PostgREST — dont `can_record_cash`, `credit_limit_usd`, `operational_site`,
-- `eez_suspended` et `is_demo`. Se donner le droit d'encaisser du liquide ou une
-- ligne de crédit tenait en une requête.
--
-- L'inversion est le fond du correctif : tout est refusé sauf ce qui est
-- nommé. Une colonne ajoutée demain naît fermée, ce qui est le bon défaut pour
-- une table qui porte des privilèges.
CREATE OR REPLACE FUNCTION public.profiles_privileged_column_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  -- Ce qu'une personne peut changer sur elle-même. Rien d'autre.
  self_editable CONSTANT TEXT[] := ARRAY[
    'full_name', 'phone', 'bio', 'timezone',
    'preferred_language', 'notification_prefs', 'updated_at'
  ];
  refused TEXT;
BEGIN
  -- Session sans JWT (migrations, fixtures SQL) : personne à qui refuser un
  -- privilège, et RLS n'accorderait pas l'écriture avec auth.uid() NULL.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- service_role : routes admin, crons, scripts. Déjà RLS-bypass.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- SUPERADMIN : chemin de promotion/rétrogradation, y compris sur autrui.
  IF public.get_user_role()::text = 'SUPERADMIN' THEN
    RETURN NEW;
  END IF;

  SELECT string_agg(n.key, ', ' ORDER BY n.key)
    INTO refused
    FROM jsonb_each(to_jsonb(NEW)) n
    JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
   WHERE n.value IS DISTINCT FROM o.value
     AND NOT (n.key = ANY (self_editable));

  IF refused IS NOT NULL THEN
    RAISE EXCEPTION 'profiles: % cannot be self-updated', refused
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.profiles_privileged_column_guard() IS
'Mig 138 : liste BLANCHE des colonnes qu''un profil peut modifier sur lui-même.
Remplace la liste noire des migs 119/130, qui laissait passer can_record_cash,
credit_limit_usd, operational_site, eez_suspended, is_demo et country_code.
service_role et SUPERADMIN bypassent, comme avant.';

-- DOWN:
-- La liste noire des migs 119 + 130 est restaurable en réécrivant la fonction ;
-- les colonnes ajoutées ici se retirent par ALTER TABLE ... DROP COLUMN. Aucun
-- des deux n'est souhaitable : le retour arrière rouvre l'auto-élévation.
