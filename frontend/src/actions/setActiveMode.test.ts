import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Cookie mock ────────────────────────────────────────────────────────────────
const cookieSetCalls: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
const mockCookieSet = vi.fn((name: string, value: string, options: Record<string, unknown>) => {
    cookieSetCalls.push({ name, value, options });
});

vi.mock('next/headers', () => ({
    cookies: vi.fn().mockResolvedValue({ set: mockCookieSet }),
}));

async function getSUT() {
    const { setActiveMode } = await import('./setActiveMode');
    return setActiveMode;
}

describe('setActiveMode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        cookieSetCalls.length = 0;
    });

    it('returns ok:true and writes cookie for a valid MARITIME value', async () => {
        const fn = await getSUT();
        const result = await fn({ mode: 'MARITIME' });
        expect(result).toMatchObject({ ok: true });
        expect(mockCookieSet).toHaveBeenCalledOnce();
        const [name, value, options] = mockCookieSet.mock.calls[0];
        expect(name).toBe('gg-active-mode');
        expect(value).toBe('MARITIME');
        expect(options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    });

    it('returns ok:true and writes cookie for AIR', async () => {
        const fn = await getSUT();
        const result = await fn({ mode: 'AIR' });
        expect(result).toMatchObject({ ok: true });
        const [, value] = mockCookieSet.mock.calls[0];
        expect(value).toBe('AIR');
    });

    it('returns ok:true and writes cookie for BOTH', async () => {
        const fn = await getSUT();
        const result = await fn({ mode: 'BOTH' });
        expect(result).toMatchObject({ ok: true });
        const [, value] = mockCookieSet.mock.calls[0];
        expect(value).toBe('BOTH');
    });

    it('returns ok:false and does NOT write cookie for invalid value', async () => {
        const fn = await getSUT();
        const result = await fn({ mode: 'xxx' });
        expect(result).toMatchObject({ ok: false });
        expect(mockCookieSet).not.toHaveBeenCalled();
    });

    it('returns ok:false for empty string', async () => {
        const fn = await getSUT();
        const result = await fn({ mode: '' });
        expect(result).toMatchObject({ ok: false });
        expect(mockCookieSet).not.toHaveBeenCalled();
    });

    it('cookie has maxAge set (long-lived preference)', async () => {
        const fn = await getSUT();
        await fn({ mode: 'MARITIME' });
        const [, , options] = mockCookieSet.mock.calls[0];
        expect(typeof options.maxAge).toBe('number');
        expect((options.maxAge as number)).toBeGreaterThan(0);
    });
});
