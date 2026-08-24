'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { applyEquasisProposal } from './applyEquasisProposal';
import { rejectEquasisProposal } from './rejectEquasisProposal';
import { approveDestinationProposal } from './approveDestinationProposal';
import { approveShipownerRegistration } from './approveShipownerRegistration';
import { rejectShipownerRegistration } from './rejectShipownerRegistration';

const schema = z.object({
    kind: z.enum(['vessel-identity', 'agent', 'origin-port']),
    id: z.string().min(1),
    decision: z.enum(['approve', 'reject']),
    /** Motif — exigé au rejet : un refus sans raison n'est pas auditable. */
    reason: z.string().trim().optional(),
});

export type ResolveResult = { ok: true } | { ok: false; reason: string };

const ALLOWED_ROLES = ['SUPERADMIN', 'PORT_OFFICER'];

/**
 * Arbitre un élément de la file de validation unifiée.
 *
 * Chaque famille garde son action métier — celles-ci portent leurs propres
 * gardes (chaîne de confiance Equasis, allow-list des ports, activation de
 * compte) et ce point d'entrée ne les court-circuite pas : il ne fait que
 * router. La seule règle qu'il ajoute est la sienne, le rejet motivé.
 *
 * Le rôle est revalidé ici même. Les actions déléguées le refont de leur côté,
 * et c'est voulu : la branche « inscription » écrit avec le client plateforme,
 * qui contourne RLS.
 */
export async function resolveValidationItem(raw: unknown): Promise<ResolveResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    const { kind, id, decision, reason } = parsed.data;

    if (decision === 'reject' && (reason ?? '').length < 3) {
        return { ok: false, reason: 'reason_required' };
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'unauthenticated' };
    const { data: profile } = await supabase
        .from('profiles').select('role, is_active').eq('id', auth.user.id).single();
    if (!profile || !ALLOWED_ROLES.includes(String(profile.role)) || profile.is_active === false) {
        return { ok: false, reason: 'forbidden' };
    }

    let result: ResolveResult;
    switch (kind) {
        case 'vessel-identity':
            result = decision === 'approve'
                ? await applyEquasisProposal({ proposalId: id })
                : await rejectEquasisProposal({ proposalId: id, reason: reason! });
            break;

        case 'origin-port':
            result = decision === 'approve'
                ? await approveOriginPort(id, reason)
                : await rejectDestinationProposal(id, reason!);
            break;

        case 'agent':
            result = decision === 'approve'
                ? await approveOwnerRegistration(id)
                : await rejectOwnerRegistration(id, reason!);
            break;
    }

    if (result.ok) {
        revalidatePath('/admin/validations');
    }
    return result;
}

/**
 * Approuve une proposition de port d'origine.
 *
 * Le port retenu est celui que le rapprochement a deviné (`matched_port_guess`),
 * jamais une constante : approuver « Zeila » en écrivant « Berbera » créerait une
 * alerte d'arrivée sur le mauvais port et fausserait la taxe. On relit donc la
 * proposition avant d'appeler l'action métier, qui n'accepte que les deux ports
 * ouverts.
 */
async function approveOriginPort(id: string, note?: string): Promise<ResolveResult> {
    const admin = createPlatformClient();
    const { data, error } = await admin
        .from('destination_match_proposals')
        .select('matched_port_guess')
        .eq('id', id)
        .eq('status', 'PENDING')
        .maybeSingle();
    if (error) return { ok: false, reason: error.message };
    if (!data) return { ok: false, reason: 'proposal_not_pending' };

    const port = String(data.matched_port_guess ?? '');
    if (port !== 'BERBERA' && port !== 'ZEILA') return { ok: false, reason: 'unsupported_port' };

    return approveDestinationProposal({ proposalId: id, port, note });
}

/**
 * Rejette une proposition de port d'origine.
 *
 * Il n'existe pas d'action dédiée côté `approveDestinationProposal` : le rejet
 * n'a d'autre effet que de sortir la ligne de la file, sans toucher à
 * l'allow-list ni créer d'alerte d'arrivée. L'écriture passe par le client
 * plateforme parce que `destination_match_proposals` est une table globale, non
 * portée par un tenant.
 */
async function rejectDestinationProposal(id: string, reason: string): Promise<ResolveResult> {
    const admin = createPlatformClient();
    const { error } = await admin
        .from('destination_match_proposals')
        .update({ status: 'REJECTED', decision_note: reason, decided_at: new Date().toISOString() })
        .eq('id', id)
        .eq('status', 'PENDING');
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
}

/**
 * Approuve une inscription d'opérateur.
 *
 * Délègue aux actions de `/admin/registrations` plutôt que d'ouvrir un second
 * chemin d'activation de compte : elles portent déjà la garde de juridiction, le
 * refus des dossiers non `PENDING_REVIEW` et l'e-mail d'approbation. Deux
 * chemins finiraient par diverger, et c'est un compte qu'on active.
 */
async function approveOwnerRegistration(id: string): Promise<ResolveResult> {
    const result = await approveShipownerRegistration({ shipownerId: id });
    return result.ok ? { ok: true } : { ok: false, reason: result.message ?? 'approval failed' };
}

async function rejectOwnerRegistration(id: string, reason: string): Promise<ResolveResult> {
    const result = await rejectShipownerRegistration({ shipownerId: id, reason });
    return result.ok ? { ok: true } : { ok: false, reason: result.message ?? 'rejection failed' };
}
