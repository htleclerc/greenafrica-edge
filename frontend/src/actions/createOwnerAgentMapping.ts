'use server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createMapping } from '@/services/ownerAgentMappingService';
import { createPlatformClient } from '@/lib/supabase/tenant';

const inputSchema = z.object({
    shipownerId: z.string().uuid(),
    agentProfileId: z.string().uuid(),
    priority: z.number().int().min(1).max(1000).optional(),
    validFrom: z.string().optional(),
    validUntil: z.string().nullable().optional(),
});

export async function createOwnerAgentMapping(
    raw: unknown,
): Promise<{ ok: true; mappingId: string } | { ok: false; reason: string }> {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid' };
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'].includes(profile.role)) {
        return { ok: false, reason: 'insufficient role' };
    }

    // owner_agent_mappings is a global config table (not tenant-scoped in the v8
    // foundation) → UNSCOPED platform client.
    let admin;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: false, reason: 'service role not configured' };
    }

    try {
        const m = await createMapping(admin, parsed.data);
        return { ok: true, mappingId: m.id };
    } catch (err) {
        return { ok: false, reason: (err as Error).message };
    }
}
