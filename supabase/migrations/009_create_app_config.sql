-- ─────────────────────────────────────────────────────────────────────────────
-- Africgreen — App Configuration
-- Migration 009 : Global settings and feature toggles
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.app_config (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Allow read access to all authenticated users (and anon if needed for public features)
CREATE POLICY "App config is readable by everyone"
    ON public.app_config FOR SELECT
    USING (true);

-- Only superadmins can update config
CREATE POLICY "Only superadmins can update app config"
    ON public.app_config FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'SUPERADMIN'
        )
    );

-- Seed initial demo mode config
INSERT INTO public.app_config (key, value)
VALUES ('demo_mode', '{"enabled": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Trigger for updated_at
CREATE TRIGGER app_config_updated_at
    BEFORE UPDATE ON public.app_config
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
