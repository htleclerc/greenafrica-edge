// ─────────────────────────────────────────────────────────────────────────────
// Africgreen — Secure Platform Types
// All enums and interfaces for the authenticated dashboard area
// ─────────────────────────────────────────────────────────────────────────────

// ── User & Auth ──────────────────────────────────────────────────────────────

export enum UserRole {
    PORT_OFFICER    = 'PORT_OFFICER',
    FINANCE_ADMIN   = 'FINANCE_ADMIN',
    SUPERADMIN      = 'SUPERADMIN',
    SHIPPING_AGENT  = 'SHIPPING_AGENT',
}

export enum OperationalSite {
    BERBERA_PORT    = 'BERBERA_PORT',
    NATIONAL_HQ     = 'NATIONAL_HQ',
    ZEILA_PORT      = 'ZEILA_PORT',
}

export interface SecureUser {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
    operationalSite: OperationalSite;
    countryCode: string;        // ISO 3166-1 alpha-2
    timezone: string;           // e.g. 'Africa/Djibouti'
    preferredLanguage: 'en' | 'fr' | 'so' | 'ar';
    lastLogin: string;          // ISO datetime
    ipAddress: string;
    isActive: boolean;
}

// ── Vessel (Secure/Enriched) ─────────────────────────────────────────────────

export enum VesselCategory {
    CONTAINER       = 'CONTAINER',
    CARGO           = 'CARGO',
    TANKER          = 'TANKER',
    BULK_CARRIER    = 'BULK_CARRIER',
    FERRY           = 'FERRY',
    NAVAL           = 'NAVAL',
    SCIENTIFIC      = 'SCIENTIFIC',
}

export enum VesselComplianceStatus {
    COMPLIANT       = 'COMPLIANT',      // paid / credit applied
    PAYMENT_DUE     = 'PAYMENT_DUE',    // in EEZ, no pro-forma
    PROCESSING      = 'PROCESSING',     // at port / anchored
    NON_COMPLIANT   = 'NON_COMPLIANT',  // overdue / violation
    APPROACHING     = 'APPROACHING',    // entering ZEE boundary
    EXEMPT          = 'EXEMPT',         // military / humanitarian
}

export interface VesselPosition {
    lat: number;
    lng: number;
    heading: number;            // 0-360 degrees
    speedKnots: number;
    lastSeenUtc: string;        // ISO datetime
}

export interface SecureVessel {
    id: string;
    imoNumber: string;
    mmsi: string;
    name: string;
    callSign: string;
    flagCode: string;           // ISO 3166-1 alpha-2
    category: VesselCategory;
    grossTonnageDwt: number;
    enginePowerKw: number;
    designSpeedKnots: number;
    complianceStatus: VesselComplianceStatus;
    position: VesselPosition;
    estimatedEmissionsTco2: number;
    taxLiabilityUsd: number;
    portCall: string;           // e.g. 'BERBERA'
    proFormaGenerated: boolean;
    lastTransactionId: string | null;
}

// ── Tax Configuration ─────────────────────────────────────────────────────────

export enum JurisdictionZone {
    EEZ             = 'EEZ',
    PORT_VICINITY   = 'PORT_VICINITY',
    TRANSIT_LANE    = 'TRANSIT_LANE',
}

export interface TaxConfiguration {
    id: string;
    jurisdictionZone: JurisdictionZone;
    vesselCategory: VesselCategory;
    baseRateUsdPerTco2: number;
    multiplier: number;
    effectiveDate: string;      // ISO date
    status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
    createdBy: string;          // user id
}

// ── Transactions ──────────────────────────────────────────────────────────────

export enum TransactionType {
    ENTRY_TAX       = 'ENTRY_TAX',
    TRANSIT_FEE     = 'TRANSIT_FEE',
    PORT_STAY       = 'PORT_STAY',
}

export enum TransactionStatus {
    PAID            = 'PAID',
    PENDING         = 'PENDING',
    OVERDUE         = 'OVERDUE',
    EXEMPT          = 'EXEMPT',
    DISPUTED        = 'DISPUTED',
}

export interface Transaction {
    id: string;
    vesselId: string;
    vesselName: string;
    vesselImo: string;
    transactionType: TransactionType;
    emissionsTco2: number;
    taxAmountUsd: number;
    status: TransactionStatus;
    invoicePdfUrl: string | null;
    portCall: string;
    createdAt: string;          // ISO datetime
    paidAt: string | null;
}

// ── Exemptions ────────────────────────────────────────────────────────────────

export enum ExemptionReason {
    MILITARY        = 'MILITARY',
    HUMANITARIAN    = 'HUMANITARIAN',
    SCIENTIFIC      = 'SCIENTIFIC',
    UN_AGENCY       = 'UN_AGENCY',
    OTHER           = 'OTHER',
}

export interface Exemption {
    id: string;
    vesselId: string;
    vesselName: string;
    reason: ExemptionReason;
    validUntil: string;         // ISO date
    approvedBy: string;         // user id
    notes: string;
    createdAt: string;
}

// ── Audit Log ─────────────────────────────────────────────────────────────────

