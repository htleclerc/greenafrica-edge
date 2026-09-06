import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Les boîtes qui peuvent recevoir un code de connexion pour un compte armateur
 * atteint par son NAVIRE (IMO / MMSI).
 *
 *   — OWNER : l'adresse officielle du compte (le titulaire) ;
 *   — MEMBER : un membre invité actif (mig 135), qui ouvre SA session ;
 *   — REPRESENTATIVE : un représentant actif (`owner_agent_mappings`).
 *
 * Jamais les copies de facturation : recevoir un double n'est pas détenir le
 * compte (règle posée par `requestLoginLink`).
 *
 * Plafonnée à cinq : au-delà, l'écran de connexion cesserait d'être un choix
 * et deviendrait un annuaire masqué du compte.
 */
export type RecipientKind = 'OWNER' | 'MEMBER' | 'REPRESENTATIVE';

export interface LoginRecipient {
    email: string;
    kind: RecipientKind;
}

export const MAX_LOGIN_RECIPIENTS = 5;

interface EmbeddedProfile { email?: string | null }
interface MembershipRow { profiles?: EmbeddedProfile | EmbeddedProfile[] | null }

function emailOf(row: MembershipRow): string | null {
    const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    const e = String(p?.email ?? '').trim().toLowerCase();
    return e || null;
}

export async function listLoginRecipients(
    admin: SupabaseClient,
    owner: { id: string; officialEmail: string },
): Promise<LoginRecipient[]> {
    const out: LoginRecipient[] = [];
    const seen = new Set<string>();
    const push = (email: string | null, kind: RecipientKind) => {
        if (!email || seen.has(email)) return;
        seen.add(email);
        out.push({ email, kind });
    };

    push(owner.officialEmail.trim().toLowerCase(), 'OWNER');

    // Les indices d'embed lèvent l'ambiguïté PGRST201 : ces tables portent
    // deux clés vers profiles (voir loginAllowlist).
    const [members, reps] = await Promise.all([
        admin
            .from('owner_members')
            .select('profiles!owner_members_profile_id_fkey(email)')
            .eq('shipowner_id', owner.id)
            .eq('active', true),
        admin
            .from('owner_agent_mappings')
            .select('profiles!owner_agent_mappings_agent_profile_id_fkey(email)')
            .eq('shipowner_id', owner.id)
            .eq('active', true),
    ]);

    for (const row of (members.data ?? []) as MembershipRow[]) push(emailOf(row), 'MEMBER');
    for (const row of (reps.data ?? []) as MembershipRow[]) push(emailOf(row), 'REPRESENTATIVE');

    return out.slice(0, MAX_LOGIN_RECIPIENTS);
}
