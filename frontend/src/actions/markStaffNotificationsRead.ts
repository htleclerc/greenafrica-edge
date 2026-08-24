'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const oneSchema = z.object({ notificationId: z.string().uuid() });

export type MarkReadResult = { ok: true; count: number } | { ok: false; reason: string };

/**
 * Marque une notification staff comme lue **pour l'agent courant**.
 *
 * Écrit avec le client de session, jamais en service-role : la policy de la
 * mig 133 épingle `profile_id` à `auth.uid()` en `WITH CHECK`, ce qui rend
 * structurellement impossible de marquer lu à la place d'un collègue. Passer en
 * service-role ferait sauter précisément cette garantie.
 *
 * `upsert` plutôt qu'`insert` : deux onglets ouverts marquent la même ligne, et
 * un doublon sur la clé primaire n'est pas une erreur à remonter.
 */
export async function markStaffNotificationRead(raw: unknown): Promise<MarkReadResult> {
    const parsed = oneSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'invalid input' };

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'unauthenticated' };

    const { error } = await supabase
        .from('staff_notification_reads')
        .upsert(
            { notification_id: parsed.data.notificationId, profile_id: auth.user.id },
            { onConflict: 'notification_id,profile_id' },
        );

    if (error) return { ok: false, reason: error.message };
    return { ok: true, count: 1 };
}

/**
 * Marque lues toutes les notifications que l'agent courant peut voir.
 *
 * Les identifiants sont relus depuis `v_staff_notifications`, donc déjà bornés
 * par RLS à sa juridiction et à son rôle : l'agent ne peut pas marquer lu ce
 * qui ne lui était pas destiné, même en forgeant la requête.
 */
export async function markAllStaffNotificationsRead(): Promise<MarkReadResult> {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'unauthenticated' };

    const { data: unread, error: readError } = await supabase
        .from('v_staff_notifications')
        .select('id')
        .is('read_at', null);

    if (readError) return { ok: false, reason: readError.message };

    const rows = (unread ?? []).map((n) => ({
        notification_id: (n as { id: string }).id,
        profile_id: auth.user.id,
    }));
    if (rows.length === 0) return { ok: true, count: 0 };

    const { error } = await supabase
        .from('staff_notification_reads')
        .upsert(rows, { onConflict: 'notification_id,profile_id' });

    if (error) return { ok: false, reason: error.message };
    return { ok: true, count: rows.length };
}