export enum AuditAction {
    LOGIN                   = 'LOGIN',
    LOGOUT                  = 'LOGOUT',
    VESSEL_VIEWED           = 'VESSEL_VIEWED',
    INVOICE_GENERATED       = 'INVOICE_GENERATED',
    TAX_RATE_UPDATED        = 'TAX_RATE_UPDATED',
    EXEMPTION_GRANTED       = 'EXEMPTION_GRANTED',
    REPORT_EXPORTED         = 'REPORT_EXPORTED',
    USER_CREATED            = 'USER_CREATED',
    TRANSACTION_UPDATED     = 'TRANSACTION_UPDATED',
}

export enum AuditSeverity {
    INFO    = 'INFO',
    WARNING = 'WARNING',
    CRITICAL= 'CRITICAL',
}

export interface AuditLogEntry {
    id: string;
    userId: string;
    userFullName: string;
    action: AuditAction;
    severity: AuditSeverity;
    entityType: string;
    entityId: string;
    detailsJson: Record<string, unknown>;
    ipAddress: string;
    createdAt: string;          // ISO datetime
}

// ── Dashboard KPIs ────────────────────────────────────────────────────────────

export interface DashboardKpis {
    monthlyRevenueUsd: number;
    monthlyRevenueDelta: number;        // % change vs previous month
    vesselsProcessed: number;
    estCo2TrackingTons: number;
    creditsRetiredTons: number;
    activeVesselsInEez: number;
    pendingReviewCount: number;
    nonCompliantCount: number;
    systemStatus: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
    lastAisSyncUtc: string;
}

// ── System Status ─────────────────────────────────────────────────────────────

export interface SystemStatusInfo {
    status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
    nodeId: string;             // e.g. 'BER-DC1'
    encryption: string;         // e.g. 'AES-256'
    version: string;            // e.g. 'v1.2.4-secure'
    lastAisSyncUtc: string;
}

// ── Agent Registration & Validation ───────────────────────────────────────────

export enum RegistrationStatus {
    PENDING   = 'PENDING',
    APPROVED  = 'APPROVED',
    REJECTED  = 'REJECTED',
    MORE_INFO = 'MORE_INFO',   // reviewer asked for additional documents
}

export enum RegistrationEntityType {
    PORT_AUTHORITY = 'PORT_AUTHORITY',
    SHIPPING_AGENT = 'SHIPPING_AGENT',
    FINANCE_ADMIN  = 'FINANCE_ADMIN',
    INSTITUTION    = 'INSTITUTION',
}

export interface RegistrationDocument {
    name: string;
    type: 'ID' | 'LICENSE' | 'MANDATE' | 'OTHER';
    url: string;       // placeholder URL
    sizeKb: number;
}

export interface RegistrationRequest {
    id: string;
    submittedAt: string;            // ISO datetime
    entityType: RegistrationEntityType;
    orgName: string;
    orgRegistryId: string;          // official registry / licence number
    contactName: string;
    contactEmail: string;
    contactPhone?: string;
    jurisdiction: string;           // e.g. 'Berbera'
    requestedRole: UserRole;
    status: RegistrationStatus;
    reviewedBy?: string;            // fullName of reviewer
    reviewedAt?: string;
    reviewNote?: string;
    documents: RegistrationDocument[];
    ipAddress: string;
    flagged: boolean;               // manual flag for suspicious requests
}

// ── Carbon Projects (Green Ledger) ────────────────────────────────────────────

export enum ProjectStatus {
    ACTIVE      = 'ACTIVE',
    PENDING     = 'PENDING',
    COMPLETED   = 'COMPLETED',
    SUSPENDED   = 'SUSPENDED',
    REVIEW      = 'UNDER_REVIEW',
}

export enum ProjectType {
    BLUE_CARBON         = 'BLUE_CARBON',        // mangroves, seagrass
    REFORESTATION       = 'REFORESTATION',
    SOLAR               = 'SOLAR',
    WIND                = 'WIND',
    METHANE_CAPTURE     = 'METHANE_CAPTURE',
    ENERGY_EFFICIENCY   = 'ENERGY_EFFICIENCY',
}

export enum VerificationStandard {
    VERRA_VCS   = 'VERRA_VCS',
    GOLD_STANDARD = 'GOLD_STANDARD',
    IMO_DCS     = 'IMO_DCS',
    PENDING     = 'PENDING_VERIFICATION',
}

export interface CarbonProject {
    id: string;
    name: string;
    description: string;
    type: ProjectType;
    status: ProjectStatus;
    operatorName: string;
    operatorId: string;         // linked SecureUser or org id
    locationName: string;
    locationCoords: { lat: number; lng: number };
    areaHectares: number;
    startDate: string;          // ISO date
    endDate: string | null;     // null = ongoing
    verificationStandard: VerificationStandard;
    estimatedTco2PerYear: number;
    creditsIssuedTotal: number;
    creditsRetiredTotal: number;
    creditsAvailable: number;
    pricePerCreditUsd: number;
    totalValueUsd: number;
    lastVerifiedAt: string | null;
    nextVerificationAt: string | null;
    fundingUsd: number;
    sdgGoals: number[];         // UN SDG numbers e.g. [13, 14, 15]
    imageUrl?: string;
}

// ── Demo session ──────────────────────────────────────────────────────────────

export interface DemoProfile {
    role: UserRole;
    label: string;
    description: string;
    email: string;
    color: string;
}
