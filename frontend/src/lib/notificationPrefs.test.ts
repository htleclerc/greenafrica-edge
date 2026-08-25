import { describe, it, expect } from 'vitest';
import {
    allowsEmail,
    parseNotificationPrefs,
    NOTIFICATION_PREF_KEYS,
    DEFAULT_NOTIFICATION_PREFS,
} from './notificationPrefs';

describe('parseNotificationPrefs — ce que la colonne JSONB peut contenir', () => {
    it('rend les défauts sur une valeur absente ou aberrante', () => {
        for (const raw of [null, undefined, 'oui', 42, []]) {
            expect(parseNotificationPrefs(raw)).toEqual(DEFAULT_NOTIFICATION_PREFS);
        }
    });

    it('ne retient qu’un booléen — une valeur douteuse retombe sur le défaut', () => {
        // Et le défaut est ACTIF : une conversion en booléen aurait fait taire
        // un envoi sur la foi d'une valeur mal écrite.
        const prefs = parseNotificationPrefs({ vessel_alert: 'non', payment_due: false });
        expect(prefs.vessel_alert).toBe(true);
        expect(prefs.payment_due).toBe(false);
    });

    it('ignore les clés qu’elle ne connaît pas', () => {
        const prefs = parseNotificationPrefs({ sms_critical: false, vessel_alert: false });
        expect(prefs).toEqual({ ...DEFAULT_NOTIFICATION_PREFS, vessel_alert: false });
        expect('sms_critical' in prefs).toBe(false);
    });
});

/**
 * L'invariant qui compte : une préférence gouverne l'information, jamais
 * l'argent ni la sécurité. Se taire sur un paiement refusé ou sur un accès
 * ouvert au compte parce qu'une case a été décochée serait une faute.
 */
describe('allowsEmail — ce qu’une case ne peut pas éteindre', () => {
    const TOUT_COUPE = Object.fromEntries(NOTIFICATION_PREF_KEYS.map((k) => [k, false]));

    it('laisse passer les faits d’argent même tout décoché', () => {
        for (const kind of ['PAYMENT_RECEIVED', 'PAYMENT_REJECTED', 'REFUND_ISSUED'] as const) {
            expect(allowsEmail(kind, TOUT_COUPE)).toBe(true);
        }
    });

    it('laisse passer les faits de sécurité même tout décoché', () => {
        for (const kind of ['MEMBER_INVITED', 'MEMBER_REVOKED', 'KYC_REJECTED'] as const) {
            expect(allowsEmail(kind, TOUT_COUPE)).toBe(true);
        }
    });

    it('coupe bien ce qui est gouverné', () => {
        expect(allowsEmail('ALERT_DETECTED', { vessel_alert: false })).toBe(false);
        expect(allowsEmail('PROFORMA_REMINDER', { payment_due: false })).toBe(false);
        expect(allowsEmail('STATEMENT_READY', { monthly_statement: false })).toBe(false);
    });

    it('une bascule gouverne tous les faits de sa famille', () => {
        const off = { payment_due: false };
        for (const kind of ['PROFORMA_ISSUED', 'PROFORMA_REMINDER', 'OWNER_ESCALATION'] as const) {
            expect(allowsEmail(kind, off)).toBe(false);
        }
    });

    it('laisse tout passer quand rien n’a été choisi', () => {
        for (const kind of ['ALERT_DETECTED', 'PROFORMA_REMINDER', 'STATEMENT_READY'] as const) {
            expect(allowsEmail(kind, null)).toBe(true);
        }
    });
});
