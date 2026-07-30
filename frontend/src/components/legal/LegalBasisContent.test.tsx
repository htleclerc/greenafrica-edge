import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/en.json';
import LegalBasisContent from './LegalBasisContent';

vi.mock('next/navigation', () => ({
    useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/layout/Navbar', () => ({
    Navbar: () => <nav data-testid="navbar" />,
}));

function renderPage() {
    return render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <LegalBasisContent />
        </NextIntlClientProvider>,
    );
}

describe('LegalBasisContent', () => {
    it('renders the document title', () => {
        renderPage();
        expect(screen.getByRole('heading', { level: 1, name: /Legal Basis & Methodology References/i })).toBeInTheDocument();
    });

    it('renders all seven section headings', () => {
        renderPage();
        for (const title of [
            /Programme Summary/i,
            /National Legal Framework/i,
            /Maritime Methodology/i,
            /Aviation Methodology/i,
            /Governance & Audit/i,
            /Dispute Resolution & Jurisdiction/i,
            /Contact & Correspondence/i,
        ]) {
            expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
        }
    });

    it('states the verified maritime worked example', () => {
        renderPage();
        expect(screen.getByText('4,500 nm')).toBeInTheDocument();
        expect(screen.getByText('725 tCO2')).toBeInTheDocument();
        expect(screen.getByText('USD 29,000')).toBeInTheDocument();
    });

    it('states the verified aviation worked example and its real pro-forma reference', () => {
        renderPage();
        expect(screen.getByText('USD 560')).toBeInTheDocument();
        expect(screen.getByText(/AVI-MAI-2026-0001/)).toBeInTheDocument();
    });

    it('offers the source documents on request rather than as downloads', () => {
        renderPage();
        expect(screen.getAllByText(/available on request/i).length).toBeGreaterThan(0);
        expect(document.querySelector('a[href$=".pdf"]')).toBeNull();
    });
});
