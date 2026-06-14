import { describe, it, expect, vi } from 'vitest';
import { normalizeActiveMode, ACTIVE_MODE_COOKIE } from './activeMode';

describe('normalizeActiveMode', () => {
    it('accepts MARITIME / AIR / BOTH', () => {
        expect(normalizeActiveMode('MARITIME')).toBe('MARITIME');
        expect(normalizeActiveMode('AIR')).toBe('AIR');
        expect(normalizeActiveMode('BOTH')).toBe('BOTH');
    });

    it('defaults unknown/empty to BOTH', () => {
        expect(normalizeActiveMode(undefined)).toBe('BOTH');
        expect(normalizeActiveMode('xxx')).toBe('BOTH');
        expect(normalizeActiveMode(null)).toBe('BOTH');
        expect(normalizeActiveMode('')).toBe('BOTH');
    });

    it('exposes the cookie name', () => {
        expect(ACTIVE_MODE_COOKIE).toBe('gg-active-mode');
    });
});

describe('modeFilter', () => {
    it('returns null when mode is BOTH', async () => {
        const { modeFilter } = await import('./activeMode');
        expect(modeFilter('BOTH')).toBeNull();
    });

    it('returns the transport mode when not BOTH', async () => {
        const { modeFilter } = await import('./activeMode');
        expect(modeFilter('MARITIME')).toBe('MARITIME');
        expect(modeFilter('AIR')).toBe('AIR');
    });
});
