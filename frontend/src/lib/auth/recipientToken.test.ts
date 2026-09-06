import { describe, it, expect, beforeEach } from 'vitest';
import { matchRecipientToken, signRecipientToken } from './recipientToken';

const RECIPIENTS = [
    { email: 'contact@horn.example', kind: 'OWNER' as const },
    { email: 'compta@horn.example', kind: 'MEMBER' as const },
];
const T0 = Date.UTC(2026, 8, 6, 10, 30);
const HOUR = 60 * 60 * 1000;

beforeEach(() => {
    process.env.LOGIN_RECIPIENT_SECRET = 'test-recipient-secret';
});

describe('recipientToken', () => {
    it('retrouve la boîte désignée, sans transporter l’adresse', () => {
        const token = signRecipientToken('own-1', 'compta@horn.example', T0);
        expect(token).toMatch(/^[0-9a-f]{32}$/);
        expect(token).not.toContain('@');
        expect(matchRecipientToken(token, 'own-1', RECIPIENTS, T0)).toEqual(RECIPIENTS[1]);
    });

    it('admet la fenêtre précédente, pas une plus ancienne', () => {
        const token = signRecipientToken('own-1', 'compta@horn.example', T0);
        expect(matchRecipientToken(token, 'own-1', RECIPIENTS, T0 + HOUR)).toEqual(RECIPIENTS[1]);
        expect(matchRecipientToken(token, 'own-1', RECIPIENTS, T0 + 2 * HOUR)).toBeNull();
    });

    it('ne vaut que pour son compte et ses boîtes admises', () => {
        const token = signRecipientToken('own-1', 'compta@horn.example', T0);
        expect(matchRecipientToken(token, 'own-2', RECIPIENTS, T0)).toBeNull();
        expect(matchRecipientToken(token, 'own-1', [RECIPIENTS[0]], T0)).toBeNull();
    });

    it('rejette une forme étrangère sans comparer', () => {
        expect(matchRecipientToken('compta@horn.example', 'own-1', RECIPIENTS, T0)).toBeNull();
        expect(matchRecipientToken('', 'own-1', RECIPIENTS, T0)).toBeNull();
        expect(matchRecipientToken('zz'.repeat(16), 'own-1', RECIPIENTS, T0)).toBeNull();
    });

    it('est insensible à la casse de l’adresse', () => {
        const token = signRecipientToken('own-1', 'COMPTA@horn.example', T0);
        expect(matchRecipientToken(token, 'own-1', RECIPIENTS, T0)).toEqual(RECIPIENTS[1]);
    });
});
