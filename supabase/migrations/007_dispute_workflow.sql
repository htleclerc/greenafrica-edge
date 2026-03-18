-- Dispute status enum
CREATE TYPE public.dispute_status AS ENUM ('OPEN', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'ESCALATED');

-- Dispute reason enum
CREATE TYPE public.dispute_reason AS ENUM ('EMISSION_CALCULATION', 'TAX_RATE', 'ZONE_CLASSIFICATION', 'VESSEL_DATA', 'OTHER');

-- Disputes table
CREATE TABLE public.disputes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ref TEXT UNIQUE,
    transaction_id UUID NOT NULL REFERENCES public.transactions(id),
    vessel_id UUID NOT NULL REFERENCES public.vessels(id),
    submitted_by UUID NOT NULL REFERENCES public.profiles(id),
    reason public.dispute_reason NOT NULL,
    description TEXT NOT NULL,
    evidence_urls TEXT[] DEFAULT '{}',
    status public.dispute_status NOT NULL DEFAULT 'OPEN',
    reviewer_id UUID REFERENCES public.profiles(id),
    review_note TEXT,
    original_amount_usd NUMERIC NOT NULL,
    revised_amount_usd NUMERIC,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-generate ref numbers DSP-YYYY-NNNNNN
CREATE OR REPLACE FUNCTION public.generate_dispute_ref()
RETURNS TRIGGER AS $$
DECLARE
    next_num INTEGER;
BEGIN
    SELECT COALESCE(MAX(CAST(SUBSTRING(ref FROM 10) AS INTEGER)), 0) + 1
    INTO next_num
    FROM public.disputes
    WHERE ref LIKE 'DSP-' || TO_CHAR(NOW(), 'YYYY') || '-%';

    NEW.ref := 'DSP-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(next_num::TEXT, 6, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_dispute_ref
    BEFORE INSERT ON public.disputes
    FOR EACH ROW
    WHEN (NEW.ref IS NULL)
    EXECUTE FUNCTION public.generate_dispute_ref();

-- RLS policies
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;

-- Shipping agents can see their own disputes
CREATE POLICY disputes_select_own ON public.disputes
    FOR SELECT USING (
        submitted_by = auth.uid()
        OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'))
    );

-- Shipping agents can insert disputes for their own transactions
CREATE POLICY disputes_insert_own ON public.disputes
    FOR INSERT WITH CHECK (submitted_by = auth.uid());

-- Reviewers can update disputes
CREATE POLICY disputes_update_reviewer ON public.disputes
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'))
    );

-- Index for faster queries
CREATE INDEX idx_disputes_transaction ON public.disputes(transaction_id);
CREATE INDEX idx_disputes_status ON public.disputes(status);
CREATE INDEX idx_disputes_submitted_by ON public.disputes(submitted_by);
