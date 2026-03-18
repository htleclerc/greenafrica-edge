import type { SupabaseClient } from '@supabase/supabase-js';
import type { RegistrationRequest } from '@/types/secure';
import type { RegistrationRequestRow } from '@/types/database';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

function rowToRegistrationRequest(row: RegistrationRequestRow): RegistrationRequest {
    return {
        id: row.id,
        ref: (row as Record<string, unknown>).ref as string ?? row.id,
        submittedAt: row.created_at,
        entityType: row.entity_type as RegistrationRequest['entityType'],
        orgName: row.org_name,
        orgRegistryId: row.org_registry_id,
        contactName: row.contact_name,
        contactEmail: row.contact_email,
        contactPhone: row.contact_phone ?? undefined,
        jurisdiction: row.jurisdiction,
        requestedRole: row.requested_role as RegistrationRequest['requestedRole'],
        status: row.status as RegistrationRequest['status'],
        reviewedBy: row.reviewed_by ?? undefined,
        reviewedAt: row.reviewed_at ?? undefined,
        reviewNote: row.review_note ?? undefined,
        documents: [],
        ipAddress: row.ip_address ?? '',
        flagged: row.flagged,
    };
}

export async function getRegistrations(client: Client): Promise<RegistrationRequest[]> {
    const { data } = await client
        .from('registration_requests')
        .select('*')
        .order('created_at', { ascending: false });
    return ((data ?? []) as RegistrationRequestRow[]).map(rowToRegistrationRequest);
}

export async function updateRegistrationStatus(
    client: Client,
    id: string,
    status: string,
    reviewNote?: string,
    reviewedBy?: string,
): Promise<void> {
    await client.from('registration_requests').update({
        status,
        review_note: reviewNote ?? null,
        reviewed_by: reviewedBy ?? null,
        reviewed_at: new Date().toISOString(),
    }).eq('id', id);
}
