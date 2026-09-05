import { sendRegistrationApprovalEmail } from '@/services/emailService';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { appBaseUrl } from '@/lib/appUrl';

export type ApprovalResult =
    | { ok: true; userId: string; emailSent: boolean }
    | { ok: false; reason: string; status: number };

/**
 * Approuve une demande d'inscription : active le profil, clôt la demande,
 * notifie le demandeur.
 *
 * Extrait de `POST /api/auth/approve` pour que la file de validation unifiée
 * (`/admin/validations`) et la route historique partagent la même
 * implémentation — une deuxième version de l'activation de compte serait
 * l'endroit exact où les deux écrans finiraient par diverger.
 *
 * **Ne vérifie pas le rôle de l'appelant** : chaque point d'entrée le fait avant
 * d'appeler (la route via `requireRole`, l'action via son propre contrôle). La
 * fonction écrit avec le client plateforme, qui contourne RLS.
 */
export async function approveRegistrationRequest(
    requestId: string,
    reviewNote: string | null,
    reviewerId?: string,
): Promise<ApprovalResult> {
    const admin = createPlatformClient();

    const { data: request, error: requestError } = await admin
        .from('registration_requests')
        .select('*')
        .eq('id', requestId)
        .single();

    if (requestError || !request) return { ok: false, reason: 'Registration request not found', status: 404 };
    if (request.status === 'APPROVED') return { ok: false, reason: 'Already approved', status: 409 };

    const { data: targetProfile, error: profileError } = await admin
        .from('profiles')
        .select('id')
        .eq('email', request.contact_email)
        .single();

    if (profileError || !targetProfile) {
        return {
            ok: false,
            reason: 'No user account found for this email. The applicant must complete signup first.',
            status: 404,
        };
    }

    // On ne bascule que is_active. Le rôle en base a déjà été posé par
    // /api/auth/register via ROLE_MAP — le réécrire ici avec requested_role
    // enregistrerait un rôle de formulaire (p. ex. FLEET_MANAGER) dans la colonne
    // enum user_role et lèverait une violation. Source unique : le mappage à
    // l'inscription.
    const { error: updateError } = await admin
        .from('profiles')
        .update({ is_active: true })
        .eq('id', targetProfile.id);

    if (updateError) return { ok: false, reason: updateError.message, status: 500 };

    await admin
        .from('registration_requests')
        .update({
            status: 'APPROVED',
            reviewed_by: reviewerId ?? null,
            reviewed_at: new Date().toISOString(),
            review_note: reviewNote,
        })
        .eq('id', requestId);

    const { data: fullProfile } = await admin
        .from('profiles')
        .select('email, full_name, role, operational_site')
        .eq('id', targetProfile.id)
        .single();

    let emailSent = false;
    if (fullProfile?.email) {
        const appUrl = appBaseUrl();
        const result = await sendRegistrationApprovalEmail({
            to: fullProfile.email,
            recipientName: fullProfile.full_name || 'User',
            role: fullProfile.role,
            operationalSite: fullProfile.operational_site,
            activationUrl: `${appUrl}/login`,
        });
        emailSent = result.success;
        // Le compte est activé même si l'e-mail échoue : l'échec est tracé, il ne
        // fait pas reculer l'approbation.
        if (!result.success) console.error('[Approve] Email failed:', result.error);
    }

    return { ok: true, userId: targetProfile.id, emailSent };
}
