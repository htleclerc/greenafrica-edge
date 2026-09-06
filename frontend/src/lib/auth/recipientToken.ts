import { createHmac, timingSafeEqual } from 'crypto';
import type { LoginRecipient } from '@/services/auth/loginRecipients';

/**
 * Jeton opaque qui désigne UNE boîte parmi celles proposées après la saisie
 * d'un IMO, sans jamais transporter l'adresse.
 *
 *   token = HMAC-SHA256(secret, shipownerId · email · fenêtre horaire)[0..32]
 *
 * — il ne se devine pas : l'adresse et le compte sont sous HMAC ;
 * — il ne se rejoue pas : la fenêtre change chaque heure (la précédente reste
 *   admise, pour un choix fait à 10h59 et envoyé à 11h00) ;
 * — il ne s'énumère pas : le serveur ne compare qu'aux boîtes RÉELLEMENT
 *   admises pour ce compte, recalculées à chaque appel.
 */
const WINDOW_MS = 60 * 60 * 1000;

/**
 * Secret dédié, sinon celui de la signature des factures : tous deux sont
 * déjà posés en production et ne quittent jamais le serveur.
 */
function secret(): string {
    const s = process.env.LOGIN_RECIPIENT_SECRET ?? process.env.INVOICE_SIGNING_SECRET;
    if (!s) throw new Error('recipientToken: LOGIN_RECIPIENT_SECRET ou INVOICE_SIGNING_SECRET requis');
    return s;
}

function windowIndex(now: number): number {
    return Math.floor(now / WINDOW_MS);
}

function sign(shipownerId: string, email: string, win: number): string {
    return createHmac('sha256', secret())
        .update(`${shipownerId}${email.toLowerCase()}${win}`)
        .digest('hex')
        .slice(0, 32);
}

export function signRecipientToken(shipownerId: string, email: string, now: number = Date.now()): string {
    return sign(shipownerId, email, windowIndex(now));
}

/**
 * Retrouve la boîte désignée par un jeton, ou `null`. Comparaison en temps
 * constant, sur la fenêtre courante et la précédente.
 */
export function matchRecipientToken(
    token: string,
    shipownerId: string,
    recipients: LoginRecipient[],
    now: number = Date.now(),
): LoginRecipient | null {
    if (!/^[0-9a-f]{32}$/.test(token)) return null;
    const given = Buffer.from(token, 'hex');
    const win = windowIndex(now);
    for (const r of recipients) {
        for (const w of [win, win - 1]) {
            const expected = Buffer.from(sign(shipownerId, r.email, w), 'hex');
            if (expected.length === given.length && timingSafeEqual(expected, given)) return r;
        }
    }
    return null;
}
