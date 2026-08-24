import { describe, it, expect } from 'vitest';
import { buildCalculationSteps } from './invoiceCalculationSteps';

const BASE = {
    emissionsTco2: 126,
    ratePerTco2: 40,
    totalUsd: 5040,
    decreeReference: 'MOE&CC/MWI/36/2026',
};

const labels = (steps: ReturnType<typeof buildCalculationSteps>) => steps.map((s) => s.step);

describe('buildCalculationSteps', () => {
    it('sans breakdown, se limite a ce qui est opposable', () => {
        // Les transactions inserees directement en base (seed, import) n'ont
        // pas de breakdown_json. Reconstituer une chaine voyage a rebours
        // publierait un calcul que la base ne justifie pas.
        const steps = buildCalculationSteps({ ...BASE, breakdown: null });
        expect(labels(steps)).toEqual([
            'Taxable CO2 (Green-Gate base)',
            'Carbon rate',
            'TOTAL CONTRIBUTION DUE',
        ]);
        expect(steps.at(-1)).toMatchObject({ value: 'USD 5,040.00', total: true });
    });

    it('deroule la chaine maritime distance x facteur', () => {
        const steps = buildCalculationSteps({
            ...BASE,
            breakdown: {
                distance_nm: 320.5,
                emissions_factor_g_co2_per_nm: 393134.2,
                emissions_factor_source: 'IMO MEPC.346(78) Table 1',
                rate_usd_per_tco2: 40,
            },
        });
        expect(labels(steps)).toEqual([
            'Distance travelled in the EEZ',
            'Emission factor for the class',
            'Taxable CO2 (Green-Gate base)',
            'Carbon rate',
            'TOTAL CONTRIBUTION DUE',
        ]);
        expect(steps[0].value).toBe('320.5 nm');
        expect(steps[1].source).toBe('IMO MEPC.346(78) Table 1');
    });

    it('deroule la chaine aerienne par cycles LTO', () => {
        const steps = buildCalculationSteps({
            ...BASE,
            breakdown: { lto_cycles: 12, co2_kg_per_lto_cycle: 10500, emission_source: 'ICAO EEDB' },
        });
        expect(labels(steps)).toContain('LTO cycles over the period');
        expect(labels(steps)).toContain('CO2 per LTO cycle');
        expect(steps[0].value).toBe('12');
    });

    it('signale une estimation par masse au decollage', () => {
        // L'ecran le marque deja d'un drapeau ; le document doit le dire aussi.
        const steps = buildCalculationSteps({
            ...BASE,
            breakdown: {
                lto_cycles: 12, co2_kg_per_lto_cycle: 10500,
                emission_source: 'MTOW_FALLBACK', approximate: true,
            },
        });
        expect(labels(steps)).toContain('Estimation notice');
    });

    it('ignore un breakdown incomplet plutot que d imprimer NaN', () => {
        const steps = buildCalculationSteps({
            ...BASE,
            breakdown: { distance_nm: 320.5 }, // facteur manquant
        });
        expect(labels(steps)).toEqual([
            'Taxable CO2 (Green-Gate base)',
            'Carbon rate',
            'TOTAL CONTRIBUTION DUE',
        ]);
    });

    it('tolere des valeurs numeriques serialisees en chaine', () => {
        // PostgREST rend les NUMERIC en chaine selon le type de colonne.
        const steps = buildCalculationSteps({
            ...BASE,
            breakdown: { distance_nm: '320.5', emissions_factor_g_co2_per_nm: '393134.2' },
        });
        expect(steps[0].value).toBe('320.5 nm');
    });
});
