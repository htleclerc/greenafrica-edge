'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { enforceRateLimit } from '@/lib/rateLimit';
import { readPortalFeatureFlags } from '@/lib/feature-flags';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { notifyStaffSafe } from '@/services/staffNotificationService';

/**
 * Demande d'accès armateur — quatre champs.
 *
 * Le formulaire réclamait huit renseignements, dont un extrait d'immatriculation
 * à téléverser. Il demande désormais le strict nécessaire pour qu'un agent
 * puisse identifier le dossier : qui écrit, pour quelle société, et sur quel
 * navire. Le MMSI est facultatif — il ne sert qu'à retrouver le navire quand
 * l'IMO ne tombe pas juste.
 *
 * ATTRIBUTION AUTOMATIQUE — CE QU'ELLE SUPPOSE DÉSORMAIS
 *
 * Un dossier FANTÔME rattaché au navire est mis en service immédiatement.
 * L'ancien formulaire exigeait en plus que le numéro IMO de la SOCIÉTÉ
 * corresponde ; ce champ a disparu, et l'IMO du navire le remplace seul.
 *
 * C'est une décision produit, prise en connaissance du risque : l'IMO d'un
 * navire est PUBLIC — il figure dans tous les registres. Quiconque le connaît
 * peut donc faire mettre en service le dossier fantôme correspondant et
 * recevoir l'invitation à l'adresse qu'il a saisie.
 *
 * Ce qui borne ce risque, et qu'il ne faut pas détricoter :
 *   — un dossier DÉJÀ en service (ACTIVE, INVITED, SUSPENDED, REJECTED) n'est
 *     jamais touché, et l'écran n'en dit rien ;
 *   — seuls les dossiers fantômes, c'est-à-dire jamais activés, sont
 *     concernés ;
 *   — la mise en service est tracée dans `audit_logs`.
 *
 * Le durcissement possible sans rien retirer au parcours : envoyer
 * l'invitation à `shipowners.official_email` quand le dossier en porte une,
 * plutôt qu'à l'adresse saisie. L'armateur légitime entre, l'usurpateur
 * n'obtient rien. Non implémenté — à trancher.
 */

const registerShipownerSchema = z.object({
    email: z.string().email().max(254),
    /** Raison sociale de l'armateur, telle que le demandeur la déclare. */
    name: z.string().min(2).max(200),
    /** IMO du navire — 7 chiffres. C'est le rattachement au dossier. */
    vessel_imo: z.string().regex(/^\d{7}$/, '7 digits required'),
    /** MMSI — 9 chiffres. Facultatif, sert de second chemin de recherche. */
    mmsi: z.string().regex(/^\d{9}$/, '9 digits required').optional(),
    recaptcha_token: z.string().min(1),
});

type RegisterShipownerInput = z.infer<typeof registerShipownerSchema>;

interface RegisterShipownerResult {
    ok: boolean;
    /**
     * Message INVARIABLE sur tous les chemins, y compris la mise en service et
     * le refus silencieux : l'écran ne doit jamais révéler si un navire est
     * connu, ni si son dossier est déjà pourvu.
     */
    message: string;
    /** Renseigné uniquement sur une ATTRIBUTION AUTOMATIQUE réussie. */
    autoClaimedId?: string;
}

const GENERIC_MESSAGE = 'Demande reçue. Vous recevrez un email sous 48h après validation.';

async function verifyRecaptcha(token: string): Promise<boolean> {
    const secret = process.env.RECAPTCHA_SECRET_KEY;
    if (!secret) {
        if (process.env.NODE_ENV !== 'production') return true;
        return false;
    }
    const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
    });
    if (!r.ok) return false;
    const data = await r.json() as { success: boolean; score?: number };
    return data.success === true && (data.score ?? 0) >= 0.5;
}

