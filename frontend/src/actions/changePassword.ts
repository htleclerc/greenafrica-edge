'use server';

import { z } from 'zod';
import { createClient as createStatelessClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { writeAuditLog } from '@/services/auditService';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/passwordPolicy';

const schema = z.object({
    /**
     * Vide autorisé : une personne invitée n'a jamais reçu de mot de passe et
     * n'a donc rien à prouver. Le serveur décide, pas le formulaire.
     */
    currentPassword: z.string(),
    newPassword: z.string().min(MIN_PASSWORD_LENGTH),
});

export type ChangePasswordResult = { ok: true } | { ok: false; reason: string };

/**
 * Change le mot de passe après avoir prouvé l'ancien — sauf s'il n'y en a
 * jamais eu.
 *
 * Supabase n'exige pas l'ancien mot de passe : `updateUser` suffit à qui tient
 * la session. C'est trop peu — un poste laissé déverrouillé permettrait de
 * verrouiller le compte de son titulaire. On le redemande donc, et on le
 * vérifie contre GoTrue.
 *
 * Mais une invitation crée le compte avec un mot de passe que l'invité ne
 * connaît pas — aucun pour `inviteUserByEmail`, un jetable pour
 * `invite-armateur`. Lui réclamer l'ancien, c'est lui demander de prouver un
 * secret qu'on ne lui a jamais donné : il ne pouvait pas en choisir un.
 * `profiles.password_set_at` (mig 156) tranche le cas — nulle tant que la
 * personne n'a rien choisi.
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

    // Le marqueur est lu côté serveur, jamais reçu du formulaire : c'est lui
    // qui décide si la preuve est due.
    const platform = createPlatformClient();
    const { data: profile } = await platform
        .from('profiles')
        .select('password_set_at')
        .eq('id', auth.user.id)
        .maybeSingle();
    const dejaChoisi = Boolean((profile as { password_set_at?: string | null } | null)?.password_set_at);

    if (dejaChoisi) {
        if (!parsed.data.currentPassword) return { ok: false, reason: 'wrong_current_password' };
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
    }

    const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword });
    if (error) return { ok: false, reason: error.message };

    // Poser la marque APRÈS le succès : une tentative échouée ne doit pas
    // enfermer un invité derrière une preuve qu'il ne peut toujours pas donner.
    if (!dejaChoisi) {
        await platform.from('profiles')
            .update({ password_set_at: new Date().toISOString() })
            .eq('id', auth.user.id);
    }

    await writeAuditLog(createPlatformClient(), {
        user_id: auth.user.id,
        user_full_name: auth.user.email,
        action: 'PASSWORD_CHANGED',
        severity: 'WARNING',
        entity_type: 'Profile',
        entity_id: auth.user.id,
        // Jamais le mot de passe, ni sa longueur : les deux renseignent une attaque.
        details_json: { method: dejaChoisi ? 'self_service' : 'initial_setup' },
    });

    return { ok: true };
}
