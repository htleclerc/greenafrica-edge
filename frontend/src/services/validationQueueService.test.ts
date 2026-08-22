import { describe, it, expect } from 'vitest';
import {
    comparisonRow, equasisToItem, destinationToItem, registrationToItem,
    ORIGIN_PORT_CONFIDENT_DISTANCE,
} from './validationQueueService';
import type { EquasisProposal } from './equasisProposalService';
import type { DestinationProposal } from './destinationProposalService';

const equasis: EquasisProposal = {
    id: 'eq-1',
    imo_number: '9703291',
    shipowner_id: 'own-1',
    proposed_owner_name: 'HORN SHIPPING',
    proposed_manager: 'Horn Ship Management',
    proposed_email: 'ops@horn.example',
    proposed_country: 'SO',
    source: 'scraper',
    scraped_at: '2026-08-20T09:00:00Z',
    applied: false,
    reviewed_at: null,
    reviewed_by: null,
    rejected_reason: null,
    shipowner: {
        id: 'own-1',
        name: 'HORN SHIPPING',
        country_code: 'SO',
        official_email: 'ops@horn.example',
        official_email_source: 'EQUASIS_VERIFIED',
        account_state: 'ACTIVE',
    },
};

const destination: DestinationProposal = {
    id: 'dp-1',
    mmsi: '636092837',
    imo_number: '9412887',
    vessel_name: 'HORIZON VENTURE',
    raw_destination: 'DJIBOUTI',
    normalized: 'DJIBOUTI',
    matched_port_guess: 'BERBERA',
    fuzzy_score: 1,
    status: 'PENDING',
    created_at: '2026-08-19T06:00:00Z',
};

describe('comparisonRow', () => {
    it('ne signale une divergence que si les deux valeurs existent et diffèrent', () => {
        expect(comparisonRow('f', 'a', 'b').diverges).toBe(true);
        expect(comparisonRow('f', 'a', 'a').diverges).toBe(false);
    });
    it('ne signale pas de divergence quand on ne fait que remplir un champ vide', () => {
        expect(comparisonRow('f', null, 'b').diverges).toBe(false);
        expect(comparisonRow('f', '   ', 'b').diverges).toBe(false);
    });
    it('rend un tiret plutôt qu’une chaîne vide', () => {
        const row = comparisonRow('f', null, null);
        expect(row.declared).toBe('—');
        expect(row.source).toBe('—');
    });
});

describe('equasisToItem', () => {
    it('marque conforme une proposition qui ne fait que compléter', () => {
        const item = equasisToItem({
            ...equasis,
            shipowner: { ...equasis.shipowner!, official_email: null, country_code: null },
        });
        expect(item.conforming).toBe(true);
    });
    it('marque non conforme dès qu’une valeur déjà posée diverge', () => {
        const item = equasisToItem({
            ...equasis,
            shipowner: { ...equasis.shipowner!, official_email: 'contact@officier.example' },
        });
        expect(item.conforming).toBe(false);
        expect(item.comparison?.find((r) => r.field === 'email')?.diverges).toBe(true);
    });
    it('porte l’IMO dans le titre — c’est par lui qu’on identifie le dossier', () => {
        expect(equasisToItem(equasis).title).toContain('IMO 9703291');
    });
});

describe('destinationToItem', () => {
    it('approuve en lot un rapprochement à distance 1 ou moins', () => {
        expect(destinationToItem({ ...destination, fuzzy_score: 0 }).conforming).toBe(true);
        expect(destinationToItem({ ...destination, fuzzy_score: ORIGIN_PORT_CONFIDENT_DISTANCE }).conforming).toBe(true);
    });
    it('sort du lot dès que la distance dépasse le seuil — un score haut est un mauvais score', () => {
        const weak = { ...destination, fuzzy_score: ORIGIN_PORT_CONFIDENT_DISTANCE + 1 };
        expect(destinationToItem(weak).conforming).toBe(false);
    });
    it('sort du lot quand aucun port n’a été deviné, même à distance nulle', () => {
        expect(destinationToItem({ ...destination, matched_port_guess: null, fuzzy_score: 0 }).conforming).toBe(false);
    });
    it('retombe sur le MMSI quand le navire n’a pas de nom', () => {
        expect(destinationToItem({ ...destination, vessel_name: null }).title).toContain('636092837');
    });
});

describe('registrationToItem', () => {
    const base = {
        id: 'r-1', org_name: 'Berbera Port Services', contact_name: 'Amina Haji',
        contact_email: 'amina@bps.example', entity_type: 'SHIPPING_AGENT',
        requested_role: 'SHIPPING_AGENT', jurisdiction: 'Somaliland',
        created_at: '2026-08-18T10:00:00Z', flagged: false,
    };

    it('n’a rien à comparer — une candidature n’est pas un écart entre deux sources', () => {
        expect(registrationToItem(base).comparison).toBeUndefined();
        expect(registrationToItem(base).summary).toBe('SHIPPING_AGENT · SHIPPING_AGENT · Somaliland');
    });
    it('exclut du lot une demande signalée', () => {
        expect(registrationToItem({ ...base, flagged: true }).conforming).toBe(false);
    });
    it('retombe sur l’e-mail quand le contact n’a pas de nom', () => {
        expect(registrationToItem({ ...base, contact_name: null }).title).toContain('amina@bps.example');
    });
});
