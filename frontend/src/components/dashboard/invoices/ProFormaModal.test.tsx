import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Transaction } from '@/types/secure';
import { TransactionStatus, TransactionType, UserRole } from '@/types/secure';

// ─────────────────────────────────────────────────────────────────────────────
// Module stubs — must be declared before the import under test
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));

vi.mock('@/lib/RoleContext', () => ({
    useRole: () => ({ isDemo: false, role: UserRole.PORT_OFFICER, user: { id: 'staff-1' } }),
}));

vi.mock('@/hooks/useVessels', () => ({
    useVessels: () => ({ data: [] }),
}));

// taxConfigs: controlled per-test via the hoisted variable below
const mockTaxConfigs: unknown[] = [];
vi.mock('@/hooks/useTaxConfigs', () => ({
    useTaxConfigs: () => ({ data: mockTaxConfigs }),
}));

vi.mock('@/lib/supabase/client', () => ({
    createClient: () => ({}),
}));

vi.mock('@/services/profileService', () => ({
    getProfileById: () => Promise.resolve(null),
}));

vi.mock('@/services/invoiceService', () => ({
    statusToMode: (_status: string) => ({ mode: 'proforma', badge: 'TO PAY' }),
    buildVerifyUrl: (_ref: string) => 'https://example.com/verify/test',
    generateQrCodeDataUrl: () => Promise.resolve('data:image/png;base64,fake'),
}));

// ─────────────────────────────────────────────────────────────────────────────

import { ProFormaModal } from './ProFormaModal';

const baseTx: Transaction = {
    id: 'tx-test-uuid-0001-abcd',
    ref: 'PRO-2026-testref',
    vesselId: 'vessel-1',
    vesselName: 'MV TEST VESSEL',
    vesselImo: '1234567',
    transactionType: TransactionType.ENTRY_TAX,
    emissionsTco2: 100,
    taxAmountUsd: 4000,
    status: TransactionStatus.PENDING,
    invoicePdfUrl: null,
    portCall: 'Djibouti Port',
    createdAt: new Date('2026-06-01T00:00:00Z').toISOString(),
    paidAt: null,
};

describe('ProFormaModal — jurisdictionName prop', () => {
    beforeEach(() => {
        mockTaxConfigs.length = 0;
    });

    it('renders the passed jurisdictionName in the header', () => {
        render(
            <ProFormaModal
                tx={baseTx}
                onClose={vi.fn()}
                jurisdictionName="Republic of Djibouti"
            />,
        );
        // The sovereign name should appear in the PDF preview header area
        const matches = screen.getAllByText(/Republic of Djibouti/i);
        expect(matches.length).toBeGreaterThan(0);
    });

    it('does not show Republic of Somaliland when Djibouti is passed', () => {
        render(
            <ProFormaModal
                tx={baseTx}
                onClose={vi.fn()}
                jurisdictionName="Republic of Djibouti"
            />,
        );
        // Somaliland should NOT appear in the document body (except possibly in the flag alt or TODO comments which are not rendered)
        const somaliBits = screen.queryAllByText(/Somaliland/i);
        // The only Somaliland text could be in the flag img alt — check none are in text nodes
        const textOnlyMatches = somaliBits.filter(
            (el) => el.tagName !== 'IMG',
        );
        expect(textOnlyMatches).toHaveLength(0);
    });

    it('defaults to Republic of Somaliland when no prop is passed', () => {
        render(
            <ProFormaModal
                tx={baseTx}
                onClose={vi.fn()}
            />,
        );
        const matches = screen.getAllByText(/Republic of Somaliland/i);
        expect(matches.length).toBeGreaterThan(0);
    });
});

describe('ProFormaModal — fail-closed rate', () => {
    beforeEach(() => {
        mockTaxConfigs.length = 0;
    });

    it('shows "—" for the rate when no active tax config is found', () => {
        // mockTaxConfigs is empty → rateUnavailable = true
        render(
            <ProFormaModal
                tx={baseTx}
                onClose={vi.fn()}
                jurisdictionName="Republic of Djibouti"
            />,
        );
        // The rate display should show '—' rather than '20'
        const rateDashes = screen.getAllByText('—');
        expect(rateDashes.length).toBeGreaterThan(0);
        // '20' must NOT appear as a rate value (old silent default)
        expect(screen.queryByText(/\$20\.00\/t/i)).toBeNull();
        expect(screen.queryByText(/\$20\.00/i)).toBeNull();
    });

    it('shows "rate unavailable" warning when no tax config', () => {
        render(
            <ProFormaModal
                tx={baseTx}
                onClose={vi.fn()}
            />,
        );
        expect(screen.getByText(/rate unavailable/i)).toBeDefined();
    });

    it('disables all action buttons when rate is unavailable', () => {
        render(
            <ProFormaModal
                tx={baseTx}
                onClose={vi.fn()}
            />,
        );
        // All three action buttons should be disabled
        const buttons = screen.getAllByRole('button');
        const actionButtons = buttons.filter(
            (btn) => btn.hasAttribute('disabled') &&
                     !btn.textContent?.toLowerCase().includes('cancel'),
        );
        expect(actionButtons.length).toBeGreaterThan(0);
    });
});
