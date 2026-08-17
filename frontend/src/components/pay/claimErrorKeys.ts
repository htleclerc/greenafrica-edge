import type { RequestAccessCodeResult } from '@/actions/requestVesselAccessCode';
import type { VerifyAccessCodeResult } from '@/actions/verifyVesselAccessCode';

export type SendFailureReason = Extract<RequestAccessCodeResult, { ok: false }>['reason'];
export type VerifyFailureReason = Extract<VerifyAccessCodeResult, { ok: false }>['reason'];

// Mappages exhaustifs raison → clé i18n. Écrits en switch sans `default` : si
// une raison est un jour ajoutée côté action, TypeScript refuse de compiler
// tant que ce fichier n'a pas été mis à jour — pas de repli silencieux sur
// « code incorrect » pour une raison en réalité non gérée.
//
// L'exhaustivité du typage garantit que chaque cas est TRAITÉ, pas qu'il est
// traité CORRECTEMENT (une erreur de copie mappant `activation_failed` sur
// `claim_error_invalid_code` compilerait sans broncher) — voir
// `claimErrorKeys.test.ts`, qui asserte la table complète.
export function sendErrorKey(reason: SendFailureReason): string {
    switch (reason) {
        case 'rate_limited':
            return 'claim_error_rate_limited';
        case 'invalid_identifier':
            return 'claim_error_invalid_identifier';
        case 'not_claimable':
            return 'claim_error_not_claimable';
        case 'send_failed':
            return 'claim_error_send_failed';
    }
}

export function verifyErrorKey(reason: VerifyFailureReason): string {
    switch (reason) {
        case 'invalid_code':
            return 'claim_error_invalid_code';
        case 'rate_limited':
            return 'claim_error_rate_limited';
        case 'invalid_identifier':
            return 'claim_error_invalid_identifier';
        case 'not_claimable':
            return 'claim_error_not_claimable';
        case 'activation_failed':
            return 'claim_error_activation_failed';
    }
}
