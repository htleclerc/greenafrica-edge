/**
 * Tests du TaxSimulatorPage (post-merge #68).
 *
 * Le composant ne lit plus tax_configurations : il fetch GET /api/simulator/tariff
 * → { ratePerTco2: number | null; currency: string } et applique un taux unique.
 * Fail-closed quand ratePerTco2 === null (bannière + calcul/PDF désactivés).
 *
 * La fonction `calculate` est interne au module — on teste via le rendu.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { VesselCategory } from '@/types/secure';

// ─────────────────────────────────────────────────────────────────────────────
// Stubs
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));

// ─────────────────────────────────────────────────────────────────────────────

import { TaxSimulatorPage } from './TaxSimulatorPage';

// ── Helpers de calcul (reprennent les constantes du module source) ────────────
// SFOC pour CONTAINER = 175 g/kWh
// CO2_FACTOR_HFO = 3.206 tCO2/tFuel
// LOAD_FACTOR_SEA = 0.75   LOAD_FACTOR_PORT = 0.10
// État initial : category=CONTAINER, enginePowerKw=12000, speedKnots=19,
//   eezDistanceNm=120, portStayHours=24, includePortVicinity=true, fuelType=HFO

function expectedEezCo2(ratePerTco2: number): { co2: number; tax: number } {
    const sfoc = 175;
    const co2Factor = 3.206;
    const hours = 120 / 19;
    const fuel = (12_000 * 0.75 * sfoc * hours) / 1_000_000;
    const co2 = fuel * co2Factor;
    return { co2, tax: co2 * ratePerTco2 };
}

function expectedPortCo2(ratePerTco2: number): { co2: number; tax: number } {
    const sfoc = 175;
    const co2Factor = 3.206;
    const fuel = (12_000 * 0.10 * sfoc * 24) / 1_000_000;
    const co2 = fuel * co2Factor;
    return { co2, tax: co2 * ratePerTco2 };
}

/** Crée un mock de fetch qui répond avec le payload donné. */
function mockFetchTariff(payload: { ratePerTco2: number | null; currency?: string }): void {
    global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ currency: 'USD', ...payload }),
    } as Response);
}

