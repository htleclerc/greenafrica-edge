import type { SupabaseClient } from '@supabase/supabase-js';
import {
    parseNotificationPrefs,
    DEFAULT_NOTIFICATION_PREFS,
    type NotificationPrefKey,
} from '@/lib/notificationPrefs';

export interface ProfileSettings {
    fullName: string;
    phone: string | null;
    bio: string | null;
    timezone: string;
    notificationPrefs: Record<NotificationPrefKey, boolean>;
}

/**
 * Les champs du profil que son titulaire peut changer.
 *
 * Ne lit que ce qui est modifiable. Le rôle, le site et l'identifiant viennent
 * déjà du contexte de session : les redemander ici les ferait exister à deux
 * endroits, avec le risque qu'ils divergent le temps d'un rendu.
 *
 * En cas d'échec, rend des valeurs vides et les préférences par défaut — un
 * écran de réglages qui refuse de s'afficher est pire qu'un écran incomplet,
 * et aucune valeur par défaut ici ne débloque quoi que ce soit.
 */
export async function loadProfileSettings(db: SupabaseClient): Promise<ProfileSettings> {
    const { data: auth } = await db.auth.getUser();
    const empty: ProfileSettings = {
        fullName: '',
        phone: null,
        bio: null,
        timezone: 'Africa/Mogadishu',
        notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS },
    };
    if (!auth?.user) return empty;

    const { data, error } = await db
        .from('profiles')
        .select('full_name, phone, bio, timezone, notification_prefs')
        .eq('id', auth.user.id)
        .maybeSingle();

    if (error || !data) return empty;

    const row = data as {
        full_name: string | null;
        phone: string | null;
        bio: string | null;
        timezone: string | null;
        notification_prefs: unknown;
    };

    return {
        fullName: row.full_name ?? '',
        phone: row.phone,
        bio: row.bio,
        timezone: row.timezone ?? empty.timezone,
        notificationPrefs: parseNotificationPrefs(row.notification_prefs),
    };
}
