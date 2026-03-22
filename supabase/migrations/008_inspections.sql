CREATE TYPE public.inspection_type AS ENUM ('ROUTINE', 'COMPLIANCE_CHECK', 'RANDOM', 'FOLLOW_UP');
CREATE TYPE public.inspection_status AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FLAGGED');

CREATE TABLE public.inspections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ref TEXT UNIQUE,
    vessel_id UUID NOT NULL REFERENCES public.vessels(id),
    inspector_id UUID NOT NULL REFERENCES public.profiles(id),
    mmsi TEXT NOT NULL,
    inspection_type public.inspection_type NOT NULL DEFAULT 'ROUTINE',
    status public.inspection_status NOT NULL DEFAULT 'IN_PROGRESS',
    checklist JSONB NOT NULL DEFAULT '{}',
    findings TEXT DEFAULT '',
    photo_urls TEXT[] DEFAULT '{}',
    compliance_verified BOOLEAN DEFAULT false,
    offline_created BOOLEAN DEFAULT false,
    synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-generate ref INS-YYYY-NNNNNN
CREATE OR REPLACE FUNCTION public.generate_inspection_ref()
RETURNS TRIGGER AS $$
DECLARE next_num INTEGER;
BEGIN
    SELECT COALESCE(MAX(CAST(SUBSTRING(ref FROM 10) AS INTEGER)), 0) + 1
    INTO next_num FROM public.inspections
    WHERE ref LIKE 'INS-' || TO_CHAR(NOW(), 'YYYY') || '-%';
    NEW.ref := 'INS-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(next_num::TEXT, 6, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_inspection_ref
    BEFORE INSERT ON public.inspections FOR EACH ROW
    WHEN (NEW.ref IS NULL) EXECUTE FUNCTION public.generate_inspection_ref();

ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY inspections_select ON public.inspections FOR SELECT USING (
    inspector_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('PORT_OFFICER', 'SUPERADMIN'))
);

CREATE POLICY inspections_insert ON public.inspections FOR INSERT WITH CHECK (inspector_id = auth.uid());

CREATE POLICY inspections_update ON public.inspections FOR UPDATE USING (
    inspector_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('SUPERADMIN'))
);

CREATE INDEX idx_inspections_vessel ON public.inspections(vessel_id);
CREATE INDEX idx_inspections_inspector ON public.inspections(inspector_id);
CREATE INDEX idx_inspections_mmsi ON public.inspections(mmsi);
CREATE INDEX idx_inspections_status ON public.inspections(status);
