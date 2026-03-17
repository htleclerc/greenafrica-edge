-- ─────────────────────────────────────────────────────────────────────────────
-- Africgreen — Core Domain Tables
-- Migration 003 : Vessels, Transactions, Tax Configs, Exemptions, Audit, Projects
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Enum types ──────────────────────────────────────────────────────────────

CREATE TYPE public.vessel_category AS ENUM (
    'CONTAINER', 'CARGO', 'TANKER', 'BULK_CARRIER', 'FERRY', 'NAVAL', 'SCIENTIFIC'
);

CREATE TYPE public.compliance_status AS ENUM (
    'COMPLIANT', 'PAYMENT_DUE', 'PROCESSING', 'NON_COMPLIANT', 'APPROACHING', 'EXEMPT'
);

CREATE TYPE public.jurisdiction_zone AS ENUM (
    'EEZ', 'PORT_VICINITY', 'TRANSIT_LANE'
);

CREATE TYPE public.transaction_type AS ENUM (
    'ENTRY_TAX', 'TRANSIT_FEE', 'PORT_STAY'
);

CREATE TYPE public.transaction_status AS ENUM (
    'PAID', 'PENDING', 'OVERDUE', 'EXEMPT', 'DISPUTED'
);

CREATE TYPE public.exemption_reason AS ENUM (
    'MILITARY', 'HUMANITARIAN', 'SCIENTIFIC', 'UN_AGENCY', 'OTHER'
);

CREATE TYPE public.audit_action AS ENUM (
    'LOGIN', 'LOGOUT', 'VESSEL_VIEWED', 'INVOICE_GENERATED',
    'TAX_RATE_UPDATED', 'EXEMPTION_GRANTED', 'REPORT_EXPORTED',
    'USER_CREATED', 'TRANSACTION_UPDATED'
);

CREATE TYPE public.audit_severity AS ENUM (
    'INFO', 'WARNING', 'CRITICAL'
);

CREATE TYPE public.project_type AS ENUM (
    'BLUE_CARBON', 'REFORESTATION', 'SOLAR', 'WIND', 'METHANE_CAPTURE', 'ENERGY_EFFICIENCY'
);

CREATE TYPE public.project_status AS ENUM (
    'ACTIVE', 'PENDING', 'COMPLETED', 'SUSPENDED', 'UNDER_REVIEW'
);

CREATE TYPE public.verification_standard AS ENUM (
    'VERRA_VCS', 'GOLD_STANDARD', 'IMO_DCS', 'PENDING_VERIFICATION'
);

CREATE TYPE public.tax_config_status AS ENUM (
    'ACTIVE', 'DRAFT', 'ARCHIVED'
);

-- ── Vessels ─────────────────────────────────────────────────────────────────

