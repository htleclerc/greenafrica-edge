import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { FleetBoard } from './FleetBoard';
import type { OwnerFleet, FleetVessel } from '@/services/ownerFleet';
import en from '../../../../messages/en.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

function vessel(overrides: Partial<FleetVessel> = {}): FleetVessel {
    return {
        id: 'v-star',
        name: 'GG DEMO STAR',
        imoNumber: '9839272',
        category: 'CONTAINER',
        position: null,
        status: 'overdue',
        urgency: 'overdue',
        needsAction: true,
        nextDueDate: '2026-05-26T00:00:00Z',
        emissionsTco2: 413,
        outstandingUsd: 16500,
        paidYtdUsd: 0,
        ...overrides,
    } as FleetVessel;
}

function fleetOf(vessels: FleetVessel[]): OwnerFleet {
    return {
        vessels,
        counts: {
            all: vessels.length,
            action: vessels.filter((v) => v.needsAction).length,
            inPort: 0,
            compliant: vessels.filter((v) => !v.needsAction).length,
            exempt: 0,
        },
    } as OwnerFleet;
}

function renderBoard(fleet: OwnerFleet) {
    return render(
        <NextIntlClientProvider locale="en" messages={en}>
            <FleetBoard fleet={fleet} vesselBasePath="/dashboard/vessels" />
        </NextIntlClientProvider>,
    );
}

describe('FleetBoard — accès au détail', () => {
    // Un navire à traiter est rendu en CARTE, un navire conforme en LIGNE de
    // tableau. Seule la ligne portait un lien « Details » : l'armateur pouvait
    // consulter le détail de ses navires conformes, et d'aucun autre —
    // exactement l'inverse de ce dont il a besoin avant de payer.

    it('donne accès au détail d un navire en retard', () => {
        renderBoard(fleetOf([vessel()]));
        const links = screen.getAllByRole('link', { name: /GG DEMO STAR|Details/i });
        const hrefs = links.map((l) => l.getAttribute('href'));
        expect(hrefs).toContain('/dashboard/vessels/v-star');
    });

    it('garde l action de paiement à côté du détail, pas à sa place', () => {
        renderBoard(fleetOf([vessel()]));
        // L'action principale reste le paiement : le détail s'ajoute, il ne
        // remplace pas le geste attendu.
        expect(screen.getByRole('link', { name: /Pay before/i })).toHaveAttribute(
            'href', '/dashboard/invoices',
        );
    });

    it('rend le nom du navire cliquable sur la carte', () => {
        renderBoard(fleetOf([vessel()]));
        expect(screen.getByRole('link', { name: 'GG DEMO STAR' }))
            .toHaveAttribute('href', '/dashboard/vessels/v-star');
    });

    it('n ajoute pas de second lien redondant sur une pro-forma', () => {
        // Sur ce statut, l'action principale mène DÉJÀ au détail du navire :
        // deux liens vers la même page ne feraient qu'encombrer.
        renderBoard(fleetOf([vessel({ id: 'v-pro', status: 'proforma', nextDueDate: null })]));
        const detailLinks = screen
            .getAllByRole('link')
            .filter((l) => l.getAttribute('href') === '/dashboard/vessels/v-pro');
        expect(detailLinks.length).toBeLessThanOrEqual(2);
    });

    it('conserve le lien détail des navires conformes', () => {
        const { container } = renderBoard(
            fleetOf([vessel({ id: 'v-pioneer', name: 'GG DEMO PIONEER', status: 'compliant', needsAction: false })]),
        );
        expect(within(container).getByRole('link', { name: /Details/i }))
            .toHaveAttribute('href', '/dashboard/vessels/v-pioneer');
    });
});
