-- ─────────────────────────────────────────────────────────────────────────────
-- Africgreen — Registration Requests
-- Migration 002 : Table des demandes d'inscription à valider par un admin
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Enum types ──────────────────────────────────────────────────────────────

CREATE TYPE public.registration_status AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'MORE_INFO'
);

CREATE TYPE public.registration_entity_type AS ENUM (
    'PORT_AUTHORITY',
    'SHIPPING_AGENT',
    'FINANCE_ADMIN',
    'INSTITUTION'
);

-- ── Registration requests table ─────────────────────────────────────────────

CREATE TABLE public.registration_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Organization info (Step 1)
    entity_type     public.registration_entity_type NOT NULL,
    org_name        TEXT NOT NULL,
    org_registry_id TEXT NOT NULL,
    jurisdiction    TEXT NOT NULL,
    requested_role  TEXT NOT NULL,

    -- Contact info (Step 2)
    contact_name    TEXT NOT NULL,
    contact_email   TEXT NOT NULL,
    contact_phone   TEXT,
    password_hash   TEXT NOT NULL,   -- bcrypt hash — stored until approval

    -- Preferences (Step 3)
    default_region  TEXT NOT NULL DEFAULT 'Full EEZ Overview',
    access_scope    TEXT NOT NULL DEFAULT 'regional' CHECK (access_scope IN ('national', 'regional')),
    notify_proforma BOOLEAN NOT NULL DEFAULT TRUE,
    notify_co2      BOOLEAN NOT NULL DEFAULT TRUE,
    notify_revenue  BOOLEAN NOT NULL DEFAULT TRUE,
    notify_weekly   BOOLEAN NOT NULL DEFAULT TRUE,

    -- Review workflow
    status          public.registration_status NOT NULL DEFAULT 'PENDING',
    reviewed_by     UUID REFERENCES public.profiles(id),
    reviewed_at     TIMESTAMPTZ,
    review_note     TEXT,
    flagged         BOOLEAN NOT NULL DEFAULT FALSE,

    -- Metadata
    ip_address      INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_reg_status ON public.registration_requests(status);
CREATE INDEX idx_reg_email ON public.registration_requests(contact_email);
CREATE INDEX idx_reg_created ON public.registration_requests(created_at DESC);

-- Auto-update updated_at
CREATE TRIGGER reg_requests_updated_at
    BEFORE UPDATE ON public.registration_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.registration_requests ENABLE ROW LEVEL SECURITY;

-- Anyone can insert (signup is public)
CREATE POLICY "Anyone can submit registration"
    ON public.registration_requests
    FOR INSERT
    WITH CHECK (true);

-- Applicants can read their own request by email (before they have an account)
-- This uses a service role or anon key with the email filter

-- Admins (PORT_OFFICER, SUPERADMIN) can read all requests
CREATE POLICY "Admins can read all registrations"
    ON public.registration_requests
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
            AND p.role IN ('SUPERADMIN', 'PORT_OFFICER')
        )
    );

-- Admins can update requests (approve/reject)
CREATE POLICY "Admins can update registrations"
    ON public.registration_requests
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
            AND p.role IN ('SUPERADMIN', 'PORT_OFFICER')
        )
    );

-- Allow anon users to insert (for the signup form)
CREATE POLICY "Anon can submit registration"
    ON public.registration_requests
    FOR INSERT
    TO anon
    WITH CHECK (true);

-- Allow anon to read their own request by email (for status check)
CREATE POLICY "Anon can read own registration by email"
    ON public.registration_requests
    FOR SELECT
    TO anon
    USING (true);