CREATE TABLE public.vessels (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    imo_number              TEXT NOT NULL UNIQUE,
    mmsi                    TEXT NOT NULL,
    name                    TEXT NOT NULL,
    call_sign               TEXT NOT NULL,
    flag_code               CHAR(2) NOT NULL,
    category                public.vessel_category NOT NULL,
    gross_tonnage_dwt       INTEGER NOT NULL,
    engine_power_kw         INTEGER NOT NULL,
    design_speed_knots      NUMERIC(5,1) NOT NULL,
    compliance_status       public.compliance_status NOT NULL DEFAULT 'APPROACHING',
    estimated_emissions_tco2 NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_liability_usd       NUMERIC(12,2) NOT NULL DEFAULT 0,
    port_call               TEXT,
    pro_forma_generated     BOOLEAN NOT NULL DEFAULT FALSE,
    last_transaction_id     UUID,
    -- owner_id links vessels to their shipping agent for RLS
    owner_id                UUID REFERENCES public.profiles(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vessels_imo ON public.vessels(imo_number);
CREATE INDEX idx_vessels_owner ON public.vessels(owner_id);
CREATE INDEX idx_vessels_compliance ON public.vessels(compliance_status);
CREATE INDEX idx_vessels_port ON public.vessels(port_call);

CREATE TRIGGER vessels_updated_at
    BEFORE UPDATE ON public.vessels
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- ── Vessel Positions (AIS time-series) ──────────────────────────────────────

CREATE TABLE public.vessel_positions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_id       UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
    lat             NUMERIC(9,6) NOT NULL,
    lng             NUMERIC(9,6) NOT NULL,
    heading         NUMERIC(5,1) NOT NULL DEFAULT 0,
    speed_knots     NUMERIC(5,1) NOT NULL DEFAULT 0,
    zone            public.jurisdiction_zone,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vpos_vessel_time ON public.vessel_positions(vessel_id, recorded_at DESC);
CREATE INDEX idx_vpos_zone ON public.vessel_positions(zone);

-- ── Transactions ────────────────────────────────────────────────────────────

CREATE TABLE public.transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_id           UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
    vessel_name         TEXT NOT NULL,
    vessel_imo          TEXT NOT NULL,
    transaction_type    public.transaction_type NOT NULL,
    emissions_tco2      NUMERIC(12,2) NOT NULL,
    tax_amount_usd      NUMERIC(12,2) NOT NULL,
    status              public.transaction_status NOT NULL DEFAULT 'PENDING',
    invoice_pdf_url     TEXT,
    port_call           TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    paid_at             TIMESTAMPTZ
);

CREATE INDEX idx_txn_vessel ON public.transactions(vessel_id);
CREATE INDEX idx_txn_status ON public.transactions(status);
CREATE INDEX idx_txn_created ON public.transactions(created_at DESC);

-- Add FK from vessels.last_transaction_id now that transactions table exists
ALTER TABLE public.vessels
    ADD CONSTRAINT fk_vessels_last_txn
    FOREIGN KEY (last_transaction_id) REFERENCES public.transactions(id);

-- ── Tax Configurations ──────────────────────────────────────────────────────

CREATE TABLE public.tax_configurations (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiction_zone       public.jurisdiction_zone NOT NULL,
    vessel_category         public.vessel_category NOT NULL,
    base_rate_usd_per_tco2  NUMERIC(8,2) NOT NULL,
    multiplier              NUMERIC(4,2) NOT NULL DEFAULT 1.0,
    effective_date          DATE NOT NULL,
    status                  public.tax_config_status NOT NULL DEFAULT 'DRAFT',
    created_by              UUID NOT NULL REFERENCES public.profiles(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one ACTIVE config per zone+category
CREATE UNIQUE INDEX idx_tax_active_unique
    ON public.tax_configurations(jurisdiction_zone, vessel_category)
    WHERE status = 'ACTIVE';

CREATE TRIGGER tax_configs_updated_at
    BEFORE UPDATE ON public.tax_configurations
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- ── Exemptions ──────────────────────────────────────────────────────────────

CREATE TABLE public.exemptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_id       UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
    vessel_name     TEXT NOT NULL,
    reason          public.exemption_reason NOT NULL,
    valid_until     DATE NOT NULL,
    approved_by     UUID NOT NULL REFERENCES public.profiles(id),
    notes           TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_exemptions_vessel ON public.exemptions(vessel_id);
CREATE INDEX idx_exemptions_valid ON public.exemptions(valid_until);

-- ── Audit Logs ──────────────────────────────────────────────────────────────

CREATE TABLE public.audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES public.profiles(id),
    user_full_name  TEXT NOT NULL,
    action          public.audit_action NOT NULL,
    severity        public.audit_severity NOT NULL DEFAULT 'INFO',
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    details_json    JSONB NOT NULL DEFAULT '{}',
    ip_address      INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON public.audit_logs(user_id);
CREATE INDEX idx_audit_action ON public.audit_logs(action);
CREATE INDEX idx_audit_created ON public.audit_logs(created_at DESC);
CREATE INDEX idx_audit_severity ON public.audit_logs(severity);

-- ── Carbon Projects ─────────────────────────────────────────────────────────

CREATE TABLE public.carbon_projects (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    TEXT NOT NULL,
    description             TEXT NOT NULL,
    type                    public.project_type NOT NULL,
    status                  public.project_status NOT NULL DEFAULT 'PENDING',
    operator_name           TEXT NOT NULL,
    operator_id             TEXT NOT NULL,
    location_name           TEXT NOT NULL,
    location_lat            NUMERIC(9,6) NOT NULL,
    location_lng            NUMERIC(9,6) NOT NULL,
    area_hectares           NUMERIC(10,1) NOT NULL DEFAULT 0,
    start_date              DATE NOT NULL,
    end_date                DATE,
    verification_standard   public.verification_standard NOT NULL DEFAULT 'PENDING_VERIFICATION',
    estimated_tco2_per_year NUMERIC(12,2) NOT NULL DEFAULT 0,
    credits_issued_total    NUMERIC(12,2) NOT NULL DEFAULT 0,
    credits_retired_total   NUMERIC(12,2) NOT NULL DEFAULT 0,
    credits_available       NUMERIC(12,2) NOT NULL DEFAULT 0,
    price_per_credit_usd    NUMERIC(8,2) NOT NULL DEFAULT 0,
    total_value_usd         NUMERIC(14,2) NOT NULL DEFAULT 0,
    last_verified_at        DATE,
    next_verification_at    DATE,
    funding_usd             NUMERIC(14,2) NOT NULL DEFAULT 0,
    sdg_goals               INTEGER[] NOT NULL DEFAULT '{}',
    image_url               TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_projects_status ON public.carbon_projects(status);
CREATE INDEX idx_projects_type ON public.carbon_projects(type);

CREATE TRIGGER carbon_projects_updated_at
    BEFORE UPDATE ON public.carbon_projects
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
