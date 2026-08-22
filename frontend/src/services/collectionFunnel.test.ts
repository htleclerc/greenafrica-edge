import { describe, it, expect } from 'vitest';
import { buildFunnel, stageOf, SETTLED_WINDOW_DAYS, type FunnelStage } from './collectionFunnel';

const NOW = new Date('2026-08-22T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

type ScanRow = Parameters<typeof stageOf>[0];

const base: ScanRow = {
    transaction_id: 't1',
    debtor_name: 'GULF MARITIME LTD',
    invoice_ref: 'GG-2026-0418',
    outstanding_usd: 1000,
    status: 'OVERDUE',
    latest_tier: 'J7',
    latest_sent_at: daysAgo(3),
    latest_response_at: null,
};

const zero: Record<FunnelStage, number> = { reminder: 0, formal: 0, authority: 0, settled: 0 };

describe('stageOf', () => {
    it('regroupe J3 et J7 sous la relance — même geste attendu', () => {
        expect(stageOf({ ...base, latest_tier: 'J3' }, NOW)).toBe('reminder');
        expect(stageOf({ ...base, latest_tier: 'J7' }, NOW)).toBe('reminder');
    });
    it('regroupe J15 et J30 sous la mise en demeure', () => {
        expect(stageOf({ ...base, latest_tier: 'J15' }, NOW)).toBe('formal');
        expect(stageOf({ ...base, latest_tier: 'J30' }, NOW)).toBe('formal');
    });
    it('regroupe J45, huissier et judiciaire sous l’escalade autorité', () => {
        for (const tier of ['J45', 'BAILIFF', 'JUDICIAL']) {
            expect(stageOf({ ...base, latest_tier: tier }, NOW)).toBe('authority');
        }
    });
    it('laisse hors file un dossier sans palier envoyé', () => {
        expect(stageOf({ ...base, latest_tier: null }, NOW)).toBeNull();
    });
    it('ne retient les réglés que dans la fenêtre de la semaine', () => {
        const paid = { ...base, status: 'PAID', latest_response_at: daysAgo(2) };
        expect(stageOf(paid, NOW)).toBe('settled');
        expect(stageOf({ ...paid, latest_response_at: daysAgo(SETTLED_WINDOW_DAYS + 1) }, NOW)).toBeNull();
    });
    it('retombe sur la date d’envoi quand le règlement n’a pas de date de réponse', () => {
        const paid = { ...base, status: 'PAID', latest_response_at: null, latest_sent_at: daysAgo(1) };
        expect(stageOf(paid, NOW)).toBe('settled');
    });
    it('un dossier réglé sort de la rampe même si son palier est une escalade', () => {
        const paid = { ...base, status: 'PAID', latest_tier: 'BAILIFF', latest_response_at: daysAgo(1) };
        expect(stageOf(paid, NOW)).toBe('settled');
    });
});

describe('buildFunnel', () => {
    const rows: ScanRow[] = [
        { ...base, transaction_id: 'a', latest_tier: 'J3', outstanding_usd: 48_200 },
        { ...base, transaction_id: 'b', latest_tier: 'J7', outstanding_usd: 27_300 },
        { ...base, transaction_id: 'c', latest_tier: 'J3', outstanding_usd: 5_000 },
        { ...base, transaction_id: 'd', latest_tier: 'J15', outstanding_usd: 84_400 },
        { ...base, transaction_id: 'e', latest_tier: 'BAILIFF', outstanding_usd: 128_400 },
    ];
    const counts: Record<FunnelStage, number> = { reminder: 5, formal: 4, authority: 3, settled: 9 };

    it('cumule les encours balayés par étape', () => {
        const f = buildFunnel(rows, counts, false, NOW);
        expect(f.columns.reminder.outstandingUsd).toBe(80_500);
        expect(f.columns.authority.outstandingUsd).toBe(128_400);
    });
    it('met en aperçu les deux dossiers les plus lourds de l’étape', () => {
        const f = buildFunnel(rows, counts, false, NOW);
        expect(f.columns.reminder.previews.map((p) => p.transactionId)).toEqual(['a', 'b']);
    });
    it('compte les « +N autres » sur le compte exact, pas sur le lot balayé', () => {
        const f = buildFunnel(rows, counts, false, NOW);
        expect(f.columns.reminder.others).toBe(3);   // 5 au total, 2 en aperçu
        expect(f.columns.authority.others).toBe(2);  // 3 au total, 1 seul balayé et montré
    });
    it('n’annonce pas d’autres dossiers quand l’étape est vide', () => {
        const f = buildFunnel([], zero, false, NOW);
        expect(f.columns.formal.others).toBe(0);
        expect(f.columns.formal.previews).toEqual([]);
    });
    it('ne compte comme à faire avancer que les trois étapes ouvertes', () => {
        expect(buildFunnel(rows, counts, false, NOW).actionable).toBe(12);
    });
    it('désigne comme prioritaire le dossier le plus lourd de l’étape la plus grave', () => {
        expect(buildFunnel(rows, counts, false, NOW).priorityTransactionId).toBe('e');
    });
    it('retombe sur l’étape suivante quand l’escalade est vide', () => {
        const withoutAuthority = rows.filter((r) => r.latest_tier !== 'BAILIFF');
        const f = buildFunnel(withoutAuthority, { ...counts, authority: 0 }, false, NOW);
        expect(f.priorityTransactionId).toBe('d');
    });
    it('ne désigne aucun prioritaire quand tout est réglé', () => {
        expect(buildFunnel([], zero, false, NOW).priorityTransactionId).toBeNull();
    });
    it('propage le drapeau de troncature — un cumul partiel doit se dire', () => {
        expect(buildFunnel(rows, counts, true, NOW).truncated).toBe(true);
    });
});
