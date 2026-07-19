-- ============================================================================
-- Green-Gate OS — Fix trigger + Bootstrap SuperAdmin
-- Coller ce script ENTIER dans le SQL Editor de Supabase Dashboard
-- URL: https://supabase.com/dashboard/project/dyjolepwxxsedwngkfox/sql/new
-- ============================================================================

-- ── 1. FIX: handle_new_user trigger (safe enum cast + is_active=false) ──────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, role, is_active)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1)),
        CASE
            WHEN NEW.raw_user_meta_data->>'role' IS NOT NULL
                 AND NEW.raw_user_meta_data->>'role' != ''
            THEN (NEW.raw_user_meta_data->>'role')::public.user_role
            ELSE 'PORT_OFFICER'::public.user_role
        END,
        COALESCE((NEW.raw_user_meta_data->>'is_active')::boolean, false)
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 2. Ensure trigger exists on auth.users ──────────────────────────────────

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- ── 3. Fix any orphan profiles (users in auth.users without profile) ────────

INSERT INTO public.profiles (id, email, full_name, role, is_active)
SELECT
    u.id,
    u.email,
    COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
    'PORT_OFFICER'::public.user_role,
    false
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

-- ── 4. Create SuperAdmin user via auth.users direct insert ──────────────────
-- Password: Demo@2025! (bcrypt hashed via pgcrypto)

-- Enable pgcrypto if not already
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Delete any previous superadmin@africgreen.gov.sl to avoid conflicts
DELETE FROM public.profiles WHERE email = 'superadmin@africgreen.gov.sl';
DELETE FROM auth.users WHERE email = 'superadmin@africgreen.gov.sl';

-- Insert into auth.users
INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token
)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    'superadmin@africgreen.gov.sl',
    crypt('Demo@2025!', gen_salt('bf')),
    NOW(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    '{"full_name": "Green-Gate SuperAdmin", "role": "SUPERADMIN", "is_active": true}'::jsonb,
    NOW(),
    NOW(),
    '',
    ''
);

-- ── 5. Ensure the superadmin profile is active ─────────────────────────────

UPDATE public.profiles
SET is_active = true, role = 'SUPERADMIN'
WHERE email = 'superadmin@africgreen.gov.sl';

-- ── 6. Also fix existing orphan profiles to match registration data ─────────

UPDATE public.profiles p
SET role = (rr.requested_role)::public.user_role
FROM public.registration_requests rr
WHERE p.email = rr.contact_email
  AND rr.status = 'PENDING'
  AND p.is_active = false;

-- ── 7. Diagnostic output ────────────────────────────────────────────────────

SELECT '=== AUTH USERS ===' AS section;
SELECT id, email, email_confirmed_at IS NOT NULL AS confirmed,
       raw_user_meta_data->>'role' AS meta_role
FROM auth.users
ORDER BY created_at;

SELECT '=== PROFILES ===' AS section;
SELECT id, email, role, is_active, created_at
FROM public.profiles
ORDER BY created_at;

SELECT '=== TRIGGERS ON auth.users ===' AS section;
SELECT tgname, proname, tgenabled
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'auth' AND c.relname = 'users';
