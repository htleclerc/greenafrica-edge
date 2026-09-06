'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { enforceRateLimit, getClientId } from '@/lib/rateLimit';
import { normalizeVesselIdentifier } from '@/lib/vessels/identifier';
import { writeAuditLog } from '@/services/auditService';
import { listLoginRecipients } from '@/services/auth/loginRecipients';
import { matchRecipientToken } from '@/lib/auth/recipientToken';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('verifyVesselAccessCode');

const schema = z.object({
    identifier: z.string(),
    code: z.string().min(4).max(10),
    /** Jeton de la boîte choisie (membre, représentant) ; absent = titulaire. */
    recipient: z.string().optional(),
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
 * Refuse un rattachement qui DÉPLACERAIT profile_id plutôt que de le poser
 * pour la première fois — dans les deux sens :
 *   1. cette ligne shipowners porte déjà un profile_id différent du compte
 *      qui vient de vérifier son code ;
 *   2. ce compte porte déjà une AUTRE ligne shipowners.
 * shipowners.profile_id n'a pas de contrainte unique (mig 024) et tous les
 * points de résolution (requireOwner, requirePrincipal, /api/me/principal,
 * RoleContext) lisent via .maybeSingle() — un re-pointage silencieux dans
 * l'un ou l'autre sens ferait échouer cette lecture pour un compte existant.
 */
async function findProfileClaimConflict(
    admin: SupabaseClient,
    owner: { id: string; profile_id: string | null },
    sessionUserId: string,
): Promise<boolean> {
    if (owner.profile_id && owner.profile_id !== sessionUserId) return true;

    // .limit(1) : sans plafond, .maybeSingle() lève PGRST116 dès que DEUX lignes
    // ou plus matchent — et c'est justement l'état déjà corrompu (le même
    // profile_id porté par plusieurs shipowners) que cette garde existe pour
    // détecter. .maybeSingle() renvoie alors data:null avec une erreur ; ignorer
    // l'erreur ferait lire "aucun conflit" sur le cas exact qu'on cherche à
    // bloquer. On échoue donc fermé : toute erreur ici est traitée en conflit.
    const { data: conflictingRow, error } = await admin
        .from('shipowners')
        .select('id')
        .eq('profile_id', sessionUserId)
        .neq('id', owner.id)
        .limit(1)
        .maybeSingle();

    if (error) {
        log.warn('profile_claim_conflict_check_failed', {
            ownerId: owner.id,
            sessionUserId,
            error: error.message,
        });
        return true;
    }

    return Boolean(conflictingRow);
}

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

    // .not('shipowner_id', 'is', null) : doit rester en accord avec la même
    // clause dans requestVesselAccessCode et avec le JOIN shipowners du RPC
    // vessel_payment_teaser (mig 118) — sinon un pro-forma AIR récent non
    // apparié (shipowner_id NULL) devient "le plus récent" ici tout en étant
    // écarté par le teaser, et l'écran affiche claimable=true pour un armateur
    // que cette résolution ne retrouvera jamais.
    const { data: txn } = await admin
        .from('transactions')
        .select('shipowner_id')
        .eq('vessel_imo', imo)
        .in('status', OUTSTANDING)
        .not('shipowner_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!txn?.shipowner_id) return { ok: false, reason: 'not_claimable' };

    const { data: owner } = await admin
        .from('shipowners')
        .select('id, official_email, official_email_source, is_placeholder, jurisdiction_id, profile_id')
        .eq('id', txn.shipowner_id)
        .maybeSingle();

    // G2, rejouée ici : la garde de l'envoi ne suffit pas — un code obtenu
    // autrement ne doit pas non plus ouvrir un armateur de regroupement.
    if (!owner || owner.is_placeholder || !owner.official_email) {
        return { ok: false, reason: 'not_claimable' };
    }

    const supabase = await createClient();

    // Boîte choisie au premier temps. Un membre ou un représentant ouvre SA
    // session — jamais celle du titulaire : le dossier n'est pas rattaché à
    // son profil, sinon il en deviendrait le titulaire.
    if (parsed.data.recipient) {
        const recipients = await listLoginRecipients(admin, {
            id: owner.id, officialEmail: String(owner.official_email),
        });
        const chosen = matchRecipientToken(parsed.data.recipient, owner.id, recipients);
        if (!chosen) return { ok: false, reason: 'invalid_code' };
        if (chosen.kind !== 'OWNER') {
            const { data: memberSession, error: memberErr } = await supabase.auth.verifyOtp({
                email: chosen.email,
                token: parsed.data.code,
                type: 'email',
            });
            if (memberErr || !memberSession?.user) return { ok: false, reason: 'invalid_code' };
            log.info('vessel_login_as_recipient', { ownerId: owner.id, kind: chosen.kind });
            return { ok: true, redirectTo: '/dashboard' };
        }
    }

    const { data: session, error } = await supabase.auth.verifyOtp({
        email: owner.official_email,
        token: parsed.data.code,
        type: 'email',
    });

    if (error || !session?.user) return { ok: false, reason: 'invalid_code' };

    // Finding 3 : la vérification du code n'autorise qu'un PREMIER
    // rattachement, jamais un TRANSFERT de la ligne shipowners d'un compte à
    // un autre.
    if (await findProfileClaimConflict(admin, owner, session.user.id)) {
        log.warn('profile_claim_conflict', { ownerId: owner.id, sessionUserId: session.user.id });
        return { ok: false, reason: 'activation_failed' };
    }

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
