-- FIXTURE D'ENVIRONNEMENT LOCAL — N'EST PAS UNE MIGRATION.
--
-- À rejouer après chaque `supabase db reset`, avant tout script d'import ou
-- test qui passe par PostgREST :
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/local-grants.sql
--
-- POURQUOI. Dans l'image supabase/postgres, le rôle `postgres` n'est pas
-- superuser (`supabase_admin` l'est). Les migrations s'exécutent donc en
-- `postgres`, et les ALTER DEFAULT PRIVILEGES posés pour anon / authenticated
-- / service_role — qui appartiennent à `supabase_admin` — ne s'appliquent pas
-- aux tables ainsi créées. Résultat : 37 des 44 tables de `public` n'ont ni
-- SELECT ni INSERT pour service_role en local, et toute lecture via l'API
-- échoue sur « permission denied for table ... ».
--
-- C'est un artefact strictement LOCAL. En production, les migrations sont
-- appliquées par la plateforme Supabase, où les privilèges par défaut
-- s'appliquent normalement — c'est bien pourquoi les écrans d'administration
-- fonctionnent sur l'hébergé.
--
-- Ne PAS transformer ce fichier en migration : cela accorderait en production
-- des droits que le modèle RLS n'y attend pas, et masquerait la vraie cause.
--
-- C'est aussi la raison des six tests de migration qui échouent en local
-- (058, 073, 074, 076, 087, 119) : ils simulent un rôle applicatif et butent
-- sur les mêmes droits manquants.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'v', 'm')
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated, service_role',
      r.relname);
  END LOOP;
END $$;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
