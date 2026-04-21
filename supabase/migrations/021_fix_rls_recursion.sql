-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 021 : Fix infinite recursion in RLS policies
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Pre-existing bug (since migration 001) finally surfaced when MANAGER tried
-- to SELECT from registration_requests:
--
--   Error 42P17: infinite recursion detected in policy for relation "profiles"
--
-- ROOT CAUSE
-- ──────────
-- Migration 001's "Admins can read all profiles" policy contains a
-- self-referencing subquery against the profiles table:
--
--   USING (
--       EXISTS (
--           SELECT 1 FROM public.profiles p
--           WHERE p.id = auth.uid() AND p.role IN ('SUPERADMIN', 'PORT_OFFICER')
--       )
--   )
--
-- When ANY policy on ANOTHER table (like registration_requests) does its own
-- subquery against profiles to check the caller's role, Postgres needs to
-- evaluate the profiles SELECT policy, which itself queries profiles → loop.
--
-- The bug was latent because the only callers of registration_requests went
-- through the service_role key (Next.js admin route handler), which bypasses
-- RLS entirely. The MANAGER role finally exposed it by being a real
-- authenticated user with a non-trivial RLS check needed.
--
-- FIX
-- ───
-- Use the existing SECURITY DEFINER function public.get_user_role() (defined
-- in migration 001). Because it runs as the function owner (postgres), its
-- internal SELECT FROM profiles bypasses RLS — breaking the recursion loop.
--
-- The vessels and vessel_positions policies created in migration 020 already
-- use this pattern (get_user_role()::text IN (...)) and don't recurse. This
-- migration brings profiles and registration_requests in line.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── profiles: replace recursive policy with get_user_role() check ───────────
DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
CREATE POLICY "Admins can read all profiles"
    ON public.profiles
    FOR SELECT
    USING (
        public.get_user_role()::text IN ('SUPERADMIN', 'PORT_OFFICER', 'MANAGER')
    );

-- Same pattern for the SUPERADMIN-only update policy if it has the same
-- shape. The original policy might already be fine if it just checks
-- get_user_role() — drop+recreate idempotently to be sure.
DROP POLICY IF EXISTS "Superadmin can update any profile" ON public.profiles;
CREATE POLICY "Superadmin can update any profile"
    ON public.profiles
    FOR UPDATE
    USING (public.get_user_role()::text = 'SUPERADMIN')
    WITH CHECK (public.get_user_role()::text = 'SUPERADMIN');

-- ── registration_requests: rewrite with get_user_role() to match ────────────
DROP POLICY IF EXISTS "Admins and managers can read all registrations" ON public.registration_requests;
CREATE POLICY "Admins and managers can read all registrations"
    ON public.registration_requests
    FOR SELECT
    USING (
        public.get_user_role()::text IN ('SUPERADMIN', 'PORT_OFFICER', 'MANAGER')
    );

DROP POLICY IF EXISTS "Admins and managers can update registrations" ON public.registration_requests;
CREATE POLICY "Admins and managers can update registrations"
    ON public.registration_requests
    FOR UPDATE
    USING (
        public.get_user_role()::text IN ('SUPERADMIN', 'PORT_OFFICER', 'MANAGER')
    );

-- ── Verify ──────────────────────────────────────────────────────────────────
-- After running, this should NOT recurse (smoke test from the role of the
-- caller you want to verify):
--   SELECT id FROM public.profiles LIMIT 1;
--   SELECT id FROM public.registration_requests LIMIT 1;
