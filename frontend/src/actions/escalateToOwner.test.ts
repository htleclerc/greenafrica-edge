import { describe, it, expect } from 'vitest';
import { escalateToOwner } from './escalateToOwner';

describe('escalateToOwner', () => {
    it('rejects invalid transaction id', async () => {
        const result = await escalateToOwner({
            transactionId: 'not-a-uuid',
            ownerEmail: 'x@y.z',
        });
        expect(result.ok).toBe(false);
    });

    it('rejects invalid email', async () => {
        const result = await escalateToOwner({
            transactionId: '00000000-0000-0000-0000-000000000000',
            ownerEmail: 'not-an-email',
        });
        expect(result.ok).toBe(false);
    });

    // Deep integration test (DB + Resend + Storage + Auth) lives in the e2e
    // suite; unit test covers only the Zod validation edge.
});
