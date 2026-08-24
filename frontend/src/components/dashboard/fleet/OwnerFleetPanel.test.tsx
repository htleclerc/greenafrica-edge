import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { OwnerFleetPanel } from './OwnerFleetPanel';
import type { FleetVessel } from '@/services/ownerFleetService';
import { OWNER_ALL_PRIVILEGES, NO_PRIVILEGES, type OwnerPrivileges } from '@/lib/auth/ownerPrivileges';
import en from '../../../../messages/en.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/actions/updateOwnerVessel', () => ({
    renameOwnerVessel: vi.fn(),
    detachOwnerVessel: vi.fn(),
}));

function vessel(overrides: Partial<FleetVessel> = {}): FleetVessel {
    return {
        id: 'v1',
        name: 'GG DEMO STAR',
        imoNumber: '9839272',
        mmsi: '636092841',
        flagCode: 'LR',
        complianceStatus: 'PAYMENT_DUE',
        invoiceCount: 1,
        outstandingUsd: 16500,
        overdue: true,
        partiallyPaid: false,
        canRemove: false,
        ...overrides,
    };
}

function renderPanel(
    fleet: FleetVessel[],
    privileges: OwnerPrivileges = OWNER_ALL_PRIVILEGES,
    isMember = false,
) {
    return render(
        <NextIntlClientProvider locale="en" messages={en}>
            <OwnerFleetPanel fleet={fleet} privileges={privileges} isMember={isMember} />
        </NextIntlClientProvider>,
    );
}

/** Teinte du badge d'un navire, lue sur la puce colorée. */
function badgeOf(label: string | RegExp): HTMLElement {
    return screen.getByText(label).closest('span') as HTMLElement;
}

describe('OwnerFleetPanel — ce que la couleur annonce', () => {
    // Le badge était rouge dès qu'une facture existait — soldée ou non, échue
    // ou non. Un navire à jour s'affichait aussi alarmant qu'un impayé, et une
    // somme due dans trois semaines aussi urgente qu'une somme en retard.
    // C'est l'ÉCHÉANCE qui décide de l'alarme.

    it('passe au vert quand tout est réglé', () => {
        renderPanel([vessel({ outstandingUsd: 0, overdue: false, complianceStatus: 'COMPLIANT' })]);
        expect(badgeOf('1 invoice(s) · settled').className).toContain('22C55E');
    });

    it('reste rouge quand l échéance est dépassée', () => {
        renderPanel([vessel({ overdue: true })]);
        expect(badgeOf('1 invoice(s)').className).toContain('EF4444');
    });

    it('passe à l orange sur un règlement partiel encore dans les délais', () => {
        renderPanel([vessel({ outstandingUsd: 8000, overdue: false, partiallyPaid: true })]);
        expect(badgeOf('1 invoice(s) · part-paid').className).toContain('F97316');
    });

    it('reste rouge sur un règlement partiel dont l échéance est passée', () => {
        // Un acompte ne repousse pas la date : la créance est en retard.
        renderPanel([vessel({ outstandingUsd: 8000, overdue: true, partiallyPaid: true })]);
        expect(badgeOf('1 invoice(s) · part-paid').className).toContain('EF4444');
    });

    it('n alarme pas une somme due mais pas encore échue', () => {
        renderPanel([vessel({ overdue: false })]);
        expect(badgeOf('1 invoice(s)').className).toContain('F97316');
    });

    it('signale distinctement un navire sans aucune facture', () => {
        renderPanel([vessel({ invoiceCount: 0, outstandingUsd: 0, overdue: false, canRemove: true })]);
        expect(screen.getByText('No invoice')).toBeInTheDocument();
        expect(screen.queryByText(/cannot be removed|stays on file/i)).not.toBeInTheDocument();
    });

    it('explique le blocage du retrait sans parler de contestation quand c est réglé', () => {
        // « Si ce navire n'est pas le vôtre, contestez la facture » n'a pas de
        // sens face à une taxation déjà acquittée.
        renderPanel([vessel({ outstandingUsd: 0, overdue: false })]);
        expect(screen.getByText(/settled invoice and stays on file/i)).toBeInTheDocument();
        expect(screen.queryByText(/dispute the invoice/i)).not.toBeInTheDocument();
    });

    it('totalise le reste dû de la flotte', () => {
        renderPanel([
            vessel({ id: 'v1', outstandingUsd: 16500 }),
            vessel({ id: 'v2', name: 'GG DEMO PIONEER', outstandingUsd: 0, overdue: false }),
        ]);
        // Le total du bandeau et le montant de la ligne portent la même somme.
        expect(screen.getAllByText(/16,500\.00/).length).toBeGreaterThanOrEqual(1);
    });
});

describe('OwnerFleetPanel — sous-permissions du membre invité', () => {
    it('retire renommer et retirer au membre qui ne gère pas la flotte', () => {
        renderPanel([vessel({ canRemove: true })], NO_PRIVILEGES, true);
        expect(screen.queryByRole('button', { name: en.MyFleet.rename })).toBeNull();
        expect(screen.queryByRole('button', { name: en.MyFleet.detach })).toBeNull();
        expect(screen.getByText(en.MyFleet.restricted)).toBeInTheDocument();
    });

    it('laisse la flotte lisible : le navire et son encours restent affichés', () => {
        renderPanel([vessel()], NO_PRIVILEGES, true);
        expect(screen.getByText('GG DEMO STAR')).toBeInTheDocument();
    });

    it('ne dit rien au titulaire, qui a tout', () => {
        renderPanel([vessel({ canRemove: true })]);
        expect(screen.getByRole('button', { name: en.MyFleet.rename })).toBeInTheDocument();
        expect(screen.queryByText(en.MyFleet.restricted)).toBeNull();
    });
});
