import { type SupabaseClient } from '@supabase/supabase-js';
import { matchesSanctionedEntity } from '@/domain/sanctions/entityMatch';
import type { VesselFinderCandidate } from './vesselFinderParser';

export interface SanctionedEntity {
    id: string;
    name: string;
    aliases: string[];
}

export interface FlaggedCandidate extends VesselFinderCandidate {
    contactBlocked: boolean;
    contactBlockedReason: string | null;
}

/**
 * Marque les candidats dont l'une des trois sociétés correspond à une entité
 * sous sanctions. Le blocage porte sur le CONTACT, pas sur l'identité : le
 * navire reste appariable, seul l'e-mail devient inutilisable.
 *
 * L'ordre d'examen suit celui du destinataire (manager → owner → ISM), pour que
 * le motif désigne la société qui aurait effectivement été contactée.
 */
export function flagSanctionedCandidates(
    candidates: readonly VesselFinderCandidate[],
    sanctioned: readonly SanctionedEntity[],
): FlaggedCandidate[] {
    return candidates.map((c) => {
        const roles: ReadonlyArray<readonly [string, string | null]> = [
            ['manager', c.managerName],
            ['owner', c.ownerName],
            ['ISM manager', c.ismManagerName],
        ];
        for (const [role, name] of roles) {
            if (!name) continue;
            const hit = sanctioned.find((s) => matchesSanctionedEntity(name, [s.name, ...s.aliases]));
            if (hit) {
                return {
                    ...c,
                    contactBlocked: true,
                    contactBlockedReason: `${role} sous sanctions : ${hit.name} (${hit.id})`,
                };
            }
        }
        return { ...c, contactBlocked: false, contactBlockedReason: null };
    });
}

/** Charge les armateurs marqués OFAC SDN ou UN prohibited (colonnes de la migration 092). */
export async function loadSanctionedEntities(db: SupabaseClient): Promise<SanctionedEntity[]> {
    const { data, error } = await db
        .from('shipowners')
        .select('id, name, aliases, is_ofac_sdn, is_un_prohibited')
        .or('is_ofac_sdn.eq.true,is_un_prohibited.eq.true');
    if (error) throw error;
    return (data ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
    }));
}

/** Insère un lot de candidats. Retourne le nombre de lignes écrites. */
export async function insertCandidates(
    db: SupabaseClient,
    batchLabel: string,
    importedBy: string,
    candidates: readonly FlaggedCandidate[],
): Promise<number> {
    if (candidates.length === 0) return 0;
    const rows = candidates.map((c) => ({
        batch_label: batchLabel,
        source: 'VESSELFINDER_PORTCALLS',
        imo_number: c.imoNumber,
        mmsi: c.mmsi,
        call_sign: c.callSign,
        vessel_name: c.vesselName,
        flag_code: c.flagCode,
        type_raw: c.typeRaw,
        category: c.category,
        gross_tonnage: c.grossTonnage,
        deadweight: c.deadweight,
        build_year: c.buildYear,
        last_seen_at: c.lastSeenAt,
        manager_name: c.managerName,
        manager_country: c.managerCountry,
        manager_email: c.managerEmail,
        owner_name: c.ownerName,
        owner_country: c.ownerCountry,
        owner_email: c.ownerEmail,
        ism_manager_name: c.ismManagerName,
        ism_manager_email: c.ismManagerEmail,
        contact_blocked: c.contactBlocked,
        contact_blocked_reason: c.contactBlockedReason,
        status: 'PENDING',
        imported_by: importedBy,
    }));
    const { error } = await db.from('vessel_identity_candidates').insert(rows);
    if (error) throw error;
    return rows.length;
}
