// ─────────────────────────────────────────────────────────────────────────────
// Africgreen — Database Row → TypeScript Interface Mappers
// Converts snake_case DB rows to camelCase domain types
// ─────────────────────────────────────────────────────────────────────────────

import type {
    VesselRow,
    VesselPositionRow,
    TransactionRow,
    TaxConfigurationRow,
    ExemptionRow,
    AuditLogRow,
    CarbonProjectRow,
} from '@/types/database';

import type {
    SecureVessel,
    VesselPosition,
    Transaction,
    TaxConfiguration,
    Exemption,
    AuditLogEntry,
    CarbonProject,
} from '@/types/secure';

import {
    VesselCategory,
    VesselComplianceStatus,
    TransactionType,
    TransactionStatus,
    JurisdictionZone,
    ExemptionReason,
    AuditAction,
    AuditSeverity,
    ProjectType,
    ProjectStatus,
    VerificationStandard,
} from '@/types/secure';

// ── Vessel ──────────────────────────────────────────────────────────────────

/**
 * Convert a vessels row + its latest position row into a SecureVessel.
 * If no position row is provided, a default position is used.
 */
export function rowToSecureVessel(
    row: VesselRow,
    positionRow?: VesselPositionRow | null,
): SecureVessel {
    const position: VesselPosition = positionRow
        ? {
              lat: Number(positionRow.lat),
              lng: Number(positionRow.lng),
              heading: Number(positionRow.heading),
              speedKnots: Number(positionRow.speed_knots),
              lastSeenUtc: positionRow.recorded_at,
          }
        : { lat: 0, lng: 0, heading: 0, speedKnots: 0, lastSeenUtc: '' };

    return {
        id: row.id,
        imoNumber: row.imo_number,
        mmsi: row.mmsi,
        name: row.name,
        callSign: row.call_sign,
        flagCode: row.flag_code,
        category: row.category as VesselCategory,
        grossTonnageDwt: Number(row.gross_tonnage_dwt),
        enginePowerKw: Number(row.engine_power_kw),
        designSpeedKnots: Number(row.design_speed_knots),
        complianceStatus: row.compliance_status as VesselComplianceStatus,
        position,
        estimatedEmissionsTco2: Number(row.estimated_emissions_tco2),
        taxLiabilityUsd: Number(row.tax_liability_usd),
        portCall: row.port_call ?? '',
        proFormaGenerated: row.pro_forma_generated,
        lastTransactionId: row.last_transaction_id,
    };
}

// ── Transaction ─────────────────────────────────────────────────────────────

export function rowToTransaction(row: TransactionRow): Transaction {
    return {
        id: row.id,
        ref: (row as Record<string, unknown>).ref as string ?? row.id,
        vesselId: row.vessel_id,
        vesselName: row.vessel_name,
        vesselImo: row.vessel_imo,
        transactionType: row.transaction_type as TransactionType,
        emissionsTco2: Number(row.emissions_tco2),
        taxAmountUsd: Number(row.tax_amount_usd),
        status: row.status as TransactionStatus,
        invoicePdfUrl: row.invoice_pdf_url,
        portCall: row.port_call ?? '',
        createdAt: row.created_at,
        paidAt: row.paid_at,
    };
}

// ── Tax Configuration ───────────────────────────────────────────────────────

export function rowToTaxConfiguration(row: TaxConfigurationRow): TaxConfiguration {
    return {
        id: row.id,
        ref: (row as Record<string, unknown>).ref as string ?? row.id,
        jurisdictionZone: row.jurisdiction_zone as JurisdictionZone,
        vesselCategory: row.vessel_category as VesselCategory,
        baseRateUsdPerTco2: Number(row.base_rate_usd_per_tco2),
        multiplier: Number(row.multiplier),
        effectiveDate: row.effective_date,
        status: row.status as 'ACTIVE' | 'DRAFT' | 'ARCHIVED',
        createdBy: row.created_by,
    };
}

// ── Exemption ───────────────────────────────────────────────────────────────

export function rowToExemption(row: ExemptionRow): Exemption {
    return {
        id: row.id,
        ref: (row as Record<string, unknown>).ref as string ?? row.id,
        vesselId: row.vessel_id,
        vesselName: row.vessel_name,
        reason: row.reason as ExemptionReason,
        validUntil: row.valid_until,
        approvedBy: row.approved_by,
        notes: row.notes,
        createdAt: row.created_at,
    };
}

// ── Audit Log ───────────────────────────────────────────────────────────────

export function rowToAuditLogEntry(row: AuditLogRow): AuditLogEntry {
    return {
        id: row.id,
        ref: (row as Record<string, unknown>).ref as string ?? row.id,
        userId: row.user_id,
        userFullName: row.user_full_name,
        action: row.action as AuditAction,
        severity: row.severity as AuditSeverity,
        entityType: row.entity_type,
        entityId: row.entity_id,
        detailsJson: row.details_json,
        ipAddress: row.ip_address ?? '',
        createdAt: row.created_at,
    };
}

// ── Carbon Project ──────────────────────────────────────────────────────────

export function rowToCarbonProject(row: CarbonProjectRow): CarbonProject {
    return {
        id: row.id,
        ref: (row as Record<string, unknown>).ref as string ?? row.id,
        name: row.name,
        description: row.description,
        type: row.type as ProjectType,
        status: row.status as ProjectStatus,
        operatorName: row.operator_name,
        operatorId: row.operator_id,
        locationName: row.location_name,
        locationCoords: { lat: Number(row.location_lat), lng: Number(row.location_lng) },
        areaHectares: Number(row.area_hectares),
        startDate: row.start_date,
        endDate: row.end_date,
        verificationStandard: row.verification_standard as VerificationStandard,
        estimatedTco2PerYear: Number(row.estimated_tco2_per_year),
        creditsIssuedTotal: Number(row.credits_issued_total),
        creditsRetiredTotal: Number(row.credits_retired_total),
        creditsAvailable: Number(row.credits_available),
        pricePerCreditUsd: Number(row.price_per_credit_usd),
        totalValueUsd: Number(row.total_value_usd),
        lastVerifiedAt: row.last_verified_at,
        nextVerificationAt: row.next_verification_at,
        fundingUsd: Number(row.funding_usd),
        sdgGoals: row.sdg_goals,
        imageUrl: row.image_url ?? undefined,
    };
}

// ── Vessel Position (standalone) ────────────────────────────────────────────

export function rowToVesselPosition(row: VesselPositionRow): VesselPosition {
    return {
        lat: Number(row.lat),
        lng: Number(row.lng),
        heading: Number(row.heading),
        speedKnots: Number(row.speed_knots),
        lastSeenUtc: row.recorded_at,
    };
}
