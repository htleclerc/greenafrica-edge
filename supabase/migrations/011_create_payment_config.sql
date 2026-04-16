-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 011: Payment provider configuration
-- Admin-switchable payment providers (Stripe, Paystack, Flutterwave, Wave, Wire)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payment_config (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    provider        TEXT NOT NULL UNIQUE,          -- 'stripe' | 'paystack' | 'flutterwave' | 'wave' | 'wire_transfer'
    display_name    TEXT NOT NULL DEFAULT '',
    is_enabled      BOOLEAN NOT NULL DEFAULT false,
    is_active       BOOLEAN NOT NULL DEFAULT false, -- only ONE can be active at a time
    test_mode       BOOLEAN NOT NULL DEFAULT true,
    display_order   INT NOT NULL DEFAULT 0,
    config_json     JSONB DEFAULT '{}',             -- provider-specific settings (non-secret)
    updated_at      TIMESTAMPTZ DEFAULT now(),
    updated_by      UUID REFERENCES public.profiles(id)
);

-- Seed default providers
INSERT INTO public.payment_config (provider, display_name, is_enabled, is_active, test_mode, display_order) VALUES
    ('stripe',        'Stripe (Cards + SEPA)',         false, false, true, 1),
    ('paystack',      'Paystack (Africa Cards + Bank)', false, false, true, 2),
    ('flutterwave',   'Flutterwave (Africa + Global)',  false, false, true, 3),
    ('wave',          'Wave Mobile Money',              false, false, true, 4),
    ('wire_transfer', 'Wire Transfer (SWIFT)',          true,  true,  false, 5)
ON CONFLICT (provider) DO NOTHING;

-- RLS: read for all authenticated, write for SUPERADMIN/FINANCE_ADMIN only
ALTER TABLE public.payment_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_config_read"
    ON public.payment_config FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "payment_config_write"
    ON public.payment_config FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role IN ('SUPERADMIN', 'FINANCE_ADMIN')
        )
    );

COMMENT ON TABLE public.payment_config IS
    'Admin-configurable payment providers. Switch the active provider without redeploying.';
