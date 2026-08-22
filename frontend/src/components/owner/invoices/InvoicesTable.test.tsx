import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { InvoicesTable, type InvoiceRow } from './InvoicesTable';
import en from '../../../../messages/en.json';

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
        pending_declared_payment_id: null,
        due_date: null,
        partial_paid_usd: 0,
        emissions_tco2: 287.3,
        breakdown_json: null,
        ...overrides,
    };
}

/**
 * L'écran s'ouvre sur l'onglet « Ouvertes » et sélectionne la première ligne :
 * les assertions portent donc sur le panneau de détail, qui est l'endroit où les
 * actions d'une facture vivent depuis la refonte 2c.
 */
function renderTable(rows: InvoiceRow[]) {
    return render(
        <NextIntlClientProvider locale="en" messages={en}>
            <InvoicesTable rows={rows} walletBalanceUsdMinor={0} />
        </NextIntlClientProvider>,
    );
}

describe('InvoicesTable — document availability', () => {
    it('links to the PDF when the document has been issued', () => {
        renderTable([row()]);
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
        renderTable([row({ download_url: null })]);
        expect(screen.queryByRole('link', { name: /Download PDF/i })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Issue the PDF/i })).toBeInTheDocument();
    });

    it('keeps the Pay and Dispute actions available while the document is pending issuance', () => {
        renderTable([row({ download_url: null })]);
        expect(screen.getByRole('button', { name: /^Pay \$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Dispute$/i })).toBeInTheDocument();
    });

    it('does not mark a refund row as awaiting a pro-forma', () => {
        renderTable([row({ document_type: 'REFUND', status: 'PAID', download_url: null })]);
        expect(screen.queryByRole('button', { name: /Issue the PDF/i })).not.toBeInTheDocument();
    });

    // Le marqueur passif « PDF not issued » est devenu un bouton : un pro-forma
    // que le pipeline n'a pas rendu peut etre emis a la demande par l'armateur,
    // depuis le montant deja en base.
    it('issues the missing PDF on demand and refreshes the list', async () => {
        issueOwnerProforma.mockResolvedValueOnce({ invoiceRef: 'PRO-2026-81be71091a2b' });
        renderTable([row({ download_url: null })]);

        fireEvent.click(screen.getByRole('button', { name: /Issue the PDF/i }));

        await waitFor(() =>
            expect(issueOwnerProforma).toHaveBeenCalledWith({
                transactionId: '81be7109-0cca-4dc8-a077-eda4f4011570',
            }),
        );
        await waitFor(() => expect(refresh).toHaveBeenCalled());
    });

    it('surfaces an issuance failure next to the row', async () => {
        issueOwnerProforma.mockRejectedValueOnce(new Error('Invoice not found'));
        renderTable([row({ download_url: null })]);

        fireEvent.click(screen.getByRole('button', { name: /Issue the PDF/i }));

        expect(await screen.findByText('Invoice not found')).toBeInTheDocument();
    });

    it('still renders the receipt link alongside a not-issued document', () => {
        renderTable([row({ download_url: null, receipt_ref: 'RCP-2026-0001', status: 'PAID' })]);
        expect(screen.getByRole('link', { name: /Receipt/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Issue the PDF/i })).toBeInTheDocument();
    });
});

describe('InvoicesTable — file de travail', () => {
    it('classe chaque facture dans sa famille et compte les onglets', () => {
        renderTable([
            row({ id: 'a', invoice_ref: 'OPEN-1', status: 'PENDING' }),
            row({ id: 'b', invoice_ref: 'PAID-1', status: 'PAID' }),
            row({ id: 'c', invoice_ref: 'DISP-1', status: 'DISPUTED' }),
        ]);
        expect(screen.getByRole('tab', { name: /Open · 1/ })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Paid · 1/ })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Disputed · 1/ })).toBeInTheDocument();
    });

    // La règle du handoff : sans sélection le bouton primaire retombe sur
    // « Payer tout », avec sélection il porte le total sélectionné.
    it('fait porter au bouton primaire le total de la sélection', () => {
        renderTable([
            row({ id: 'a', invoice_ref: 'OPEN-1', tax_amount_usd: 10_000 }),
            row({ id: 'b', invoice_ref: 'OPEN-2', tax_amount_usd: 5_000 }),
        ]);
        expect(screen.getByRole('button', { name: /Pay all/i })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('checkbox', { name: /Select invoice OPEN-2/i }));
        expect(screen.getByRole('button', { name: /Pay the invoice/i })).toBeInTheDocument();
    });

    it('déduit les acomptes du reste dû plutôt que d’afficher le montant facturé', () => {
        renderTable([row({ tax_amount_usd: 11_492, partial_paid_usd: 1_492 })]);
        // 11 492 − 1 492 = 10 000, rendu par usdGrouped (espace insécable étroite).
        expect(screen.getByRole('button', { name: /Pay \$10\s000/ })).toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Justificatif de paiement — un fichier se rattache TOUJOURS a un paiement
// declare. L'ecran proposait « Attach proof of payment » sans jamais dire s'il
// en manquait un, et la boite se contentait d'une croix : rien ne validait le
// geste, l'armateur ne savait pas si sa piece etait prise en compte.
// ─────────────────────────────────────────────────────────────────────────────

describe('InvoicesTable — justificatif de paiement', () => {
    it('n offre aucun rattachement tant qu aucun paiement n est declare', () => {
        renderTable([row({ pending_declared_payment_id: null })]);
        expect(screen.queryByText(/missing proof/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Review proof/i)).not.toBeInTheDocument();
    });

    it('reclame la piece manquante d un paiement declare', () => {
        renderTable([row({ pending_declared_payment_id: 'pay-1', pending_payment_has_proof: false })]);
        expect(screen.getByText(/Add the missing proof/i)).toBeInTheDocument();
    });

    it('propose de revoir la piece quand il y en a deja une', () => {
        // Le meme libelle dans les deux cas laissait croire qu'il manquait
        // toujours quelque chose — ou jamais rien.
        renderTable([row({ pending_declared_payment_id: 'pay-1', pending_payment_has_proof: true })]);
        expect(screen.getByText(/Review proof of payment/i)).toBeInTheDocument();
        expect(screen.queryByText(/Add the missing proof/i)).not.toBeInTheDocument();
    });

    it('ouvre une boite qui dit ce qu elle complete et se valide', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ proofs: [] }) });
        renderTable([row({ pending_declared_payment_id: 'pay-1', pending_payment_has_proof: false })]);
        fireEvent.click(screen.getByText(/Add the missing proof/i));

        expect(await screen.findByText(/no proof is attached yet/i)).toBeInTheDocument();
        // Un geste finalisant, pas seulement une croix.
        const done = screen.getByText('Done');
        expect(done).toBeInTheDocument();

        refresh.mockClear();
        fireEvent.click(done);
        // La fermeture rafraichit : sinon l'ecran continue de reclamer ce qui
        // vient d'etre fourni.
        await waitFor(() => expect(refresh).toHaveBeenCalled());
    });
});
