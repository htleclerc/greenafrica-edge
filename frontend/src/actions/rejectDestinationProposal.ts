'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';

const schema = z.object({
    proposalId: z.string().uuid(),
    note: z.string().min(1).max(500),
});

const ALLOWED_ROLES = ['SUPERADMIN', 'PORT_OFFICER'] as const;

export type RejectDestinationProposalResult =
    | { ok: true }
    | { ok: false; reason: string };

export async function rejectDestinationProposal(
    raw: unknown,
): Promise<RejectDestinationProposalResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
        return { ok: false, reason: 'insufficient role' };
    }

    // destination_match_proposals is a global table (not tenant-scoped) → UNSCOPED
    // platform client.
    let admin;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: false, reason: 'service role not configured' };
    }

    // 1. Load proposal, ensure PENDING
    const { data: proposal } = await admin
        .from('destination_match_proposals')
        .select('id, status')
        .eq('id', parsed.data.proposalId)
        .single();
    if (!proposal) return { ok: false, reason: 'proposal not found' };
    if (proposal.status !== 'PENDING') {
        return { ok: false, reason: 'proposal not pending' };
    }

    // 2. Update proposal to REJECTED
    const { error } = await admin
        .from('destination_match_proposals')
        .update({
            status: 'REJECTED',
            decided_by: auth.user.id,
            decided_at: new Date().toISOString(),
            decision_note: parsed.data.note,
        })
        .eq('id', parsed.data.proposalId);
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
}
