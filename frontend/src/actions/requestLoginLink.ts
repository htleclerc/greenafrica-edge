'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { enforceRateLimit, getClientId } from '@/lib/rateLimit';
import { resolveLoginTarget, resolveStaffLoginTarget } from '@/services/auth/loginAllowlist';
import { resolveOwnerByVesselIdentifier } from '@/services/auth/vesselOwnerLookup';
import { classifyVesselIdentifier } from '@/lib/vessels/identifier';
import { maskEmailHint } from '@/lib/vessels/maskEmail';
import { isContactBlocked } from '@/domain/sanctions/contactGuard';
import { sendLoginLinkEmail } from '@/services/emailService';
import { scopedLogger } from '@/lib/logger';
import { appBaseUrl } from '@/lib/appUrl';

const log = scopedLogger('requestLoginLink');

// `.strict()` volontaire : le formulaire ne propose qu'un champ. Un champ
// supplémentaire est le signe d'une tentative de détournement, pas d'une
// évolution légitime — le payload est refusé tel quel, jamais nettoyé.
const schema = z.object({ query: z.string() }).strict();

/** Le staff atterrit sur son tableau de bord, pas sur le portail armateur. */
const STAFF_CALLBACK_PATH = '/auth/callback';

export type RequestLoginLinkResult =
    | { ok: true; via: 'email' }
    /** Chemin navire : l'indice dit à l'armateur quelle boîte surveiller. */
    | { ok: true; via: 'vessel'; emailHint: string; vesselName: string | null }
    /** Navire non résolu — volontairement indistinguable d'un envoi réussi. */
    | { ok: true; via: 'vessel-unknown' }
    | { ok: false; reason: 'rate_limited' };

/**
 * Envoie un accès au portail à une cible DÉJÀ ENREGISTRÉE.
 *
 * Deux chemins derrière un seul champ, distingués par la forme de la saisie :
 *
 *   — une ADRESSE : la cible vient de la liste d'autorisation (armateur,
 *     représentant rattaché). La réponse est strictement INVARIABLE, sans
 *     indice : l'écran de connexion ne doit jamais dire qui détient un compte.
 *
 *   — un IMO (7 chiffres, somme de contrôle vérifiée) ou un MMSI (9 chiffres) :
 *     la cible est l'armateur qui doit la taxe pour ce navire. L'armateur ne
 *     connaît pas l'adresse enregistrée — souvent celle d'un manager —, donc un
 *     INDICE MASQUÉ lui dit quelle boîte surveiller. C'est un oracle assumé,
 *     borné par le double plafond et par la somme de contrôle IMO qui empêche
 *     qu'une faute de frappe désigne le navire d'un tiers.
 *
 * Le courriel porte LE LIEN ET LE CODE. `generateLink` rend les deux d'un même
 * appel ; les proposer ensemble évite qu'un client de messagerie qui réécrit
 * ou neutralise les liens ne condamne l'accès.
 *
 * Ne crée jamais de compte : l'accès ouvre un compte existant.
 */
export async function requestLoginLink(raw: unknown): Promise<RequestLoginLinkResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: true, via: 'email' };

    const query = parsed.data.query.trim();

    const h = await headers();
    const ipQuota = await enforceRateLimit('login-link', getClientId(h));
    if (!ipQuota.allowed) return { ok: false, reason: 'rate_limited' };

    let admin;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: true, via: 'email' };
    }

    // Une saisie sans arobase est traitée comme un identifiant de navire. Le
    // classement rejette hors ligne tout ce qui n'est ni 7 ni 9 chiffres :
    // aucun appel serveur, aucun quota consommé.
    if (!query.includes('@')) {
        const classified = classifyVesselIdentifier(query);
        if (!classified.ok) return { ok: true, via: 'vessel-unknown' };

        const owner = await resolveOwnerByVesselIdentifier(admin, classified.identifier);
        if (!owner) return { ok: true, via: 'vessel-unknown' };

        if (isContactBlocked({
            name: owner.name, is_ofac_sdn: owner.isOfacSdn, is_un_prohibited: owner.isUnProhibited,
        })) {
            log.warn('sanctioned_login_blocked', { shipownerId: owner.id, via: 'vessel' });
            // Même réponse qu'un navire inconnu : un armateur sanctionné ne
            // doit pas apprendre qu'il est identifié par ce chemin.
            return { ok: true, via: 'vessel-unknown' };
        }

        const ownerQuota = await enforceRateLimit('login-link', `owner:${owner.id}`);
        if (!ownerQuota.allowed) return { ok: false, reason: 'rate_limited' };

        const sent = await mintAndSend(admin, owner.officialEmail, owner.name, owner.vesselName);
        if (!sent) return { ok: true, via: 'vessel-unknown' };

        return {
            ok: true,
            via: 'vessel',
            emailHint: maskEmailHint(owner.officialEmail),
            vesselName: owner.vesselName,
        };
    }

    // ── Chemin adresse : réponse invariable, jamais d'indice ──────────────
    const target = await resolveLoginTarget(admin, query);
    if (!target) return sendToStaffOrGiveUp(admin, query);

    if (isContactBlocked({
        name: target.shipownerName,
        is_ofac_sdn: target.isOfacSdn,
        is_un_prohibited: target.isUnProhibited,
    })) {
        log.warn('sanctioned_login_blocked', { shipownerId: target.shipownerId, via: 'email' });
        return { ok: true, via: 'email' };
    }

    // Copie de facturation : reconnue par la liste d'autorisation, mais aucun
    // accès n'est envoyé. Recevoir un double n'est pas détenir le compte.
    //
    // La mig 135 a donné une portée à la session (owner_members, avec ses
    // sous-permissions) — mais elle vaut pour un MEMBRE explicitement invité,
    // pas pour une adresse mise en copie. Une copie n'a jamais été un accès et
    // ne le devient pas : pour qu'un comptable agisse, on l'invite comme membre
    // avec les cases qui conviennent.
    if (target.scope === 'BILLING_CC') {
        log.info('billing_cc_link_deferred', { shipownerId: target.shipownerId });
        return { ok: true, via: 'email' };
    }

    const ownerQuota = await enforceRateLimit('login-link', `owner:${target.shipownerId}`);
    if (!ownerQuota.allowed) return { ok: false, reason: 'rate_limited' };

    await mintAndSend(admin, target.deliveryEmail, target.shipownerName, null);
    return { ok: true, via: 'email' };
}

