/**
 * Carbon Revenue Simulation Engine
 * Based on IMO cubic-law CO2 estimation methodology (simu1.md)
 *
 * Phase 1 (MVP): Uses daily CO2 fallback table per ship type
 * Phase 3 (Target): Full cubic-law algorithm with AIS segment data
 */

// --- IMO Emission Factors (CF) ---
export enum FuelType {
    HFO = 'HFO',   // Heavy Fuel Oil
    MDO = 'MDO',   // Marine Diesel Oil
    LNG = 'LNG',   // Liquefied Natural Gas
}

export const EMISSION_FACTORS: Record<FuelType, number> = {
    [FuelType.HFO]: 3.114, // tCO2 per tonne of fuel
    [FuelType.MDO]: 3.206,
    [FuelType.LNG]: 2.750,
};

// Specific Fuel Oil Consumption (g/kWh) – average for large slow-speed engines
export const SFOC_DEFAULT = 185;

// --- Ship Type Definitions ---
export enum ShipType {
    CARGO = 'CARGO',
    TANKER = 'TANKER',
}

export interface ShipProfile {
    type: ShipType;
    labelKey: string;
    defaultEnginePowerKw: number;
    defaultDesignSpeedKnots: number;
    dailyCo2Fallback: number; // tCO2/day – Phase 1 fallback
}

export const SHIP_PROFILES: Record<ShipType, ShipProfile> = {
    [ShipType.CARGO]: {
        type: ShipType.CARGO,
        labelKey: 'ship_cargo',
        defaultEnginePowerKw: 35000,
        defaultDesignSpeedKnots: 22,
        dailyCo2Fallback: 150, // tCO2/day for medium container ship
    },
    [ShipType.TANKER]: {
        type: ShipType.TANKER,
        labelKey: 'ship_tanker',
        defaultEnginePowerKw: 15000,
        defaultDesignSpeedKnots: 14,
        dailyCo2Fallback: 45, // tCO2/day for small bulk carrier
    },
};

// --- Simulation Input/Output Types ---
export interface SimulationInput {
    shipsPerMonth: number;
    avgEmissionsPerShip: number; // tCO2 per ship
    taxRatePerTon: number;       // USD per tCO2
    shipType: ShipType;
}

export interface CompanySimulationInput {
    fleetSize: number;           // Number of ships entering ZEE per month
    daysInZeePerShip: number;    // Average days spent in ZEE per ship
    taxRatePerTon: number;       // USD per tCO2
    shipType: ShipType;
}

export interface SimulationResult {
    monthlyRevenue: number;      // USD
    annualProjection: number;    // USD
    monthlyEmissions: number;    // tCO2
    pricePerVessel: number;      // USD
    treesEquivalent: number;     // number of trees
    householdsEquivalent: number; // households powered/year equivalent
}

export interface CompanySimulationResult {
    totalTaxLiability: number;   // USD (Company Cost)
    annualTaxProjection: number; // USD
    totalFleetEmissions: number; // tCO2
    taxPerVessel: number;        // USD
    offsetRequiredTons: number;  // tCO2 (e.g. 40% compliance)
    offsetCostEstimate: number;  // USD (assuming same tax rate for offset)
}

// --- Environmental Impact Constants ---
// 1 tree absorbs ~21.77 kg of CO2 per year (EPA estimate)
const CO2_PER_TREE_KG = 21.77;
// Average household emits ~7.5 tCO2/year (US EPA, adjusted for context)
const CO2_PER_HOUSEHOLD_TONS = 7.5;

// --- Core Calculation Functions ---

/**
 * Phase 1 (MVP): Simple simulation based on flat-rate daily emissions.
 * Used for the landing page interactive simulator.
 */
export function calculateSimulation(input: SimulationInput): SimulationResult {
    const { shipsPerMonth, avgEmissionsPerShip, taxRatePerTon } = input;

    const monthlyEmissions = shipsPerMonth * avgEmissionsPerShip;
    const monthlyRevenue = monthlyEmissions * taxRatePerTon;
    const annualProjection = monthlyRevenue * 12;
    const pricePerVessel = avgEmissionsPerShip * taxRatePerTon;

    // Environmental impact
    const treesEquivalent = Math.round((monthlyEmissions * 1000) / CO2_PER_TREE_KG);
    const householdsEquivalent = Math.round(monthlyEmissions / CO2_PER_HOUSEHOLD_TONS);

    return {
        monthlyRevenue,
        annualProjection,
        monthlyEmissions,
        pricePerVessel,
        treesEquivalent,
        householdsEquivalent,
    };
}

/**
 * Phase 1 (MVP) Company Mode: Calculate tax liability for a specific fleet.
 */
export function calculateCompanySimulation(input: CompanySimulationInput): CompanySimulationResult {
    const { fleetSize, daysInZeePerShip, taxRatePerTon, shipType } = input;
    const profile = SHIP_PROFILES[shipType];

    // Daily fallback * days in ZEE = emissions per ship per voyage in ZEE
    const emissionsPerShip = profile.dailyCo2Fallback * daysInZeePerShip;

    const totalFleetEmissions = fleetSize * emissionsPerShip;
    const taxPerVessel = emissionsPerShip * taxRatePerTon;
    const totalTaxLiability = totalFleetEmissions * taxRatePerTon;
    const annualTaxProjection = totalTaxLiability * 12;

    // Assuming a 40% minimum offset compliance for demonstration
    const offsetRequiredTons = totalFleetEmissions * 0.40;
    const offsetCostEstimate = offsetRequiredTons * taxRatePerTon;

    return {
        totalTaxLiability,
        annualTaxProjection,
        totalFleetEmissions,
        taxPerVessel,
        offsetRequiredTons,
        offsetCostEstimate,
    };
}

/**
 * Phase 3 (Target): Cubic-law CO2 estimation per AIS segment.
 * E_CO2 = P_used * SFOC * Δt * CF
 * P_used = P_max * (V_actual / V_design)^3
 */
export function calculateSegmentEmission(
    enginePowerKw: number,
    designSpeedKnots: number,
    actualSpeedKnots: number,
    deltaTimeHours: number,
    fuelType: FuelType = FuelType.HFO,
    sfoc: number = SFOC_DEFAULT,
): number {
    let powerUsed: number;

    if (actualSpeedKnots < 1.0) {
        // At anchor – auxiliary generators only (~5% of max power)
        powerUsed = enginePowerKw * 0.05;
    } else {
        const speedRatio = Math.min(actualSpeedKnots / designSpeedKnots, 1.0);
        powerUsed = enginePowerKw * Math.pow(speedRatio, 3);
    }

    // Fuel consumed in tonnes: (kW * g/kWh * hours) / 1,000,000
    const fuelConsumedTonnes = (powerUsed * sfoc * deltaTimeHours) / 1_000_000;

    // CO2 = fuel * emission factor
    return fuelConsumedTonnes * EMISSION_FACTORS[fuelType];
}

// --- Formatting Helpers ---
export function formatCurrency(value: number): string {
    if (value >= 1_000_000) {
        return `$${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
        return `$${(value / 1_000).toFixed(0)}K`;
    }
    return `$${value.toFixed(0)}`;
}

export function formatNumber(value: number): string {
    return new Intl.NumberFormat('en-US').format(value);
}
