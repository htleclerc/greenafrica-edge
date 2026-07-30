import { describe, it, expect } from 'vitest';
import en from '../../../messages/en.json';
import ar from '../../../messages/ar.json';
import fr from '../../../messages/fr.json';
import pt from '../../../messages/pt.json';
import so from '../../../messages/so.json';
import sw from '../../../messages/sw.json';

type Messages = Record<string, Record<string, string>>;

const EN = en as unknown as Messages;

describe('LegalBasis message catalog — English reference', () => {
    it('defines the LegalBasis namespace', () => {
        expect(EN.LegalBasis).toBeDefined();
    });

    it('defines the document header keys', () => {
        for (const key of ['title', 'subtitle', 'version', 'effective_date', 'last_updated']) {
            expect(EN.LegalBasis[key], `LegalBasis.${key}`).toBeTruthy();
        }
    });

    it('defines a title for each of the seven sections', () => {
        for (let i = 1; i <= 7; i++) {
            const key = `section_0${i}_title`;
            expect(EN.LegalBasis[key], `LegalBasis.${key}`).toBeTruthy();
        }
    });

    it('defines the shell integration keys', () => {
        expect(EN.Legal.badge_legal_basis).toBeTruthy();
        expect(EN.Legal.footer_legal_basis).toBeTruthy();
        expect(EN.Footer.legal_basis).toBeTruthy();
    });

    it('has no empty or whitespace-only value', () => {
        for (const [key, value] of Object.entries(EN.LegalBasis)) {
            expect(typeof value, `LegalBasis.${key} must be a string`).toBe('string');
            expect(value.trim(), `LegalBasis.${key} must not be blank`).not.toBe('');
        }
    });
});

const TRANSLATIONS: ReadonlyArray<readonly [string, Messages]> = [
    ['ar', ar as unknown as Messages],
    ['fr', fr as unknown as Messages],
    ['pt', pt as unknown as Messages],
    ['so', so as unknown as Messages],
    ['sw', sw as unknown as Messages],
];

describe.each(TRANSLATIONS)('LegalBasis message catalog — %s', (locale, messages) => {
    it('has exactly the English key set', () => {
        expect(Object.keys(messages.LegalBasis ?? {}).sort()).toEqual(Object.keys(EN.LegalBasis).sort());
    });

    it('has no empty or whitespace-only value', () => {
        for (const [key, value] of Object.entries(messages.LegalBasis ?? {})) {
            expect(typeof value, `${locale} LegalBasis.${key} must be a string`).toBe('string');
            expect(value.trim(), `${locale} LegalBasis.${key} must not be blank`).not.toBe('');
        }
    });

    it('defines the shell integration keys', () => {
        expect(messages.Legal.badge_legal_basis, `${locale} Legal.badge_legal_basis`).toBeTruthy();
        expect(messages.Legal.footer_legal_basis, `${locale} Legal.footer_legal_basis`).toBeTruthy();
        expect(messages.Footer.legal_basis, `${locale} Footer.legal_basis`).toBeTruthy();
    });
});
