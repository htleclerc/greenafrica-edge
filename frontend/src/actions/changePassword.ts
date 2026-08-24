'use server';

import { z } from 'zod';
import { createClient as createStatelessClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { writeAuditLog } from '@/services/auditService';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/passwordPolicy';

const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(MIN_PASSWORD_LENGTH),
});

export type ChangePasswordResult = { ok: true } | { ok: false; reason: string };

/**
 * Change le mot de passe après avoir prouvé l'ancien.
 *
 * Supabase n'exige pas l'ancien mot de passe : `updateUser` suffit à qui tient
 * la session. C'est trop peu — un poste laissé déverrouillé permettrait de
 * verrouiller le compte de son titulaire. On le redemande donc, et on le
 * vérifie contre GoTrue.
 *
 * La vérification passe par un client **sans état** : `signInWithPassword` sur
 * le client lié aux cookies écraserait la session en cours par une session
 * neuve, au passage rétrogradée en AAL1. Ici la session de l'appelant n'est
 * jamais touchée par le contrôle.
 */
export async function changePassword(raw: unknown): Promise<ChangePasswordResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'too_short' };

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user?.email) return { ok: false, reason: 'not_authenticated' };

    if (parsed.data.newPassword === parsed.data.currentPassword) {
        return { ok: false, reason: 'unchanged' };
    }

    const probe = createStatelessClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: wrongPassword } = await probe.auth.signInWithPassword({
        email: auth.user.email,
        password: parsed.data.currentPassword,
    });
    // La session de contrôle ne doit pas survivre à la vérification.
    await probe.auth.signOut({ scope: 'local' });
    if (wrongPassword) return { ok: false, reason: 'wrong_current_password' };

    const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword });
    if (error) return { ok: false, reason: error.message };

    await writeAuditLog(createPlatformClient(), {
        user_id: auth.user.id,
        user_full_name: auth.user.email,
        action: 'PASSWORD_CHANGED',
        severity: 'WARNING',
        entity_type: 'Profile',
        entity_id: auth.user.id,
        // Jamais le mot de passe, ni sa longueur : les deux renseignent une attaque.
        details_json: { method: 'self_service' },
    });

    return { ok: true };
}
