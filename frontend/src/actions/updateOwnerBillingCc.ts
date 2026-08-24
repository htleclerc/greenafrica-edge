'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/requireOwner';
import { createTenantClient } from '@/lib/supabase/tenant';
import { normalizeCcEmails, MAX_CC_EMAILS } from '@/lib/armateurContacts';

const schema = z.object({
    emails: z.array(z.string().trim().email()).max(MAX_CC_EMAILS),
});

export type UpdateOwnerBillingCcResult =
    | { ok: true; emails: string[] }
    | { ok: false; reason: string };

/**
 * L'armateur gère lui-même ses copies de facturation.
 *
 * Jusqu'ici seul le personnel pouvait toucher `billing_cc_emails`
 * (`updateArmateurContacts`) : un armateur qui voulait mettre son comptable en
 * copie devait écrire au support. Le geste est le sien, il lui revient.
 *
 * **Ce n'est pas un accès.** Une adresse en copie reçoit les factures, relances
 * et relevés ; elle ne peut PAS ouvrir de session — `requestLoginLink` ne lui
 * envoie aucun lien (scope `BILLING_CC`, journalisé `billing_cc_link_deferred`)
 * et `verifyLoginCode` refuse ce scope. La portée « lecture seule » qu'appelle
 * ce cas n'existe pas encore dans la session ; tant qu'elle n'existe pas,
 * recevoir un double n'est pas détenir le compte.
 *
 * L'écriture passe par le client tenant, borné à la juridiction de l'armateur,
 * ET par un filtre explicite sur son propre identifiant : la portée vient de la
 * session, jamais de l'entrée.
 */
export async function updateOwnerBillingCc(raw: unknown): Promise<UpdateOwnerBillingCcResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        // Un dépassement de plafond se distingue d'une adresse invalide : les
        // deux corrections ne sont pas les mêmes côté écran.
        return {
            ok: false,
            reason: issue?.code === 'too_big' ? 'too_many' : 'invalid_email',
        };
    }

    const ctx = await requireOwner('holder');
    const primary = ctx.shipowner.official_email ?? '';

    // Retire doublons, casse et adresse principale — sans plafonner : le plafond
    // est refusé en amont par le schéma, jamais masqué par une troncature.
    const emails = normalizeCcEmails(parsed.data.emails, primary);

    const admin = createTenantClient(ctx.jurisdictionId);
    const { error } = await admin
        .from('shipowners')
        .update({ billing_cc_emails: emails })
        .eq('id', ctx.shipowner.id);

    if (error) return { ok: false, reason: error.message };

    revalidatePath('/owner/profile');
    return { ok: true, emails };
}
