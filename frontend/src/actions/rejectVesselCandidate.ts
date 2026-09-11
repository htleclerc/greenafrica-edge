'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';

// z.guid() et non z.uuid() : même raison que dans applyVesselIdentity.ts —
// Zod v4 impose les bits de version/variant RFC 4122 à z.uuid().
const schema = z.object({
    candidateId: z.guid(),
    /** Motif libre, facultatif. Tronqué côté écran, borné ici. */
    reason: z.string().trim().max(500).optional(),
});

const ALLOWED_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

export type RejectVesselCandidateResult = { ok: true } | { ok: false; reason: string };

/**
 * Écarte une proposition d'identité sans rien écrire sur le navire.
 *
 * POURQUOI CETTE ACTION EXISTE. Le statut 'REJECTED' est prévu par la mig 115
 * mais rien ne l'avait jamais posé : un candidat n'avait qu'une seule sortie,
 * l'appariement. Une ligne fautive — faute de frappe à la saisie, navire hors
 * périmètre, export périmé — restait donc PENDING à vie. Et comme l'index
 * unique partiel de la mig 117 verrouille (lot, IMO) sur les seuls PENDING,
 * cette ligne interdisait définitivement de re-saisir le même navire. La
 * porte de sortie prévue par la 117 n'avait pas de poignée.
 *
 * Gardes, chacune interrompant sans écrire :
 *   1. authentification et rôle
 *   2. candidat existant
 *   3. candidat encore ouvert — PENDING ou CONFLICT. Un candidat MATCHED est
 *      refusé : son identité est déjà écrite sur un navire, et le « rejeter »
 *      laisserait croire qu'on l'a défaite alors que rien n'est annulé. Un
 *      candidat déjà REJECTED est refusé aussi, pour ne pas réécrire l'auteur
 *      et l'horodatage d'un refus antérieur.
 *
 * Aucune écriture sur `vessels` : rejeter, c'est refuser une proposition, pas
 * toucher au registre.
 */
export async function rejectVesselCandidate(raw: unknown): Promise<RejectVesselCandidateResult> {
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
    if (!profile || !ALLOWED_ROLES.includes(String(profile.role))) {
        return { ok: false, reason: 'insufficient role' };
    }

    let admin;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: false, reason: 'service role not configured' };
    }

    const { data: candidate } = await admin
        .from('vessel_identity_candidates')
        .select('id, status, imo_number, vessel_name, batch_label')
        .eq('id', parsed.data.candidateId)
        .maybeSingle();
    if (!candidate) return { ok: false, reason: 'candidate not found' };

    if (candidate.status === 'MATCHED') return { ok: false, reason: 'candidate already matched' };
    if (candidate.status !== 'PENDING' && candidate.status !== 'CONFLICT') {
        return { ok: false, reason: 'candidate already processed' };
    }

    const reason = parsed.data.reason && parsed.data.reason !== '' ? parsed.data.reason : null;

    // Le filtre de statut est REJOUÉ dans l'UPDATE : entre la lecture et
    // l'écriture, un autre officier a pu apparier ce même candidat. Sans lui,
    // le rejet écraserait un appariement déjà appliqué à un navire.
    const { data: updated, error: updateErr } = await admin
        .from('vessel_identity_candidates')
        .update({
            status: 'REJECTED',
            rejected_by: auth.user.id,
            rejected_at: new Date().toISOString(),
            rejection_reason: reason,
        })
        .eq('id', candidate.id)
        .in('status', ['PENDING', 'CONFLICT'])
        .select('id');
    if (updateErr) return { ok: false, reason: updateErr.message };
    if (!updated || updated.length === 0) return { ok: false, reason: 'candidate already processed' };

    await admin.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: profile.full_name ?? 'Officier',
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Vessel',
        entity_id: candidate.id,
        details_json: {
            event: 'VESSEL_IDENTITY_REJECTED',
            candidateId: candidate.id,
            imoNumber: candidate.imo_number,
            vesselName: candidate.vessel_name,
            batchLabel: candidate.batch_label,
            previousStatus: candidate.status,
            rejectionReason: reason,
        },
    });

    return { ok: true };
}
