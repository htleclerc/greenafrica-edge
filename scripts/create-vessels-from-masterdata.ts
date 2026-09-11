// scripts/create-vessels-from-masterdata.ts
// Crée au registre les navires vus à Berbera mais absents de `vessels`, à
// partir des particulars VesselFinder MasterData, et les rattache à un
// armateur porteur.
//
// POURQUOI CE SCRIPT
// Une pro-forma se rattache à un navire ET à un armateur — les 86 lignes de la
// campagne du 27/08 le font toutes. Huit navires ayant fait escale en août et
// septembre n'existaient pas au registre : leurs contributions, 86 364,00 USD,
// ne pouvaient donc pas être enregistrées.
//
// LES JAUGES NE SONT PAS ESTIMÉES. `gross_tonnage_dwt` reçoit le GT de
// MasterData et `dwt` reçoit le DWT — deux champs distincts, à ne jamais
// confondre : `gross_tonnage_dwt` part à l'API fiscale sous le nom
// `gross_tonnage`, et les intervertir fausserait tous les montants suivants.
// Un navire dont MasterData ne donne pas le GT n'est pas créé.
//
// L'ARMATEUR PORTEUR
// `--owner-email` désigne l'armateur auquel rattacher ces navires. Une adresse
// de notre propre domaine (a.unknow@greengate.africa) est un porteur interne :
// aucune relance ne part vers un tiers, elle revient chez nous. C'est
// volontaire — l'identité réelle de ces armateurs n'est pas établie, et
// inventer un contact enverrait des mises en demeure au mauvais destinataire.
//
// Usage :
//   npx tsx scripts/create-vessels-from-masterdata.ts \
//       --calc a.json --calc s.json --masterdata md.json --portcalls pc.json \
//       --owner-email a.unknow@greengate.africa [--prod] [--execute]

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const EXECUTE = args.includes('--execute');

function opt(name: string, fallback: string): string {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
function opts(name: string): string[] {
    const out: string[] = [];
    args.forEach((a, i) => {
        if (a === `--${name}` && args[i + 1]) out.push(args[i + 1]);
    });
    return out;
}

process.loadEnvFile(new URL(PROD ? '../frontend/.env.prod.local' : '../frontend/.env.local', import.meta.url));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('❌ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants');
    process.exit(1);
}

const OWNER_EMAIL = opt('owner-email', '');
const MASTERDATA = opt('masterdata', '');
const PORTCALLS = opt('portcalls', '');
const CALC_FILES = opts('calc');
if (!OWNER_EMAIL || !MASTERDATA || CALC_FILES.length === 0) {
    console.error('❌ --owner-email, --masterdata et au moins un --calc sont requis');
    process.exit(1);
}

const JURIDICTION_SOMALILAND = '00000000-0000-4000-8000-00000000534f';

/** Même table que `vesselFinderParser.ts` — un type non listé n'est pas deviné. */
const CATEGORIE_PAR_TYPE: Readonly<Record<string, string>> = {
    'Bulk Carrier': 'BULK_CARRIER',
    'Container Ship': 'CONTAINER',
    'General Cargo Ship': 'CARGO',
    'Deck Cargo Ship': 'CARGO',
    'Ro-Ro Cargo Ship': 'CARGO',
    'Palletised Cargo Ship': 'CARGO',
    'Refrigerated Cargo Ship': 'CARGO',
    'Livestock Carrier': 'CARGO',
    'Landing Craft': 'CARGO',
    Tug: 'CARGO',
    'Oil Products Tanker': 'TANKER',
    'Chemical/Oil Products Tanker': 'TANKER',
    'LPG Tanker': 'TANKER',
};

interface MasterRow {
    IMO?: string | number;
    NAME?: string;
    FLAG?: string;
    TYPE?: string;
    BUILT?: string | number;
    GT?: string | number;
    DWT?: string | number;
}

function lireJson<T>(f: string): T {
    return JSON.parse(readFileSync(f, 'utf-8')) as T;
}

/** IMO → MMSI, relevé sur les mouvements portuaires (MasterData n'en donne pas). */
function mmsiParImo(fichier: string): Map<string, string> {
    const m = new Map<string, string>();
    if (!fichier) return m;
    const rows = lireJson<Array<Record<string, unknown>>>(fichier);
    for (const it of rows) {
        const pc = (it.PORTCALL ?? it) as Record<string, unknown>;
        const imo = String(pc.IMO ?? '');
        const mmsi = String(pc.MMSI ?? '');
        if (imo && imo !== '0' && mmsi && mmsi !== '0') m.set(imo, mmsi);
    }
    return m;
}

