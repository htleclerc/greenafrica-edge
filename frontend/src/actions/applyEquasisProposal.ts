'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { upsertShipownerEmail, getOrCreateGhost } from '@/services/shipownerService';

const schema = z.object({
    proposalId: z.string().uuid(),
});

const ALLOWED_ROLES = ['PORT_OFFICER', 'MANAGER', 'SUPERADMIN'] as const;

export type ApplyEquasisProposalResult =
    | { ok: true; shipownerId: string; emailUpdated: boolean }
    | { ok: false; reason: string };

/**
 * Apply a reviewed Equasis proposal to the underlying shipowner row.
 *
 * Trust-chain semantics (see shipownerService.upsertShipownerEmail):
 *   - source='EQUASIS_VERIFIED' has trust 2
 *   - it overrides AGENT_CLAIM (1) but NOT PORT_OFFICER (3)
 *   - the helper does this comparison silently — caller can read
 *     the returned official_email_source to detect a no-op
 *
 * Name + country are filled ONLY when currently null. Port officers who
 * set those manually never get clobbered by an automated proposal.
 *
 * Resolves shipowner_id at apply time (not at create time) so that
 * proposals raised before the vessel was attached to an owner can still
 * be applied later. Falls back to creating a GHOST shipowner if the
 * vessel exists without one — the proposal data is the seed for that
 * GHOST.
 */
export async function applyEquasisProposal(
    raw: unknown,
): Promise<ApplyEquasisProposalResult> {
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

    // equasis_scrape_proposals is a global review queue (not tenant-scoped); shipowner
    // writes in single-country mode inherit the DEFAULT jurisdiction (multi-country
    // proposal-review scoping deferred to Wedge 2). UNSCOPED platform client.
    let admin;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: false, reason: 'service role not configured' };
    }

    // 1. Load the proposal
    const { data: proposal, error: pErr } = await admin
        .from('equasis_scrape_proposals')
        .select(
            'id, imo_number, shipowner_id, proposed_owner_name, proposed_manager, proposed_email, proposed_country, applied, reviewed_at',
        )
        .eq('id', parsed.data.proposalId)
        .single();
    if (pErr || !proposal) return { ok: false, reason: 'proposal not found' };
    if (proposal.applied) {
        return { ok: false, reason: 'proposal already applied' };
    }
    if (proposal.reviewed_at !== null) {
        return { ok: false, reason: 'proposal already rejected' };
    }

    // 2. Resolve shipowner_id — direct, then via vessel, then GHOST fallback
    let shipownerId = proposal.shipowner_id as string | null;
    if (!shipownerId) {
        const { data: vessel } = await admin
            .from('vessels')
            .select('shipowner_id')
            .eq('imo_number', proposal.imo_number)
            .maybeSingle();
        shipownerId = vessel?.shipowner_id ?? null;
    }
    if (!shipownerId) {
        // Last resort: create a GHOST seeded with the proposal's owner name
        // (or fall back to the IMO if no name was proposed). The caller still
        // sees a successful apply — the GHOST is the placeholder for whoever
        // gets invited later.
        const ghost = await getOrCreateGhost(admin, {
            name: proposal.proposed_owner_name || `Owner of IMO ${proposal.imo_number}`,
            country_code: proposal.proposed_country || undefined,
        });
        shipownerId = ghost.id;
    }

    // 3. Apply email through trust chain
    let emailUpdated = false;
    if (proposal.proposed_email) {
        const before = await admin
            .from('shipowners')
            .select('official_email_source')
            .eq('id', shipownerId)
            .single();
        const beforeSource = before.data?.official_email_source ?? null;
        await upsertShipownerEmail(
            admin,
            shipownerId,
            proposal.proposed_email,
            'EQUASIS_VERIFIED',
        );
        const after = await admin
            .from('shipowners')
            .select('official_email_source')
            .eq('id', shipownerId)
            .single();
        emailUpdated = after.data?.official_email_source !== beforeSource ||
            (beforeSource === 'EQUASIS_VERIFIED' || beforeSource === 'AGENT_CLAIM');
    }

    // 4. Fill name / country only if currently null
    const fillUpdates: Record<string, string> = {};
    const { data: current } = await admin
        .from('shipowners')
        .select('name, country_code')
        .eq('id', shipownerId)
        .single();
    if (proposal.proposed_owner_name && (!current?.name || current.name.startsWith('Owner of IMO'))) {
        fillUpdates.name = proposal.proposed_owner_name;
    }
    if (proposal.proposed_country && !current?.country_code) {
        fillUpdates.country_code = proposal.proposed_country;
    }
    if (Object.keys(fillUpdates).length > 0) {
        await admin.from('shipowners').update(fillUpdates).eq('id', shipownerId);
    }

    // 5. Mark the proposal applied
    const now = new Date().toISOString();
    const { error: applyErr } = await admin
        .from('equasis_scrape_proposals')
        .update({
            applied: true,
            shipowner_id: shipownerId,
            reviewed_by: auth.user.id,
            reviewed_at: now,
        })
        .eq('id', proposal.id);
    if (applyErr) return { ok: false, reason: applyErr.message };

    // 6. Audit log
    await admin.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: profile.full_name ?? 'Officer',
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Shipowner',
        entity_id: shipownerId,
        details_json: {
            event: 'EQUASIS_PROPOSAL_APPLIED',
            proposalId: proposal.id,
            imoNumber: proposal.imo_number,
            emailApplied: !!proposal.proposed_email,
            nameFilled: 'name' in fillUpdates,
            countryFilled: 'country_code' in fillUpdates,
        },
    });

    return { ok: true, shipownerId, emailUpdated };
}
