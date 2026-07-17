// scripts/seed-onboarding.ts
// Import du package onboarding_armateurs (docs/onboarding/seeds) dans Supabase.
// Usage :
//   npx tsx scripts/seed-onboarding.ts                → dry-run (aucun write)
//   npx tsx scripts/seed-onboarding.ts --execute      → import idempotent
//   PURGE_CONFIRM=TABLE_RASE npx tsx scripts/seed-onboarding.ts --execute --purge
//
// Résolution des modules : @supabase/supabase-js et zod doivent être présents dans
// <repo>/node_modules (racine, `npm install @supabase/supabase-js zod` sans -A/-D) —
// scripts/ et frontend/ sont des répertoires frères, la résolution Node ne remonte
// jamais latéralement vers frontend/node_modules depuis un fichier situé sous
// scripts/ (elle ne regarde que les ancêtres du fichier important le module). Les
// imports relatifs vers frontend/src/services/onboardingImport/* eux-mêmes résolvent
// zod normalement (ancêtre = frontend/node_modules). Voir Task 7 report.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from '../frontend/src/types/supabase.generated';
import {
    armateursFileSchema, compagniesFileSchema, naviresFileSchema, voyagesFileSchema,
    proformasFileSchema, relancesFileSchema, paiementsFileSchema,
} from '../frontend/src/services/onboardingImport/seedSchemas';
import type { SeedVoyage, SeedProforma } from '../frontend/src/services/onboardingImport/seedSchemas';
import {
    mapArmateurToShipowner, mapCompagnieToShipowner, mapNavireToVessel,
    mapProformaMaritime, mapProformaAviation, mapRelance, mapPaiement,
} from '../frontend/src/services/onboardingImport/mappers';
import type {
    ShipownerInsert, VesselInsert, TransactionInsert, CollectionReminderInsert,
    PaymentInsert, VesselRefForProforma, ProformaTransactionRef,
} from '../frontend/src/services/onboardingImport/mappers';

type Db = ReturnType<typeof createClient<Database>>;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEEDS = join(ROOT, 'docs', 'onboarding', 'seeds');
const EXECUTE = process.argv.includes('--execute');
const PURGE = process.argv.includes('--purge');

const CHUNK = 200;

// Ordre FK de purge — voir brief Task 7. Ne touche PAS profiles/jurisdictions/
// tariffs/methodologies/emission_factors/air_emission_factors/app_config/audit_logs.
//
// DEUX TABLES DU BRIEF SONT VOLONTAIREMENT ABSENTES — toutes deux rendues
// inconditionnellement indélébiles par des migrations postérieures au brief :
//   - `wallet_ledger` (migration 050) : ledger append-only, trigger
//     trg_ledger_immutable — "Even service_role is forbidden from UPDATE/
//     DELETE on ledger rows". Un DELETE y échoue TOUJOURS (permission denied),
//     même sur table vide.
//   - `transactions` (migration 089, Wedge 4 fiscal hardening) : trigger
//     transactions_no_delete — "DELETE forbidden — fiscal rows are permanent",
//     sans échappatoire, pour QUICONQUE (y compris service_role).
// Cet import n'écrit jamais wallet_ledger (aucun wallet créé par ce script) —
// rien à purger là. Pour transactions, la purge en masse est structurellement
// impossible ; l'idempotence de l'import (pré-filtrage par invoice_ref avant
// insert, voir plus bas) rend de toute façon la purge inutile pour cette table.
//
// `vessels` reste dans la liste, MAIS un DELETE en masse échouera tant que la
// moindre transaction (même hors périmètre de ce script — ex. données de
// démonstration seed.sql) référence un vessel_id : la CASCADE déclenchée sur
// `transactions` retombe sur le même trigger no_delete. Sur une base neuve,
// c'est inoffensif (aucune transaction n'existe encore) ; documenté comme
// limitation connue si des données de démo pré-existantes bloquent le run.
const PURGE_TABLES = [
    'collection_reminders', 'refunds', 'payment_proofs',
    'payments', 'arrival_alerts', 'vessel_positions',
    'aircraft_positions', 'vessels', 'aircraft', 'wallets', 'shipowners',
] as const;

