// ─────────────────────────────────────────────────────────────────────────────
// Africgreen — Supabase Database Types
// Generated manually to match migrations 001-005
// ─────────────────────────────────────────────────────────────────────────────

export interface Database {
    public: {
        Tables: {
            profiles: {
                Row: {
                    id: string;
                    email: string;
                    full_name: string;
                    role: DbUserRole;
                    operational_site: DbOperationalSite;
                    country_code: string;
                    timezone: string;
                    preferred_language: string;
                    ip_address: string | null;
                    is_active: boolean;
                    is_demo: boolean;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id: string;
                    email: string;
                    full_name: string;
                    role?: DbUserRole;
                    operational_site?: DbOperationalSite;
                    country_code?: string;
                    timezone?: string;
                    preferred_language?: string;
                    ip_address?: string | null;
                    is_active?: boolean;
                    is_demo?: boolean;
                };
                Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
            };
            vessels: {
                Row: {
                    id: string;
                    imo_number: string;
                    mmsi: string;
                    name: string;
                    call_sign: string;
                    flag_code: string;
                    category: DbVesselCategory;
                    gross_tonnage_dwt: number;
                    engine_power_kw: number;
                    design_speed_knots: number;
                    compliance_status: DbComplianceStatus;
                    estimated_emissions_tco2: number;
                    tax_liability_usd: number;
                    port_call: string | null;
                    pro_forma_generated: boolean;
                    last_transaction_id: string | null;
                    owner_id: string | null;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id?: string;
                    imo_number: string;
                    mmsi: string;
                    name: string;
                    call_sign: string;
                    flag_code: string;
                    category: DbVesselCategory;
                    gross_tonnage_dwt: number;
                    engine_power_kw: number;
                    design_speed_knots: number;
                    compliance_status?: DbComplianceStatus;
                    estimated_emissions_tco2?: number;
                    tax_liability_usd?: number;
                    port_call?: string | null;
                    pro_forma_generated?: boolean;
                    last_transaction_id?: string | null;
                    owner_id?: string | null;
                };
                Update: Partial<Database['public']['Tables']['vessels']['Insert']>;
            };
            vessel_positions: {
                Row: {
                    id: string;
                    vessel_id: string;
                    lat: number;
                    lng: number;
                    heading: number;
                    speed_knots: number;
                    zone: DbJurisdictionZone | null;
                    recorded_at: string;
                };
                Insert: {
                    id?: string;
                    vessel_id: string;
                    lat: number;
                    lng: number;
                    heading?: number;
                    speed_knots?: number;
                    zone?: DbJurisdictionZone | null;
                    recorded_at?: string;
                };
                Update: Partial<Database['public']['Tables']['vessel_positions']['Insert']>;
            };
            transactions: {
                Row: {
                    id: string;
                    vessel_id: string;
                    vessel_name: string;
                    vessel_imo: string;
                    transaction_type: DbTransactionType;
                    emissions_tco2: number;
                    tax_amount_usd: number;
                    status: DbTransactionStatus;
                    invoice_pdf_url: string | null;
                    port_call: string | null;
                    created_at: string;
                    paid_at: string | null;
                };
                Insert: {
                    id?: string;
                    vessel_id: string;
                    vessel_name: string;
                    vessel_imo: string;
                    transaction_type: DbTransactionType;
                    emissions_tco2: number;
                    tax_amount_usd: number;
                    status?: DbTransactionStatus;
                    invoice_pdf_url?: string | null;
                    port_call?: string | null;
                    paid_at?: string | null;
                };
                Update: Partial<Database['public']['Tables']['transactions']['Insert']>;
            };
            tax_configurations: {
                Row: {
                    id: string;
                    jurisdiction_zone: DbJurisdictionZone;
                    vessel_category: DbVesselCategory;
                    base_rate_usd_per_tco2: number;
                    multiplier: number;
                    effective_date: string;
                    status: DbTaxConfigStatus;
                    created_by: string;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id?: string;
                    jurisdiction_zone: DbJurisdictionZone;
                    vessel_category: DbVesselCategory;
                    base_rate_usd_per_tco2: number;
                    multiplier?: number;
                    effective_date: string;
                    status?: DbTaxConfigStatus;
                    created_by: string;
                };
                Update: Partial<Database['public']['Tables']['tax_configurations']['Insert']>;
            };
            exemptions: {
                Row: {
                    id: string;
                    vessel_id: string;
                    vessel_name: string;
                    reason: DbExemptionReason;
                    valid_until: string;
                    approved_by: string;
                    notes: string;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    vessel_id: string;
                    vessel_name: string;
                    reason: DbExemptionReason;
                    valid_until: string;
                    approved_by: string;
                    notes?: string;
                };
                Update: Partial<Database['public']['Tables']['exemptions']['Insert']>;
            };
            audit_logs: {
                Row: {
                    id: string;
                    user_id: string;
                    user_full_name: string;
                    action: DbAuditAction;
                    severity: DbAuditSeverity;
                    entity_type: string;
                    entity_id: string;
                    details_json: Record<string, unknown>;
                    ip_address: string | null;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    user_id: string;
                    user_full_name: string;
                    action: DbAuditAction;
                    severity?: DbAuditSeverity;
                    entity_type: string;
                    entity_id: string;
                    details_json?: Record<string, unknown>;
                    ip_address?: string | null;
                };
                Update: Partial<Database['public']['Tables']['audit_logs']['Insert']>;
            };
            carbon_projects: {
                Row: {
                    id: string;
                    name: string;
                    description: string;
                    type: DbProjectType;
                    status: DbProjectStatus;
                    operator_name: string;
                    operator_id: string;
                    location_name: string;
                    location_lat: number;
                    location_lng: number;
                    area_hectares: number;
                    start_date: string;
                    end_date: string | null;
                    verification_standard: DbVerificationStandard;
                    estimated_tco2_per_year: number;
                    credits_issued_total: number;
                    credits_retired_total: number;
                    credits_available: number;
                    price_per_credit_usd: number;
                    total_value_usd: number;
                    last_verified_at: string | null;
                    next_verification_at: string | null;
                    funding_usd: number;
                    sdg_goals: number[];
                    image_url: string | null;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id?: string;
                    name: string;
                    description: string;
                    type: DbProjectType;
                    status?: DbProjectStatus;
                    operator_name: string;
                    operator_id: string;
                    location_name: string;
                    location_lat: number;
                    location_lng: number;
                    area_hectares?: number;
                    start_date: string;
                    end_date?: string | null;
                    verification_standard?: DbVerificationStandard;
                    estimated_tco2_per_year?: number;
                    credits_issued_total?: number;
                    credits_retired_total?: number;
                    credits_available?: number;
                    price_per_credit_usd?: number;
                    total_value_usd?: number;
                    last_verified_at?: string | null;
                    next_verification_at?: string | null;
                    funding_usd?: number;
                    sdg_goals?: number[];
                    image_url?: string | null;
                };
                Update: Partial<Database['public']['Tables']['carbon_projects']['Insert']>;
            };
            disputes: {
                Row: {
                    id: string;
                    ref: string;
                    transaction_id: string;
                    vessel_id: string;
                    submitted_by: string;
                    reason: DbDisputeReason;
                    description: string;
                    evidence_urls: string[];
                    status: DbDisputeStatus;
                    reviewer_id: string | null;
                    review_note: string | null;
                    original_amount_usd: number;
                    revised_amount_usd: number | null;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    id?: string;
                    transaction_id: string;
                    vessel_id: string;
                    submitted_by: string;
                    reason: DbDisputeReason;
                    description: string;
                    evidence_urls?: string[];
                    status?: DbDisputeStatus;
                    reviewer_id?: string | null;
                    review_note?: string | null;
                    original_amount_usd: number;
                    revised_amount_usd?: number | null;
                };
                Update: Partial<Database['public']['Tables']['disputes']['Insert']>;
            };
            inspections: {
                Row: {
                    id: string;
                    ref: string;
                    vessel_id: string;
                    inspector_id: string;
                    mmsi: string;
                    inspection_type: DbInspectionType;
                    status: DbInspectionStatus;
                    checklist: Record<string, unknown>;
                    findings: string;
                    photo_urls: string[];
                    compliance_verified: boolean;
                    offline_created: boolean;
                    synced_at: string | null;
                    created_at: string;
                };
                Insert: {
                    id?: string;
                    vessel_id: string;
                    inspector_id: string;
                    mmsi: string;
                    inspection_type: DbInspectionType;
                    status?: DbInspectionStatus;
                    checklist?: Record<string, unknown>;
                    findings?: string;
                    photo_urls?: string[];
                    compliance_verified?: boolean;
                    offline_created?: boolean;
                    synced_at?: string | null;
                };
                Update: Partial<Database['public']['Tables']['inspections']['Insert']>;
            };
            registration_requests: {
                Row: {
                    id: string;
                    entity_type: DbRegistrationEntityType;
                    org_name: string;
                    org_registry_id: string;
                    jurisdiction: string;
                    requested_role: string;
                    contact_name: string;
                    contact_email: string;
                    contact_phone: string | null;
                    password_hash: string;
                    default_region: string;
                    access_scope: string;
                    notify_proforma: boolean;
                    notify_co2: boolean;
                    notify_revenue: boolean;
                    notify_weekly: boolean;
                    status: DbRegistrationStatus;
                    reviewed_by: string | null;
                    reviewed_at: string | null;
                    review_note: string | null;
                    flagged: boolean;
                    ip_address: string | null;
                    created_at: string;
                    updated_at: string;
                };
                Insert: {
                    entity_type: DbRegistrationEntityType;
                    org_name: string;
                    org_registry_id: string;
                    jurisdiction: string;
                    requested_role: string;
                    contact_name: string;
                    contact_email: string;
                    contact_phone?: string | null;
                    password_hash: string;
                    default_region?: string;
                    access_scope?: string;
                    notify_proforma?: boolean;
                    notify_co2?: boolean;
                    notify_revenue?: boolean;
                    notify_weekly?: boolean;
                };
                Update: Partial<{
                    status: DbRegistrationStatus;
                    reviewed_by: string | null;
                    reviewed_at: string | null;
                    review_note: string | null;
                    flagged: boolean;
                }>;
            };
        };
        Enums: {
            user_role: DbUserRole;
            operational_site: DbOperationalSite;
            vessel_category: DbVesselCategory;
            compliance_status: DbComplianceStatus;
            jurisdiction_zone: DbJurisdictionZone;
            transaction_type: DbTransactionType;
            transaction_status: DbTransactionStatus;
            exemption_reason: DbExemptionReason;
            audit_action: DbAuditAction;
            audit_severity: DbAuditSeverity;
            project_type: DbProjectType;
            project_status: DbProjectStatus;
            verification_standard: DbVerificationStandard;
            tax_config_status: DbTaxConfigStatus;
            dispute_status: DbDisputeStatus;
            dispute_reason: DbDisputeReason;
            inspection_type: DbInspectionType;
            inspection_status: DbInspectionStatus;
            registration_status: DbRegistrationStatus;
            registration_entity_type: DbRegistrationEntityType;
        };
    };
}

