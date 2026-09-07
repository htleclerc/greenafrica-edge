'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { appBaseUrl } from '@/lib/appUrl';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { enforceRateLimit, getClientId } from '@/lib/rateLimit';
import { sendPasswordResetEmail } from '@/services/emailService';
import { maskEmailHint } from '@/lib/vessels/maskEmail';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('requestPasswordReset');

const schema = z.object({ email: z.string() }).strict();

export type RequestPasswordResetResult =
    | { ok: true }
    | { ok: false; reason: 'rate_limited' };

/**
 * Envoie un lien de réinitialisation de mot de passe.
 *
 * Pourquoi une action serveur plutôt que `resetPasswordForEmail`.
 *
 * `resetPasswordForEmail` laisse GoTrue expédier le courriel, et cela a
 * échoué deux fois de suite en production, pour deux raisons distinctes :
 *
 *   — le message partait dans le gabarit PAR DÉFAUT de Supabase, hors charte.
 *     Les gabarits de `supabase/templates/` ne valent que pour la pile
 *     locale : ils ne sont jamais téléversés vers le projet hébergé, dont la
 *     console garde ses propres copies ;
 *
 *   — son lien ne menait à `/auth/callback` que si cette cible figurait dans
 *     les « Redirect URLs » du projet. Sinon GoTrue retombait sur le Site URL
 *     en déposant le jeton dans un FRAGMENT, que le serveur ne voit jamais.
 *
 * On mine donc le jeton nous-mêmes et on envoie NOTRE courriel, avec un lien
 * qui frappe nos propres routes. Rien ne dépend plus d'une console que nous
 * ne maîtrisons pas.
 *
 * La réponse est INVARIABLE, adresse connue ou non : l'écran « mot de passe
 * oublié » ne doit pas confirmer l'existence d'un compte.
 */
export async function requestPasswordReset(raw: unknown): Promise<RequestPasswordResetResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: true };

    const email = parsed.data.email.trim().toLowerCase();
    if (!email.includes('@') || email.length < 5) return { ok: true };

    const h = await headers();
    // Même plafond que le lien de connexion : le formulaire est public et
    // déclenche un envoi vers une adresse tierce.
    const quota = await enforceRateLimit('login-link', `reset:${getClientId(h)}`);
    if (!quota.allowed) return { ok: false, reason: 'rate_limited' };

    let admin;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: true };
    }

    // Le compte doit exister ET être actif. `generateLink` de type `recovery`
    // échouerait de toute façon sur une adresse inconnue, mais le vérifier ici
    // évite un appel sortant et journalise proprement.
    const { data: profile, error } = await admin
        .from('profiles')
        .select('id, email, full_name, is_active')
        .eq('email', email)
        .eq('is_active', true)
        .limit(1);
    if (error) log.error('profile_lookup_failed', { error: error.message });

    const row = (profile ?? [])[0] as { full_name?: string | null } | undefined;
    if (!row) {
        // Journalisé parce que l'écran, lui, se tait. Adresse MASQUÉE : un
        // journal n'est pas un endroit où déverser des coordonnées.
        log.info('reset_target_unresolved', { hint: maskEmailHint(email) });
        return { ok: true };
    }

    const { data, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
    });
    const tokenHash = data?.properties?.hashed_token;
    if (linkErr || !tokenHash) {
        log.warn('reset_link_generate_failed', { error: linkErr?.message });
        return { ok: true };
    }

    // `type=recovery` : c'est ce que `/auth/callback` lit pour router vers
    // l'écran de choix du nouveau mot de passe.
    const link = `${appBaseUrl()}/auth/callback`
        + `?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;

    const sent = await sendPasswordResetEmail({
        to: email,
        recipientName: row.full_name ?? 'there',
        link,
    });
    if (!sent.success) log.warn('reset_send_failed', { error: sent.error });

    return { ok: true };
}
