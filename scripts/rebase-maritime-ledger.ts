// Rebascule du livre maritime sur la campagne de recouvrement du 19/08/2026.
//
// Usage :
//   npx tsx scripts/rebase-maritime-ledger.ts            → simulation, aucune écriture
//   npx tsx scripts/rebase-maritime-ledger.ts --execute  → applique, idempotent
//
// Prérequis : migration 128 appliquée (sans quoi les INSERT échouent sur
// l'index unique), et SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY exportés.
// SUPABASE_URL est l'URL HTTPS du projet, pas la chaîne postgresql://.
//
// ORDRE IMPOSÉ : annuler AVANT d'insérer. L'inverse bute sur l'index unique,
// puisque les 86 références de la campagne sont précisément celles que
// détiennent les pro-formas du seed.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    parseConsRefs,
    parseSuiviArmateurs,
    parseVesselDetail,
    reconcileWithCsv,
    SANCTIONED_CONS_REFS,
    type ConsDossier,
    type VesselLine,
} from '../frontend/src/services/ledgerRebase/consRefsParser';
import { SOMALILAND_JURISDICTION_ID } from '../frontend/src/services/onboardingImport/mappers';

const EXECUTE = process.argv.includes('--execute');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF_DIR = join(ROOT, 'docs', 'onboarding', 'campagne-19aout');

const CSV_PATH = process.env.CONS_REFS_CSV
    ?? 'C:/Users/lecle/Claude/Projects/Greengate/02_Maritime/ProFormas_OFFICIEL_19aout2026/cons_refs_mapping.csv';

/**
 * Marqueur de provenance écrit dans breakdown_json. Il distingue une
 * pro-forma de la campagne d'une pro-forma du seed portant la même
 * référence — c'est ce qui rend le script rejouable sans dégât.
 */
const CAMPAIGN_SOURCE = 'campagne_19aout_2026';

/** Totaux attendus. Un écart interrompt : on n'importe pas un fichier tronqué. */
const EXPECTED = { dossiers: 74, navires: 86, usd: 1_316_124.0 };

/**
 * Pavillons du classeur (en toutes lettres) vers ISO-3166-1 alpha-2, dérivés
 * de l'export d'escales qui porte à la fois FLAGNAME et FLAG. 21 sur 21
 * résolus ; « Unknown » tombe légitimement sur ZZ.
 */
const FLAG_ISO2: Record<string, string> = {
    'Antigua & Barbuda': 'AG', Barbados: 'BB', Belize: 'BZ', Cameroon: 'CM',
    Comoros: 'KM', Egypt: 'EG', 'Guinea-Bissau': 'GW', Honduras: 'HN',
    'Hong Kong': 'HK', Liberia: 'LR', 'Marshall Islands': 'MH', Palau: 'PW',
    Panama: 'PA', Portugal: 'PT', 'Saint Kitts & Nevis': 'KN',
    'Sao Tome & Principe': 'ST', Singapore: 'SG',
    'St Vincent & Grenadines': 'VC', Tanzania: 'TZ', Togo: 'TG', Unknown: 'ZZ',
};

const SANCTIONED = new Set<string>(SANCTIONED_CONS_REFS);
/** Morgan Navigation est visé par les Nations unies ; les deux autres par l'OFAC. */
const UN_PROHIBITED = new Set(['PRO-CONS-2026-001']);

function log(...a: unknown[]) { console.log(EXECUTE ? '[EXEC]' : '[DRY ]', ...a); }

function readSheet(name: string): unknown[][] {
    return JSON.parse(readFileSync(join(REF_DIR, name), 'utf8')) as unknown[][];
}

