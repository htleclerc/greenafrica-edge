import type { CalculationStep } from '@/services/invoiceLayout';

/**
 * Traduit le `breakdown_json` d'une transaction en étapes imprimables sur la
 * page « CALCULATION DETAILS ».
 *
 * C'est la chaîne RÉELLEMENT appliquée par le moteur qui est publiée, pas une
 * chaîne théorique : distance × facteur d'émission pour le maritime, cycles LTO
 * pour l'aérien. Les pro-formas de la campagne d'août 2026 ont été produits hors
 * application avec une méthode voyage (soutes × 3,114 × 50 %) que nos données
 * ne portent pas — les rejouer ici serait publier un calcul que la base ne
 * justifie pas.
 *
 * Sans `breakdown_json` — cas des transactions insérées directement en base —
 * on se limite à ce qui est opposable : base taxable, taux, total.
 */

export interface CalculationInputs {
    breakdown: unknown;
    emissionsTco2: number;
    ratePerTco2: number;
    totalUsd: number;
    decreeReference: string;
}

const num = (v: unknown): number | null => {
    const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
    return Number.isFinite(n) ? n : null;
};

const fmt = (n: number, digits = 2) =>
    n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function baseSteps(i: CalculationInputs): CalculationStep[] {
    return [
        {
            step: 'Taxable CO2 (Green-Gate base)',
            source: 'Emissions attributed to the port State',
            value: `${fmt(i.emissionsTco2)} tCO2`,
        },
        {
            step: 'Carbon rate',
            source: i.decreeReference,
            value: `× USD ${fmt(i.ratePerTco2)}/t`,
        },
        {
            step: 'TOTAL CONTRIBUTION DUE',
            source: `${fmt(i.emissionsTco2)} tCO2 × USD ${fmt(i.ratePerTco2)}`,
            value: `USD ${fmt(i.totalUsd)}`,
            total: true,
        },
    ];
}

export function buildCalculationSteps(i: CalculationInputs): CalculationStep[] {
    const b = (i.breakdown ?? null) as Record<string, unknown> | null;
    if (!b || typeof b !== 'object') return baseSteps(i);

    // ── Maritime : distance parcourue dans l'EEZ × facteur d'émission ────────
    const distance = num(b.distance_nm);
    const factor = num(b.emissions_factor_g_co2_per_nm);
    if (distance !== null && factor !== null) {
        const source = typeof b.emissions_factor_source === 'string' && b.emissions_factor_source
            ? b.emissions_factor_source
            : 'Emission factor registry';
        return [
            {
                step: 'Distance travelled in the EEZ',
                source: 'Tracked route, port State waters',
                value: `${fmt(distance, 1)} nm`,
            },
            {
                step: 'Emission factor for the class',
                source,
                value: `${fmt(factor, 1)} g CO2/nm`,
            },
            {
                step: 'Taxable CO2 (Green-Gate base)',
                source: `${fmt(distance, 1)} nm × ${fmt(factor, 1)} g/nm ÷ 10^6`,
                value: `${fmt(i.emissionsTco2)} tCO2`,
            },
            {
                step: 'Carbon rate',
                source: i.decreeReference,
                value: `× USD ${fmt(i.ratePerTco2)}/t`,
            },
            {
                step: 'TOTAL CONTRIBUTION DUE',
                source: `${fmt(i.emissionsTco2)} tCO2 × USD ${fmt(i.ratePerTco2)}`,
                value: `USD ${fmt(i.totalUsd)}`,
                total: true,
            },
        ];
    }

    // ── Aérien : cycles LTO × CO2 par cycle (ICAO) ───────────────────────────
    const cycles = num(b.lto_cycles);
    const perCycle = num(b.co2_kg_per_lto_cycle);
    if (cycles !== null && perCycle !== null) {
        const steps: CalculationStep[] = [
            {
                step: 'LTO cycles over the period',
                source: 'Landing/take-off cycles recorded',
                value: fmt(cycles, 0),
            },
            {
                step: 'CO2 per LTO cycle',
                source: typeof b.emission_source === 'string' && b.emission_source
                    ? b.emission_source
                    : 'ICAO engine emissions databank',
                value: `${fmt(perCycle, 1)} kg CO2`,
            },
            {
                step: 'Taxable CO2 (Green-Gate base)',
                source: `${fmt(cycles, 0)} × ${fmt(perCycle, 1)} kg ÷ 1 000`,
                value: `${fmt(i.emissionsTco2)} tCO2`,
            },
            {
                step: 'Carbon rate',
                source: i.decreeReference,
                value: `× USD ${fmt(i.ratePerTco2)}/t`,
            },
            {
                step: 'TOTAL CONTRIBUTION DUE',
                source: `${fmt(i.emissionsTco2)} tCO2 × USD ${fmt(i.ratePerTco2)}`,
                value: `USD ${fmt(i.totalUsd)}`,
                total: true,
            },
        ];
        // Une estimation par masse au décollage n'est pas une mesure : le
        // document doit le dire, comme l'écran le signale déjà par un drapeau.
        if (b.approximate === true || b.emission_source === 'MTOW_FALLBACK') {
            steps.splice(2, 0, {
                step: 'Estimation notice',
                source: 'Engine data unavailable — MTOW-based approximation',
                value: 'approximate',
            });
        }
        return steps;
    }

    return baseSteps(i);
}
