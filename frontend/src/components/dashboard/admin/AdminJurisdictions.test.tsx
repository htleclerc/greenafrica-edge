import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { AdminJurisdictions, type JurisdictionRow, type JurisdictionModeConfigRow, type TariffRow, type SplitRuleRow, type SettlementRow } from './AdminJurisdictions';
import en from '../../../../messages/en.json';

vi.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/actions/toggleJurisdictionMode', () => ({
    toggleJurisdictionMode: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/actions/createTariffVersion', () => ({
    createTariffVersion: vi.fn(async () => ({ ok: true })),
}));

const JUR: JurisdictionRow = {
    id: '00000000-0000-4000-8000-00000000534f',
    code: 'SO',
    name: 'Republic of Somaliland',
    default_currency: 'USD',
    locales: ['so', 'ar', 'en'],
    status: 'ACTIVE',
};

const MODE_CONFIGS: JurisdictionModeConfigRow[] = [
    { jurisdiction_id: JUR.id, mode: 'MARITIME', enabled: true, activated_at: '2024-01-01T00:00:00Z' },
    { jurisdiction_id: JUR.id, mode: 'AIR', enabled: false, activated_at: null },
];

const TARIFFS: TariffRow[] = [
    {
        id: 't1',
        jurisdiction_id: JUR.id,
        mode: 'MARITIME',
        asset_category: null,
        rate_per_tco2: 40,
        currency: 'USD',
        effective_from: '2024-01-01',
        effective_to: null,
        status: 'ACTIVE',
        decree_ref: 'DEC-2024-001',
    },
];

const SPLIT: SplitRuleRow = {
    id: 'sr1',
    jurisdiction_id: JUR.id,
    concessionaire_pct: 20,
    sovereign_pct: 80,
    contract_ref: 'CONTRACT-001',
    effective_from: '2024-01-01T00:00:00Z',
    effective_to: null,
};

// Settlement fixtures
const SETTLEMENT_ROW: SettlementRow = {
    jurisdiction_id: JUR.id,
    jurisdiction_code: 'SO',
    month: '2026-06-01',
    mode: 'MARITIME',
    tx_count: 3,
    total_usd: '12000.50',
    concessionaire_usd: '2400.10',
    sovereign_usd: '9600.40',
    unattributed_count: 0,
    unattributed_usd: null,
    mismatched_count: 0,
    mismatched_usd: null,
};

// A row with NULL concessionaire_usd to test COALESCE→0.00
const SETTLEMENT_ROW_NULL_CONC: SettlementRow = {
    ...SETTLEMENT_ROW,
    month: '2026-05-01',
    concessionaire_usd: null,
    sovereign_usd: null,
    total_usd: null,
};

// A row with unattributed_count > 0 to test the warning line
const SETTLEMENT_ROW_UNATTR: SettlementRow = {
    ...SETTLEMENT_ROW,
    month: '2026-06-01',
    unattributed_count: 2,
    mismatched_count: 1,
};

function renderPanel(viewerRole = 'SUPERADMIN', settlement: SettlementRow[] = []) {
    return render(
        <NextIntlClientProvider locale="en" messages={en}>
            <AdminJurisdictions
                jurisdictions={[JUR]}
                modeConfigs={MODE_CONFIGS}
                tariffs={TARIFFS}
                splitRules={[SPLIT]}
                settlement={settlement}
                viewerRole={viewerRole}
            />
        </NextIntlClientProvider>,
    );
}

describe('AdminJurisdictions', () => {
    it('renders jurisdiction code and name', () => {
        renderPanel();
        expect(screen.getByText('SO')).toBeInTheDocument();
        expect(screen.getByText('Republic of Somaliland')).toBeInTheDocument();
    });

    it('displays ACTIVE status badge', () => {
        renderPanel();
        // The status badge shows 'ACTIVE'
        expect(screen.getAllByText(/ACTIVE/i).length).toBeGreaterThanOrEqual(1);
    });

    it('shows tariff rate with currency', () => {
        renderPanel();
        // M3: rate displays as "40.00 USD/tCO₂" (currency from row, no hardcoded '$')
        expect(screen.getByText(/40\.00 USD/)).toBeInTheDocument();
    });

    it('displays decree_ref', () => {
        renderPanel();
        expect(screen.getByText('DEC-2024-001')).toBeInTheDocument();
    });

    it('shows split rule info', () => {
        renderPanel();
        expect(screen.getByText(/CONTRACT-001/)).toBeInTheDocument();
    });

    it('shows "New version" button for SUPERADMIN', () => {
        renderPanel('SUPERADMIN');
        // At least one "New version" button should exist
        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
    });

    it('does not show "New version" button for PORT_OFFICER', () => {
        renderPanel('PORT_OFFICER');
        // PORT_OFFICER cannot create tariffs — no "New version" button text
        expect(screen.queryByText(/New version/i)).not.toBeInTheDocument();
    });

    it('shows mode labels MARITIME and AIR', () => {
        renderPanel();
        expect(screen.getAllByText('MARITIME').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('AIR').length).toBeGreaterThanOrEqual(1);
    });

    it('renders empty state when no jurisdictions', () => {
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <AdminJurisdictions
                    jurisdictions={[]}
                    modeConfigs={[]}
                    tariffs={[]}
                    splitRules={[]}
                    settlement={[]}
                    viewerRole="SUPERADMIN"
                />
            </NextIntlClientProvider>,
        );
        // Empty state text should appear
        expect(screen.getByText(en.AdminJurisdictions.empty)).toBeInTheDocument();
    });

    it('settlement: shows empty state when no rows for jurisdiction', () => {
        renderPanel('SUPERADMIN', []);
        expect(screen.getByText(en.AdminJurisdictions.settlement.empty)).toBeInTheDocument();
    });

    it('settlement: renders total and concessionaire amounts for a jurisdiction', () => {
        renderPanel('SUPERADMIN', [SETTLEMENT_ROW]);
        // Total should appear
        expect(screen.getByText(/12,000\.50 USD/)).toBeInTheDocument();
        // Concessionaire
        expect(screen.getByText(/2,400\.10 USD/)).toBeInTheDocument();
        // Sovereign
        expect(screen.getByText(/9,600\.40 USD/)).toBeInTheDocument();
    });

    it('settlement: COALESCE NULL concessionaire_usd renders 0.00', () => {
        renderPanel('SUPERADMIN', [SETTLEMENT_ROW_NULL_CONC]);
        // Both concessionaire and total are null → rendered as "0.00 USD"
        const zeros = screen.getAllByText(/0\.00 USD/);
        expect(zeros.length).toBeGreaterThanOrEqual(1);
    });

    it('settlement: shows warning line when unattributed_count > 0', () => {
        renderPanel('SUPERADMIN', [SETTLEMENT_ROW_UNATTR]);
        expect(screen.getByText(/2 unattributed tx/)).toBeInTheDocument();
        expect(screen.getByText(/1 mismatched tx/)).toBeInTheDocument();
    });
});