export async function registerShipowner(
    input: RegisterShipownerInput,
    clientIp: string,
): Promise<RegisterShipownerResult> {
    // Défense en profondeur : même si la redirection de l'interface est
    // contournée par un POST direct, on refuse d'écrire.
    const flags = await readPortalFeatureFlags();
    if (!flags.selfServiceEnabled) {
        return { ok: false, message: 'Self-service signup is not currently enabled.' };
    }

    const rl = await enforceRateLimit('signup-shipowner', clientIp);
    if (!rl.allowed) return { ok: false, message: 'Too many attempts. Try again later.' };

    const parsed = registerShipownerSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: 'Invalid input.' };
    const data = parsed.data;

    const captchaOk = await verifyRecaptcha(data.recaptcha_token);
    if (!captchaOk) return { ok: false, message: GENERIC_MESSAGE };

    // Client sans contexte de tenant : la demande est anonyme. La juridiction
    // vient du DEFAULT de colonne tant que l'inscription est mono-pays.
    const supabase = createPlatformClient();

    const vessel = await findVessel(supabase, data);

    if (vessel?.shipowner_id) {
        const { data: owner } = await supabase
            .from('shipowners')
            .select('id, account_state')
            .eq('id', vessel.shipowner_id)
            .maybeSingle();
        const state = (owner as { account_state?: string } | null)?.account_state;

        // Dossier fantôme rattaché au navire : mise en service immédiate.
        if (state === 'GHOST') return await autoClaim(supabase, vessel.shipowner_id, data);

        // Dossier déjà pourvu : on ne crée rien et on ne le dit pas. C'est la
        // garde anti-usurpation, et elle ne se négocie pas.
        if (state) return { ok: true, message: GENERIC_MESSAGE };
    }

    await insertPendingReview(supabase, data, vessel);
    return { ok: true, message: GENERIC_MESSAGE };
}

interface MatchedVessel {
    id: string;
    name: string | null;
    shipowner_id: string | null;
    /** Par quel identifiant le navire a été retrouvé — porté au dossier de revue. */
    matchedOn: 'IMO' | 'MMSI';
}

/**
 * L'IMO d'abord, le MMSI en second recours. Un armateur qui se trompe d'un
 * chiffre sur l'IMO, ou dont le navire est enregistré sous un IMO que nous
 * n'avons pas, reste rattachable par son MMSI plutôt que de tomber dans un
 * dossier orphelin que personne ne saura instruire.
 */
async function findVessel(
    supabase: SupabaseClient,
    data: RegisterShipownerInput,
): Promise<MatchedVessel | null> {
    const { data: byImo } = await supabase
        .from('vessels')
        .select('id, name, shipowner_id')
        .eq('imo_number', data.vessel_imo)
        .maybeSingle();
    if (byImo) return { ...(byImo as Omit<MatchedVessel, 'matchedOn'>), matchedOn: 'IMO' };

    if (!data.mmsi) return null;

    const { data: byMmsi } = await supabase
        .from('vessels')
        .select('id, name, shipowner_id')
        .eq('mmsi', data.mmsi)
        .maybeSingle();
    return byMmsi ? { ...(byMmsi as Omit<MatchedVessel, 'matchedOn'>), matchedOn: 'MMSI' } : null;
}

/**
 * Met le dossier fantôme en service et invite le demandeur.
 *
 * Le passage GHOST → ACTIVE est conditionné dans le `UPDATE` lui-même
 * (`.eq('account_state', 'GHOST')`) : deux demandes simultanées sur le même
 * navire ne peuvent pas inviter deux personnes. Celle qui perd la course
 * repart avec le message générique, sans rien apprendre.
 */
