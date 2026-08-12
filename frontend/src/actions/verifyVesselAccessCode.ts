'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { enforceRateLimit, getClientId } from '@/lib/rateLimit';
import { normalizeVesselIdentifier } from '@/lib/vessels/identifier';
import { writeAuditLog } from '@/services/auditService';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('verifyVesselAccessCode');

const schema = z.object({
    identifier: z.string(),
    code: z.string().min(4).max(10),
});

const OUTSTANDING = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'];

// Chaîne de confiance (mig 116) : seules ces sources sont vérifiées de façon
// indépendante de l'armateur lui-même. AGENT_CLAIM et une source absente
// (NULL — provenance inconnue) restent en WARNING : l'inconnu n'est jamais
// routinier, seul le vérifié l'est.
const VERIFIED_SOURCES = new Set(['EQUASIS_VERIFIED', 'VESSELFINDER_VERIFIED', 'PORT_OFFICER']);

export type VerifyAccessCodeResult =
    | { ok: true; redirectTo: string }
    | {
          ok: false;
          reason: 'invalid_code' | 'invalid_identifier' | 'not_claimable' | 'rate_limited' | 'activation_failed';
      };

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

    // Plafond : le chemin d'envoi (tâche 10) en impose déjà deux. Sans plafond
    // ici, un code à six chiffres reste tentable en force brute contre un IMO
    // connu — même clé que l'envoi, même bucket, keyée sur l'IP.
    const h = await headers();
    const quota = await enforceRateLimit('vessel-claim', getClientId(h));
    if (!quota.allowed) return { ok: false, reason: 'rate_limited' };

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

    const { error: updateError } = await admin
        .from('shipowners')
        .update({
            profile_id: session.user.id,
            account_state: 'ACTIVE',
            email_verified_at: new Date().toISOString(),
        })
        .eq('id', owner.id);

    // L'échec d'écriture doit être un échec pour l'appelant, pas un {ok:true}
    // silencieux : sans ce garde, l'audit (une fois écrit) affirmerait un
    // rattachement qui n'a en réalité pas eu lieu.
    if (updateError) {
        log.warn('shipowner_activation_failed', { ownerId: owner.id, error: updateError.message });
        return { ok: false, reason: 'activation_failed' };
    }

    const { data: profile } = await admin
        .from('profiles')
        .select('full_name')
        .eq('id', session.user.id)
        .maybeSingle();

    // Provenance vérifiée indépendamment de l'armateur → INFO, routinier.
    // Tout le reste (AGENT_CLAIM, ou une source absente) → WARNING : le
    // contrôle compensatoire de la décision PO du 2026-08-12.
    const isVerifiedSource = owner.official_email_source !== null
        && VERIFIED_SOURCES.has(owner.official_email_source);

    await writeAuditLog(admin, {
        user_id: session.user.id,
        user_full_name: profile?.full_name ?? 'Armateur (auto-rattachement)',
        action: 'SHIPOWNER_SELF_CLAIM',
        severity: isVerifiedSource ? 'INFO' : 'WARNING',
        entity_type: 'Shipowner',
        entity_id: owner.id,
        jurisdiction_id: owner.jurisdiction_id ?? null,
        details_json: {
            vessel_imo: imo,
            email_source: owner.official_email_source,
        },
    });

    return { ok: true, redirectTo: '/dashboard' };
}
