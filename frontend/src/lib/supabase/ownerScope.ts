import type { SupabaseClient } from '@supabase/supabase-js';
import { createTenantClient } from '@/lib/supabase/tenant';

// ─────────────────────────────────────────────────────────────────────────────
// Client borné à UN armateur (et, au choix, à UN navire), en lecture seule.
//
// Le portail armateur lit à travers la session de l'armateur : la RLS
// (`current_shipowner_id()`, mig 135) borne chaque table à son dossier. Pour
// que le staff voie EXACTEMENT le même écran, il faut un client qui impose la
// même borne — depuis le code, puisque la session est celle du staff.
//
// Même technique que `createTenantClient` : un Proxy sur `from()` qui ajoute
// le filtre à chaque `select`. Deux différences :
//   — fermé par défaut : une table qui n'est ni bornée ni explicitement
//     autorisée en lecture LÈVE. Une vue « lecture seule » qui laisserait
//     passer une table oubliée montrerait toute la juridiction sous le nom
//     d'un seul débiteur ;
//   — toute écriture lève. Voir n'est pas agir.
// ─────────────────────────────────────────────────────────────────────────────

/** Tables bornées à l'armateur, et la colonne qui le porte. */
const OWNER_COLUMN: Readonly<Record<string, string>> = {
    transactions: 'shipowner_id',
    payments: 'shipowner_id',
    wallets: 'shipowner_id',
    vessels: 'shipowner_id',
    owner_statements: 'shipowner_id',
    owner_members: 'shipowner_id',
    shipowner_payment_intents: 'shipowner_id',
    refunds: 'shipowner_id',
    // Actif aérien (mig 074) : l'exploitant est un armateur généralisé.
    aircraft: 'operator_id',
    shipowners: 'id',
};

/** Colonne qui porte le navire, pour la portée « ce navire seulement ». */
const VESSEL_COLUMN: Readonly<Record<string, string>> = {
    transactions: 'vessel_id',
    arrival_alerts: 'vessel_id',
    vessels: 'id',
};

/**
 * Tables lisibles sans borne armateur : soit elles n'en ont pas (référentiels),
 * soit le portail les filtre toujours par des identifiants déjà bornés
 * (`payment_proofs` par `payment_id`, `wallet_ledger` par `wallet_id`).
 */
const PASSTHROUGH_TABLES: ReadonlySet<string> = new Set([
    'payment_proofs', 'wallet_ledger', 'jurisdictions', 'jurisdiction_issuer_profile',
    'app_config', 'greengate_tariffs', 'profiles',
]);

export interface OwnerScope {
    jurisdictionId: string;
    shipownerId: string;
    /** Restreint aux lignes de ce navire : factures, alertes, fiche navire. */
    vesselId?: string;
}

interface FilterLike {
    eq: (column: string, value: unknown) => FilterLike;
}
interface QueryBuilderLike {
    select: (...args: unknown[]) => FilterLike;
}

function readOnlyViolation(table: string): never {
    throw new Error(`OwnerScopedClient: écriture refusée sur ${table} — vue en lecture seule`);
}

export function createOwnerScopedClient(scope: OwnerScope): SupabaseClient {
    if (!scope.jurisdictionId || !scope.shipownerId) {
        throw new Error('createOwnerScopedClient: jurisdictionId et shipownerId sont requis');
    }
    const base = createTenantClient(scope.jurisdictionId);

    return new Proxy(base, {
        get(target, prop, receiver) {
            if (prop === 'from') {
                return (table: string) => {
                    const qb = target.from(table) as unknown as QueryBuilderLike;
                    const ownerCol = OWNER_COLUMN[table];
                    const vesselCol = VESSEL_COLUMN[table];

                    if (!ownerCol && !PASSTHROUGH_TABLES.has(table) && !(scope.vesselId && vesselCol)) {
                        throw new Error(`OwnerScopedClient: table ${table} hors de la portée armateur`);
                    }

                    return {
                        select: (...args: unknown[]) => {
                            let q = qb.select(...args);
                            if (ownerCol) q = q.eq(ownerCol, scope.shipownerId);
                            if (scope.vesselId && vesselCol) q = q.eq(vesselCol, scope.vesselId);
                            return q;
                        },
                        insert: () => readOnlyViolation(table),
                        upsert: () => readOnlyViolation(table),
                        update: () => readOnlyViolation(table),
                        delete: () => readOnlyViolation(table),
                    };
                };
            }
            if (prop === 'rpc') {
                return () => { throw new Error('OwnerScopedClient: rpc refusé — vue en lecture seule'); };
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    }) as unknown as SupabaseClient;
}
