import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { upsertShipownerEmail, type EmailSource } from './shipownerService';

/** Client minimal : mémorise la source courante et enregistre les mises à jour. */
function fakeDb(currentSource: EmailSource | null) {
    const updates: Array<Record<string, unknown>> = [];
    const db = {
        from: () => ({
            select: () => ({
                eq: () => ({
                    single: async () => ({
                        data: { official_email: 'old@x.com', official_email_source: currentSource },
                        error: null,
                    }),
                }),
            }),
            update: (payload: Record<string, unknown>) => {
                updates.push(payload);
                return { eq: () => ({ select: () => ({ single: async () => ({ data: payload, error: null }) }) }) };
            },
        }),
    } as unknown as SupabaseClient;
    return { db, updates };
}

describe('chaîne de confiance des e-mails', () => {
    it('VESSELFINDER_VERIFIED remplace une revendication d\'agent', async () => {
        const { db, updates } = fakeDb('AGENT_CLAIM');
        await upsertShipownerEmail(db, 'owner-1', 'new@x.com', 'VESSELFINDER_VERIFIED');
        expect(updates).toHaveLength(1);
        expect(updates[0].official_email_source).toBe('VESSELFINDER_VERIFIED');
    });

    it('VESSELFINDER_VERIFIED n\'écrase pas une saisie d\'officier de port', async () => {
        const { db, updates } = fakeDb('PORT_OFFICER');
        await upsertShipownerEmail(db, 'owner-1', 'new@x.com', 'VESSELFINDER_VERIFIED');
        expect(updates).toHaveLength(0);
    });

    it('VESSELFINDER_VERIFIED est au même niveau qu\'EQUASIS_VERIFIED', async () => {
        const { db, updates } = fakeDb('EQUASIS_VERIFIED');
        await upsertShipownerEmail(db, 'owner-1', 'new@x.com', 'VESSELFINDER_VERIFIED');
        expect(updates).toHaveLength(1);
    });
});
