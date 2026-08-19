import { describe, it, expect } from 'vitest';
import { maskEmailHint } from './maskEmail';

describe('maskEmailHint', () => {
    it("conserve la première lettre de chaque partie et le TLD", () => {
        expect(maskEmailHint('contact@hornshipping.com')).toBe('c••••t@h••••g.com');
    });

    it("ne restitue jamais le domaine en clair", () => {
        const masked = maskEmailHint('operations@uniseas-shipping.com');
        expect(masked).not.toContain('uniseas');
        expect(masked).not.toContain('operations');
        expect(masked.endsWith('.com')).toBe(true);
    });

    it("gère un sous-domaine sans fuir les niveaux intermédiaires", () => {
        const masked = maskEmailHint('ops@mail.hornshipping.co.uk');
        expect(masked).not.toContain('hornshipping');
        expect(masked).not.toContain('mail');
    });

    it("gère les parties très courtes sans planter ni tout révéler", () => {
        expect(maskEmailHint('a@b.com')).toBe('a@b.com');
        expect(maskEmailHint('ab@cd.com')).toBe('ab@cd.com');
    });

    it("retourne une chaîne neutre pour une entrée qui n'est pas une adresse", () => {
        expect(maskEmailHint('pas-une-adresse')).toBe('•••');
        expect(maskEmailHint('')).toBe('•••');
    });
});
