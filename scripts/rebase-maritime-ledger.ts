// Rebascule du livre maritime sur le dossier de production du 27/08/2026.
//
// Usage :
//   npx tsx scripts/rebase-maritime-ledger.ts                 → simulation, aucune écriture
//   npx tsx scripts/rebase-maritime-ledger.ts --execute       → applique, idempotent
//   npx tsx scripts/rebase-maritime-ledger.ts --execute --clean-ghosts
//       → en plus : neutralise ce que le seed de juillet a laissé sur le rail maritime
//
// Prérequis : migrations 128 (index unique excluant VOID) et 146 (échéance
// explicite, agent consignataire) appliquées, et SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY exportés. SUPABASE_URL est l'URL HTTPS du projet,
// pas la chaîne postgresql://.
//
// ORDRE IMPOSÉ : annuler AVANT d'insérer. L'inverse bute sur l'index unique,
// puisque les 86 références de la campagne sont précisément celles que
// détiennent les pro-formas du seed de juillet.
//
// SOURCE : `docs/06_Production_DB/seeds_prod` — le paquet identifié du 27/08.
// Même portefeuille que la campagne du 19/08 (mêmes références, mêmes montants,
// même total), mais les 86 navires y portent enfin leur IMO réel, et les
// dossiers arrivent avec adresse, club P&I et agence consignataire. La feuille
// « Détail Navires » de la campagne reste lue, pour le seul pont slug ↔
// référence consolidée (voir prodSeeds.ts).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVesselDetail } from '../frontend/src/services/ledgerRebase/consRefsParser';
import { buildProdSeedBundle, type ProdSeedBundle } from '../frontend/src/services/ledgerRebase/prodSeeds';
import { SOMALILAND_JURISDICTION_ID } from '../frontend/src/services/onboardingImport/mappers';

const EXECUTE = process.argv.includes('--execute');
const CLEAN_GHOSTS = process.argv.includes('--clean-ghosts');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED_DIR = join(ROOT, 'docs', '06_Production_DB', 'seeds_prod');
const CAMPAIGN_DIR = join(ROOT, 'docs', 'onboarding', 'campagne-19aout');

/**
 * Marqueur de provenance écrit dans breakdown_json. Il distingue une pro-forma
 * du dossier de production d'une pro-forma du seed portant la même référence —
 * c'est ce qui rend le script rejouable sans dégât. La valeur du 19/08 est
 * encore reconnue : là où cette rebascule-là a été jouée (bases de recette),
 * ses lignes sont les nôtres et ne doivent pas être annulées puis recréées.
 */
const CAMPAIGN_SOURCE = 'campagne_27aout_2026';
const PREVIOUS_CAMPAIGN_SOURCE = 'campagne_19aout_2026';
const OURS = new Set([CAMPAIGN_SOURCE, PREVIOUS_CAMPAIGN_SOURCE]);

/** Marqueur du seed d'onboarding de juillet, seul périmètre du nettoyage. */
const SEED_SOURCE = 'onboarding_seed_v2';

/** 40,00 USD par tonne de CO₂ — le tarif que les 86 pro-formas appliquent. */
const RATE_USD_PER_TCO2 = 40;

/**
 * Pavillons du dossier (en toutes lettres) vers ISO-3166-1 alpha-2. 21 sur 21
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

function log(...a: unknown[]) { console.log(EXECUTE ? '[EXEC]' : '[DRY ]', ...a); }

/**
 * Émission au matin de Mogadiscio, échéance en fin de journée : c'est la
 * convention que la colonne générée appliquait (mig 022) et que le déclencheur
 * de la mig 146 reconduit. Un débiteur qui paie le 10 au soir est dans les
 * temps.
 */
function issuedAt(day: string): string { return `${day}T09:00:00+03:00`; }
function dueAt(day: string): string { return `${day}T23:59:59.999+03:00`; }