// Tables écrites par ce script — union restreinte pour satisfaire les
// overloads `.from()` générés par `supabase gen types` (le schéma concret
// rejette un `table: string` non littéral). Les lignes elles-mêmes restent
// typées via les interfaces *Insert de Task 6 ; le cast `as never` au point
// d'appel de `.insert()/.upsert()` est le contournement documenté de
// postgrest-js pour des helpers batch génériques sur plusieurs tables (les
// overloads stricts de la lib n'acceptent pas un type de ligne paramétrique).
type WritableTable =
    | 'shipowners' | 'vessels' | 'aircraft' | 'transactions'
    | 'collection_reminders' | 'payments';

function env(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`env ${name} manquante`);
    return v;
}

function loadJson(file: string): unknown {
    return JSON.parse(readFileSync(join(SEEDS, file), 'utf-8'));
}

function chunk<T>(arr: T[], size = CHUNK): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

/** Insère par batch de 200, ignorant les conflits déjà gérés par le pré-filtrage
 * de l'appelant (pas d'upsert générique ici — voir note sur l'immutabilité des
 * transactions plus bas). */
async function insertBatched(
    db: Db,
    table: WritableTable,
    rows: Record<string, unknown>[],
): Promise<void> {
    for (const batch of chunk(rows)) {
        if (batch.length === 0) continue;
        const { error } = await db.from(table).insert(batch as never);
        if (error) throw new Error(`insert ${table}: ${error.message}`);
    }
}

/** Idempotence par pré-filtrage + insert (pas d'upsert `ON CONFLICT`) : les
 * index d'idempotence posés par les migrations 092-094 (`idx_shipowners_seed_ref`,
 * `idx_vessels_seed_ref`, `idx_creminders_seed_ref`) sont tous des UNIQUE INDEX
 * PARTIELS (`WHERE seed_ref IS NOT NULL`) — PostgREST ne sait pas exprimer le
 * prédicat WHERE d'un index partiel dans un upsert `ON CONFLICT`, ce qui produit
 * systématiquement `there is no unique or exclusion constraint matching the ON
 * CONFLICT specification`. On sélectionne donc les clés déjà présentes puis on
 * n'insère que le manquant — idempotent par construction, et applicable
 * uniformément (même pattern que les transactions plus bas, pour une raison
 * apparentée mais pas identique : là c'est le trigger d'immutabilité (mig 089)
 * ET, indépendamment, le fait que `idx_txn_invoice_ref` (migration 017) est
 * LUI AUSSI un unique index partiel (`WHERE invoice_ref IS NOT NULL`) — un
 * upsert `ON CONFLICT(invoice_ref)` échouerait pour la même raison PostgREST
 * que ci-dessus, même si `transactions` n'était pas immuable ; ici c'est
 * l'index partiel).
 *
 * Hypothèse mono-processus : ce script est un batch à exécution unique (pas de
 * lock, pas de transaction englobante). Le pré-filtrage select-puis-insert
 * n'offre aucune protection TOCTOU si deux exécutions tournent en parallèle
 * sur la même base — deux runs concurrents peuvent tous deux voir une clé
 * absente et tenter le même insert, l'un des deux échouant alors sur la
 * contrainte unique. Non traité ici : le brief suppose une exécution
 * ponctuelle et supervisée, pas un import concurrent. */
async function insertMissingByKey(
    db: Db,
    table: WritableTable,
    keyColumn: string,
    rows: Record<string, unknown>[],
): Promise<void> {
    const keys = rows.map((r) => r[keyColumn] as string);
    const existing = await selectExistingSet(db, table, keyColumn, keys);
    const toInsert = rows.filter((r) => !existing.has(r[keyColumn] as string));
    await insertBatched(db, table, toInsert);
}

/** Sélectionne les valeurs déjà présentes d'une colonne, par batch (évite les
 * `.in()` géants). */
async function selectExistingSet(
    db: Db,
    table: WritableTable,
    column: string,
    values: string[],
): Promise<Set<string>> {
    const out = new Set<string>();
    for (const batch of chunk(values)) {
        if (batch.length === 0) continue;
        const { data, error } = await db.from(table).select(column).in(column, batch);
        if (error) throw new Error(`select ${table}.${column}: ${error.message}`);
        for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
            const v = row[column];
            if (typeof v === 'string') out.add(v);
        }
    }
    return out;
}

