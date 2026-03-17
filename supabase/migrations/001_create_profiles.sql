-- ─────────────────────────────────────────────────────────────────────────────
-- Africgreen — User Profiles & RBAC
-- Migration 001 : Table profiles liée à auth.users
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Enum types ───────────────────────────────────────────────────────────────

CREATE TYPE public.user_role AS ENUM (
    'PORT_OFFICER',
    'FINANCE_ADMIN',
    'SHIPPING_AGENT',
    'SUPERADMIN'
);

CREATE TYPE public.operational_site AS ENUM (
    'BERBERA_PORT',
    'NATIONAL_HQ',
    'ZEILA_PORT'
);

-- ── Profiles table ───────────────────────────────────────────────────────────
-- Chaque ligne est liée 1:1 à un auth.users via l'id

CREATE TABLE public.profiles (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email           TEXT NOT NULL,
    full_name       TEXT NOT NULL,
    role            public.user_role NOT NULL DEFAULT 'PORT_OFFICER',
    operational_site public.operational_site NOT NULL DEFAULT 'BERBERA_PORT',
    country_code    CHAR(2) NOT NULL DEFAULT 'SO',
    timezone        TEXT NOT NULL DEFAULT 'Africa/Mogadishu',
    preferred_language TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'fr', 'so', 'ar')),
    ip_address      INET,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    is_demo         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index pour les requêtes fréquentes
CREATE INDEX idx_profiles_role ON public.profiles(role);
CREATE INDEX idx_profiles_site ON public.profiles(operational_site);
CREATE INDEX idx_profiles_active ON public.profiles(is_active) WHERE is_active = TRUE;

-- ── Auto-update updated_at ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- ── Auto-create profile on signup ────────────────────────────────────────────
-- Quand un user s'inscrit via Supabase Auth, on crée automatiquement un profil
-- is_active = false par défaut → le SUPERADMIN doit approuver

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

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- ── RLS (Row Level Security) ─────────────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Chaque user peut lire son propre profil
CREATE POLICY "Users can read own profile"
    ON public.profiles
    FOR SELECT
    USING (auth.uid() = id);

-- Chaque user peut mettre à jour son propre profil (sauf le rôle)
CREATE POLICY "Users can update own profile"
    ON public.profiles
    FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Les SUPERADMIN et PORT_OFFICER peuvent lire tous les profils
CREATE POLICY "Admins can read all profiles"
    ON public.profiles
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
            AND p.role IN ('SUPERADMIN', 'PORT_OFFICER')
        )
    );

-- Seul SUPERADMIN peut modifier les rôles
CREATE POLICY "Superadmin can update any profile"
    ON public.profiles
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
            AND p.role = 'SUPERADMIN'
        )
    );

-- ── Helper function pour récupérer le rôle courant ──────────────────────────

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS public.user_role AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;
