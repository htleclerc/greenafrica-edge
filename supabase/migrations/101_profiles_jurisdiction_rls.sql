-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 101 : scoping juridiction de la lecture des profils (profiles)
--
-- Durcissement RGPD/sécurité (audit 2026-07-21, finding C3c). La policy
-- "Admins can read all profiles" (mig 021) laissait SUPERADMIN/PORT_OFFICER/MANAGER
-- lire TOUS les profils (email, full_name, ip_address) de toutes les juridictions
-- → fuite cross-tenant sur des données personnelles de personnes physiques.
--
-- profiles n'a pas de colonne jurisdiction_id. La juridiction d'un profil se déduit :
--   - STAFF : via user_jurisdictions (peuplé uniquement pour le staff, à l'invitation).
--   - OWNER (SHIPPING_AGENT/SHIPOWNER) : via shipowners.profile_id + shipowners.jurisdiction_id
--     (les owners n'ont PAS de ligne user_jurisdictions — une policy qui l'exigerait
--     les rendrait invisibles ; d'où la branche shipowners, role-agnostique).
--
-- On PRÉSERVE l'ensemble de rôles existant (SUPERADMIN/PORT_OFFICER/MANAGER) : on ne
-- change QUE le scoping, pas qui a accès. SUPERADMIN reste inconditionnel (visibilité
-- jamais dépendante du peuplement de shipowners/user_jurisdictions). La policy
-- permissive "Users can read own profile" (mig 001) reste intacte (self-read via
-- OR-of-permissive-policies). Index déjà présents : shipowners(profile_id),
-- user_jurisdictions(user_id). ADDITIVE (remplacement de policy).
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
CREATE POLICY "Admins can read all profiles"
    ON public.profiles
    FOR SELECT
    USING (
        public.get_user_role()::text = 'SUPERADMIN'
        OR (
            public.get_user_role()::text IN ('PORT_OFFICER', 'MANAGER')
            AND (
                EXISTS (
                    SELECT 1 FROM public.user_jurisdictions uj
                    WHERE uj.user_id = profiles.id
                      AND uj.jurisdiction_id = ANY (public.current_jurisdiction_ids())
                )
                OR EXISTS (
                    SELECT 1 FROM public.shipowners so
                    WHERE so.profile_id = profiles.id
                      AND so.jurisdiction_id = ANY (public.current_jurisdiction_ids())
                )
            )
        )
    );

-- DOWN:
-- DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
-- CREATE POLICY "Admins can read all profiles"
--     ON public.profiles FOR SELECT
--     USING (public.get_user_role()::text IN ('SUPERADMIN', 'PORT_OFFICER', 'MANAGER'));
