import { describe, it, expect } from 'vitest';
import { sendErrorKey, verifyErrorKey, type SendFailureReason, type VerifyFailureReason } from './claimErrorKeys';

/**
 * Ces deux fonctions existent pour éviter qu'un armateur throttlé ou dont
 * l'activation a échoué ne soit renvoyé vers « code incorrect ». L'exhaustivité
 * du typage (switch sans `default`) garantit que chaque raison est TRAITÉE,
 * pas qu'elle est mappée vers la BONNE clé — une erreur de copie compilerait
 * sans broncher. Ce test asserte donc la table de correspondance complète,
 * raison par raison, plutôt que de se contenter de « ça ne plante pas ».
 */
describe('sendErrorKey', () => {
    const table: Array<[SendFailureReason, string]> = [
        ['invalid_identifier', 'claim_error_invalid_identifier'],
        ['not_claimable', 'claim_error_not_claimable'],
        ['rate_limited', 'claim_error_rate_limited'],
        ['send_failed', 'claim_error_send_failed'],
    ];

    it.each(table)('mappe %s vers %s', (reason, expectedKey) => {
        expect(sendErrorKey(reason)).toBe(expectedKey);
    });
});

describe('verifyErrorKey', () => {
    const table: Array<[VerifyFailureReason, string]> = [
        ['invalid_code', 'claim_error_invalid_code'],
        ['invalid_identifier', 'claim_error_invalid_identifier'],
        ['not_claimable', 'claim_error_not_claimable'],
        ['rate_limited', 'claim_error_rate_limited'],
        ['activation_failed', 'claim_error_activation_failed'],
    ];

    it.each(table)('mappe %s vers %s', (reason, expectedKey) => {
        expect(verifyErrorKey(reason)).toBe(expectedKey);
    });
});
