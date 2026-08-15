'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { enforceRateLimit, getClientId } from '@/lib/rateLimit';
import { normalizeVesselIdentifier } from '@/lib/vessels/identifier';
import { maskEmailHint } from '@/lib/vessels/maskEmail';
import { scopedLogger } from '@/lib/logger';
import { sendVesselAccessCodeEmail } from '@/services/emailService';

const log = scopedLogger('requestVesselAccessCode');

// Volontairement `.strict()` : le formulaire ne propose aucun champ e-mail, et
// un champ supplémentaire dans le payload est le signe d'une tentative de
// détournement, pas d'une évolution légitime. Un payload qui échoue ce parse
// est REFUSÉ tel quel (invalid_identifier) — aucun champ n'est jamais
// récupéré hors du schéma. Voir G4.
const schema = z.object({ identifier: z.string() }).strict();

const OUTSTANDING = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'];

export type RequestAccessCodeResult =
    | { ok: true; emailHint: string }
    | { ok: false; reason: 'invalid_identifier' | 'not_claimable' | 'rate_limited' | 'send_failed' };

/**
 * Envoie un code d'accès à l'adresse DÉJÀ ENREGISTRÉE pour l'armateur du
 * navire recherché.
 *
 * Le code ouvre le compte armateur entier — tous ses navires, tout son
 * portefeuille — et non le seul navire recherché. C'est cohérent : c'est
 * l'armateur légitime qui lit sa boîte. Cela veut aussi dire que la qualité de
 * shipowners.official_email porte à elle seule le modèle de sécurité de ce
 * chemin.
 *
 * Gardes (spec §Sécurité) :
 *   G2 — un armateur is_placeholder ne déclenche jamais d'envoi ;
 *   G3 — double plafond, par IP et par armateur ;
 *   G4 — l'adresse d'envoi vient de la base, jamais de l'entrée.
 */
