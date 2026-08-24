'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { writeAuditLog } from '@/services/auditService';

const schema = z.object({ sessionId: z.string().uuid() });

export type RevokeSessionResult = { ok: true } | { ok: false; reason: string };

/**
 * Ferme une session ouverte sur un autre appareil.
 *
 * La portée n'est pas contrôlée ici : `revoke_user_session` (mig 137) filtre
 * sur `auth.uid()` dans son WHERE. Un identifiant forgé ne supprime donc rien,
 * et la fonction rend FAUX sans dire si la session existait — l'appelant
 * n'apprend rien sur les sessions d'autrui.
 *
 * Fermer sa PROPRE session est refusé : le geste attendu s'appelle se
 * déconnecter, il est ailleurs, et le confondre avec celui-ci ferait
 * disparaître l'écran sous les doigts de la personne.
 */
export async function revokeSession(raw: unknown): Promise<RevokeSessionResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'invalid_input' };

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not_authenticated' };

    // Quelle session est la courante ? La base le sait — elle lit `session_id`
    // dans le jeton. Le déduire ici demanderait de décoder le JWT à la main.
    const { data: mine } = await supabase.rpc('current_user_sessions');
    const target = ((mine ?? []) as { id: string; is_current: boolean | null }[])
        .find((s) => s.id === parsed.data.sessionId);
    if (!target) return { ok: false, reason: 'not_found' };
    if (target.is_current === true) return { ok: false, reason: 'is_current' };

    const { data, error } = await supabase.rpc('revoke_user_session', {
        p_session_id: parsed.data.sessionId,
    });
    if (error) return { ok: false, reason: error.message };
    if (data !== true) return { ok: false, reason: 'not_found' };

    await writeAuditLog(createPlatformClient(), {
        user_id: auth.user.id,
        user_full_name: auth.user.email ?? '—',
        action: 'SESSION_REVOKED',
        severity: 'WARNING',
        entity_type: 'Profile',
        entity_id: auth.user.id,
        details_json: { session_id: parsed.data.sessionId },
    });

    revalidatePath('/dashboard/settings');
    return { ok: true };
}
