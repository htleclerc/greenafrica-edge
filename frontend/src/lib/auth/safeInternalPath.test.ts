import { describe, it, expect } from 'vitest';
import { safeInternalPath } from './safeInternalPath';

describe('safeInternalPath', () => {
    it('accepts a simple internal path', () => {
        expect(safeInternalPath('/dashboard')).toBe('/dashboard');
    });

    it('accepts a nested internal path', () => {
        expect(safeInternalPath('/owner/invoices')).toBe('/owner/invoices');
    });

    it('rejects a protocol-relative URL (open-redirect)', () => {
        expect(safeInternalPath('//evil.com')).toBeNull();
    });

    it('rejects a backslash-prefixed path (open-redirect)', () => {
        expect(safeInternalPath('/\\evil')).toBeNull();
    });

    it('rejects an absolute URL', () => {
        expect(safeInternalPath('https://x')).toBeNull();
    });

    it('rejects null', () => {
        expect(safeInternalPath(null)).toBeNull();
    });

    it('rejects an empty string', () => {
        expect(safeInternalPath('')).toBeNull();
    });

    it('rejects a relative path without leading slash', () => {
        expect(safeInternalPath('relative')).toBeNull();
    });
});