export async function requestVesselAccessCode(raw: unknown): Promise<RequestAccessCodeResult> {
    const parsed = schema.safeParse(raw);
    // Un champ inattendu (ex. `email`) fait échouer .strict() — le payload est
    // refusé tel quel, pas nettoyé. G4 : rien n'est jamais repris hors du
    // schéma validé.
    if (!parsed.success) return { ok: false, reason: 'invalid_identifier' };

    const identifier = normalizeVesselIdentifier(parsed.data.identifier);
    if (!identifier) return { ok: false, reason: 'invalid_identifier' };

    const h = await headers();
    const ipQuota = await enforceRateLimit('vessel-claim', getClientId(h));
    if (!ipQuota.allowed) return { ok: false, reason: 'rate_limited' };

    let admin: SupabaseClient;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: false, reason: 'send_failed' };
    }

    // `transactions` ne porte que vessel_imo — pas de colonne MMSI. Une
    // recherche par MMSI doit donc passer par vessels pour obtenir l'IMO.
    let imo = identifier.value;
    if (identifier.kind === 'MMSI') {
        const { data: vessel } = await admin
            .from('vessels').select('imo_number').eq('mmsi', identifier.value).maybeSingle();
        if (!vessel?.imo_number) return { ok: false, reason: 'not_claimable' };
        imo = vessel.imo_number;
    }

    // Résolution via transactions.shipowner_id — first-write-only (trigger de
    // mig 089), donc porteuse de l'attribution fiscale faisant foi. Ne pas
    // « simplifier » vers vessels.shipowner_id, librement modifiable.
    // .not('shipowner_id', 'is', null) : sans ce filtre, un pro-forma AIR
    // récent auto-émis pour un navire non apparié (proformaPipelineService,
    // shipowner_id: vessel.shipowner_id ?? null) devient la ligne "la plus
    // récente" retenue ici et fait échouer not_claimable — alors même que le
    // RPC vessel_payment_teaser (JOIN shipowners) a déjà écarté cette ligne
    // et affiché claimable=true sur la base d'un avis attribué plus ancien.
    // Les deux résolutions doivent porter sur le même sous-ensemble.
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
        .select('id, name, official_email, official_email_source, is_placeholder')
        .eq('id', txn.shipowner_id)
        .maybeSingle();

    // G2 : le placeholder est refusé AVANT tout envoi, indépendamment de la
    // présence d'un e-mail sur la ligne.
    if (!owner || owner.is_placeholder) return { ok: false, reason: 'not_claimable' };
    if (!owner.official_email) return { ok: false, reason: 'not_claimable' };

    // G3 : second plafond, keyé sur l'armateur. Sans lui, faire varier l'IP
    // suffirait à inonder la boîte de l'armateur.
    const ownerQuota = await enforceRateLimit('vessel-claim', `owner:${owner.id}`);
    if (!ownerQuota.allowed) return { ok: false, reason: 'rate_limited' };

    // G4 : l'adresse vient de la base. Aucune valeur d'entrée n'y contribue.
    //
    // On ne passe plus par signInWithOtp() : GoTrue enverrait alors SON propre
    // template ("Magic Link" pour un user existant, "Confirm signup" pour un
    // nouveau), et les deux ne portent que {{ .ConfirmationURL }} — aucun des
    // blocs [auth.email.template.*] n'est configuré (supabase/config.toml
    // ~L229, tous commentés). L'armateur recevrait un lien, jamais le code à
    // six chiffres qu'attend ClaimByCodePanel. On mine le token nous-mêmes
    // via generateLink (même pattern que /auth/sl/route.ts) et on envoie le
    // code par notre propre e-mail (emailService/Resend), comme tout le reste
    // de la plateforme.
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: owner.official_email,
        options: {
            // handle_new_user attribuait PORT_OFFICER faute de role dans les
            // métadonnées — ce qui ouvrirait les audit_logs non tagués (RLS
            // mig 100) à un armateur auto-rattaché. Depuis la mig 120 le repli
            // du trigger est SHIPOWNER, mais on continue de le demander
            // explicitement : 'SHIPOWNER' est le seul rôle de l'allowlist du
            // canal client, donc ce chemin reste correct même si le repli
            // change. Ces métadonnées ne s'appliquent qu'à la CRÉATION du
            // user : un compte existant (staff compris) n'est jamais
            // rétrogradé par cet appel.
            //
            // is_active n'y figure plus : la mig 120 ne l'accepte QUE depuis
            // raw_app_meta_data (canal service_role), hors de portée de
            // generateLink — dont les options sont typées
            // Pick<GenerateLinkOptions, 'data' | 'redirectTo'> et dont `data`
            // alimente raw_user_meta_data. L'activation est donc reposée
            // juste après, explicitement.
            data: { role: 'SHIPOWNER' },
        },
    });

    if (linkError || !linkData?.properties?.email_otp) {
        log.warn('otp_generate_failed', { ownerId: owner.id, error: linkError?.message });
        return { ok: false, reason: 'send_failed' };
    }

    // Réactive le profil que le trigger vient de créer inactif.
    //
    // `.eq('role', 'SHIPOWNER')` n'est pas cosmétique : generateLink renvoie le
    // compte EXISTANT quand l'adresse en a déjà un. Sans ce filtre, un membre du
    // staff dont l'adresse est aussi l'official_email d'un armateur se verrait
    // activé (ou, si on écrivait aussi le rôle, rétrogradé) par un simple appel
    // public à cette action. Le filtre borne l'écriture aux lignes déjà sans
    // privilège — elle ne peut donc rien élever.
    //
    // Non bloquant : le code est déjà miné et l'e-mail part quand même. Après
    // rattachement (verifyVesselAccessCode pose shipowners.profile_id +
    // account_state='ACTIVE'), requirePrincipal résout l'armateur par la
    // branche opérateur, qui ne lit pas profiles.is_active.
    if (linkData.user?.id) {
        const { error: activateError } = await admin
            .from('profiles')
            .update({ is_active: true })
            .eq('id', linkData.user.id)
            .eq('role', 'SHIPOWNER');
        if (activateError) {
            log.warn('owner_profile_activation_failed', {
                ownerId: owner.id,
                error: activateError.message,
            });
        }
    }

    const emailResult = await sendVesselAccessCodeEmail({
        to: owner.official_email,
        recipientName: owner.name,
        code: linkData.properties.email_otp,
    });

    if (!emailResult.success) {
        log.warn('otp_send_failed', { ownerId: owner.id, error: emailResult.error });
        return { ok: false, reason: 'send_failed' };
    }

    return { ok: true, emailHint: maskEmailHint(owner.official_email) };
}
