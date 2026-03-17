import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditLogEntry } from '@/types/secure';
import type { AuditLogRow } from '@/types/database';
import { rowToAuditLogEntry } from '@/types/secure/mappers';

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

export async function writeAuditLog(
    client: Client,
    entry: Record<string, unknown>,
): Promise<void> {
    await client.from('audit_logs').insert(entry);
}
