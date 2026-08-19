import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditLogEntry } from '@/types/secure';
import type { AuditLogRow } from '@/types/database';
import { rowToAuditLogEntry } from '@/types/secure/mappers';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('auditService');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

export interface AuditLogFilters {
    action?: string;
    severity?: string;
    userId?: string;
    limit?: number;
}

export async function getAuditLogs(client: Client, filters?: AuditLogFilters): Promise<AuditLogEntry[]> {
    let query = client.from('audit_logs').select('*').order('created_at', { ascending: false });

    if (filters?.action) query = query.eq('action', filters.action);
    if (filters?.severity) query = query.eq('severity', filters.severity);
    if (filters?.userId) query = query.eq('user_id', filters.userId);
    if (filters?.limit) query = query.limit(filters.limit);

    const { data } = await query;
    return ((data ?? []) as AuditLogRow[]).map(rowToAuditLogEntry);
}

/**
 * Callers SHOULD include `jurisdiction_id: string | null` on `entry` (RGPD C3b —
 * audit_logs.jurisdiction_id must be tagged on every writer; `null` only for
 * legitimate cross-jurisdiction roll-ups). Left untyped (Record<string, unknown>)
 * on purpose so existing call sites aren't forced through a signature change.
 */
export async function writeAuditLog(
    client: Client,
    entry: Record<string, unknown>,
): Promise<void> {
    // Best-effort by design (audit must never break the caller's flow), but
    // failures must be visible — entries that violate the audit_action /
    // audit_severity enums or the profiles FK were previously dropped silently.
    const { error } = await client.from('audit_logs').insert(entry);
    if (error) {
        log.warn('audit_log_insert_failed', {
            action: entry.action,
            entity_type: entry.entity_type,
            entity_id: entry.entity_id,
            error: error.message,
        });
    }
}
