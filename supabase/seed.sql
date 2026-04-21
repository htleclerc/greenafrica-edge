-- ─────────────────────────────────────────────────────────────────────────────
-- Africgreen — Seed : Comptes démo génériques
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Ce script crée des comptes démo dans Supabase Auth + profiles.
-- Chaque rôle a un utilisateur générique avec un mot de passe connu.
--
-- IMPORTANT : À exécuter uniquement en environnement dev/staging.
-- Ne JAMAIS exécuter en production.
--
-- Mot de passe commun pour tous les comptes démo : Demo@2025!
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Créer les utilisateurs dans auth.users ────────────────────────────────
-- Le trigger on_auth_user_created créera automatiquement les profils.
-- On utilise des UUID fixes pour pouvoir les référencer ensuite.

-- Port Officer — Hassan Mohamoud
INSERT INTO auth.users (
    id, instance_id, aud, role,
    email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, raw_app_meta_data,
    confirmation_token, recovery_token
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'demo.officer@berbera.gov.sl',
    crypt('Demo@2025!', gen_salt('bf')),
    NOW(), NOW(), NOW(),
    jsonb_build_object('full_name', 'Officer Hassan Mohamoud', 'role', 'PORT_OFFICER'),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    '', ''
) ON CONFLICT (id) DO NOTHING;

-- Finance Admin — Fadumo Yusuf
INSERT INTO auth.users (
    id, instance_id, aud, role,
    email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, raw_app_meta_data,
    confirmation_token, recovery_token
) VALUES (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'demo.finance@mof.gov.sl',
    crypt('Demo@2025!', gen_salt('bf')),
    NOW(), NOW(), NOW(),
    jsonb_build_object('full_name', 'Adm. Fadumo Yusuf', 'role', 'FINANCE_ADMIN'),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    '', ''
) ON CONFLICT (id) DO NOTHING;

-- Shipping Agent — Ahmed Warsame
INSERT INTO auth.users (
    id, instance_id, aud, role,
    email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, raw_app_meta_data,
    confirmation_token, recovery_token
) VALUES (
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'demo.agent@mariner-corp.com',
    crypt('Demo@2025!', gen_salt('bf')),
    NOW(), NOW(), NOW(),
    jsonb_build_object('full_name', 'Ahmed Warsame', 'role', 'SHIPPING_AGENT'),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    '', ''
) ON CONFLICT (id) DO NOTHING;

-- Superadmin — Al-Farid Ibrahim (invisible en UI, mais existe en DB)
INSERT INTO auth.users (
    id, instance_id, aud, role,
    email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, raw_app_meta_data,
    confirmation_token, recovery_token
) VALUES (
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'superadmin@africgreen.gov.sl',
    crypt('Demo@2025!', gen_salt('bf')),
    NOW(), NOW(), NOW(),
    jsonb_build_object('full_name', 'Min. Al-Farid Ibrahim', 'role', 'SUPERADMIN'),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    '', ''
) ON CONFLICT (id) DO NOTHING;

-- Superadmin — Green Gate platform owner
INSERT INTO auth.users (
    id, instance_id, aud, role,
    email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, raw_app_meta_data,
    confirmation_token, recovery_token
) VALUES (
    '00000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'sadmin@greengate.africa',
    crypt('Demo@2025!', gen_salt('bf')),
    NOW(), NOW(), NOW(),
    jsonb_build_object('full_name', 'Green Gate Superadmin', 'role', 'SUPERADMIN'),
    jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
    '', ''
) ON CONFLICT (id) DO NOTHING;

-- ── 2. Mettre à jour les profils créés par le trigger ────────────────────────
-- Le trigger a déjà créé les lignes, on enrichit les champs manquants.

UPDATE public.profiles SET
    operational_site = 'BERBERA_PORT',
    country_code     = 'SO',
    timezone         = 'Africa/Mogadishu',
    preferred_language = 'en',
    ip_address       = '197.231.44.12'::INET,
    is_demo          = TRUE
WHERE id = '00000000-0000-0000-0000-000000000001';

UPDATE public.profiles SET
    operational_site = 'NATIONAL_HQ',
    country_code     = 'SO',
    timezone         = 'Africa/Mogadishu',
    preferred_language = 'fr',
    ip_address       = '197.231.44.55'::INET,
    is_demo          = TRUE
WHERE id = '00000000-0000-0000-0000-000000000002';

UPDATE public.profiles SET
    operational_site = 'BERBERA_PORT',
    country_code     = 'SO',
    timezone         = 'Africa/Mogadishu',
    preferred_language = 'en',
    ip_address       = '41.223.12.88'::INET,
    is_demo          = TRUE
WHERE id = '00000000-0000-0000-0000-000000000003';

UPDATE public.profiles SET
    operational_site = 'NATIONAL_HQ',
    country_code     = 'SO',
    timezone         = 'Africa/Mogadishu',
    preferred_language = 'en',
    ip_address       = '197.231.44.01'::INET,
    is_demo          = TRUE
WHERE id = '00000000-0000-0000-0000-000000000004';

UPDATE public.profiles SET
    operational_site = 'NATIONAL_HQ',
    country_code     = 'SO',
    timezone         = 'Africa/Mogadishu',
    preferred_language = 'fr',
    ip_address       = '197.231.44.02'::INET,
    is_demo          = FALSE
WHERE id = '00000000-0000-0000-0000-000000000005';

-- ── 3. Créer les identités auth ──────────────────────────────────────────────
-- Nécessaire pour que Supabase Auth reconnaisse les comptes.

INSERT INTO auth.identities (
    id, user_id, provider_id, provider,
    identity_data, last_sign_in_at,
    created_at, updated_at
) VALUES
(
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'demo.officer@berbera.gov.sl', 'email',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000001', 'email', 'demo.officer@berbera.gov.sl'),
    NOW(), NOW(), NOW()
),
(
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002',
    'demo.finance@mof.gov.sl', 'email',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000002', 'email', 'demo.finance@mof.gov.sl'),
    NOW(), NOW(), NOW()
),
(
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000003',
    'demo.agent@mariner-corp.com', 'email',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000003', 'email', 'demo.agent@mariner-corp.com'),
    NOW(), NOW(), NOW()
),
(
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000004',
    'superadmin@africgreen.gov.sl', 'email',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000004', 'email', 'superadmin@africgreen.gov.sl'),
    NOW(), NOW(), NOW()
),
(
    '00000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000005',
    'sadmin@greengate.africa', 'email',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000005', 'email', 'sadmin@greengate.africa'),
    NOW(), NOW(), NOW()
)
ON CONFLICT DO NOTHING;