async function resoudreArmateur(db: SupabaseClient): Promise<{ id: string; name: string }> {
    const { data, error } = await db
        .from('shipowners')
        .select('id, name, official_email')
        .eq('official_email', OWNER_EMAIL)
        .maybeSingle();
    if (error) throw new Error(`lecture shipowners: ${error.message}`);
    if (data) return { id: String(data.id), name: String(data.name) };

    // Pas d'armateur à cette adresse : on reprend le porteur « UNKNOWN », qui
    // existe déjà pour ce rôle, plutôt que d'ajouter un troisième réceptacle
    // à côté de lui et de « À identifier ».
    const { data: unknown_, error: uErr } = await db
        .from('shipowners')
        .select('id, name')
        .eq('name', 'UNKNOWN')
        .maybeSingle();
    if (uErr) throw new Error(`lecture UNKNOWN: ${uErr.message}`);
    if (!unknown_) throw new Error("aucun armateur à cette adresse et pas de porteur « UNKNOWN » : refus de créer une entité de facturation sans instruction");

    console.log(`→ le porteur « UNKNOWN » recevra l'adresse ${OWNER_EMAIL}`);
    if (EXECUTE) {
        const { error: upErr } = await db
            .from('shipowners')
            .update({
                official_email: OWNER_EMAIL,
                // Décision interne d'un officier, pas une adresse vérifiée
                // auprès d'un tiers : c'est la seule valeur honnête de la liste.
                official_email_source: 'PORT_OFFICER',
                is_placeholder: true,
            })
            .eq('id', unknown_.id);
        if (upErr) throw new Error(`mise à jour UNKNOWN: ${upErr.message}`);
    }
    return { id: String(unknown_.id), name: String(unknown_.name) };
}

async function main(): Promise<void> {
    const db: SupabaseClient = createClient(SUPABASE_URL as string, SERVICE_ROLE_KEY as string, {
        auth: { persistSession: false },
    });

    console.log(`=== ${EXECUTE ? 'ÉCRITURE' : 'SIMULATION'} · ${PROD ? 'PRODUCTION' : 'staging'} ===\n`);

    // Les IMO facturables, tous lots confondus.
    const voulus = new Set<string>();
    for (const f of CALC_FILES) {
        for (const r of lireJson<Array<Record<string, unknown>>>(f)) {
            if (r.state === 'billable') voulus.add(String(r.imo));
        }
    }

    const { data: existants, error: vErr } = await db.from('vessels').select('imo_number');
    if (vErr) throw new Error(`lecture vessels: ${vErr.message}`);
    const dejaLa = new Set((existants ?? []).map((v) => String(v.imo_number)));
    const aCreer = [...voulus].filter((i) => !dejaLa.has(i)).sort();

    if (aCreer.length === 0) {
        console.log('Aucun navire à créer — tous les IMO facturables sont au registre.');
        return;
    }

    const master = new Map<string, MasterRow>();
    for (const it of lireJson<Array<Record<string, unknown>>>(MASTERDATA)) {
        const r = (it.MASTERDATA ?? it) as MasterRow;
        master.set(String(r.IMO ?? ''), r);
    }
    const mmsis = mmsiParImo(PORTCALLS);
    const armateur = await resoudreArmateur(db);
    console.log(`armateur porteur : ${armateur.name} (${OWNER_EMAIL})\n`);

    const lignes: Array<Record<string, unknown>> = [];
    const refus: string[] = [];

    for (const imo of aCreer) {
        const r = master.get(imo);
        const gt = Number(r?.GT ?? 0);
        const categorie = r?.TYPE ? CATEGORIE_PAR_TYPE[r.TYPE] : undefined;
        if (!r || !gt || !categorie || !r.FLAG || !r.NAME) {
            refus.push(`${imo} — particulars incomplets (GT ${r?.GT ?? '?'}, type « ${r?.TYPE ?? '?'} »)`);
            continue;
        }
        lignes.push({
            imo_number: imo,
            mmsi: mmsis.get(imo) ?? null,
            name: r.NAME,
            flag_code: String(r.FLAG).slice(0, 2).toUpperCase(),
            category: categorie,
            // GT dans gross_tonnage_dwt, DWT dans dwt : voir l'en-tête.
            gross_tonnage_dwt: gt,
            dwt: r.DWT ? Number(r.DWT) : null,
            build_year: r.BUILT ? Number(r.BUILT) : null,
            shipowner_id: armateur.id,
            compliance_status: 'PAYMENT_DUE',
            jurisdiction_id: JURIDICTION_SOMALILAND,
        });
        console.log(
            `  ${imo.padEnd(9)} ${String(r.NAME).slice(0, 20).padEnd(20)} ${String(r.FLAG).padEnd(3)} ` +
                `${String(categorie).padEnd(13)} GT ${String(gt).padEnd(7)} DWT ${String(r.DWT ?? '-').padEnd(8)} ${String(r.BUILT ?? '-')}`,
        );
    }

    console.log(`\n${lignes.length} navire(s) à créer`);
    if (refus.length) {
        console.log(`⚠ ${refus.length} écarté(s) :`);
        for (const x of refus) console.log(`   ${x}`);
    }
    if (!EXECUTE) {
        console.log("\nSimulation — rien n'a été écrit. Ajouter --execute pour créer.");
        return;
    }
    if (lignes.length === 0) return;

    const { error: insErr } = await db.from('vessels').insert(lignes);
    if (insErr) {
        console.error(`\n❌ insertion refusée : ${insErr.message}`);
        process.exit(1);
    }
    console.log(`\n✅ ${lignes.length} navire(s) créé(s), rattaché(s) à ${armateur.name}.`);
}

main().catch((err: unknown) => {
    console.error('❌', err instanceof Error ? err.message : String(err));
    process.exit(1);
});
