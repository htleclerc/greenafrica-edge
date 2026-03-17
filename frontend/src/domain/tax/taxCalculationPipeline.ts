import { calculateSegmentEmission, FuelType } from '@/domain/simulation/simulationEngine';
import type { VesselPosition, SecureVessel, TaxConfiguration } from '@/types/secure';
import { JurisdictionZone } from '@/types/secure';

// ── Types ───────────────────────────────────────────────────────────────────

export interface AisSegment {
    startPosition: VesselPosition;
    endPosition: VesselPosition;
    deltaTimeHours: number;
    avgSpeedKnots: number;
    zone: JurisdictionZone;
}

export interface ZoneEmission {
    zone: JurisdictionZone;
    emissionsTco2: number;
    timeHours: number;
    segmentCount: number;
}

export interface TaxLineItem {
    zone: JurisdictionZone;
    emissionsTco2: number;
    baseRate: number;
    multiplier: number;
    taxAmountUsd: number;
}

export interface TaxBreakdown {
    totalEmissionsTco2: number;
    totalTaxUsd: number;
    lineItems: TaxLineItem[];
    zoneEmissions: ZoneEmission[];
}

// ── Core Functions ──────────────────────────────────────────────────────────

/**
 * Convert consecutive AIS positions into navigational segments.
 * Each segment includes time delta and average speed.
 */
export function positionsToSegments(
    positions: VesselPosition[],
    defaultZone: JurisdictionZone = JurisdictionZone.EEZ,
): AisSegment[] {
    if (positions.length < 2) return [];

    const segments: AisSegment[] = [];
    for (let i = 0; i < positions.length - 1; i++) {
        const start = positions[i];
        const end = positions[i + 1];

        const startTime = new Date(start.lastSeenUtc).getTime();
        const endTime = new Date(end.lastSeenUtc).getTime();
        const deltaTimeHours = (endTime - startTime) / (1000 * 60 * 60);

        // Skip segments with invalid time deltas
        if (deltaTimeHours <= 0 || deltaTimeHours > 48) continue;

        const avgSpeedKnots = (start.speedKnots + end.speedKnots) / 2;

        segments.push({
            startPosition: start,
            endPosition: end,
            deltaTimeHours,
            avgSpeedKnots,
            zone: defaultZone,  // In production, would be determined by geofence
        });
    }

    return segments;
}

/**
 * Compute CO2 emissions per zone from AIS segments and vessel specs.
 * Uses the cubic-law formula from simulationEngine.
 */
export function computeVesselEmissions(
    segments: AisSegment[],
    vessel: Pick<SecureVessel, 'enginePowerKw' | 'designSpeedKnots'>,
    fuelType: FuelType = FuelType.HFO,
): ZoneEmission[] {
    const zoneMap = new Map<JurisdictionZone, { emissions: number; time: number; count: number }>();

    for (const seg of segments) {
        const co2 = calculateSegmentEmission(
            vessel.enginePowerKw,
            vessel.designSpeedKnots,
            seg.avgSpeedKnots,
            seg.deltaTimeHours,
            fuelType,
        );

        const existing = zoneMap.get(seg.zone) ?? { emissions: 0, time: 0, count: 0 };
        existing.emissions += co2;
        existing.time += seg.deltaTimeHours;
        existing.count += 1;
        zoneMap.set(seg.zone, existing);
    }

    const results: ZoneEmission[] = [];
    for (const [zone, data] of zoneMap) {
        results.push({
            zone,
            emissionsTco2: Math.round(data.emissions * 100) / 100,
            timeHours: Math.round(data.time * 100) / 100,
            segmentCount: data.count,
        });
    }

    return results;
}

/**
 * Apply tax rates to zone emissions to produce a liability breakdown.
 */
export function computeTaxLiability(
    zoneEmissions: ZoneEmission[],
    taxConfigs: TaxConfiguration[],
    vesselCategory: string,
): TaxBreakdown {
    const lineItems: TaxLineItem[] = [];
    let totalEmissionsTco2 = 0;
    let totalTaxUsd = 0;

    for (const ze of zoneEmissions) {
        totalEmissionsTco2 += ze.emissionsTco2;

        // Find matching tax config for this zone + vessel category
        const config = taxConfigs.find(
            (tc) =>
                tc.jurisdictionZone === ze.zone &&
                tc.vesselCategory === vesselCategory &&
                tc.status === 'ACTIVE',
        );

        if (config) {
            const taxAmount = ze.emissionsTco2 * config.baseRateUsdPerTco2 * config.multiplier;
            totalTaxUsd += taxAmount;

            lineItems.push({
                zone: ze.zone,
                emissionsTco2: ze.emissionsTco2,
                baseRate: config.baseRateUsdPerTco2,
                multiplier: config.multiplier,
                taxAmountUsd: Math.round(taxAmount * 100) / 100,
            });
        } else {
            // No config found — zero tax but still track emissions
            lineItems.push({
                zone: ze.zone,
                emissionsTco2: ze.emissionsTco2,
                baseRate: 0,
                multiplier: 0,
                taxAmountUsd: 0,
            });
        }
    }

    return {
        totalEmissionsTco2: Math.round(totalEmissionsTco2 * 100) / 100,
        totalTaxUsd: Math.round(totalTaxUsd * 100) / 100,
        lineItems,
        zoneEmissions,
    };
}

/**
 * Full pipeline: positions → segments → emissions → tax
 */
export function computeFullTaxPipeline(
    positions: VesselPosition[],
    vessel: Pick<SecureVessel, 'enginePowerKw' | 'designSpeedKnots' | 'category'>,
    taxConfigs: TaxConfiguration[],
    fuelType: FuelType = FuelType.HFO,
): TaxBreakdown {
    const segments = positionsToSegments(positions);
    const zoneEmissions = computeVesselEmissions(segments, vessel, fuelType);
    return computeTaxLiability(zoneEmissions, taxConfigs, vessel.category);
}