/**
 * Dernier ressort du chemin adresse : un compte STAFF, sinon rien.
 *
 * Le staff passe APRÈS l'armateur. L'ordre n'est pas anodin : une adresse qui
 * serait à la fois l'adresse officielle d'un dossier et un profil interne doit
 * ouvrir le dossier, qui porte la garde des sanctions.
 *
 * La réponse reste INVARIABLE — `via: 'email'` qu'une cible ait été trouvée ou
 * non. L'écran de connexion ne doit pas confirmer l'existence d'un compte, et
 * ouvrir le rail au staff ne doit pas transformer le formulaire public en
 * oracle sur les comptes d'administration.
 */
async function sendToStaffOrGiveUp(
    admin: ReturnType<typeof createPlatformClient>,
    query: string,
): Promise<RequestLoginLinkResult> {
    const staff = await resolveStaffLoginTarget(admin, query);
    if (!staff) {
        // Journalisé parce que l'écran, lui, se tait. Sans cette ligne, une
        // adresse mal saisie et un mailer en panne se ressemblent trait pour
        // trait — c'est ce qui a coûté des heures de diagnostic. L'adresse est
        // MASQUÉE : un journal n'est pas un endroit où déverser des
        // coordonnées.
        log.info('login_target_unresolved', { hint: maskEmailHint(query) });
        return { ok: true, via: 'email' };
    }

    const quota = await enforceRateLimit('login-link', `staff:${staff.profileId}`);
    if (!quota.allowed) return { ok: false, reason: 'rate_limited' };

    const sent = await mintAndSend(
        admin, staff.deliveryEmail, staff.fullName ?? 'Green Gate', null, STAFF_CALLBACK_PATH,
    );
    if (!sent) log.warn('staff_link_send_failed', { profileId: staff.profileId });
    return { ok: true, via: 'email' };
}

/**
 * Mine le jeton et envoie lien + code.
 *
 * On mine nous-mêmes plutôt que de laisser GoTrue envoyer : les modèles
 * `[auth.email.template.*]` sont tous commentés dans `supabase/config.toml`,
 * le destinataire recevrait un courriel par défaut, hors charte et non
 * traduit. Un seul appel rend `action_link` ET `email_otp`.
 */
async function mintAndSend(
    admin: ReturnType<typeof createPlatformClient>,
    email: string,
    recipientName: string,
    vesselName: string | null,
    /** Chemin de retour. Le staff n'a rien à faire dans le portail armateur. */
    callbackPath: string = '/owner/auth/callback',
): Promise<boolean> {
    const appUrl = appBaseUrl();
    const { data, error } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo: `${appUrl}${callbackPath}` },
    });

    const link = data?.properties?.action_link;
    const code = data?.properties?.email_otp;
    if (error || !link || !code) {
        log.warn('link_generate_failed', { error: error?.message });
        return false;
    }

    const sent = await sendLoginLinkEmail({ to: email, recipientName, link, code, vesselName });
    if (!sent.success) log.warn('link_send_failed', { error: sent.error });
    return sent.success;
}
