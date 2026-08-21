import { type SupabaseClient } from '@supabase/supabase-js';

export interface ProvisionInput {
    email: string;
    fullName: string;
}

export interface ProvisionResult {
    profileId: string;
    /** Faux quand l'adresse avait déjà un compte — l'opération est rejouable. */
    created: boolean;
}

/** Le cap de listUsers ; au-delà, la recherche d'un compte existant décrocherait. */
const LIST_USERS_PAGE_SIZE = 200;

/**
 * Crée SILENCIEUSEMENT un compte armateur.
 *
 * `createUser` et non `inviteUserByEmail` : ce dernier déclenche un envoi par
 * le SMTP de Supabase, or la décision PO est de ne rien envoyer — l'accès
 * passe par la relance suivante, dont le lien fonctionne enfin. Vingt-six
 * armateurs relancés le 19 août, un seul profil en base : c'est ce trou que
 * cette fonction comble, sans ajouter un envoi de plus.
 *
 * `email_confirm: true` parce qu'aucun courriel de confirmation ne partira ;
 * sans cela le compte resterait non confirmé et le lien magique échouerait au
 * premier usage.
 *
 * Idempotent : une adresse déjà connue rend son profil existant.
 */
export async function provisionOwnerAccount(
    admin: SupabaseClient,
    input: ProvisionInput,
): Promise<ProvisionResult> {
    const email = input.email.trim().toLowerCase();

    const { data: created, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: input.fullName, role: 'SHIPOWNER' },
    });

    let profileId: string;
    let wasCreated = true;

    if (created?.user) {
        profileId = created.user.id;
    } else if (error && (error.code === 'email_exists' || /already/i.test(error.message))) {
        const { data: list, error: listErr } = await admin.auth.admin.listUsers({
            page: 1, perPage: LIST_USERS_PAGE_SIZE,
        });
        if (listErr) throw new Error(`recherche du compte existant : ${listErr.message}`);
        // Comparaison en minuscules des deux côtés : GoTrue conserve la casse
        // de saisie, et une adresse stockée en majuscules passerait à côté.
        const found = list.users.find((u) => u.email?.trim().toLowerCase() === email);
        if (!found) throw new Error(`compte existant introuvable pour ${email}`);
        profileId = found.id;
        wasCreated = false;
    } else {
        throw new Error(`création du compte ${email} : ${error?.message ?? 'cause inconnue'}`);
    }

    const { error: profileErr } = await admin.from('profiles').upsert({
        id: profileId,
        email,
        full_name: input.fullName,
        role: 'SHIPOWNER',
        is_active: true,
    }, { onConflict: 'id' });
    if (profileErr) throw new Error(`profil ${email} : ${profileErr.message}`);

    return { profileId, created: wasCreated };
}
