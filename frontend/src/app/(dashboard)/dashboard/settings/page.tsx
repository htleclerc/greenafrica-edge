import { SettingsPage } from '@/components/dashboard/settings/SettingsPage';
import { createClient } from '@/lib/supabase/server';
import { loadSecurityOverview } from '@/services/securityService';
import { loadProfileSettings } from '@/services/profileSettingsService';

// L'état de sécurité se lit à chaque affichage : un facteur retiré depuis un
// autre appareil ne doit pas rester annoncé actif par une page mise en cache.
export const dynamic = 'force-dynamic';

export default async function SettingsRoute() {
    const supabase = await createClient();
    const [security, profile] = await Promise.all([
        loadSecurityOverview(supabase),
        loadProfileSettings(supabase),
    ]);
    return <SettingsPage security={security} profile={profile} />;
}
