-- ============================================================================
-- AfricGreenOS — COMPLETE Auth Fix
--
-- INSTRUCTIONS:
-- 1. Go to: https://supabase.com/dashboard/project/dyjolepwxxsedwngkfox/sql/new
-- 2. Paste this ENTIRE script
-- 3. Click "Run"
-- 4. After success, go to Settings > General > Restart project
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 1: DIAGNOSTIC — understand current state
-- ════════════════════════════════════════════════════════════════════════════

-- Check GoTrue internal migrations
SELECT 'STEP 1a: auth.schema_migrations' AS diagnostic;
SELECT version FROM auth.schema_migrations ORDER BY version DESC LIMIT 10;

-- Check if auth.users table is accessible
SELECT 'STEP 1b: auth.users count' AS diagnostic;
SELECT count(*) AS user_count FROM auth.users;

-- Check triggers on auth.users
SELECT 'STEP 1c: triggers on auth.users' AS diagnostic;
SELECT tgname, proname, tgenabled
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'auth' AND c.relname = 'users';

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 2: DROP the custom trigger (this is the likely cause of GoTrue crash)
-- GoTrue inspects auth.users triggers at startup. If our trigger function
-- references types/tables that cause issues, GoTrue fails for ALL operations.
-- ════════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 3: Fix the trigger function to be bullet-proof
-- Key changes:
--   - Wrapped in exception handler (trigger NEVER crashes auth operations)
--   - is_active defaults to FALSE (new users need admin approval)
--   - Safe enum cast with fallback
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, role, is_active)
    VALUES (
        NEW.id,
        COALESCE(NEW.email, ''),
        COALESCE(
            NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
            split_part(COALESCE(NEW.email, 'user'), '@', 1)
        ),
        CASE
            WHEN NEW.raw_user_meta_data->>'role' IN ('PORT_OFFICER','FINANCE_ADMIN','SHIPPING_AGENT','SUPERADMIN')
            THEN (NEW.raw_user_meta_data->>'role')::public.user_role
            ELSE 'PORT_OFFICER'::public.user_role
        END,
        COALESCE((NEW.raw_user_meta_data->>'is_active')::boolean, false)
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- NEVER let this trigger crash auth operations
    RAISE WARNING 'handle_new_user trigger failed for %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 4: Recreate the trigger (safe version with exception handler)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 5: Clean up any corrupted auth.users rows (from direct INSERT)
-- Direct inserts into auth.users miss required columns that GoTrue expects.
-- We delete them so GoTrue can properly manage user creation.
-- ════════════════════════════════════════════════════════════════════════════

-- First, identify rows that were likely inserted directly (missing GoTrue fields)
SELECT 'STEP 5: checking for corrupted auth rows' AS info;
SELECT id, email,
       CASE WHEN is_sso_user IS NULL THEN 'CORRUPTED' ELSE 'OK' END AS status
FROM auth.users;

-- Delete corrupted rows (inserted directly, not via GoTrue)
DELETE FROM auth.users
WHERE email = 'superadmin@africgreen.gov.sl';

-- Also clean up corresponding profiles
DELETE FROM public.profiles
WHERE email = 'superadmin@africgreen.gov.sl';

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 6: Fix orphan profiles (profiles without matching auth.users)
-- These cause foreign key issues
-- ════════════════════════════════════════════════════════════════════════════

SELECT 'STEP 6: orphan profiles' AS info;
SELECT p.id, p.email, p.role
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE u.id IS NULL;

-- Delete orphan profiles (they have no matching auth user)
DELETE FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id);

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 7: Notify PostgREST to reload schema cache
-- ════════════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 8: Final diagnostic
-- ════════════════════════════════════════════════════════════════════════════

SELECT '=== FINAL: auth.users ===' AS result;
SELECT id, email, email_confirmed_at IS NOT NULL AS confirmed,
       raw_user_meta_data->>'role' AS meta_role,
       created_at
FROM auth.users ORDER BY created_at;

SELECT '=== FINAL: profiles ===' AS result;
SELECT id, email, role, is_active FROM public.profiles ORDER BY created_at;

SELECT '=== FINAL: registration_requests ===' AS result;
SELECT id, contact_email, requested_role, status FROM public.registration_requests ORDER BY created_at;

-- ════════════════════════════════════════════════════════════════════════════
-- DONE! Now:
-- 1. Go to Dashboard > Settings > General > "Restart project"
-- 2. Wait 1-2 minutes
-- 3. Then use the /api/auth/setup endpoint to create the SuperAdmin
-- ════════════════════════════════════════════════════════════════════════════