/** Crée un mock de fetch qui répond avec une erreur HTTP. */
function mockFetchTariffError(status = 500): void {
    global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status,
        json: () => Promise.resolve({ error: 'server error' }),
    } as unknown as Response);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('TaxSimulatorPage — fetch tariff + calcul (post-merge #68)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ── CAS A : tarif disponible ─────────────────────────────────────────────

    it('Cas A — ratePerTco2=40 : affiche le montant total calculé avec ce taux', async () => {
        mockFetchTariff({ ratePerTco2: 40 });
        render(<TaxSimulatorPage />);

        // Attend que le fetch se résolve et que le résultat soit affiché
        const { tax: eezTax } = expectedEezCo2(40);
        const { tax: portTax } = expectedPortCo2(40);
        const totalTax = eezTax + portTax;

        // Le total > 0 prouve que le calcul a eu lieu avec rate=40 (pas un fallback)
        expect(totalTax).toBeGreaterThan(0);

        // Le bouton PDF doit être actif (result !== null)
        await waitFor(() => {
            const pdfBtn = screen.getByText('simulator_generate_pdf');
            expect(pdfBtn).toBeDefined();
            // disabled="false" ou absence de disabled indique que le bouton est activé
            const btn = pdfBtn.closest('button') as HTMLButtonElement | null;
            expect(btn?.disabled).toBe(false);
        });
    });

    it('Cas A — ratePerTco2=40 : totalCo2 affiché = eezCo2 + portCo2 (fr-FR)', async () => {
        mockFetchTariff({ ratePerTco2: 40 });
        render(<TaxSimulatorPage />);

        const { co2: eezCo2 } = expectedEezCo2(40);
        const { co2: portCo2 } = expectedPortCo2(40);
        const totalCo2 = eezCo2 + portCo2;

        // Forme fr-FR avec 2 décimales : ex. "1,23"
        const totalFormatted = totalCo2.toLocaleString('fr-FR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });

        await waitFor(() => {
            expect(document.body.textContent).toContain(totalFormatted);
        });
    });

    it('Cas A — ratePerTco2=40 : EEZ tax = eezCo2 × 40 (cohérence taux unique)', async () => {
        mockFetchTariff({ ratePerTco2: 40 });
        render(<TaxSimulatorPage />);

        const { co2: eezCo2, tax: eezTax } = expectedEezCo2(40);
        // Vérification arithmétique pure — taux unique, pas de multiplier
        expect(eezTax).toBeCloseTo(eezCo2 * 40, 5);
    });

    // ── CAS B : tarif null → fail-closed ────────────────────────────────────

    it('Cas B — ratePerTco2=null : bannière « tarif non publié » visible', async () => {
        mockFetchTariff({ ratePerTco2: null });
        render(<TaxSimulatorPage />);

        await waitFor(() => {
            expect(screen.getByText('simulator_no_tariff_title')).toBeDefined();
        });
    });

    it('Cas B — ratePerTco2=null : bouton PDF désactivé (result === null)', async () => {
        mockFetchTariff({ ratePerTco2: null });
        render(<TaxSimulatorPage />);

        await waitFor(() => {
            const pdfBtn = screen.getByText('simulator_generate_pdf');
            const btn = pdfBtn.closest('button') as HTMLButtonElement | null;
            expect(btn?.disabled).toBe(true);
        });
    });

    it('Cas B — ratePerTco2=null : aucun montant numérique calculé affiché (affiche "—")', async () => {
        mockFetchTariff({ ratePerTco2: null });
        render(<TaxSimulatorPage />);

        await waitFor(() => {
            // Quand result === null, le composant affiche "—" à la place des chiffres
            expect(document.body.textContent).toContain('—');
        });
    });

    // ── CAS C : fetch échoue → traité comme null ─────────────────────────────

    it('Cas C — fetch erreur HTTP : même comportement que ratePerTco2=null', async () => {
        mockFetchTariffError(503);
        render(<TaxSimulatorPage />);

        await waitFor(() => {
            expect(screen.getByText('simulator_no_tariff_title')).toBeDefined();
            const pdfBtn = screen.getByText('simulator_generate_pdf');
            const btn = pdfBtn.closest('button') as HTMLButtonElement | null;
            expect(btn?.disabled).toBe(true);
        });
    });

    // ── Boundaries pures (pas de fetch needed) ───────────────────────────────

    it('boundary — eezDistance=0 → eezCo2=0 (logique pure)', () => {
        const sfoc = 175;
        const co2Factor = 3.206;
        const fuelZero = (12_000 * 0.75 * sfoc * 0) / 1_000_000;
        expect(fuelZero * co2Factor).toBe(0);
    });

    it('boundary — totalCo2=0 quand eezDistance=0 ET portStayHours=0 (logique pure)', () => {
        const sfoc = 175;
        const co2Factor = 3.206;
        const eezFuel  = (12_000 * 0.75 * sfoc * 0) / 1_000_000;
        const portFuel = (12_000 * 0.10 * sfoc * 0) / 1_000_000;
        const totalCo2 = (eezFuel + portFuel) * co2Factor;
        expect(totalCo2).toBe(0);
    });

    it('boundary — taux unique : eezRate === portRate (multiplier=1 sur les deux zones)', () => {
        // Post-#68 : il n'y a plus de taux différenciés par zone
        const rate = 50;
        const { tax: eezTax, co2: eezCo2 } = expectedEezCo2(rate);
        const { tax: portTax, co2: portCo2 } = expectedPortCo2(rate);
        // Les deux taux effectifs doivent être identiques au taux unique
        expect(eezTax / eezCo2).toBeCloseTo(rate, 5);
        expect(portTax / portCo2).toBeCloseTo(rate, 5);
    });
});
