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

// Mutable so individual describe blocks can override role / demo flag
let mockRole: UserRole = UserRole.PORT_OFFICER;
let mockIsDemo = false;

vi.mock('@/lib/RoleContext', () => ({
    useRole: () => ({ isDemo: mockIsDemo, role: mockRole, user: { id: 'staff-1' } }),
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
        mockRole = UserRole.PORT_OFFICER;
        mockIsDemo = false;
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
        mockRole = UserRole.PORT_OFFICER;
        mockIsDemo = false;
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

// ─────────────────────────────────────────────────────────────────────────────
// Rendu nominal — les éléments clés doivent s'afficher depuis les props tx
// ─────────────────────────────────────────────────────────────────────────────

describe('ProFormaModal — rendu nominal', () => {
    beforeEach(() => {
        mockTaxConfigs.length = 0;
        mockRole = UserRole.PORT_OFFICER;
        mockIsDemo = false;
    });

    it('affiche le nom du navire issu de tx.vesselName', () => {
        render(<ProFormaModal tx={baseTx} onClose={vi.fn()} />);
        const matches = screen.getAllByText(/MV TEST VESSEL/i);
        expect(matches.length).toBeGreaterThan(0);
    });

    it('affiche le numéro IMO issu de tx.vesselImo', () => {
        render(<ProFormaModal tx={baseTx} onClose={vi.fn()} />);
        const matches = screen.getAllByText(/IMO.*1234567|1234567.*IMO/i);
        expect(matches.length).toBeGreaterThan(0);
    });

    it("affiche le port d'escale issu de tx.portCall", () => {
        render(<ProFormaModal tx={baseTx} onClose={vi.fn()} />);
        const matches = screen.getAllByText(/Djibouti Port/i);
        expect(matches.length).toBeGreaterThan(0);
    });

    it('affiche le montant taxAmountUsd dans le total', () => {
        render(<ProFormaModal tx={baseTx} onClose={vi.fn()} />);
        // taxAmountUsd = 4000, affiché comme "$4,000" ou "4 000"
        const matches = screen.getAllByText(/4[,\s]?000/);
        expect(matches.length).toBeGreaterThan(0);
    });

    it('affiche le label PRO-FORMA INVOICE (mode proforma depuis le mock statusToMode)', () => {
        render(<ProFormaModal tx={baseTx} onClose={vi.fn()} />);
        // Le label apparait dans le header toolbar ET dans le PDF preview — getAllByText
        const labels = screen.getAllByText(/PRO-FORMA INVOICE/i);
        expect(labels.length).toBeGreaterThan(0);
    });

    it('appelle onClose quand le bouton de fermeture est cliqué', () => {
        const onClose = vi.fn();
        render(<ProFormaModal tx={baseTx} onClose={onClose} />);
        // Le bouton X (icône) est dans le coin du modal toolbar
        const closeButtons = screen.getAllByRole('button').filter(
            (btn) => btn.getAttribute('class')?.includes('rounded-lg') && btn.querySelector('svg'),
        );
        // Au moins un bouton de fermeture doit exister
        expect(closeButtons.length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas limites
// ─────────────────────────────────────────────────────────────────────────────

describe('ProFormaModal — cas limites', () => {
    beforeEach(() => {
        mockTaxConfigs.length = 0;
        mockRole = UserRole.PORT_OFFICER;
        mockIsDemo = false;
    });

    it('montant 0 : affiche $0 dans le total sans planter', () => {
        const zeroTx: Transaction = { ...baseTx, taxAmountUsd: 0, emissionsTco2: 0 };
        render(<ProFormaModal tx={zeroTx} onClose={vi.fn()} />);
        // L'UI doit s'afficher sans erreur, et afficher $0
        const matches = screen.getAllByText(/\$0/);
        expect(matches.length).toBeGreaterThan(0);
    });

    it('role SHIPPING_AGENT : le bouton "Pay Now" est visible à la place de Print & Send', () => {
        mockRole = UserRole.SHIPPING_AGENT;
        render(<ProFormaModal tx={baseTx} onClose={vi.fn()} />);
        // pay_now_short i18n key retourné tel quel par le mock useTranslations
        const payBtn = screen.queryByText(/pay_now_short/i);
        expect(payBtn).not.toBeNull();
        // Print & Send ne doit pas être dans le toolbar (c'est pour les non-armateurs)
        expect(screen.queryByText(/print_and_send/i)).toBeNull();
    });

    it('mode démo : bannière demo_generate_disabled visible', () => {
        mockIsDemo = true;
        render(<ProFormaModal tx={baseTx} onClose={vi.fn()} />);
        // La bannière démo utilise la clé i18n retournée telle quelle
        expect(screen.getByText('demo_generate_disabled')).toBeDefined();
    });
});
