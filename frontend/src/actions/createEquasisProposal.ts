'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';

const schema = z.object({
    imoNumber: z.string().trim().min(3).max(20),
    proposedOwnerName: z.string().trim().max(200).optional().default(''),
    proposedManager: z.string().trim().max(200).optional().default(''),
    proposedEmail: z.string().email().optional().or(z.literal('')),
    proposedCountry: z.string().trim().max(50).optional().default(''),
});

const ALLOWED_ROLES = ['PORT_OFFICER', 'SUPERADMIN'] as const;

export type CreateEquasisProposalResult =
    | { ok: true; proposalId: string }
    | { ok: false; reason: string };

/**
 * Manual proposal entry by Port Operations / Superadmin.
 *
 * When a port officer has owner-email information from any source
 * (Equasis lookup done by hand, third-party data feed, agent disclosure),
 * they can paste it here. Stored with source='manual' so the review UI
 * shows the provenance.
 *
 * The proposal is NOT auto-applied — it lands in the review queue
 * alongside scraper-sourced proposals. The same human-validation gate
 * applies to manual entries as to scraped ones, so a single mistake
 * doesn't silently overwrite shipowner data.
 *
 * shipowner_id is resolved from the IMO at creation time when possible:
 *   - vessel exists with a shipowner_id → that shipowner_id
 *   - vessel exists without shipowner → null (apply will resolve later
 *     via getOrCreateGhost, or refuse if the vessel still has no owner)
 *   - vessel doesn't exist → null (must be created first via the normal
 *     claim flow before the proposal can be applied)
 */
export async function createEquasisProposal(
    raw: unknown,
): Promise<CreateEquasisProposalResult> {
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

    // At least one proposed field must be present — empty proposals
    // shouldn't pollute the review queue.
    const hasContent =
        parsed.data.proposedOwnerName ||
        parsed.data.proposedManager ||
        parsed.data.proposedEmail ||
        parsed.data.proposedCountry;
    if (!hasContent) {
        return { ok: false, reason: 'at least one of owner / manager / email / country is required' };
    }

    // equasis_scrape_proposals is a global review queue (not tenant-scoped in the v8
    // foundation) → UNSCOPED platform client.
    let admin;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: false, reason: 'service role not configured' };
    }

    // Best-effort shipowner_id resolution from vessels.imo_number
    let shipownerId: string | null = null;
    const { data: vessel } = await admin
        .from('vessels')
        .select('shipowner_id')
        .eq('imo_number', parsed.data.imoNumber)
        .maybeSingle();
    if (vessel?.shipowner_id) {
        shipownerId = vessel.shipowner_id;
    }

    const { data: proposal, error } = await admin
        .from('equasis_scrape_proposals')
        .insert({
            imo_number: parsed.data.imoNumber,
            shipowner_id: shipownerId,
            proposed_owner_name: parsed.data.proposedOwnerName || null,
            proposed_manager: parsed.data.proposedManager || null,
            proposed_email: parsed.data.proposedEmail || null,
            proposed_country: parsed.data.proposedCountry || null,
            source: 'manual',
        })
        .select('id')
        .single();

    if (error) {
        return { ok: false, reason: error.message };
    }

    return { ok: true, proposalId: proposal.id };
}