interface ShipownerRow { id: string; seed_ref: string | null }
interface VesselRow { id: string; seed_ref: string | null; name: string; imo_number: string }
interface AircraftRow { id: string; operator_id: string | null; icao_type: string | null }
interface TransactionRow { id: string; invoice_ref: string | null; shipowner_id: string | null }

async function selectShipowners(db: Db, seedRefs: string[]): Promise<ShipownerRow[]> {
    const out: ShipownerRow[] = [];
    for (const batch of chunk(seedRefs)) {
        if (batch.length === 0) continue;
        const { data, error } = await db.from('shipowners').select('id, seed_ref').in('seed_ref', batch);
        if (error) throw new Error(`select shipowners: ${error.message}`);
        out.push(...((data ?? []) as ShipownerRow[]));
    }
    return out;
}

async function selectVessels(db: Db, seedRefs: string[]): Promise<VesselRow[]> {
    const out: VesselRow[] = [];
    for (const batch of chunk(seedRefs)) {
        if (batch.length === 0) continue;
        const { data, error } = await db.from('vessels')
            .select('id, seed_ref, name, imo_number').in('seed_ref', batch);
        if (error) throw new Error(`select vessels: ${error.message}`);
        out.push(...((data ?? []) as VesselRow[]));
    }
    return out;
}

async function selectAircraftByOperators(db: Db, operatorIds: string[]): Promise<AircraftRow[]> {
    const out: AircraftRow[] = [];
    for (const batch of chunk(operatorIds)) {
        if (batch.length === 0) continue;
        const { data, error } = await db.from('aircraft')
            .select('id, operator_id, icao_type').in('operator_id', batch);
        if (error) throw new Error(`select aircraft: ${error.message}`);
        out.push(...((data ?? []) as AircraftRow[]));
    }
    return out;
}

/** Sélectionne les `rail_details.seed_ref` déjà présents en base pour `payments`
 * — dédup client-side car PostgREST ne sait pas filtrer/indexer un champ JSONB
 * arbitraire via `.in()` (pas d'index dédié sur `rail_details->>'seed_ref'`, et
 * ça ne vaudrait pas le coût d'une migration pour un script d'import ponctuel).
 * Volumes faibles à l'import (dizaines de paiements attendues, pas de pagination
 * nécessaire) — un `select('rail_details')` complet suffit largement ici,
 * contrairement à `selectExistingSet` qui batch par prudence sur des colonnes
 * indexées et potentiellement plus volumineuses (shipowners/vessels/transactions). */
async function selectExistingPaymentSeedRefs(db: Db): Promise<Set<string>> {
    const { data, error } = await db.from('payments').select('rail_details');
    if (error) throw new Error(`select payments.rail_details: ${error.message}`);
    const out = new Set<string>();
    for (const row of (data ?? []) as { rail_details: unknown }[]) {
        const details = row.rail_details as Record<string, unknown> | null;
        const seedRef = details?.seed_ref;
        if (typeof seedRef === 'string') out.add(seedRef);
    }
    return out;
}

async function selectTransactions(db: Db, invoiceRefs: string[]): Promise<TransactionRow[]> {
    const out: TransactionRow[] = [];
    for (const batch of chunk(invoiceRefs)) {
        if (batch.length === 0) continue;
        const { data, error } = await db.from('transactions')
            .select('id, invoice_ref, shipowner_id').in('invoice_ref', batch);
        if (error) throw new Error(`select transactions: ${error.message}`);
        out.push(...((data ?? []) as TransactionRow[]));
    }
    return out;
}

