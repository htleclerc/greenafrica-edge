'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceRole } from '@supabase/supabase-js';

const schema = z.object({
    proposalId: z.string().uuid(),
    port: z.enum(['BERBERA', 'ZEILA']),
    addToAllowList: z.boolean().default(true),
    createAlert: z.boolean().default(true),
    note: z.string().optional(),
});

const ALLOWED_ROLES = ['SUPERADMIN', 'PORT_OFFICER'] as const;

export type ApproveDestinationProposalResult =
    | { ok: true; allowListUpdated: boolean; alertCreated: boolean }
    | { ok: false; reason: string };

export async function approveDestinationProposal(
    raw: unknown,
): Promise<ApproveDestinationProposalResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role, full_name')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
        return { ok: false, reason: 'insufficient role' };
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return { ok: false, reason: 'service role not configured' };
    const admin = createServiceRole(url, key, { auth: { persistSession: false } });

    // 1. Load proposal, ensure PENDING
    const { data: proposal } = await admin
        .from('destination_match_proposals')
        .select('id, status, normalized, mmsi, matched_port_guess')
        .eq('id', parsed.data.proposalId)
        .single();
    if (!proposal) return { ok: false, reason: 'proposal not found' };
    if (proposal.status !== 'PENDING') {
        return { ok: false, reason: 'proposal not pending' };
    }

    // 2. Update proposal to APPROVED
    const { error: upErr } = await admin
        .from('destination_match_proposals')
        .update({
            status: 'APPROVED',
            decided_by: auth.user.id,
            decided_at: new Date().toISOString(),
            decision_note: parsed.data.note ?? null,
        })
        .eq('id', proposal.id);
    if (upErr) return { ok: false, reason: upErr.message };

    // 3. Optionally merge into allow-list (idempotent — no-op if already present)
    let allowListUpdated = false;
    if (parsed.data.addToAllowList) {
        const { data: cfg } = await admin
            .from('app_config')
            .select('value')
            .eq('key', 'arrival.origin_port_allow_list')
            .single();
        const list = (cfg?.value ?? {}) as Record<string, string[]>;
        const current = list[parsed.data.port] ?? [];
        if (!current.includes(proposal.normalized)) {
            list[parsed.data.port] = [...current, proposal.normalized];
            const { error: cErr } = await admin
                .from('app_config')
                .update({ value: list })
                .eq('key', 'arrival.origin_port_allow_list');
            if (cErr) return { ok: false, reason: cErr.message };
            allowListUpdated = true;
        }
    }

    // 4. Backdated alert creation deferred to v0+1.
    return { ok: true, allowListUpdated, alertCreated: false };
}
