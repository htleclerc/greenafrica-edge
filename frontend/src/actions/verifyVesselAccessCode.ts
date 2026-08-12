'use server';

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { normalizeVesselIdentifier } from '@/lib/vessels/identifier';
import { writeAuditLog } from '@/services/auditService';

const schema = z.object({
    identifier: z.string(),
    code: z.string().min(4).max(10),
});

const OUTSTANDING = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'];

export type VerifyAccessCodeResult =
    | { ok: true; redirectTo: string }
    | { ok: false; reason: 'invalid_code' | 'invalid_identifier' | 'not_claimable' };

/**
 * Vérifie le code reçu par e-mail, lie le compte à l'armateur et l'active.
 *
 * La ligne d'audit n'est pas décorative : le PO a décidé (2026-08-12) que les
 * trois valeurs d'official_email_source ouvrent l'accès direct, y compris
 * AGENT_CLAIM — l'adresse déclarée par un agent maritime, la moins fiable.
 * L'audit en WARNING sur cette source est le contrôle compensatoire : il rend
 * la décision révisable a posteriori sans bloquer personne a priori.
 */
export async function verifyVesselAccessCode(raw: unknown): Promise<VerifyAccessCodeResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'invalid_identifier' };

    const identifier = normalizeVesselIdentifier(parsed.data.identifier);
    if (!identifier) return { ok: false, reason: 'invalid_identifier' };

    let admin: SupabaseClient;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: false, reason: 'not_claimable' };
    }

    let imo = identifier.value;
    if (identifier.kind === 'MMSI') {
        const { data: vessel } = await admin
            .from('vessels').select('imo_number').eq('mmsi', identifier.value).maybeSingle();
        if (!vessel?.imo_number) return { ok: false, reason: 'not_claimable' };
        imo = vessel.imo_number;
    }

    const { data: txn } = await admin
        .from('transactions')
        .select('shipowner_id')
        .eq('vessel_imo', imo)
        .in('status', OUTSTANDING)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!txn?.shipowner_id) return { ok: false, reason: 'not_claimable' };

    const { data: owner } = await admin
        .from('shipowners')
        .select('id, official_email, official_email_source, is_placeholder, jurisdiction_id')
        .eq('id', txn.shipowner_id)
        .maybeSingle();

    // G2, rejouée ici : la garde de l'envoi ne suffit pas — un code obtenu
    // autrement ne doit pas non plus ouvrir un armateur de regroupement.
    if (!owner || owner.is_placeholder || !owner.official_email) {
        return { ok: false, reason: 'not_claimable' };
    }

    const supabase = await createClient();
    const { data: session, error } = await supabase.auth.verifyOtp({
        email: owner.official_email,
        token: parsed.data.code,
        type: 'email',
    });

    if (error || !session?.user) return { ok: false, reason: 'invalid_code' };

    await admin
        .from('shipowners')
        .update({
            profile_id: session.user.id,
            account_state: 'ACTIVE',
            email_verified_at: new Date().toISOString(),
        })
        .eq('id', owner.id);

    const viaAgentClaim = owner.official_email_source === 'AGENT_CLAIM';
    await writeAuditLog(admin, {
        action: 'SHIPOWNER_SELF_CLAIM',
        entity_type: 'shipowners',
        entity_id: owner.id,
        user_id: session.user.id,
        jurisdiction_id: owner.jurisdiction_id ?? null,
        // AGENT_CLAIM = adresse déclarée par un agent maritime. L'accès est
        // ouvert (décision PO) mais tracé plus fort pour rester revoyable.
        severity: viaAgentClaim ? 'WARNING' : 'INFO',
        metadata: {
            vessel_imo: imo,
            email_source: owner.official_email_source,
        },
    });

    return { ok: true, redirectTo: '/dashboard' };
}
