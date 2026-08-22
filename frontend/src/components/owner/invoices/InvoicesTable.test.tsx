import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { InvoicesTable, type InvoiceRow } from './InvoicesTable';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const issueOwnerProforma = vi.fn();
vi.mock('@/actions/issueOwnerProforma', () => ({
    issueOwnerProforma: (...args: unknown[]) => issueOwnerProforma(...args),
}));

function row(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
    return {
        id: '81be7109-0cca-4dc8-a077-eda4f4011570',
        invoice_ref: 'PRO-2026-81be71091a2b',
        content_hash: 'a'.repeat(64),
        document_type: 'PROFORMA',
        vessel_name: 'GG DEMO PIONEER',
        tax_amount_usd: 11492,
        status: 'PENDING',
        paid_at: null,
        created_at: '2026-04-26T18:58:12.360325+00:00',
        download_url: '/api/invoices/PRO-2026-81be71091a2b/download?h=aaa&s=bbb',
        receipt_ref: null,
        pending_wire_payment_id: null,
        ...overrides,
    };
}

describe('InvoicesTable — document availability', () => {
    it('links to the PDF when the document has been issued', () => {
        render(<InvoicesTable rows={[row()]} walletBalanceUsdMinor={0} />);
        const link = screen.getByRole('link', { name: /Download PDF/i });
        expect(link).toHaveAttribute(
            'href',
            '/api/invoices/PRO-2026-81be71091a2b/download?h=aaa&s=bbb',
        );
    });

    // REGRESSION GUARD (2026-07-24) — seeded pro-formas carry no rendered PDF, so
    // download_url is null. The actions cell used to render nothing at all, which
    // read as "the pro-forma is missing" rather than "not issued yet".
    it('shows an explicit not-issued marker instead of an empty cell', () => {
        render(<InvoicesTable rows={[row({ download_url: null })]} walletBalanceUsdMinor={0} />);
        expect(screen.queryByRole('link', { name: /Download PDF/i })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Issue PDF/i })).toBeInTheDocument();
    });

    it('keeps the Pay and Dispute actions available while the document is pending issuance', () => {
        render(<InvoicesTable rows={[row({ download_url: null })]} walletBalanceUsdMinor={0} />);
        expect(screen.getByRole('button', { name: /^Pay$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Dispute/i })).toBeInTheDocument();
    });

    it('does not mark a refund row as awaiting a pro-forma', () => {
        render(
            <InvoicesTable
                rows={[row({ document_type: 'REFUND', status: 'PAID', download_url: null })]}
                walletBalanceUsdMinor={0}
            />,
        );
        expect(screen.queryByRole('button', { name: /Issue PDF/i })).not.toBeInTheDocument();
    });

    // Le marqueur passif « PDF not issued » est devenu un bouton : un pro-forma
    // que le pipeline n'a pas rendu peut etre emis a la demande par l'armateur,
    // depuis le montant deja en base.
    it('issues the missing PDF on demand and refreshes the list', async () => {
        issueOwnerProforma.mockResolvedValueOnce({ invoiceRef: 'PRO-2026-81be71091a2b' });
        render(<InvoicesTable rows={[row({ download_url: null })]} walletBalanceUsdMinor={0} />);

        fireEvent.click(screen.getByRole('button', { name: /Issue PDF/i }));

        await waitFor(() =>
            expect(issueOwnerProforma).toHaveBeenCalledWith({
                transactionId: '81be7109-0cca-4dc8-a077-eda4f4011570',
            }),
        );
        await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it('surfaces an issuance failure next to the row', async () => {
        issueOwnerProforma.mockRejectedValueOnce(new Error('Invoice not found'));
        render(<InvoicesTable rows={[row({ download_url: null })]} walletBalanceUsdMinor={0} />);

        fireEvent.click(screen.getByRole('button', { name: /Issue PDF/i }));

        expect(await screen.findByText('Invoice not found')).toBeInTheDocument();
    });

    it('still renders the receipt link alongside a not-issued document', () => {
        render(
            <InvoicesTable
                rows={[row({ download_url: null, receipt_ref: 'RCP-2026-0001', status: 'PAID' })]}
                walletBalanceUsdMinor={0}
            />,
        );
        const table = screen.getByRole('table');
        expect(within(table).getByRole('link', { name: /receipt/i })).toBeInTheDocument();
        expect(within(table).getByRole('button', { name: /Issue PDF/i })).toBeInTheDocument();
    });
});
