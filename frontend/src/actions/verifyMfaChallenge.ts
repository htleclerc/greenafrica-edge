'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const schema = z.object({ code: z.string().trim().regex(/^\d{6}$/) });

export type VerifyMfaChallengeResult = { ok: true } | { ok: false; reason: string };

/**
 * Franchit le second facteur d'une session déjà ouverte.
 *
 * Distinct de `verifyMfaEnrollment` : là on prouvait qu'un facteur neuf
 * fonctionne, ici on prouve qu'on détient un facteur déjà en place. Les deux
 * finissent sur `mfa.verify`, mais l'un crée une protection et l'autre la
 * franchit — les confondre ferait qu'un code valide sur un facteur non vérifié
 * élèverait la session.
 *
 * Réussir réécrit les cookies avec un jeton AAL2 ; le middleware laisse alors
 * passer. Rien d'autre n'est à faire : l'élévation vit dans le jeton, pas dans
 * un drapeau applicatif qu'il faudrait penser à poser.
 */
export async function verifyMfaChallenge(raw: unknown): Promise<VerifyMfaChallengeResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'invalid_code' };

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not_authenticated' };

    const { data: factors } = await supabase.auth.mfa.listFactors();
    const factor = (factors?.totp ?? []).find((f) => f.status === 'verified');
    if (!factor) return { ok: false, reason: 'no_factor' };

    const { data: challenge, error: challengeErr } =
        await supabase.auth.mfa.challenge({ factorId: factor.id });
    if (challengeErr || !challenge) return { ok: false, reason: 'challenge_failed' };

    const { error } = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.id,
        code: parsed.data.code,
    });
    // Le motif ne distingue pas « mauvais code » de « code expiré » : les deux
    // se corrigent de la même façon, et les séparer renseignerait qui essaie.
    if (error) return { ok: false, reason: 'invalid_code' };

    return { ok: true };
}