function loadBundle(): ProdSeedBundle {
    // Les deux sources portent des coordonnées réelles et ne suivent pas le
    // dépôt : elles se copient à la main sur la machine qui joue l'import.
    // Le dire ici évite un ENOENT nu, illisible pour qui découvre la manœuvre.
    for (const [dir, quoi] of [[SEED_DIR, 'le dossier de production du 27/08'], [CAMPAIGN_DIR, 'le référentiel de la campagne du 19/08']] as const) {
        if (!existsSync(dir)) {
            throw new Error(`${quoi} est absent (${dir}) — il ne suit pas le dépôt, voir docs/runbooks/bascule-livre-maritime-27aout.md`);
        }
    }

    const seed = (f: string) => JSON.parse(readFileSync(join(SEED_DIR, f), 'utf8'));
    const campaign = parseVesselDetail(
        JSON.parse(readFileSync(join(CAMPAIGN_DIR, 'detail-navires.json'), 'utf8')) as unknown[][],
    );
    return buildProdSeedBundle({
        armateurs: seed('01_armateurs_PROD.json'),
        navires: seed('02_navires_PROD.json'),
        proformas: seed('04_proformas_PROD.json'),
        relances: seed('05_relances_PROD.json'),
    }, campaign);
}

async function main() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis');
    const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

    // ── 0. Référentiel ───────────────────────────────────────────────────────
    const bundle = loadBundle();
    log(`dossier : ${bundle.owners.length} armateurs, ${bundle.vessels.length} navires,`
        + ` ${bundle.proformas.length} pro-formas, ${bundle.reminders.length} relances,`
        + ` ${bundle.totalUsd.toFixed(2)} USD`);
    const notable = bundle.warnings.filter((w) => !w.includes('agence consignataire'));
    log(`signalements : ${bundle.warnings.length} (dont ${notable.length} hors agence manquante)`);
    notable.slice(0, 8).forEach((w) => log(`  ! ${w}`));
    if (notable.length > 8) log(`  … ${notable.length - 8} autres`);

    const targetRefs = bundle.proformas.map((p) => p.reference);

    // ── 1. Annulation des pro-formas occupant les références cibles ──────────
    // `status` est la seule colonne libre de la mig 089 ; invoice_ref est en
    // écriture unique et DELETE est interdit. VOID est donc le seul levier.
    type Occupant = {
        id: string; invoice_ref: string; vessel_name: string;
        tax_amount_usd: number; proforma_sent_at: string | null;
        breakdown_json: { source?: string } | null;
    };
    const { data: occupants, error: occErr } = await db
        .from('transactions')
        .select('id, invoice_ref, vessel_name, tax_amount_usd, proforma_sent_at, breakdown_json')
        .in('invoice_ref', targetRefs)
        .neq('status', 'VOID');
    if (occErr) throw new Error(`lecture des occupants : ${occErr.message}`);

    // Ne JAMAIS annuler ce que ce script a lui-même émis. Sans ce filtre, un
    // second passage annule les 86 pro-formas puis les réinsère : le livre est
    // détruit et redoublé à chaque exécution.
    const toVoid = ((occupants ?? []) as Occupant[])
        .filter((t) => !OURS.has(String(t.breakdown_json?.source ?? '')));

    // Garde-fou : une pro-forma déjà distribuée porte une date d'envoi, et son
    // PDF circule chez le débiteur. L'annuler en silence rendrait le livre
    // incohérent avec ce qui a été notifié.
    const distributed = toVoid.filter((t) => t.proforma_sent_at);
    if (distributed.length) {
        throw new Error(
            `${distributed.length} pro-forma(s) à annuler ont déjà été envoyées `
            + `(${distributed.slice(0, 3).map((t) => t.invoice_ref).join(', ')}…) — arbitrage requis, rien n'a été écrit`,
        );
    }

    const alreadyMine = (occupants ?? []).length - toVoid.length;
    if (alreadyMine > 0) log(`déjà émises par la campagne, laissées intactes : ${alreadyMine}`);
    log(`à annuler : ${toVoid.length} pro-forma(s) occupant les références cibles`);

    // En simulation rien n'est écrit, mais la suite doit raisonner comme si :
    // sans cela, les étapes 4 et 6 revoient ces lignes vivantes et annoncent
    // 0 pro-forma à créer et 100 reliquats à neutraliser. Un compte-rendu de
    // simulation qui ne décrit pas ce que l'exécution ferait ne sert à rien.
    const voidedHere = new Set(toVoid.map((t) => t.id));

    for (const t of toVoid) {
        log(`  VOID ${t.invoice_ref} — ${t.vessel_name} (${Number(t.tax_amount_usd).toFixed(2)} USD)`);
        if (EXECUTE) {
            const { error } = await db.from('transactions').update({ status: 'VOID' }).eq('id', t.id);
            if (error) throw new Error(`VOID ${t.invoice_ref} : ${error.message}`);
        }
    }

    // ── 2. Armateurs ─────────────────────────────────────────────────────────
    // La campagne fait foi sur ces 74 dossiers : le script réécrit à chaque
    // passage les champs qu'il apporte. Une exception, `official_email` : c'est
    // le champ que l'administration corrige à la main (updateArmateurEmail), et
    // l'écraser effacerait une correction humaine par une donnée d'export.
    const ownerIdByCons = new Map<string, string>();
    let ownersCreated = 0;
    let ownersUpdated = 0;
    for (const o of bundle.owners) {
        const contact = {
            name: o.legalName,
            aliases: o.aliases,
            ops_email: o.opsEmail,
            billing_cc_emails: o.ccEmails,
            phone_e164: o.phone,
            address: o.address,
            country_code: o.countryCode,
            is_un_prohibited: o.isUnProhibited,
            is_ofac_sdn: o.isOfacSdn,
            notes: [o.piClub ? `P&I: ${o.piClub}` : null, o.notes].filter(Boolean).join(' — ') || null,
        };

        const { data: found, error: findErr } = await db.from('shipowners')
            .select('id, official_email').eq('seed_ref', o.consRef).maybeSingle();
        if (findErr) throw new Error(`armateur ${o.consRef} : ${findErr.message}`);

        if (found) {
            const row = found as { id: string; official_email: string | null };
            ownerIdByCons.set(o.consRef, row.id);
            const current = (row.official_email ?? '').trim().toLowerCase();
            if (current && o.loginEmail && current !== o.loginEmail) {
                log(`  ! ${o.consRef} : adresse en base (${current}) ≠ dossier (${o.loginEmail}) — la base est conservée`);
            }
            ownersUpdated += 1;
            if (EXECUTE) {
                const patch = current
                    ? contact
                    : { ...contact, official_email: o.loginEmail, official_email_source: o.loginEmail ? 'PORT_OFFICER' : null };
                const { error } = await db.from('shipowners').update(patch).eq('id', row.id);
                if (error) throw new Error(`armateur ${o.consRef} : ${error.message}`);
            }
            continue;
        }

        const sanctioned = o.isOfacSdn || o.isUnProhibited;
        log(`  armateur ${o.consRef} ${o.legalName}${sanctioned ? '  [SANCTIONS]' : ''}`);
        ownersCreated += 1;
        if (!EXECUTE) { ownerIdByCons.set(o.consRef, `dry-${o.consRef}`); continue; }

        const { data: ins, error } = await db.from('shipowners').insert({
            ...contact,
            seed_ref: o.consRef,
            official_email: o.loginEmail,
            official_email_source: o.loginEmail ? 'PORT_OFFICER' : null,
            account_state: 'GHOST',
            jurisdiction_id: SOMALILAND_JURISDICTION_ID,
            applicable_modes: ['MARITIME'],
        }).select('id').single();
        if (error) throw new Error(`armateur ${o.consRef} : ${error.message}`);
        ownerIdByCons.set(o.consRef, (ins as { id: string }).id);
    }

    // ── 3. Navires ───────────────────────────────────────────────────────────
    const consBySlug = new Map(bundle.owners.map((o) => [o.slug, o.consRef]));
    const proformaByVesselSeedId = new Map(bundle.proformas.map((p) => [p.vesselSeedId, p]));
    const vesselIdByRef = new Map<string, string>();
    let vesselsCreated = 0;
    let vesselsUpdated = 0;
    for (const v of bundle.vessels) {
        const consRef = consBySlug.get(v.ownerSlug);
        if (!consRef) throw new Error(`${v.name} : dossier de ${v.ownerSlug} introuvable`);
        const ownerId = ownerIdByCons.get(consRef);
        if (!ownerId) throw new Error(`${v.name} : armateur ${consRef} non résolu`);

        // Le navire porte la dette de sa pro-forma : les écrans de flotte
        // lisent ces deux colonnes, et les laisser à zéro afficherait une
        // flotte en règle sur un portefeuille entièrement impayé.
        const proforma = proformaByVesselSeedId.get(v.seedId);
        if (!proforma) throw new Error(`${v.name} : aucune pro-forma pour ce navire`);

        const identity = {
            name: v.name,
            estimated_emissions_tco2: proforma.billedTco2,
            tax_liability_usd: proforma.totalUsd,
            compliance_status: 'PAYMENT_DUE',
            mmsi: v.mmsi,
            flag_code: FLAG_ISO2[v.flagName] ?? 'ZZ',
            gross_tonnage_dwt: v.grossTonnage,
            dwt: v.dwt,
            build_year: v.buildYear,
            vessel_subtype: v.vesselSubtype,
            previous_names: v.previousNames,
            registered_owner: v.registeredOwner,
            local_agent_name: v.localAgentName,
            local_agent_contact: v.localAgentContact,
            local_agent_phone: v.localAgentPhone,
            last_port_call_on: v.lastPortCallOn,
            port_calls_count: v.portCallsCount,
            shipowner_id: ownerId,
        };

        const { data: found, error: findErr } = await db.from('vessels')
            .select('id').eq('imo_number', v.imo).maybeSingle();
        if (findErr) throw new Error(`navire ${v.imo} : ${findErr.message}`);

        if (found) {
            const id = (found as { id: string }).id;
            vesselIdByRef.set(v.invoiceRef, id);
            vesselsUpdated += 1;
            if (EXECUTE) {
                const { error } = await db.from('vessels').update(identity).eq('id', id);
                if (error) throw new Error(`navire ${v.name} : ${error.message}`);
            }
            continue;
        }

        log(`  navire ${v.name} (${v.imo}) → ${consRef}`);
        vesselsCreated += 1;
        if (!EXECUTE) { vesselIdByRef.set(v.invoiceRef, `dry-${v.invoiceRef}`); continue; }

        const { data: ins, error } = await db.from('vessels').insert({
            ...identity,
            imo_number: v.imo,
            category: 'CARGO',
            jurisdiction_id: SOMALILAND_JURISDICTION_ID,
        }).select('id').single();
        if (error) throw new Error(`navire ${v.name} : ${error.message}`);
        vesselIdByRef.set(v.invoiceRef, (ins as { id: string }).id);
    }

    // ── 4. Pro-formas ────────────────────────────────────────────────────────
    const vesselBySeedId = new Map(bundle.vessels.map((v) => [v.seedId, v]));
    const txIdByRef = new Map<string, string>();
    let inserted = 0;
    for (const p of bundle.proformas) {
        const { data: live, error: liveErr } = await db.from('transactions')
            .select('id').eq('invoice_ref', p.reference).neq('status', 'VOID').maybeSingle();
        if (liveErr) throw new Error(`${p.reference} : ${liveErr.message}`);
        const liveId = (live as { id: string } | null)?.id;
        if (liveId && !voidedHere.has(liveId)) { txIdByRef.set(p.reference, liveId); continue; }

        const vessel = vesselBySeedId.get(p.vesselSeedId);
        if (!vessel) throw new Error(`${p.reference} : navire ${p.vesselSeedId} introuvable`);
        const consRef = consBySlug.get(p.ownerSlug);
        if (!consRef) throw new Error(`${p.reference} : dossier de ${p.ownerSlug} introuvable`);

        log(`  pro-forma ${p.reference} ${vessel.name} ${p.totalUsd.toFixed(2)} USD → ${p.dueOn}`);
        inserted += 1;
        if (!EXECUTE) continue;

        const { data: ins, error } = await db.from('transactions').insert({
            vessel_id: vesselIdByRef.get(p.reference),
            vessel_name: vessel.name,
            vessel_imo: vessel.imo,
            shipowner_id: ownerIdByCons.get(consRef),
            emissions_tco2: p.billedTco2,
            tax_amount_usd: p.totalUsd,
            rate_usd_per_tco2: RATE_USD_PER_TCO2,
            document_type: 'PROFORMA',
            transaction_type: 'ENTRY_TAX',
            status: 'PENDING',
            invoice_ref: p.reference,
            jurisdiction_id: SOMALILAND_JURISDICTION_ID,
            created_at: issuedAt(p.issuedOn),
            // Terme à 15 jours, contre le NET-30 par défaut : c'est la date que
            // porte le PDF distribué le 27/08. Possible depuis la mig 146.
            due_date: dueAt(p.dueOn),
            proforma_sent_at: p.sentAt,
            breakdown_json: {
                source: CAMPAIGN_SOURCE,
                consRef,
                period: p.period,
                collectionStatus: p.collectionStatus,
                sentMethod: p.sentMethod,
                pdfFile: p.pdfFile,
                // Pénalité annoncée au dossier. Conservée en note, jamais
                // appliquée : aucune colonne fiscale ne la porte et le montant
                // est forfaitaire, non proportionnel.
                penaltyAfterDueUsd: p.penaltyAfterDueUsd,
            },
        }).select('id').single();
        if (error) throw new Error(`pro-forma ${p.reference} : ${error.message}`);
        txIdByRef.set(p.reference, (ins as { id: string }).id);
    }

    // ── 5. Journal des relances ──────────────────────────────────────────────
    // `FINAL_15D` n'existe pas dans l'enum reminder_tier : le palier du dossier
    // décrit le terme accordé, pas le rang dans la rampe J3→J45. MANUAL est le
    // seul libellé honnête ; le nom du gabarit garde la trace exacte.
    let remindersInserted = 0;
    for (const r of bundle.reminders) {
        const { data: existing, error: exErr } = await db.from('collection_reminders')
            .select('id').eq('seed_ref', r.seedId).maybeSingle();
        if (exErr) throw new Error(`relance ${r.seedId} : ${exErr.message}`);
        if (existing) continue;

        const txId = txIdByRef.get(r.invoiceRef);
        if (!txId && EXECUTE) throw new Error(`relance ${r.seedId} : pro-forma ${r.invoiceRef} non résolue`);
        remindersInserted += 1;
        if (!EXECUTE) continue;

        const { error } = await db.from('collection_reminders').insert({
            transaction_id: txId,
            tier: 'MANUAL',
            sent_at: r.sentAt,
            sent_email: r.sentEmail,
            cc_emails: r.ccEmails,
            template_used: r.template,
            debtor_response_type: r.responseType,
            debtor_response_at: r.respondedAt,
            escalated_bailiff: r.escalatedBailiff,
            seed_ref: r.seedId,
        });
        if (error) throw new Error(`relance ${r.seedId} : ${error.message}`);
    }
    log(`relances : ${remindersInserted} à inscrire`);

    // ── 6. Nettoyage du rail maritime de juillet (optionnel) ─────────────────
    let ghostVoided = 0;
    let ghostReminders = 0;
    let ghostPayments = 0;
    if (CLEAN_GHOSTS) {
        // Les pro-formas maritimes du seed qui ne portent pas une des 86
        // références restent vivantes après l'étape 1. Elles décrivent des
        // navires inventés (VESSEL-W*-*) et gonflent l'encours d'un montant
        // qui n'a jamais été facturé à personne.
        // SANS filtre de statut, volontairement. L'étape 1 vient d'en annuler
        // 86 : les exclure ici perdrait de vue les relances et les paiements
        // fictifs qu'elles portent, et le nettoyage passerait à côté de
        // l'essentiel. En simulation le défaut est invisible — rien n'a été
        // annulé — d'où un compte juste en simulation et nul à l'exécution.
        const { data: leftovers, error: leftErr } = await db
            .from('transactions')
            .select('id, invoice_ref, vessel_name, tax_amount_usd, proforma_sent_at, status')
            .eq('breakdown_json->>source', SEED_SOURCE)
            .eq('mode', 'MARITIME');
        if (leftErr) throw new Error(`lecture des reliquats : ${leftErr.message}`);

        type SeedTx = {
            id: string; invoice_ref: string | null;
            proforma_sent_at: string | null; status: string;
        };
        const allSeedMaritime = (leftovers ?? []) as SeedTx[];
        // À annuler : celles qui vivent encore, c'est-à-dire celles dont la
        // référence ne figure pas au dossier du 27/08.
        const rows = allSeedMaritime.filter((t) => t.status !== 'VOID' && !voidedHere.has(t.id));
        const sent = rows.filter((t) => t.proforma_sent_at);
        if (sent.length) throw new Error(`${sent.length} pro-forma(s) de seed ont été envoyées — nettoyage refusé`);

        ghostVoided = rows.length;
        log(`reliquats maritimes du seed à neutraliser : ${ghostVoided}`);
        for (const t of rows) {
            if (!EXECUTE) continue;
            const { error } = await db.from('transactions').update({ status: 'VOID' }).eq('id', t.id);
            if (error) throw new Error(`VOID ${t.invoice_ref ?? t.id} : ${error.message}`);
        }

        // Relances et paiements fictifs du seed. Ni l'une ni l'autre table n'a
        // de garde de suppression, et ces lignes n'ont aucun correspondant
        // réel : le seed les a fabriquées pour peupler les écrans.
        const seedTxIds = allSeedMaritime.map((t) => t.id);
        if (seedTxIds.length) {
            const { data: rem } = await db.from('collection_reminders')
                .select('id').in('transaction_id', seedTxIds).is('seed_ref', null);
            ghostReminders = (rem ?? []).length;
            const { data: pay } = await db.from('payments')
                .select('id').in('transaction_id', seedTxIds);
            ghostPayments = (pay ?? []).length;
            log(`relances fictives : ${ghostReminders} · paiements fictifs : ${ghostPayments}`);
            if (EXECUTE) {
                if (ghostReminders) {
                    const { error } = await db.from('collection_reminders')
                        .delete().in('transaction_id', seedTxIds).is('seed_ref', null);
                    if (error) throw new Error(`suppression des relances fictives : ${error.message}`);
                }
                if (ghostPayments) {
                    const { error } = await db.from('payments').delete().in('transaction_id', seedTxIds);
                    if (error) throw new Error(`suppression des paiements fictifs : ${error.message}`);
                }
            }
        }
    }

    // ── Récapitulatif ────────────────────────────────────────────────────────
    const joignables = bundle.owners.filter((o) => o.loginEmail);
    const muets = bundle.owners.filter((o) => !o.loginEmail && !(o.isOfacSdn || o.isUnProhibited));
    const sanctionnes = bundle.owners.filter((o) => o.isOfacSdn || o.isUnProhibited);
    const usdOf = (slugs: Set<string>) => bundle.proformas
        .filter((p) => slugs.has(p.ownerSlug)).reduce((s, p) => s + p.totalUsd, 0);

    console.log('');
    log(`annulées ${toVoid.length} · armateurs ${ownersCreated} créés / ${ownersUpdated} mis à jour`
        + ` · navires ${vesselsCreated} créés / ${vesselsUpdated} mis à jour`
        + ` · pro-formas ${inserted} · relances ${remindersInserted}`);
    if (CLEAN_GHOSTS) {
        log(`nettoyage : ${ghostVoided} pro-formas de seed annulées · ${ghostReminders} relances · ${ghostPayments} paiements supprimés`);
    }
    log(`joignables ${joignables.length} (${usdOf(new Set(joignables.map((o) => o.slug))).toFixed(2)} USD)`
        + ` · sans adresse ${muets.length} (${usdOf(new Set(muets.map((o) => o.slug))).toFixed(2)} USD)`
        + ` · sanctionnés ${sanctionnes.length} (${usdOf(new Set(sanctionnes.map((o) => o.slug))).toFixed(2)} USD)`);
    if (!EXECUTE) log('SIMULATION — relancer avec --execute pour appliquer');
}

main().catch((e) => {
    console.error('ÉCHEC :', e instanceof Error ? e.message : e);
    process.exit(1);
});
