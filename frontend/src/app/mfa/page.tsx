import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { MfaChallenge } from './MfaChallenge';

// L'état d'élévation vit dans le jeton : jamais de version mise en cache.
export const dynamic = 'force-dynamic';

/**
 * Écran d'élévation au second facteur.
 *
 * Le middleware y envoie ; cette page revérifie plutôt que de faire confiance
 * au fait d'avoir été appelée. Deux raisons : l'URL est visitable à la main, et
 * afficher une demande de code à qui n'en a pas ferait une impasse.
 */
export default async function MfaRoute({
    searchParams,
}: {
    searchParams: Promise<{ redirectTo?: string }>;
}) {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');

    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const pending = aal?.currentLevel === 'aal1' && aal?.nextLevel === 'aal2';

    const { redirectTo } = await searchParams;
    // Destination interne uniquement : un `redirectTo` absolu ferait de cet
    // écran un tremplin de redirection ouverte vers un site tiers.
    const safeTarget = redirectTo?.startsWith('/') && !redirectTo.startsWith('//')
        ? redirectTo
        : '/dashboard';

    if (!pending) redirect(safeTarget);

    return <MfaChallenge redirectTo={safeTarget} />;
}
