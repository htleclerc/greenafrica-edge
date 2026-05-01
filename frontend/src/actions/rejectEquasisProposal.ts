'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceRole } from '@supabase/supabase-js';

const schema = z.object({
    proposalId: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
});

const ALLOWED_ROLES = ['PORT_OFFICER', 'MANAGER', 'SUPERADMIN'] as const;

export type RejectEquasisProposalResult =
    | { ok: true }
    | { ok: false; reason: string };

/**
 * Reject a pending Equasis proposal. Stamps reviewed_by + reviewed_at
 * and the rejection reason. Leaves the underlying shipowner row
 * untouched. Worker / port officer can submit a new proposal later
 * with corrected data.
 */
export async function rejectEquasisProposal(
    raw: unknown,
): Promise<RejectEquasisProposalResult> {
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

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
        return { ok: false, reason: 'service role not configured' };
    }
    const admin = createServiceRole(supabaseUrl, serviceKey, {
        auth: { persistSession: false },
    });

    const { data: proposal, error: pErr } = await admin
        .from('equasis_scrape_proposals')
        .select('id, applied, reviewed_at')
        .eq('id', parsed.data.proposalId)
        .single();
    if (pErr || !proposal) return { ok: false, reason: 'proposal not found' };
    if (proposal.applied) {
        return { ok: false, reason: 'proposal already applied — cannot reject' };
    }
    if (proposal.reviewed_at !== null) {
        return { ok: false, reason: 'proposal already rejected' };
    }

    const { error } = await admin
        .from('equasis_scrape_proposals')
        .update({
            applied: false,
            reviewed_by: auth.user.id,
            reviewed_at: new Date().toISOString(),
            rejected_reason: parsed.data.reason,
        })
        .eq('id', proposal.id);
    if (error) return { ok: false, reason: error.message };

    return { ok: true };
}