async function autoClaim(
    supabase: SupabaseClient,
    shipownerId: string,
    data: RegisterShipownerInput,
): Promise<RegisterShipownerResult> {
    const { data: claimed, error: upErr } = await supabase
        .from('shipowners')
        .update({
            name: data.name,
            // L'adresse doit atterrir sur la ligne shipowners : le cron de
            // relance et la boucle de notification résolvent le destinataire
            // par `official_email`. Sans elle, l'armateur mis en service ne
            // reçoit jamais une seule pro-forma.
            official_email: data.email,
            official_email_source: 'AGENT_CLAIM',
            proof_imo_vessel_imo: data.vessel_imo,
            // Ni `kyc_level_b_completed_at` ni `imo_company_no_verified_at` :
            // le formulaire ne demande plus ni pièce ni IMO société. Les dater
            // affirmerait des vérifications qui n'ont pas eu lieu.
            account_state: 'ACTIVE',
        })
        .eq('id', shipownerId)
        .eq('account_state', 'GHOST')
        .select('id, jurisdiction_id');
    if (upErr) return { ok: false, message: GENERIC_MESSAGE };

    // Course perdue : un autre appel a déjà pris le dossier.
    if (!claimed || claimed.length === 0) return { ok: true, message: GENERIC_MESSAGE };

    const inviteResp = await supabase.auth.admin.inviteUserByEmail(
        data.email,
        { redirectTo: `${process.env.NEXT_PUBLIC_BASE_URL}/owner/auth/callback` },
    );
    if (inviteResp.error) {
        console.error('[registerShipowner] inviteUserByEmail failed:', inviteResp.error.message);
        // Sans invitation, le dossier serait ACTIVE et injoignable : on le
        // rend à son état fantôme plutôt que de le laisser en rade.
        await supabase.from('shipowners')
            .update({ account_state: 'GHOST' })
            .eq('id', shipownerId)
            .eq('account_state', 'ACTIVE');
        return { ok: false, message: 'Email delivery failed. Try again later.' };
    }

    const newUser = inviteResp.data?.user;
    if (newUser) {
        await supabase.from('profiles').upsert({
            id: newUser.id,
            email: data.email,
            full_name: data.name,
            role: 'SHIPOWNER',
            is_active: true,
        });
        await supabase.from('shipowners')
            .update({ profile_id: newUser.id })
            .eq('id', shipownerId);
        await supabase.from('wallets').insert({ shipowner_id: shipownerId });

        await supabase.from('audit_logs').insert({
            user_id: newUser.id,
            user_full_name: data.name,
            action: 'USER_CREATED',
            severity: 'INFO',
            entity_type: 'Shipowner',
            entity_id: shipownerId,
            jurisdiction_id: (claimed[0] as { jurisdiction_id: string | null }).jurisdiction_id,
            details_json: {
                event: 'SHIPOWNER_AUTO_CLAIM',
                // L'IMO qui a ouvert le dossier : c'est le seul élément que le
                // demandeur ait eu à produire, la trace doit le dire.
                vessel_imo: data.vessel_imo,
                mmsi: data.mmsi ?? null,
            },
        });
    }

    return { ok: true, message: GENERIC_MESSAGE, autoClaimedId: shipownerId };
}

async function insertPendingReview(
    supabase: SupabaseClient,
    data: RegisterShipownerInput,
    vessel: MatchedVessel | null,
): Promise<void> {
    // Ce que l'agent doit savoir tient en une ligne : ce que le demandeur a
    // saisi, et ce que la base en a fait. Sans cela il rouvre l'enquête à la
    // main sur chaque dossier.
    const notes = [
        `Demande self-service — navire déclaré IMO ${data.vessel_imo}`,
        data.mmsi ? `MMSI ${data.mmsi}` : null,
        vessel
            ? `rattaché à ${vessel.name ?? 'navire sans nom'} (trouvé par ${vessel.matchedOn})`
            : 'aucun navire correspondant en base',
    ].filter(Boolean).join(' · ');

    const { data: created } = await supabase.from('shipowners').insert({
        name: data.name,
        official_email: data.email,
        official_email_source: 'AGENT_CLAIM',
        proof_imo_vessel_imo: data.vessel_imo,
        notes,
        // `kyc_level_b_completed_at` n'est PAS posé : le niveau B suppose une
        // adresse, un pays et une pièce justificative, que le formulaire ne
        // demande plus. Le dater ici affirmerait une vérification qui n'a pas
        // eu lieu, et l'écran de conformité s'en trouverait faussé.
        account_state: 'PENDING_REVIEW',
    }).select('id, jurisdiction_id').maybeSingle();
    // Pas d'audit_log : l'utilisateur est anonyme et `user_id` est NOT NULL.
    // La ligne shipowners, avec son created_at et son état, EST la trace.

    const row = created as { id: string; jurisdiction_id: string | null } | null;
    if (row?.jurisdiction_id) {
        await notifyStaffSafe(supabase, {
            jurisdictionId: row.jurisdiction_id,
            kind: 'REGISTRATION_SUBMITTED',
            params: { org: data.name },
            deepLink: '/admin/registrations',
            dedupKey: row.id,
        });
    }
}
