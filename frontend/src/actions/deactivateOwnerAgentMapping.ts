'use server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { deactivateMapping } from '@/services/ownerAgentMappingService';
import { createPlatformClient } from '@/lib/supabase/tenant';

const inputSchema = z.object({ mappingId: z.string().uuid() });

export async function deactivateOwnerAgentMapping(
    raw: unknown,
): Promise<{ ok: true } | { ok: false; reason: string }> {
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
        await deactivateMapping(admin, parsed.data.mappingId);
        return { ok: true };
    } catch (err) {
        return { ok: false, reason: (err as Error).message };
    }
}