// ── Enum string unions (match PostgreSQL enums) ─────────────────────────────

export type DbUserRole = 'PORT_OFFICER' | 'FINANCE_ADMIN' | 'SHIPPING_AGENT' | 'SUPERADMIN';
export type DbOperationalSite = 'BERBERA_PORT' | 'NATIONAL_HQ' | 'ZEILA_PORT';
export type DbVesselCategory = 'CONTAINER' | 'CARGO' | 'TANKER' | 'BULK_CARRIER' | 'FERRY' | 'NAVAL' | 'SCIENTIFIC';
export type DbComplianceStatus = 'COMPLIANT' | 'PAYMENT_DUE' | 'PROCESSING' | 'NON_COMPLIANT' | 'APPROACHING' | 'EXEMPT';
export type DbJurisdictionZone = 'EEZ' | 'PORT_VICINITY' | 'TRANSIT_LANE';
export type DbTransactionType = 'ENTRY_TAX' | 'TRANSIT_FEE' | 'PORT_STAY';
export type DbTransactionStatus = 'PAID' | 'PENDING' | 'OVERDUE' | 'EXEMPT' | 'DISPUTED';
export type DbExemptionReason = 'MILITARY' | 'HUMANITARIAN' | 'SCIENTIFIC' | 'UN_AGENCY' | 'OTHER';
export type DbAuditAction = 'LOGIN' | 'LOGOUT' | 'VESSEL_VIEWED' | 'INVOICE_GENERATED' | 'TAX_RATE_UPDATED' | 'EXEMPTION_GRANTED' | 'REPORT_EXPORTED' | 'USER_CREATED' | 'TRANSACTION_UPDATED' | 'DISPUTE_FILED' | 'DISPUTE_REVIEWED' | 'INSPECTION_COMPLETED';
export type DbAuditSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type DbProjectType = 'BLUE_CARBON' | 'REFORESTATION' | 'SOLAR' | 'WIND' | 'METHANE_CAPTURE' | 'ENERGY_EFFICIENCY';
export type DbProjectStatus = 'ACTIVE' | 'PENDING' | 'COMPLETED' | 'SUSPENDED' | 'UNDER_REVIEW';
export type DbVerificationStandard = 'VERRA_VCS' | 'GOLD_STANDARD' | 'IMO_DCS' | 'PENDING_VERIFICATION';
export type DbTaxConfigStatus = 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
export type DbDisputeStatus = 'OPEN' | 'UNDER_REVIEW' | 'ACCEPTED' | 'REJECTED' | 'ESCALATED';
export type DbDisputeReason = 'EMISSION_CALCULATION' | 'TAX_RATE' | 'ZONE_CLASSIFICATION' | 'VESSEL_DATA' | 'OTHER';
export type DbRegistrationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'MORE_INFO';
export type DbRegistrationEntityType = 'PORT_AUTHORITY' | 'SHIPPING_AGENT' | 'FINANCE_ADMIN' | 'INSTITUTION';
export type DbInspectionType = 'ROUTINE' | 'COMPLIANCE_CHECK' | 'RANDOM' | 'FOLLOW_UP';
export type DbInspectionStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FLAGGED';

// ── Row type helpers ────────────────────────────────────────────────────────

export type ProfileRow = Database['public']['Tables']['profiles']['Row'];
export type VesselRow = Database['public']['Tables']['vessels']['Row'];
export type VesselPositionRow = Database['public']['Tables']['vessel_positions']['Row'];
export type TransactionRow = Database['public']['Tables']['transactions']['Row'];
export type TaxConfigurationRow = Database['public']['Tables']['tax_configurations']['Row'];
export type ExemptionRow = Database['public']['Tables']['exemptions']['Row'];
export type AuditLogRow = Database['public']['Tables']['audit_logs']['Row'];
export type CarbonProjectRow = Database['public']['Tables']['carbon_projects']['Row'];
export type DisputeRow = Database['public']['Tables']['disputes']['Row'];
export type RegistrationRequestRow = Database['public']['Tables']['registration_requests']['Row'];
export type InspectionRow = Database['public']['Tables']['inspections']['Row'];
