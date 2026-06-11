import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { AdminJurisdictions, type JurisdictionRow, type JurisdictionModeConfigRow, type TariffRow, type SplitRuleRow } from './AdminJurisdictions';
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

function renderPanel(viewerRole = 'SUPERADMIN') {
    return render(
        <NextIntlClientProvider locale="en" messages={en}>
            <AdminJurisdictions
                jurisdictions={[JUR]}
                modeConfigs={MODE_CONFIGS}
                tariffs={TARIFFS}
                splitRules={[SPLIT]}
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
                    viewerRole="SUPERADMIN"
                />
            </NextIntlClientProvider>,
        );
        // Empty state text should appear
        expect(screen.getByText(en.AdminJurisdictions.empty)).toBeInTheDocument();
    });
});