async function main(): Promise<void> {
    // 1. Parse + validation Zod des 7 seeds (échoue AVANT tout write)
    const armateurs = armateursFileSchema.parse(loadJson('01_armateurs.json')).armateurs;
    const navires = naviresFileSchema.parse(loadJson('02_navires.json')).navires;
    const voyages = voyagesFileSchema.parse(loadJson('03_voyages.json')).voyages;
    const proformas = proformasFileSchema.parse(loadJson('04_proformas.json')).proformas;
    const relances = relancesFileSchema.parse(loadJson('05_relances.json')).relances;
    const paiements = paiementsFileSchema.parse(loadJson('06_paiements.json')).paiements;
    const compagnies = compagniesFileSchema.parse(loadJson('07_compagnies_aeriennes.json')).compagnies;

    const totalUsd = proformas.reduce((s, p) => s + p.total_usd, 0);
    console.log(`Seeds OK : ${armateurs.length} armateurs, ${compagnies.length} compagnies, ` +
        `${navires.length} navires, ${voyages.length} voyages, ${proformas.length} pro-formas, ` +
        `${relances.length} relances, ${paiements.length} paiements — total USD ${totalUsd.toFixed(2)}`);

    if (!EXECUTE) { console.log('Dry-run : aucun write. Relancer avec --execute.'); return; }

    const db = createClient<Database>(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
    const confirmedBy = env('SEED_ADMIN_PROFILE_ID');

    if (PURGE) {
        if (process.env.PURGE_CONFIRM !== 'TABLE_RASE') {
            throw new Error('--purge exige PURGE_CONFIRM=TABLE_RASE');
        }
        // Validation up-front, AVANT tout DELETE : `transactions` est
        // structurellement non purgeable (trigger transactions_no_delete,
        // migration 089 — DELETE interdit à quiconque, y compris service_role,
        // voir note sur PURGE_TABLES ci-dessus). Si des transactions existent
        // déjà, un `--purge` serait de toute façon incomplet (les FK vers
        // vessels/shipowners resteraient bloquées en cascade au milieu de la
        // boucle) : on échoue tôt et lisiblement plutôt que de purger
        // partiellement puis buter sur `vessels`.
        const { count: txnCount, error: txnCountError } = await db
            .from('transactions').select('id', { count: 'exact', head: true });
        if (txnCountError) throw new Error(`purge : count transactions: ${txnCountError.message}`);
        if ((txnCount ?? 0) > 0) {
            throw new Error(
                `purge impossible : ${txnCount} transactions immuables présentes — la remise à ` +
                `zéro des transactions exige une opération DBA dédiée (voir rapport Task 7) ; ` +
                `aucune table n'a été touchée`,
            );
        }
        let purgedCount = 0;
        try {
            for (const table of PURGE_TABLES) {
                const { error } = await db.from(table).delete().not('id', 'is', null);
                if (error) throw new Error(`${table}: ${error.message}`);
                purgedCount += 1;
                console.log(`purge ${table} OK`);
            }
        } catch (e) {
            const detail = e instanceof Error ? e.message : String(e);
            throw new Error(
                `purge interrompue : ${purgedCount}/${PURGE_TABLES.length} tables purgées, ` +
                `arrêt sur ${detail}`,
            );
        }
    }

    // ── 2. Shipowners (armateurs + compagnies) — insert-si-manquant par seed_ref ─
    const shipownerRows: ShipownerInsert[] = [
        ...armateurs.map(mapArmateurToShipowner),
        ...compagnies.map(mapCompagnieToShipowner),
    ];
    await insertMissingByKey(db, 'shipowners', 'seed_ref', shipownerRows as unknown as Record<string, unknown>[]);
    const shipownerSeedRefs = shipownerRows.map((r) => r.seed_ref);
    const shipownerDbRows = await selectShipowners(db, shipownerSeedRefs);
    const shipownerIdBySeedRef = new Map<string, string>();
    for (const row of shipownerDbRows) {
        if (row.seed_ref) shipownerIdBySeedRef.set(row.seed_ref, row.id);
    }
    console.log(`shipowners : ${shipownerDbRows.length} lignes en base (${shipownerRows.length} du seed)`);

    // ── 3. Vessels — insert-si-manquant par seed_ref ─────────────────────────────
    const vesselRows: VesselInsert[] = navires.map((n) => mapNavireToVessel(n, shipownerIdBySeedRef));
    await insertMissingByKey(db, 'vessels', 'seed_ref', vesselRows as unknown as Record<string, unknown>[]);
    const vesselSeedRefs = vesselRows.map((r) => r.seed_ref);
    const vesselDbRows = await selectVessels(db, vesselSeedRefs);
    const vesselIdBySeedRef = new Map<string, VesselRefForProforma>();
    for (const row of vesselDbRows) {
        if (row.seed_ref) {
            vesselIdBySeedRef.set(row.seed_ref, { id: row.id, name: row.name, imoNumber: row.imo_number });
        }
    }
    console.log(`vessels : ${vesselDbRows.length} lignes en base (${vesselRows.length} du seed)`);

    // ── 4. Aircraft synthétiques par (compagnie, icao_type) ─────────────────────
    const aviationProformas = proformas.filter(
        (p): p is Extract<SeedProforma, { type: 'AVIATION' }> => p.type === 'AVIATION',
    );
    const requiredAircraftKeys = new Map<string, { compagnieId: string; icaoType: string }>();
    for (const p of aviationProformas) {
        const key = `${p.compagnie_id}/${p.vol_details.aircraft}`;
        if (!requiredAircraftKeys.has(key)) {
            requiredAircraftKeys.set(key, { compagnieId: p.compagnie_id, icaoType: p.vol_details.aircraft });
        }
    }
    const compagnieOperatorIds = [...new Set(
        [...requiredAircraftKeys.values()]
            .map(({ compagnieId }) => shipownerIdBySeedRef.get(compagnieId))
            .filter((id): id is string => Boolean(id)),
    )];
    const existingAircraft = await selectAircraftByOperators(db, compagnieOperatorIds);
    const aircraftIdByDbKey = new Map<string, string>();
    for (const row of existingAircraft) {
        if (row.operator_id && row.icao_type) {
            aircraftIdByDbKey.set(`${row.operator_id}/${row.icao_type}`, row.id);
        }
    }
    const aircraftToInsert: Record<string, unknown>[] = [];
    for (const { compagnieId, icaoType } of requiredAircraftKeys.values()) {
        const operatorId = shipownerIdBySeedRef.get(compagnieId) ?? null;
        const dbKey = `${operatorId}/${icaoType}`;
        if (operatorId && !aircraftIdByDbKey.has(dbKey)) {
            aircraftToInsert.push({ registration: null, icao_type: icaoType, operator_id: operatorId });
        }
    }
    if (aircraftToInsert.length > 0) {
        for (const batch of chunk(aircraftToInsert)) {
            const { data, error } = await db.from('aircraft')
                .insert(batch as never).select('id, operator_id, icao_type');
            if (error) throw new Error(`insert aircraft: ${error.message}`);
            for (const row of (data ?? []) as AircraftRow[]) {
                if (row.operator_id && row.icao_type) {
                    aircraftIdByDbKey.set(`${row.operator_id}/${row.icao_type}`, row.id);
                }
            }
        }
    }
    const aircraftIdByKey = new Map<string, string>();
    for (const [seedKey, { compagnieId, icaoType }] of requiredAircraftKeys) {
        const operatorId = shipownerIdBySeedRef.get(compagnieId);
        if (!operatorId) continue;
        const id = aircraftIdByDbKey.get(`${operatorId}/${icaoType}`);
        if (id) aircraftIdByKey.set(seedKey, id);
    }
    console.log(`aircraft : ${aircraftIdByKey.size} lignes distinctes (${aircraftToInsert.length} nouvelles)`);

    // ── 5. Transactions maritimes puis aviation ──────────────────────────────────
    // NOTE : pas d'upsert ici (contrairement à shipowners/vessels/reminders) —
    // migration 089 gèle la quasi-totalité des colonnes de `transactions` en
    // UPDATE (trigger transactions_fiscal_immutable). Un upsert onConflict
    // régénérerait un UPDATE identique à chaque relance, ce qui reste inoffensif
    // tant que les valeurs sont rigoureusement identiques, MAIS écraserait aussi
    // `status`/`collections_status` (colonnes FREE) que le trigger de paiement
    // (mig 051) a pu faire progresser vers PARTIALLY_PAID/PAID entre deux runs.
    // Pré-filtrer par invoice_ref déjà présent puis n'insérer que le manquant
    // est idempotent sans jamais toucher une ligne existante.
    const voyageBySeedRef = new Map<string, SeedVoyage>(voyages.map((v) => [v.id, v]));
    const maritimeProformas = proformas.filter(
        (p): p is Extract<SeedProforma, { type: 'MARITIME' }> => p.type === 'MARITIME',
    );

    const maritimeRows: TransactionInsert[] = maritimeProformas.map((p) => mapProformaMaritime(p, {
        vesselIdBySeedRef, shipownerIdBySeedRef, voyageBySeedRef,
    }));
    const aviationRows: TransactionInsert[] = aviationProformas.map((p) => mapProformaAviation(p, {
        aircraftIdByKey, shipownerIdBySeedRef,
    }));
    const allTxnRows = [...maritimeRows, ...aviationRows];
    const allInvoiceRefs = allTxnRows.map((r) => r.invoice_ref);
    const existingInvoiceRefs = await selectExistingSet(db, 'transactions', 'invoice_ref', allInvoiceRefs);
    const txnRowsToInsert = allTxnRows.filter((r) => !existingInvoiceRefs.has(r.invoice_ref));
    await insertBatched(db, 'transactions', txnRowsToInsert as unknown as Record<string, unknown>[]);
    console.log(`transactions : ${txnRowsToInsert.length} nouvelles (${allTxnRows.length} attendues au total, ` +
        `${existingInvoiceRefs.size} déjà présentes)`);

    const txnDbRows = await selectTransactions(db, allInvoiceRefs);
    const txnByInvoiceRef = new Map<string, TransactionRow>();
    for (const row of txnDbRows) {
        if (row.invoice_ref) txnByInvoiceRef.set(row.invoice_ref, row);
    }
    const txnIdByProformaSeedId = new Map<string, ProformaTransactionRef>();
    for (const p of proformas) {
        const row = txnByInvoiceRef.get(p.reference);
        if (!row || !row.shipowner_id) {
            throw new Error(`transaction introuvable ou sans shipowner_id pour la pro-forma ${p.id} (${p.reference})`);
        }
        txnIdByProformaSeedId.set(p.id, { transactionId: row.id, shipownerId: row.shipowner_id });
    }

    // ── 6. collection_reminders puis payments ────────────────────────────────────
    const reminderRows: CollectionReminderInsert[] = relances.map((r) => mapRelance(r, txnIdByProformaSeedId));
    await insertMissingByKey(db, 'collection_reminders', 'seed_ref', reminderRows as unknown as Record<string, unknown>[]);
    console.log(`collection_reminders : ${reminderRows.length} lignes attendues (insert-si-manquant, idempotent)`);

    // Dédup par `rail_details.seed_ref` (pas par `external_reference`) : ce
    // dernier est nullable (paiement cash sans référence bancaire), donc
    // `!r.external_reference || !existingExternalRefs.has(...)` ré-insérerait
    // TOUJOURS les paiements sans référence à chaque run. mapPaiement (Task 6/7
    // review) porte désormais le seed id (`pay-001`…) dans `rail_details.seed_ref`
    // — clé stable et toujours présente, quel que soit le rail de paiement.
    const paymentRows: PaymentInsert[] = paiements.map((p) => mapPaiement(p, txnIdByProformaSeedId, confirmedBy));
    const existingPaymentSeedRefs = await selectExistingPaymentSeedRefs(db);
    const paymentRowsToInsert = paymentRows.filter((r) => {
        const seedRef = (r.rail_details as { seed_ref?: unknown }).seed_ref;
        return typeof seedRef !== 'string' || !existingPaymentSeedRefs.has(seedRef);
    });
    await insertBatched(db, 'payments', paymentRowsToInsert as unknown as Record<string, unknown>[]);
    console.log(`payments : ${paymentRowsToInsert.length} nouveaux (${paymentRows.length} attendus au total, ` +
        `${paymentRows.length - paymentRowsToInsert.length} déjà présents)`);

    // ── 7. Vérification finale chiffrée ─────────────────────────────────────────
    await verify(db);
}

async function verify(db: Db): Promise<void> {
    const failures: string[] = [];

    const check = async (label: string, actual: number, expected: number, tolerance = 0): Promise<void> => {
        const diff = Math.abs(actual - expected);
        if (diff > tolerance) {
            failures.push(`${label} : attendu ${expected}, obtenu ${actual} (écart ${diff.toFixed(2)})`);
        } else {
            console.log(`OK — ${label} : ${actual}`);
        }
    };

    const headCount = (result: { count: number | null; error: { message: string } | null }, label: string): number => {
        if (result.error) throw new Error(`count ${label}: ${result.error.message}`);
        return result.count ?? 0;
    };

    // Filtre seed_ref IS NOT NULL : robuste face à des lignes hors périmètre de
    // cet import (ex. données de démonstration seed.sql, structurellement
    // indélébiles quand une transaction — elle-même immuable, mig 089 — les
    // référence encore ; voir la note sur PURGE_TABLES plus haut). "importés"
    // signifie ici précisément "lignes produites par ce script".
    const shipownersCount = headCount(
        await db.from('shipowners').select('id', { count: 'exact', head: true }).not('seed_ref', 'is', null),
        'shipowners');
    await check('shipowners importés', shipownersCount, 26);

    const vesselsCount = headCount(
        await db.from('vessels').select('id', { count: 'exact', head: true }).not('seed_ref', 'is', null),
        'vessels');
    await check('vessels', vesselsCount, 100);

    const proformaCount = headCount(
        await db.from('transactions').select('id', { count: 'exact', head: true })
            .eq('document_type', 'PROFORMA'),
        'transactions PROFORMA');
    await check('transactions PROFORMA', proformaCount, 458);

    const maritimeCount = headCount(
        await db.from('transactions').select('id', { count: 'exact', head: true })
            .eq('document_type', 'PROFORMA').eq('mode', 'MARITIME'),
        'transactions PROFORMA MARITIME');
    await check('transactions PROFORMA MARITIME', maritimeCount, 100);

    const airCount = headCount(
        await db.from('transactions').select('id', { count: 'exact', head: true })
            .eq('document_type', 'PROFORMA').eq('mode', 'AIR'),
        'transactions PROFORMA AIR');
    await check('transactions PROFORMA AIR', airCount, 358);

    const { data: sumData, error: sumError } = await db
        .from('transactions').select('tax_amount_usd').eq('document_type', 'PROFORMA');
    if (sumError) throw new Error(`sum transactions: ${sumError.message}`);
    const taxSum = ((sumData ?? []) as { tax_amount_usd: number }[])
        .reduce((s, r) => s + Number(r.tax_amount_usd), 0);
    await check('SUM(tax_amount_usd)', taxSum, 2604886.34, 0.01);

    const remindersCount = headCount(
        await db.from('collection_reminders').select('id', { count: 'exact', head: true }),
        'collection_reminders');
    await check('collection_reminders', remindersCount, 40);

    const paymentsCount = headCount(
        await db.from('payments').select('id', { count: 'exact', head: true }), 'payments');
    await check('payments', paymentsCount, 3);

    const { data: paymentSumData, error: paymentSumError } = await db
        .from('payments').select('amount_usd_minor');
    if (paymentSumError) throw new Error(`sum payments: ${paymentSumError.message}`);
    const paymentsSum = ((paymentSumData ?? []) as { amount_usd_minor: number }[])
        .reduce((s, r) => s + Number(r.amount_usd_minor), 0) / 100;
    await check('SUM(payments.amount_usd_minor)/100', paymentsSum, 12055.57, 0.01);

    const sanctionedCount = headCount(
        await db.from('shipowners').select('id', { count: 'exact', head: true })
            .not('seed_ref', 'is', null)
            .or('is_ofac_sdn.eq.true,is_un_prohibited.eq.true'),
        'shipowners sanctionnés');
    await check('shipowners sanctionnés (OFAC/UN)', sanctionedCount, 3);

    if (failures.length > 0) {
        console.error('Vérification finale ÉCHOUÉE :');
        for (const f of failures) console.error(`  - ${f}`);
        throw new Error(`${failures.length} vérification(s) en écart`);
    }
    console.log('Vérification finale OK — tous les compteurs et sommes correspondent.');
}

main().catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
});
