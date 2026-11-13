import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Les pays auxquels un membre du personnel a accès.
 *
 * Deux niveaux d'administration :
 *
 *   • l'administrateur GÉNÉRAL (rôle SUPERADMIN) n'est rattaché à aucun pays.
 *     Il les voit tous et choisit celui dans lequel il travaille, par le
 *     sélecteur : c'est ainsi qu'il « se place » dans un pays ;
 *   • tout autre membre du personnel n'a accès qu'aux pays auxquels il est
 *     rattaché (`user_jurisdictions`).
 *
 * La base applique déjà cette règle (`current_jurisdiction_ids()`, mig 071).
 * Cette fonction est son pendant côté application : un seul endroit la porte,
 * pour que le sélecteur, le choix du pays actif et la résolution du pays d'une
 * requête ne puissent pas diverger.
 */
export interface JurisdictionRef {
    id: string;
    code: string;
    name: string;
}

export interface AccessibleJurisdictions {
    /** Vrai pour l'administrateur général : accès à tous les pays, sans rattachement. */
    isGeneralAdmin: boolean;
    /** Triés par code, pour qu'un choix par défaut soit toujours le même. */
    jurisdictions: JurisdictionRef[];
}

const GENERAL_ADMIN_ROLE = 'SUPERADMIN';

type JoinedRow = {
    jurisdictions: JurisdictionRef | JurisdictionRef[] | null;
};

function byCode(a: JurisdictionRef, b: JurisdictionRef): number {
    return a.code.localeCompare(b.code);
}

/**
 * @param supabase client de SESSION de l'utilisateur : il lit son propre
 *   profil, ses propres rattachements et la liste des pays, que la RLS ouvre
 *   en lecture.
 * @throws si une lecture échoue — ne jamais prendre une erreur pour « aucun pays ».
 */
export async function listAccessibleJurisdictions(
    supabase: SupabaseClient,
    userId: string,
): Promise<AccessibleJurisdictions> {
    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();
    if (profileError) {
        throw new Error(`listAccessibleJurisdictions: profil illisible — ${profileError.message}`);
    }

    if (profile?.role === GENERAL_ADMIN_ROLE) {
        const { data, error } = await supabase.from('jurisdictions').select('id, code, name');
        if (error) {
            throw new Error(`listAccessibleJurisdictions: pays illisibles — ${error.message}`);
        }
        return {
            isGeneralAdmin: true,
            jurisdictions: [...((data ?? []) as JurisdictionRef[])].sort(byCode),
        };
    }

    const { data, error } = await supabase
        .from('user_jurisdictions')
        .select('jurisdiction_id, jurisdictions(id, code, name)')
        .eq('user_id', userId);
    if (error) {
        throw new Error(`listAccessibleJurisdictions: rattachements illisibles — ${error.message}`);
    }

    const jurisdictions = ((data ?? []) as unknown as JoinedRow[])
        .flatMap((row) => {
            const joined = Array.isArray(row.jurisdictions) ? row.jurisdictions[0] : row.jurisdictions;
            return joined ? [{ id: joined.id, code: joined.code, name: joined.name }] : [];
        })
        .sort(byCode);

    return { isGeneralAdmin: false, jurisdictions };
}
