import { describe, it, expect, vi } from 'vitest';
import { claimArrivalAlert } from './claimArrivalAlert';

// Mock Supabase SSR client
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(),
}));

describe('claimArrivalAlert', () => {
    it('validates owner email is present', async () => {
        const result = await claimArrivalAlert({ alertId: 'x', ownerEmail: '' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toMatch(/email|invalid/i);
        }
    });

    // Deeper integration tests live in arrivalAlertService.test.ts
    // (claim logic is exercised there with a real DB).
});
