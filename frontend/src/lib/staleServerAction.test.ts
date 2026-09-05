import { describe, it, expect, vi, afterEach } from 'vitest';
import { isStaleServerActionError, reloadIfStaleServerAction } from './staleServerAction';

describe('isStaleServerActionError', () => {
    it('reconnaît le message de Next après un déploiement', () => {
        // Message observé en prod le 2026-09-05, onglet ouvert avant la mise en ligne.
        const e = new Error(
            'Server Action "403bc13ac7ce03696479eb44b3f4dfe20986fea774" was not found on the server. Read more: https://nextjs.org/docs/messages/failed-to-find-server-action',
        );
        expect(isStaleServerActionError(e)).toBe(true);
    });

    it('reconnaît la variante courte', () => {
        expect(isStaleServerActionError(new Error('Failed to find Server Action "abc"'))).toBe(true);
    });

    it('laisse passer les vraies erreurs métier', () => {
        expect(isStaleServerActionError(new Error('Invoice not found'))).toBe(false);
        expect(isStaleServerActionError(null)).toBe(false);
        expect(isStaleServerActionError({ message: 'x' })).toBe(false);
    });
});

describe('reloadIfStaleServerAction', () => {
    const original = window.location;

    afterEach(() => {
        Object.defineProperty(window, 'location', { value: original, configurable: true });
    });

    it('recharge la page sur une action périmée et le dit', () => {
        const reload = vi.fn();
        Object.defineProperty(window, 'location', { value: { ...original, reload }, configurable: true });
        expect(reloadIfStaleServerAction(new Error('Failed to find Server Action "abc"'))).toBe(true);
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('ne touche à rien sur une erreur ordinaire', () => {
        const reload = vi.fn();
        Object.defineProperty(window, 'location', { value: { ...original, reload }, configurable: true });
        expect(reloadIfStaleServerAction(new Error('Invoice not found'))).toBe(false);
        expect(reload).not.toHaveBeenCalled();
    });
});
