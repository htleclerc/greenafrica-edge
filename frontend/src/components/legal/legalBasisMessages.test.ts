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

// Figure-bearing LegalBasis keys — the legally load-bearing numeric content of the
// page (worked-example rows, carbon rate, penalty amounts, RFI multiplier, dispute
// deadlines, escalation timeline). A translation edit that mangles a digit here
// (e.g. 725 -> 275) or drops a figure must fail loudly.
const FIGURE_KEYS = [
    's03_b4_row1_value',
    's03_b4_row2_value',
    's03_b4_row3_value',
    's03_b4_row4_value',
    's03_b4_row5_value',
    's03_b4_row6_value',
    's03_b4_row7_value',
    's03_b4_row8_value',
    's03_b4_row9_value',
    's03_b4_row10_value',
    's04_c4_row3_value',
    's04_c4_row4_value',
    's04_c4_row5_value',
    's04_c4_row6_value',
    's04_c4_row7_value',
    's04_c4_row8_value',
    's04_c4_row9_value',
    's03_b4_caption',
    's04_c4_caption',
    's01_row_rate_value',
    's02_a1_art_4',
    's02_a1_art_6',
    's03_b1_p2',
    's04_c3_p2',
    's06_e1_p1',
    's06_e3_j15',
    's06_e3_j30',
    's06_e3_j45',
    's06_e3_j90',
] as const;

type FigureKey = (typeof FIGURE_KEYS)[number];

/**
 * Normalises a message value to the ordered sequence of digit-groups it contains,
 * ignoring how those groups are punctuated (thousands separators, decimal marks,
 * spacing) — locales legitimately render "4,500" / "4 500" or "14.4" / "14,4"
 * differently, but the underlying digits and their order must be identical.
 *
 * "CO2" is stripped first: the "2" in that chemical formula is not a figure, and
 * some locales (e.g. Arabic spells it out as "ثاني أكسيد الكربون" with no digit,
 * Swahili places the "tCO2"/"tCO2e" unit before its value instead of after) would
 * otherwise make a correct translation look like a mismatched digit sequence.
 */
function digitGroups(value: string): string[] {
    return value.replace(/CO2/gi, '').match(/\d+/g) ?? [];
}

describe.each(TRANSLATIONS)('LegalBasis figures — %s', (locale, messages) => {
    it.each(FIGURE_KEYS)('LegalBasis.%s matches the English digit sequence', (key: FigureKey) => {
        const enValue = EN.LegalBasis[key];
        const localeValue = messages.LegalBasis?.[key];

        expect(enValue, `LegalBasis.${key} missing from English source`).toBeTruthy();
        expect(localeValue, `${locale} LegalBasis.${key} is missing`).toBeTruthy();
        expect(digitGroups(localeValue), `${locale} LegalBasis.${key} digit sequence must match English`).toEqual(
            digitGroups(enValue),
        );
    });
});
