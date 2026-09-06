'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { enforceRateLimit, getClientId } from '@/lib/rateLimit';
import { resolveLoginTarget, resolveStaffLoginTarget } from '@/services/auth/loginAllowlist';
import { verifyVesselAccessCode } from '@/actions/verifyVesselAccessCode';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('verifyLoginCode');

const schema = z.object({
    query: z.string(),
    code: z.string().trim().min(4).max(10),
}).strict();

export type VerifyLoginCodeResult =
    | { ok: true; redirectTo: string }
    | { ok: false; reason: 'invalid_code' | 'rate_limited' };

/**
 * Vérifie le code à six chiffres saisi sur l'écran de connexion.
 *
 * DEUX CHEMINS, DEUX MÉCANIQUES.
 *
 * Saisie d'un NAVIRE : on délègue intégralement à `verifyVesselAccessCode`.
 * Cette action ne fait pas que vérifier le code — elle réalise le PREMIER
 * rattachement du compte à l'armateur, avec une garde qui refuse tout
 * TRANSFERT d'une ligne `shipowners` d'un compte à un autre. Réécrire cette
 * logique ici en dupliquerait les gardes, et deux implémentations d'une règle
 * de sécurité finissent toujours par diverger.
 *
 * Saisie d'une ADRESSE : le compte existe déjà et est actif — il a été mis en
 * service par le script. Aucun rattachement à faire, seulement ouvrir la
 * session. On vérifie donc le jeton contre l'adresse de livraison résolue par
 * la liste d'autorisation, jamais contre la saisie : sans cela, connaître une
 * adresse d'armateur suffirait à tenter des codes contre elle.
 *
 * Les motifs d'échec sont réduits à `invalid_code` : distinguer « code faux »
 * de « cible inconnue » rendrait à l'écran de connexion l'oracle que la
 * demande d'accès refuse déjà.
 */
export async function verifyLoginCode(raw: unknown): Promise<VerifyLoginCodeResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'invalid_code' };

    const query = parsed.data.query.trim();
    const code = parsed.data.code.replace(/\s/g, '');

    const h = await headers();
    const quota = await enforceRateLimit('login-link', `verify:${getClientId(h)}`);
    if (!quota.allowed) return { ok: false, reason: 'rate_limited' };

    // ── Chemin navire : délégation complète ───────────────────────────────
    if (!query.includes('@')) {
        const r = await verifyVesselAccessCode({ identifier: query, code });
        if (r.ok) return { ok: true, redirectTo: r.redirectTo };
        return {
            ok: false,
            reason: r.reason === 'rate_limited' ? 'rate_limited' : 'invalid_code',
        };
    }

    // ── Chemin adresse : vérification simple, sans rattachement ───────────
    let admin;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: false, reason: 'invalid_code' };
    }

    const target = await resolveLoginTarget(admin, query);

    // Le staff a le même rail depuis qu'il dispose d'un lien de connexion.
    // Il passe APRÈS l'armateur, comme à l'émission : une adresse qui serait
    // les deux ouvre le dossier, qui porte la garde des sanctions.
    if (!target || target.scope === 'BILLING_CC') {
        const staff = await resolveStaffLoginTarget(admin, query);
        // Une cible inconnue rend le même motif qu'un code faux : l'écran ne
        // doit pas confirmer l'existence d'un compte.
        if (!staff) return { ok: false, reason: 'invalid_code' };

        const supabaseStaff = await createClient();
        const { data: staffSession, error: staffErr } = await supabaseStaff.auth.verifyOtp({
            email: staff.deliveryEmail,
            token: code,
            type: 'email',
        });
        if (staffErr || !staffSession?.user) {
            log.info('otp_rejected', { profileId: staff.profileId });
            return { ok: false, reason: 'invalid_code' };
        }
        // Pas `/post-login` : cet écran sert à choisir un rôle à endosser, il
        // n'a rien à voir avec l'ouverture de session d'un agent.
        return { ok: true, redirectTo: '/dashboard' };
    }

    const supabase = await createClient();
    const { data: session, error } = await supabase.auth.verifyOtp({
        email: target.deliveryEmail,
        token: code,
        type: 'email',
    });

    if (error || !session?.user) {
        log.info('otp_rejected', { shipownerId: target.shipownerId });
        return { ok: false, reason: 'invalid_code' };
    }

    return { ok: true, redirectTo: '/post-login' };
}
