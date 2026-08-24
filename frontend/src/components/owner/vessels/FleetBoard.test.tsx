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

    it('n ajoute pas de bouton Détail sur une carte qui y mène déjà', () => {
        // Sur une pro-forma, l'action principale de la carte ouvre DÉJÀ la
        // fiche du navire : un second bouton juste à côté n'encombrerait que
        // l'écran. Le tableau, lui, garde le sien — c'est un autre endroit.
        renderBoard(fleetOf([vessel({ id: 'v-pro', status: 'proforma', nextDueDate: null })]));
        const card = screen.getByRole('article');
        expect(within(card).queryByText('Details')).not.toBeInTheDocument();
    });

    it('ajoute un bouton Détail sur une carte dont l action mène au paiement', () => {
        renderBoard(fleetOf([vessel({ id: 'v-star', status: 'overdue' })]));
        const card = screen.getByRole('article');
        expect(within(card).getByText('Details'))
            .toHaveAttribute('href', '/dashboard/vessels/v-star');
    });

    it('conserve le lien détail des navires conformes', () => {
        const { container } = renderBoard(
            fleetOf([vessel({ id: 'v-pioneer', name: 'GG DEMO PIONEER', status: 'compliant', needsAction: false })]),
        );
        expect(within(container).getByRole('link', { name: /Details/i }))
            .toHaveAttribute('href', '/dashboard/vessels/v-pioneer');
    });
});

describe('FleetBoard — inventaire complet', () => {
    it('liste TOUS les navires dans le tableau, y compris ceux mis en carte', () => {
        // Le tableau excluait les navires a traiter, deja rendus en carte : le
        // bandeau annoncait « 2 vessels » et la liste n'en montrait qu'un.
        // L'armateur qui cherchait le sien devait deviner qu'il etait plus haut.
        renderBoard(fleetOf([
            vessel({ id: 'v-star', name: 'GG DEMO STAR', needsAction: true }),
            vessel({
                id: 'v-pioneer', name: 'GG DEMO PIONEER',
                status: 'compliant', needsAction: false, outstandingUsd: 0,
            }),
        ]));

        const detailLinks = screen
            .getAllByRole('link')
            .map((l) => l.getAttribute('href'));
        expect(detailLinks).toContain('/dashboard/vessels/v-star');
        expect(detailLinks).toContain('/dashboard/vessels/v-pioneer');

        // Le navire a traiter parait DEUX fois : une carte d'appel a l'action,
        // et sa ligne d'inventaire. La redondance est voulue.
        expect(screen.getAllByText('GG DEMO STAR').length).toBe(2);
    });

    it('garde la carte d appel a l action au-dessus du tableau', () => {
        renderBoard(fleetOf([vessel({ id: 'v-star', needsAction: true })]));
        expect(screen.getByRole('link', { name: /Pay before/i })).toBeInTheDocument();
    });
});