async function main() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis');
    const db = createClient(url, key);

    // ── 0. Référentiel et contrôle de concordance ─────────────────────────
    const dossiers: ConsDossier[] = parseSuiviArmateurs(readSheet('suivi-armateurs.json'));
    const vessels: VesselLine[] = parseVesselDetail(readSheet('detail-navires.json'));

    const navires = dossiers.reduce((s, d) => s + d.vessels.length, 0);
    const totalDossiers = dossiers.reduce((s, d) => s + d.totalUsd, 0);
    const totalNavires = vessels.reduce((s, v) => s + v.amountUsd, 0);

    log(`référentiel : ${dossiers.length} dossiers, ${navires} navires, ${totalDossiers.toFixed(2)} USD`);

    if (dossiers.length !== EXPECTED.dossiers) throw new Error(`attendu ${EXPECTED.dossiers} dossiers, lu ${dossiers.length}`);
    if (vessels.length !== EXPECTED.navires) throw new Error(`attendu ${EXPECTED.navires} navires, lu ${vessels.length}`);
    if (Math.abs(totalDossiers - EXPECTED.usd) > 0.01) throw new Error(`total attendu ${EXPECTED.usd}, lu ${totalDossiers.toFixed(2)}`);
    if (Math.abs(totalNavires - totalDossiers) > 0.01) {
        throw new Error(`les deux feuilles divergent : dossiers ${totalDossiers.toFixed(2)}, navires ${totalNavires.toFixed(2)}`);
    }

    // Le CSV du paquet de pro-formas a été produit séparément. Leur accord
    // sur la structure est ce qui autorise l'import ; ses manques de contacts
    // sont attendus et seulement signalés.
    try {
        const rec = reconcileWithCsv(dossiers, parseConsRefs(readFileSync(CSV_PATH, 'utf8')));
        log(`concordance CSV : ${rec.ok ? 'OK' : 'ÉCARTS'}`);
        rec.problems.forEach((p) => log(`  ! ${p}`));
        if (!rec.ok) throw new Error('le classeur et le CSV divergent — import interrompu');
        if (rec.contactsOnlyInXlsx.length) {
            log(`  contacts présents au classeur, absents du CSV : ${rec.contactsOnlyInXlsx.join(', ')}`);
        }
    } catch (e) {
        if (e instanceof Error && e.message.includes('divergent')) throw e;
        log(`concordance CSV : ignorée (${e instanceof Error ? e.message : e})`);
    }

    // ── 1. Annulation des pro-formas occupant les références cibles ───────
    // `status` est la seule colonne libre de la mig 089 ; invoice_ref est en
    // écriture unique et DELETE est interdit. VOID est donc le seul levier.
    const targetRefs = vessels.map((v) => v.invoiceRef);
    const { data: occupants, error: occErr } = await db
        .from('transactions')
        .select('id, invoice_ref, vessel_name, tax_amount_usd, breakdown_json')
        .in('invoice_ref', targetRefs)
        .neq('status', 'VOID');
    if (occErr) throw new Error(`lecture des occupants : ${occErr.message}`);

    type Occupant = {
        id: string; invoice_ref: string; vessel_name: string;
        tax_amount_usd: number; breakdown_json: { source?: string } | null;
    };

    // Ne JAMAIS annuler ce que ce script a lui-même émis. Sans ce filtre, un
    // second passage annule les 86 pro-formas de la campagne puis les
    // réinsère : le livre est détruit et redoublé à chaque exécution. Le
    // marqueur de provenance est la seule chose qui distingue une pro-forma
    // du seed d'une pro-forma de la campagne portant la même référence.
    const toVoid = ((occupants ?? []) as Occupant[])
        .filter((t) => t.breakdown_json?.source !== CAMPAIGN_SOURCE);
    const alreadyMine = (occupants ?? []).length - toVoid.length;
    if (alreadyMine > 0) log(`déjà émises par la campagne, laissées intactes : ${alreadyMine}`);
    log(`à annuler : ${toVoid.length} pro-forma(s) occupant les références cibles`);
    for (const t of toVoid) {
        log(`  VOID ${t.invoice_ref} — ${t.vessel_name} (${Number(t.tax_amount_usd).toFixed(2)} USD)`);
        if (EXECUTE) {
            const { error } = await db.from('transactions').update({ status: 'VOID' }).eq('id', t.id);
            if (error) throw new Error(`VOID ${t.invoice_ref} : ${error.message}`);
        }
    }

    // ── 2. Armateurs ──────────────────────────────────────────────────────
    const ownerIdByConsRef = new Map<string, string>();
    let ownersCreated = 0;
    for (const d of dossiers) {
        const { data: found } = await db.from('shipowners')
            .select('id').eq('seed_ref', d.consRef).maybeSingle();
        if (found) { ownerIdByConsRef.set(d.consRef, (found as { id: string }).id); continue; }

        const sanctioned = SANCTIONED.has(d.consRef);
        log(`  armateur ${d.consRef} ${d.fleetManager}${sanctioned ? '  [SANCTIONS]' : ''}`);
        ownersCreated += 1;
        if (!EXECUTE) { ownerIdByConsRef.set(d.consRef, `dry-${d.consRef}`); continue; }

        const { data: ins, error } = await db.from('shipowners').insert({
            name: d.fleetManager,
            seed_ref: d.consRef,
            official_email: d.contactEmail,
            official_email_source: d.contactEmail ? 'PORT_OFFICER' : null,
            // Le manager réel est conservé comme CONTACT, jamais comme débiteur
            // substitué : 21 dossiers sur 74 nomment l'ISM, et les lettres sont
            // parties sous ce nom. ops_email n'est pas dans la liste
            // d'autorisation du lien magique — l'enregistrer n'ouvre aucun accès.
            ops_email: d.secondaryEmails[0] ?? null,
            phone_e164: d.phone,
            address: d.address,
            country_code: d.country,
            account_state: 'GHOST',
            jurisdiction_id: SOMALILAND_JURISDICTION_ID,
            applicable_modes: ['MARITIME'],
            is_un_prohibited: UN_PROHIBITED.has(d.consRef),
            is_ofac_sdn: sanctioned && !UN_PROHIBITED.has(d.consRef),
            notes: d.piClub ? `P&I: ${d.piClub}` : null,
        }).select('id').single();
        if (error) throw new Error(`armateur ${d.consRef} : ${error.message}`);
        ownerIdByConsRef.set(d.consRef, (ins as { id: string }).id);
    }

    // ── 3. Navires ────────────────────────────────────────────────────────
    const vesselIdByRef = new Map<string, string>();
    let vesselsCreated = 0;
    for (const v of vessels) {
        const ownerId = ownerIdByConsRef.get(v.consRef);
        if (!ownerId) throw new Error(`${v.name} : dossier ${v.consRef} introuvable`);
        // Un navire sans IMO reste identifiable et rattachable ; le préfixe dit
        // que l'identité n'est pas vérifiée plutôt que de laisser un trou.
        const imo = v.imo ?? `UNVERIFIED-${v.invoiceRef}`;

        const { data: found } = await db.from('vessels')
            .select('id').eq('imo_number', imo).maybeSingle();
        if (found) {
            const id = (found as { id: string }).id;
            vesselIdByRef.set(v.invoiceRef, id);
            if (EXECUTE) await db.from('vessels').update({ shipowner_id: ownerId }).eq('id', id);
            continue;
        }

        log(`  navire ${v.name} (${imo}) → ${v.consRef}`);
        vesselsCreated += 1;
        if (!EXECUTE) { vesselIdByRef.set(v.invoiceRef, `dry-${v.invoiceRef}`); continue; }

        const { data: ins, error } = await db.from('vessels').insert({
            imo_number: imo,
            mmsi: v.mmsi,
            name: v.name,
            flag_code: FLAG_ISO2[v.flag ?? 'Unknown'] ?? 'ZZ',
            category: 'CARGO',
            gross_tonnage_dwt: v.grossTonnage ?? 1,
            build_year: v.buildYear,
            compliance_status: 'PAYMENT_DUE',
            estimated_emissions_tco2: v.emissionsTco2,
            tax_liability_usd: v.amountUsd,
            shipowner_id: ownerId,
            jurisdiction_id: SOMALILAND_JURISDICTION_ID,
        }).select('id').single();
        if (error) throw new Error(`navire ${v.name} : ${error.message}`);
        vesselIdByRef.set(v.invoiceRef, (ins as { id: string }).id);
    }

    // ── 4. Pro-formas ─────────────────────────────────────────────────────
    let inserted = 0;
    for (const v of vessels) {
        const { data: live } = await db.from('transactions')
            .select('id').eq('invoice_ref', v.invoiceRef).neq('status', 'VOID').maybeSingle();
        if (live) continue;

        log(`  pro-forma ${v.invoiceRef} ${v.name} ${v.amountUsd.toFixed(2)} USD`);
        inserted += 1;
        if (!EXECUTE) continue;

        const { error } = await db.from('transactions').insert({
            vessel_id: vesselIdByRef.get(v.invoiceRef),
            vessel_name: v.name,
            vessel_imo: v.imo ?? `UNVERIFIED-${v.invoiceRef}`,
            shipowner_id: ownerIdByConsRef.get(v.consRef),
            emissions_tco2: v.emissionsTco2,
            tax_amount_usd: v.amountUsd,
            document_type: 'PROFORMA',
            transaction_type: 'ENTRY_TAX',
            status: 'PENDING',
            invoice_ref: v.invoiceRef,
            jurisdiction_id: SOMALILAND_JURISDICTION_ID,
            breakdown_json: {
                source: CAMPAIGN_SOURCE,
                consRef: v.consRef,
                portCalls: v.portCalls,
            },
        });
        if (error) throw new Error(`pro-forma ${v.invoiceRef} : ${error.message}`);
    }

    // ── Récapitulatif ─────────────────────────────────────────────────────
    const joignables = dossiers.filter((d) => d.contactEmail && !SANCTIONED.has(d.consRef));
    const sansAdresse = dossiers.filter((d) => !d.contactEmail && !SANCTIONED.has(d.consRef));
    console.log('');
    log(`annulées ${toVoid.length} · armateurs ${ownersCreated} · navires ${vesselsCreated} · pro-formas ${inserted}`);
    log(`joignables ${joignables.length} (${joignables.reduce((s, d) => s + d.totalUsd, 0).toFixed(2)} USD)`
        + ` · sans adresse ${sansAdresse.length} (${sansAdresse.reduce((s, d) => s + d.totalUsd, 0).toFixed(2)} USD)`
        + ` · sanctionnés ${dossiers.filter((d) => SANCTIONED.has(d.consRef)).length}`);
    if (!EXECUTE) log('SIMULATION — relancer avec --execute pour appliquer');
}

main().catch((e) => {
    console.error('ÉCHEC :', e instanceof Error ? e.message : e);
    process.exit(1);
});
