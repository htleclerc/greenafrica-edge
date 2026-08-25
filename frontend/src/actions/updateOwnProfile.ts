'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { NOTIFICATION_PREF_KEYS } from '@/lib/notificationPrefs';

const profileSchema = z.object({
    fullName: z.string().trim().min(2).max(120),
    // Chaînes vides admises et rangées en NULL : effacer un champ facultatif
    // est un geste normal, et une chaîne vide en base se lirait comme « rempli ».
    phone: z.string().trim().max(40).optional(),
    bio: z.string().trim().max(500).optional(),
    timezone: z.string().trim().max(64).optional(),
});

const prefsSchema = z.object({
    prefs: z.record(z.string(), z.boolean()),
});

export type ProfileActionResult = { ok: true } | { ok: false; reason: string };

const blank = (v: string | undefined) => (v && v.length > 0 ? v : null);

/**
 * Met à jour ce qu'une personne peut changer sur elle-même.
 *
 * Aucune colonne de privilège n'est nommée ici, et ce n'est pas ce qui protège :
 * le verrou de la mig 140 refuse tout ce qui sort de sa liste blanche, même si
 * cette action se mettait un jour à envoyer davantage. Le contrôle est en base,
 * là où il tient quel que soit l'appelant — y compris un PATCH PostgREST direct.
 */
export async function updateOwnProfile(raw: unknown): Promise<ProfileActionResult> {
    const parsed = profileSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'invalid_input' };

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not_authenticated' };

    const { error } = await supabase
        .from('profiles')
        .update({
            full_name: parsed.data.fullName,
            phone: blank(parsed.data.phone),
            bio: blank(parsed.data.bio),
            ...(parsed.data.timezone ? { timezone: parsed.data.timezone } : {}),
        })
        .eq('id', auth.user.id);

    if (error) return { ok: false, reason: error.message };

    revalidatePath('/dashboard/settings');
    return { ok: true };
}

/**
 * Enregistre les préférences d'envoi.
 *
 * Les clés inconnues sont écartées plutôt que stockées : la colonne resterait
 * sinon un dépotoir de bascules retirées de l'écran, et on ne saurait plus
 * lesquelles gouvernent encore quelque chose.
 */
export async function updateNotificationPrefs(raw: unknown): Promise<ProfileActionResult> {
    const parsed = prefsSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'invalid_input' };

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not_authenticated' };

    const known = Object.fromEntries(
        NOTIFICATION_PREF_KEYS
            .filter((key) => key in parsed.data.prefs)
            .map((key) => [key, parsed.data.prefs[key]]),
    );

    const { error } = await supabase
        .from('profiles')
        .update({ notification_prefs: known })
        .eq('id', auth.user.id);

    if (error) return { ok: false, reason: error.message };

    revalidatePath('/dashboard/settings');
    return { ok: true };
}
