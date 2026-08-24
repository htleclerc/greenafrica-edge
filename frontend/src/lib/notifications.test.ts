import { describe, it, expect } from 'vitest';
import {
    typeForOwnerKind, ownerRowToNotification, sortNotifications,
    type AppNotification, type OwnerNotificationRow,
} from './notifications';

const row: OwnerNotificationRow = {
    id: 'n1',
    kind: 'PAYMENT_RECEIVED',
    title_key: 'OwnerPortal.notifications.kind.PAYMENT_RECEIVED.title',
    body_key: 'OwnerPortal.notifications.kind.PAYMENT_RECEIVED.body',
    body_params: { amount_usd: 48_200, invoice_ref: 'GG-2026-0418' },
    deep_link: '/dashboard/invoices',
    read_at: null,
    created_at: '2026-08-22T09:00:00Z',
};

describe('typeForOwnerKind', () => {
    it('range les mouvements d’argent sous « paiement »', () => {
        for (const kind of [
            'PROFORMA_ISSUED', 'PROFORMA_REMINDER', 'PAYMENT_RECEIVED', 'PAYMENT_REJECTED',
            'WALLET_TOPPED_UP', 'WALLET_LOW_BALANCE', 'FINAL_ISSUED', 'COMPLEMENT_ISSUED',
            'REFUND_ISSUED', 'STATEMENT_READY',
        ]) {
            expect(typeForOwnerKind(kind)).toBe('payment');
        }
    });
    it('range le KYC sous « inscription »', () => {
        expect(typeForOwnerKind('KYC_APPROVED')).toBe('registration');
        expect(typeForOwnerKind('KYC_C_REQUIRED')).toBe('registration');
    });
    it('range litige et escalade sous « conformité »', () => {
        expect(typeForOwnerKind('DISPUTE_UPDATED')).toBe('compliance');
        expect(typeForOwnerKind('OWNER_ESCALATION')).toBe('compliance');
    });
    it('range la détection de navire sous « alerte navire »', () => {
        expect(typeForOwnerKind('ALERT_DETECTED')).toBe('vessel_alert');
    });
    // La base peut gagner un type avant que l'interface ne le connaisse.
    it('retombe sur « système » pour un type inconnu, sans échouer', () => {
        expect(typeForOwnerKind('QUELQUE_CHOSE_DE_NEUF')).toBe('system');
    });
});

describe('ownerRowToNotification', () => {
    it('garde la clé i18n pleinement qualifiée telle quelle', () => {
        const n = ownerRowToNotification(row);
        expect(n.titleKey).toBe('OwnerPortal.notifications.kind.PAYMENT_RECEIVED.title');
        expect(n.messageKey).toBe('OwnerPortal.notifications.kind.PAYMENT_RECEIVED.body');
    });
    it('déduit le lu de read_at, pas d’un drapeau local', () => {
        expect(ownerRowToNotification(row).read).toBe(false);
        expect(ownerRowToNotification({ ...row, read_at: '2026-08-22T10:00:00Z' }).read).toBe(true);
    });
    it('reprend le lien profond comme cible de la ligne', () => {
        expect(ownerRowToNotification(row).href).toBe('/dashboard/invoices');
        expect(ownerRowToNotification({ ...row, deep_link: null }).href).toBeUndefined();
    });
    it('laisse passer chaînes et nombres pour l’interpolation', () => {
        expect(ownerRowToNotification(row).messageParams).toEqual({
            amount_usd: 48_200, invoice_ref: 'GG-2026-0418',
        });
    });
    it('convertit ce qui n’est ni chaîne ni nombre', () => {
        const messy = { ...row, body_params: { flag: true, nested: { a: 1 } } };
        expect(ownerRowToNotification(messy).messageParams).toEqual({
            flag: 'true', nested: '[object Object]',
        });
    });

    /**
     * Écarter la clé faisait échouer le formatage entier : next-intl refuse une
     * phrase dont un paramètre manque, la barre affichait la clé brute et
     * journalisait une FORMATTING_ERROR à chaque rendu. Vu en vrai sur des
     * relances émises pour des transactions sans référence de pro-forma.
     */
    it('remplace une valeur nulle par un tiret plutôt que de retirer la clé', () => {
        const partial = {
            ...row,
            body_params: { invoice_ref: null, amount_usd: 5040, age_days: 64 },
        };
        expect(ownerRowToNotification(partial).messageParams).toEqual({
            invoice_ref: '—', amount_usd: 5040, age_days: 64,
        });
    });
    it('supporte un body_params absent', () => {
        const bare = { ...row, body_params: undefined as unknown as Record<string, unknown> };
        expect(ownerRowToNotification(bare).messageParams).toEqual({});
    });
});

describe('sortNotifications', () => {
    const make = (id: string, read: boolean, iso: string): AppNotification => ({
        id, type: 'system', titleKey: 't', messageKey: 'm', createdAt: iso, read,
    });

    it('met les non lues devant, quelle que soit leur date', () => {
        const sorted = sortNotifications([
            make('read-recent', true, '2026-08-22T12:00:00Z'),
            make('unread-old', false, '2026-08-01T12:00:00Z'),
        ]);
        expect(sorted.map((n) => n.id)).toEqual(['unread-old', 'read-recent']);
    });
    it('classe les plus récentes en premier à égalité de lu', () => {
        const sorted = sortNotifications([
            make('older', false, '2026-08-01T12:00:00Z'),
            make('newer', false, '2026-08-22T12:00:00Z'),
        ]);
        expect(sorted.map((n) => n.id)).toEqual(['newer', 'older']);
    });
    it('ne mute pas la liste reçue', () => {
        const items = [make('a', true, '2026-08-01T12:00:00Z'), make('b', false, '2026-08-02T12:00:00Z')];
        sortNotifications(items);
        expect(items.map((n) => n.id)).toEqual(['a', 'b']);
    });
});
