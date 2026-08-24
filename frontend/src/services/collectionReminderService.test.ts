import { describe, it, expect } from 'vitest';
import { tierForAge, dueTier, reminderTemplate, AUTO_TIERS } from './collectionReminderService';

describe('tierForAge', () => {
    it.each([
        [0, null], [2, null],
        [3, 'J3'], [6, 'J3'],
        [7, 'J7'], [14, 'J7'],
        [15, 'J15'], [29, 'J15'],
        [30, 'J30'], [44, 'J30'],
        [45, 'J45'], [90, 'J45'],
    ])('âge %i jours → palier %s', (age, expected) => {
        expect(tierForAge(age)).toBe(expected);
    });
});

describe('dueTier', () => {
    const base = {
        status: 'PENDING',
        ageDays: 15,
        sentTiers: [] as ReturnType<typeof AUTO_TIERS.slice>,
        latestResponse: null,
        latestResponseAt: null,
        now: new Date('2026-07-28T00:00:00Z'),
    };

    it('renvoie le palier attendu quand rien n\'a encore été envoyé', () => {
        expect(dueTier({ ...base, ageDays: 15 })).toBe('J15');
    });

    it('ne renvoie rien quand le palier de cet âge a déjà été envoyé', () => {
        expect(dueTier({ ...base, ageDays: 15, sentTiers: ['J3', 'J7', 'J15'] })).toBeNull();
    });

    it('renvoie le palier le plus récent atteint, pas un déjà envoyé', () => {
        // âge 30 → J30 attendu ; J3/J7/J15 déjà faits, J30 non.
        expect(dueTier({ ...base, ageDays: 30, sentTiers: ['J3', 'J7', 'J15'] })).toBe('J30');
    });

    it('arrête l\'escalade sur un statut qui ne doit plus rien', () => {
        for (const status of ['PAID', 'EXEMPT', 'VOID', 'WAIVED', 'CANCELLED']) {
            expect(dueTier({ ...base, status, ageDays: 45 })).toBeNull();
        }
    });

    it('escalade sur OVERDUE comme sur PENDING', () => {
        expect(dueTier({ ...base, status: 'OVERDUE', ageDays: 45 })).toBe('J45');
    });

    it('poursuit une créance réglée en partie', () => {
        // PARTIALLY_PAID était exclu : verser un acompte suffisait à sortir
        // définitivement du recouvrement, la rampe s'arrêtant au premier
        // centime reçu. En production, trois dossiers y échappaient pour
        // 52 717,99 USD de reste dû.
        expect(dueTier({ ...base, status: 'PARTIALLY_PAID', ageDays: 45 })).toBe('J45');
    });

    it('met en pause sur une contestation (réponse DISPUTE)', () => {
        expect(dueTier({ ...base, ageDays: 45, latestResponse: 'DISPUTE' })).toBeNull();
    });

    it('met en pause sur un statut DISPUTED', () => {
        expect(dueTier({ ...base, status: 'DISPUTED', ageDays: 45 })).toBeNull();
    });

    it('respecte la grâce de 7 jours après une promesse de paiement', () => {
        const promiseAt = new Date('2026-07-25T00:00:00Z'); // 3 j avant now
        expect(dueTier({ ...base, ageDays: 45, latestResponse: 'PAYMENT_PROMISE', latestResponseAt: promiseAt })).toBeNull();
    });

    it('reprend l\'escalade une fois la grâce de 7 jours expirée', () => {
        const promiseAt = new Date('2026-07-20T00:00:00Z'); // 8 j avant now
        expect(dueTier({ ...base, ageDays: 45, latestResponse: 'PAYMENT_PROMISE', latestResponseAt: promiseAt })).toBe('J45');
    });

    it('continue l\'escalade sur SILENT ou ACKNOWLEDGE', () => {
        expect(dueTier({ ...base, ageDays: 45, latestResponse: 'SILENT' })).toBe('J45');
        expect(dueTier({ ...base, ageDays: 45, latestResponse: 'ACKNOWLEDGE' })).toBe('J45');
    });

    it('ne renvoie rien sous J+3', () => {
        expect(dueTier({ ...base, ageDays: 1 })).toBeNull();
    });

    it("une relance MANUAL ne consomme aucun palier de la rampe", () => {
        // Le cron filtre sentTiers sur une liste blanche : MANUAL en est écarté
        // d'office. Ce test verrouille cette immunité.
        expect(dueTier({
            status: 'OVERDUE', ageDays: 20,
            sentTiers: ['J3', 'J7'],       // MANUAL n'entre jamais dans ce tableau
            latestResponse: null, latestResponseAt: null, now: new Date(),
        })).toBe('J15');
    });
});

describe('reminderTemplate', () => {
    it('associe chaque palier à un ton', () => {
        expect(reminderTemplate('J3').tone).toBe('courtesy');
        expect(reminderTemplate('J7').tone).toBe('courtesy');
        expect(reminderTemplate('J15').tone).toBe('amicable');
        expect(reminderTemplate('J30').tone).toBe('formal');
        expect(reminderTemplate('J45').tone).toBe('pre-bailiff');
    });
});
