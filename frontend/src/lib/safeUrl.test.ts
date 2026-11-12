import { describe, it, expect } from 'vitest';
import { safeHttpUrl } from './safeUrl';

describe('safeHttpUrl', () => {
    it('allows http and https', () => {
        expect(safeHttpUrl('https://ok.example/x')).toBe('https://ok.example/x');
        expect(safeHttpUrl('http://ok.example')).toBe('http://ok.example');
    });
    it('rejects javascript:, data:, vbscript:, and junk', () => {
        expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined();
        expect(safeHttpUrl('data:text/html,<script>x</script>')).toBeUndefined();
        expect(safeHttpUrl('vbscript:x')).toBeUndefined();
        expect(safeHttpUrl('not a url')).toBeUndefined();
        expect(safeHttpUrl('')).toBeUndefined();
    });
});
