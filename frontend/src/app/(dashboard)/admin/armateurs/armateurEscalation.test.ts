import { describe, it, expect } from 'vitest';
import {
    debtAgeDays, escalationLevel, matchesTab, sortByDebtAge, cockpitTotals,
} from './armateurEscalation';
import type { ArmateurCockpitRow } from '@/services/armateurService';

const NOW = new Date('2026-08-22T12:00:00Z');
/** `d` jours avant NOW, au format ISO — pour poser une ancienneté de dette précise. */
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const base: ArmateurCockpitRow = {
    id: 'x', name: 'HORN SHIPPING', country_code: 'SO', account_state: 'ACTIVE',
    is_ofac_sdn: false, is_un_prohibited: false, sanctioned: false,
    official_email: 'ops@horn.example', public_ref: 'arm_000000000001',
  imo_company_no: '1234567', proforma_count: 3,
    total_invoiced_usd: 100_000, total_paid_usd: 40_000, total_outstanding_usd: 60_000,
    overdue_count: 2, next_due_date: daysAgo(10), last_auto_tier: 'J7',
    last_reminder_at: daysAgo(2), latest_response_type: null, open_count: 3,
};

describe('debtAgeDays', () => {
    it('compte les jours écoulés depuis la plus vieille échéance ouverte', () => {
        expect(debtAgeDays({ ...base, next_due_date: daysAgo(62) }, NOW)).toBe(62);
    });
    it('rend null tant que rien n’est échu', () => {
        expect(debtAgeDays({ ...base, next_due_date: daysAgo(-5) }, NOW)).toBeNull();
        expect(debtAgeDays({ ...base, next_due_date: null }, NOW)).toBeNull();
    });
    it('rend null sur une date illisible plutôt que NaN', () => {
        expect(debtAgeDays({ ...base, next_due_date: 'pas-une-date' }, NOW)).toBeNull();
    });
});

describe('escalationLevel', () => {
    it('une entité sanctionnée passe avant tout le reste', () => {
        const row = { ...base, sanctioned: true, last_auto_tier: 'BAILIFF', latest_response_type: 'DISPUTE' };
        expect(escalationLevel(row, NOW)).toBe('sanctioned');
    });
    it('J45, huissier et judiciaire marquent le dossier escaladé', () => {
        for (const tier of ['J45', 'BAILIFF', 'JUDICIAL']) {
            expect(escalationLevel({ ...base, last_auto_tier: tier }, NOW)).toBe('escalated');
        }
    });
    it('un litige passe avant le retard — relancer un dossier contesté est une faute', () => {
        const row = { ...base, latest_response_type: 'DISPUTE', next_due_date: daysAgo(90) };
        expect(escalationLevel(row, NOW)).toBe('disputed');
    });
    it('sépare en retard et en défaut au seuil des 30 jours', () => {
        expect(escalationLevel({ ...base, next_due_date: daysAgo(29) }, NOW)).toBe('late');
        expect(escalationLevel({ ...base, next_due_date: daysAgo(30) }, NOW)).toBe('default');
    });
    it('n’escalade pas sur une échéance passée si plus rien n’est en retard', () => {
        expect(escalationLevel({ ...base, overdue_count: 0, last_auto_tier: null }, NOW)).toBe('clear');
    });
    it('marque KYC un compte non activé qui a des factures ouvertes', () => {
        const row = { ...base, account_state: 'GHOST', overdue_count: 0, next_due_date: null, last_auto_tier: null };
        expect(escalationLevel(row, NOW)).toBe('kyc');
    });
    it('ne marque pas KYC un compte non activé qui ne doit rien', () => {
        const row = { ...base, account_state: 'GHOST', overdue_count: 0, next_due_date: null, last_auto_tier: null, open_count: 0 };
        expect(escalationLevel(row, NOW)).toBe('clear');
    });
});

describe('matchesTab', () => {
    it('« Tous » ne filtre rien', () => {
        expect(matchesTab('clear', 'all')).toBe(true);
    });
    it('« En défaut » réunit sanctionnés, escaladés, en défaut et en retard', () => {
        expect(matchesTab('late', 'defaulting')).toBe(true);
        expect(matchesTab('escalated', 'defaulting')).toBe(true);
        expect(matchesTab('disputed', 'defaulting')).toBe(false);
        expect(matchesTab('clear', 'defaulting')).toBe(false);
    });
});

describe('sortByDebtAge', () => {
    it('classe par gravité, puis par ancienneté, puis par encours', () => {
        const rows: ArmateurCockpitRow[] = [
            { ...base, id: 'late', next_due_date: daysAgo(4), last_auto_tier: 'J3' },
            { ...base, id: 'escalated', next_due_date: daysAgo(62), last_auto_tier: 'J45' },
            { ...base, id: 'clear', overdue_count: 0, next_due_date: null, last_auto_tier: null },
            { ...base, id: 'default', next_due_date: daysAgo(44), last_auto_tier: 'J30' },
        ];
        expect(sortByDebtAge(rows, NOW).map((r) => r.id)).toEqual(['escalated', 'default', 'late', 'clear']);
    });
    it('ne mute pas le tableau reçu', () => {
        const rows = [{ ...base, id: 'a' }, { ...base, id: 'b', next_due_date: daysAgo(99) }];
        sortByDebtAge(rows, NOW);
        expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    });
});

describe('cockpitTotals', () => {
    const rows: ArmateurCockpitRow[] = [
        { ...base, id: 'a', next_due_date: daysAgo(40), total_outstanding_usd: 100, total_paid_usd: 300, total_invoiced_usd: 400, open_count: 2 },
        { ...base, id: 'b', next_due_date: daysAgo(10), total_outstanding_usd: 50, total_paid_usd: 50, total_invoiced_usd: 100, open_count: 1 },
        { ...base, id: 'c', next_due_date: null, total_outstanding_usd: 0, total_paid_usd: 0, total_invoiced_usd: 0, open_count: 0 },
    ];

    it('n’attribue à « > 30 j » que les dossiers qui ont franchi le seuil', () => {
        const t = cockpitTotals(rows, NOW);
        expect(t.agedOutstandingUsd).toBe(100);
        expect(t.agedOwners).toBe(1);
    });
    it('somme l’encours et les factures ouvertes sur toute la sélection', () => {
        const t = cockpitTotals(rows, NOW);
        expect(t.outstandingUsd).toBe(150);
        expect(t.openInvoices).toBe(3);
    });
    it('ne moyenne l’ancienneté que sur les dossiers échus', () => {
        expect(cockpitTotals(rows, NOW).averageAgeDays).toBe(25);
    });
    it('rend null plutôt que NaN quand rien n’est échu ou facturé', () => {
        const t = cockpitTotals([rows[2]], NOW);
        expect(t.averageAgeDays).toBeNull();
        expect(t.recoveryRate).toBeNull();
    });
    it('calcule le taux de recouvrement sur encaissé / facturé', () => {
        expect(cockpitTotals(rows, NOW).recoveryRate).toBeCloseTo(70);
    });
});
