'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { enforceRateLimit, getClientId } from '@/lib/rateLimit';
import { resolveLoginTarget } from '@/services/auth/loginAllowlist';
import { isContactBlocked } from '@/domain/sanctions/contactGuard';
import { sendLoginLinkEmail } from '@/services/emailService';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('requestLoginLink');

// `.strict()` volontaire : le formulaire ne propose qu'une adresse. Un champ
// supplémentaire est le signe d'une tentative de détournement, pas d'une
// évolution légitime — le payload est refusé tel quel, jamais nettoyé.
const schema = z.object({ email: z.string() }).strict();

export type RequestLoginLinkResult =
    | { ok: true }
    | { ok: false; reason: 'rate_limited' };

/**
 * Envoie un lien de connexion à une adresse DÉJÀ ENREGISTRÉE.
 *
 * Ne crée jamais de compte : le lien ouvre un compte existant, il n'inscrit
 * personne. C'est la contrainte posée par le PO — pas d'inscription par lien
 * magique.
 *
 * LA RÉPONSE EST INVARIABLE. Succès, adresse inconnue, saisie invalide,
 * armateur sanctionné, échec de minage, échec d'envoi : tout rend
 * `{ ok: true }`. Seul le plafond de débit se distingue, et il ne renseigne
 * pas sur l'existence d'un compte. Sans cette uniformité, le formulaire
 * deviendrait un révélateur de débiteurs — on saurait qui doit de l'argent à
 * Berbera en essayant des adresses.
 */
export async function requestLoginLink(raw: unknown): Promise<RequestLoginLinkResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: true };

    const h = await headers();
    const ipQuota = await enforceRateLimit('login-link', getClientId(h));
    if (!ipQuota.allowed) return { ok: false, reason: 'rate_limited' };

    let admin;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: true };
    }

    const target = await resolveLoginTarget(admin, parsed.data.email);
    if (!target) return { ok: true };

    // Règle métier absolue : un armateur sous sanctions ne reçoit jamais de
    // contact direct de la plateforme. Le recouvrement passe par la saisie
    // in rem via Me Eidle Omer.
    if (isContactBlocked({
        name: target.shipownerName,
        is_ofac_sdn: target.isOfacSdn,
        is_un_prohibited: target.isUnProhibited,
    })) {
        log.warn('sanctioned_login_blocked', { shipownerId: target.shipownerId });
        return { ok: true };
    }

    // Copie de facturation : reconnue par la liste d'autorisation, mais aucun
    // lien n'est envoyé pour l'instant. Une session issue d'une copie doit
    // être restreinte à la lecture des factures, or la portée n'est portée
    // nulle part dans la session — `requirePrincipal` ne résout qu'un
    // armateur. Ouvrir le portail complet à un comptable en copie lui
    // donnerait les litiges, la conformité et les moyens de paiement.
    // Recevoir un double n'est pas détenir le compte.
    if (target.scope === 'BILLING_CC') {
        log.info('billing_cc_link_deferred', { shipownerId: target.shipownerId });
        return { ok: true };
    }

    // Second plafond, keyé sur l'armateur : sans lui, faire varier l'IP
    // suffirait à inonder sa boîte.
    const ownerQuota = await enforceRateLimit('login-link', `owner:${target.shipownerId}`);
    if (!ownerQuota.allowed) return { ok: false, reason: 'rate_limited' };

    // On mine le jeton nous-mêmes : les modèles GoTrue ne sont pas configurés
    // (tous les blocs [auth.email.template.*] sont commentés dans
    // supabase/config.toml), l'armateur recevrait un courriel par défaut.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3300';
    const { data, error } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: target.deliveryEmail,
        options: { redirectTo: `${appUrl}/owner/auth/callback` },
    });

    if (error || !data?.properties?.action_link) {
        log.warn('link_generate_failed', {
            shipownerId: target.shipownerId,
            error: error?.message,
        });
        return { ok: true };
    }

    const sent = await sendLoginLinkEmail({
        to: target.deliveryEmail,
        recipientName: target.shipownerName,
        link: data.properties.action_link,
    });
    if (!sent.success) {
        log.warn('link_send_failed', { shipownerId: target.shipownerId, error: sent.error });
    }

    return { ok: true };
}
