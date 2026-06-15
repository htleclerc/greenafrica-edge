import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { writeAuditLog } from './auditService';

// ─────────────────────────────────────────────────────────────────────────────
// Fake supabase client — captures inserts + returns a scriptable error.
// ─────────────────────────────────────────────────────────────────────────────

let insertError: { message: string } | null = null;
const insertCalls: { table: string; payload: Record<string, unknown> }[] = [];

const mockClient = {
    from: (table: string) => ({
        insert: (payload: Record<string, unknown>) => {
            insertCalls.push({ table, payload });
            return Promise.resolve({ data: null, error: insertError });
        },
    }),
} as unknown as SupabaseClient;

describe('writeAuditLog', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        insertError = null;
        insertCalls.length = 0;
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleSpy.mockRestore();
    });

    it('inserts the entry into audit_logs', async () => {
        await writeAuditLog(mockClient, {
            action: 'TRANSACTION_UPDATED',
            severity: 'INFO',
            entity_type: 'Transaction',
            entity_id: 't-1',
        });

        expect(insertCalls).toHaveLength(1);
        expect(insertCalls[0].table).toBe('audit_logs');
        expect(insertCalls[0].payload).toMatchObject({
            action: 'TRANSACTION_UPDATED',
            severity: 'INFO',
        });
    });

    it('emits a structured warn when the insert fails (no more silent failures)', async () => {
        insertError = { message: 'invalid input value for enum audit_action: "PAYMENT_RECEIVED"' };

        await writeAuditLog(mockClient, {
            action: 'PAYMENT_RECEIVED',
            entity_type: 'Transaction',
            entity_id: 't-1',
        });

        const calls = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0]));
        const warnLine = calls.find((c: string) => c.includes('audit_log_insert_failed'));
        expect(warnLine).toBeDefined();
        const parsed = JSON.parse(warnLine!);
        expect(parsed.level).toBe('warn');
        expect(parsed.scope).toBe('auditService');
        expect(parsed.action).toBe('PAYMENT_RECEIVED');
        expect(parsed.entity_id).toBe('t-1');
        expect(parsed.error).toContain('invalid input value for enum audit_action');
    });

    it('does not warn when the insert succeeds', async () => {
        await writeAuditLog(mockClient, {
            action: 'TRANSACTION_UPDATED',
            severity: 'INFO',
            entity_type: 'Transaction',
            entity_id: 't-1',
        });

        const calls = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0]));
        expect(calls.find((c: string) => c.includes('audit_log_insert_failed'))).toBeUndefined();
    });
});
