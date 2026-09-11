// scripts/issue-proformas-backlog.ts
// Verse dans la plateforme les pro-formas maritimes calculées mais jamais
// enregistrées : le lot du 4→31 août et celui du 1→10 septembre.
//
// CE QU'IL FAIT ET NE FAIT PAS
// Il crée des lignes `transactions` en PENDING, avec `proforma_sent_at` NUL.
// Il **n'envoie rien** : ni e-mail, ni notification, ni PDF. La décision
// d'envoyer appartient à la Direction et elle est suspendue — le programme est
// en litige, deux débiteurs contestent par écrit et une agence a saisi deux
// ministères. Enregistrer une créance et la notifier sont deux gestes
// distincts ; ce script ne fait que le premier.
//
// D'OÙ VIENNENT LES MONTANTS
// Août : `docs/KB_GreenGate_ProFormas/data/maritime/hybrid_dataset_AOUT2026_v1.json`,
// calculé le 02/09 et dont les 24 montants sont vérifiés un à un par les tests
// Go de `backend/internal/greengate`.
// Septembre : sortie de `go run ./cmd/greengate-calc`, seule implémentation
// autorisée du calcul. Ce script ne recalcule JAMAIS lui-même — une troisième
// implémentation de la formule est exactement ce qui a produit des montants
// divergents par le passé.
//
// RÉFÉRENCES
// Le lot d'août porte déjà ses `PRO-2026-0640xx`, attribuées quand les PDF ont
// été produits : on les REPREND telles quelles. Les réattribuer
// désynchroniserait les documents déjà générés de la base — l'incident nº2 du
// dossier de connaissance. Les refs 064087→064100 existent en base sur des
// lignes VOID ; l'index unique `idx_txn_invoice_ref` exclut les annulées, la
// reprise est donc licite.
//
// Les deux lots arrivent SOUS FORME CALCULÉE, sortis de `greengate-calc` : ce
// script ne connaît pas la formule et n'applique pas la garde sanctions
// lui-même. Les deux vivent dans le Go, une fois pour toutes.
//
// Usage :
//   go run ./cmd/greengate-calc --in lot.json --out calcule.json   (depuis backend/)
//   npx tsx scripts/issue-proformas-backlog.ts --aout a.json --septembre s.json
//   … --prod              → simulation sur la production
//   … --prod --execute    → ÉCRIT en production
//
// Options : --aout <fichier> --septembre <fichier>  sorties de greengate-calc
//           --issue-date AAAA-MM-JJ   (défaut : aujourd'hui)
//           --pay-terms <jours>       (défaut 30, cf mig 149)

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const EXECUTE = args.includes('--execute');
/** Assume un lot incomplet. Voir la garde en fin de `main` : jamais implicite. */
const ALLOW_PARTIAL = args.includes('--allow-partial');

function opt(name: string, fallback: string): string {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

process.loadEnvFile(new URL(PROD ? '../frontend/.env.prod.local' : '../frontend/.env.local', import.meta.url));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('❌ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants');
    process.exit(1);
}

const ISSUE_DATE = opt('issue-date', new Date().toISOString().slice(0, 10));
const PAY_TERMS = Number(opt('pay-terms', '30'));
const SEPT_FILE = opt('septembre', '');
const AOUT_FILE = opt('aout', '');

const JURIDICTION_SOMALILAND = '00000000-0000-4000-8000-00000000534f';

/** Une pro-forma à verser, quelle que soit sa provenance. */
interface Ligne {
    lot: string;
    imo: string;
    name: string;
    gt: number;
    nCalls: number;
    billedTco2: number;
    usd: number;
    proRef: string | null;
    periodStart: string;
    periodEnd: string;
}

/** Une sortie de greengate-calc, telle quelle. */
interface LigneCalculee {
    imo: string;
    name: string;
    gt: number;
    n_calls: number;
    state: string;
    blocked_by?: string;
    billed_tco2?: number;
    hybrid_usd?: number;
    pro_ref?: string;
}

function charger(fichier: string, lot: string, debut: string, fin: string): Ligne[] {
    if (!fichier) return [];
    const rows = JSON.parse(readFileSync(fichier, 'utf-8')) as LigneCalculee[];
    return rows
        .filter((r) => r.state === 'billable')
        .map((r) => ({
            lot,
            imo: String(r.imo),
            name: String(r.name),
            gt: Number(r.gt),
            nCalls: Number(r.n_calls),
            billedTco2: Number(r.billed_tco2 ?? 0),
            usd: Number(r.hybrid_usd ?? 0),
            proRef: r.pro_ref ?? null,
            periodStart: debut,
            periodEnd: fin,
        }));
}

/** Les entités écartées par le Go, pour qu'elles figurent au rapport. */
function ecartes(fichier: string): Array<{ imo: string; name: string; raison: string }> {
    if (!fichier) return [];
    const rows = JSON.parse(readFileSync(fichier, 'utf-8')) as LigneCalculee[];
    return rows
        .filter((r) => r.state !== 'billable')
        .map((r) => ({
            imo: String(r.imo),
            name: String(r.name),
            raison: r.state === 'blocked' ? `sanctions : ${String(r.blocked_by)}` : 'jauge manquante',
        }));
}

interface NavireRegistre {
    id: string;
    imo_number: string;
    name: string;
    shipowner_id: string | null;
}

async function chargerRegistre(db: SupabaseClient): Promise<Map<string, NavireRegistre>> {
    const { data, error } = await db.from('vessels').select('id, imo_number, name, shipowner_id');
    if (error) throw new Error(`lecture vessels: ${error.message}`);
    return new Map((data ?? []).map((v) => [String(v.imo_number), v as NavireRegistre]));
}

interface Refs {
    proPrises: Set<string>;
    refsPrises: Set<string>;
    /** Clés `imo|période` déjà présentes en base, sur lignes non annulées. */
    dejaEmises: Set<string>;
    assignees: Set<string>;
    prochainPro: () => string;
    prochainInv: () => string;
}

/**
 * Les références déjà prises. Les lignes VOID n'en font PAS partie :
 * `idx_txn_invoice_ref` les exclut de son unicité, et les refs 064087→064100
 * qu'elles occupent sont précisément celles que le lot d'août doit reprendre.
 */
async function chargerRefs(db: SupabaseClient): Promise<Refs> {
    const { data, error } = await db
        .from('transactions')
        .select('ref, invoice_ref, status, vessel_imo, breakdown_json')
        .neq('status', 'VOID');
    if (error) throw new Error(`lecture transactions: ${error.message}`);
    const proPrises = new Set((data ?? []).map((t) => t.invoice_ref).filter(Boolean) as string[]);
    const refsPrises = new Set((data ?? []).map((t) => t.ref).filter(Boolean) as string[]);
    const dejaEmises = new Set(
        (data ?? [])
            .map((t) => {
                const b = t.breakdown_json as { period?: string } | null;
                return b?.period ? `${String(t.vessel_imo)}|${b.period}` : null;
            })
            .filter(Boolean) as string[],
    );
    const assignees = new Set<string>();

    const plusHaut = (s: Set<string>, motif: RegExp): number => {
        let max = 0;
        for (const r of s) {
            const m = motif.exec(r);
            if (m) max = Math.max(max, Number(m[1]));
        }
        return max;
    };
    let pro = plusHaut(proPrises, /^PRO-2026-(\d+)$/);
    let inv = plusHaut(refsPrises, /^INV-2026-(\d+)$/);

    return {
        proPrises,
        refsPrises,
        dejaEmises,
        assignees,
        prochainPro: () => {
            let candidat: string;
            do {
                pro += 1;
                candidat = `PRO-2026-${String(pro).padStart(6, '0')}`;
            } while (proPrises.has(candidat) || assignees.has(candidat));
            assignees.add(candidat);
            return candidat;
        },
        prochainInv: () => {
            let candidat: string;
            do {
                inv += 1;
                candidat = `INV-2026-${String(inv).padStart(6, '0')}`;
            } while (refsPrises.has(candidat) || assignees.has(candidat));
            assignees.add(candidat);
            return candidat;
        },
    };
}

/**
 * La clé d'idempotence RÉELLE : un navire, une période.
 *
 * La référence ne suffit pas. Le lot d'août porte les siennes, mais celui de
 * septembre les reçoit à l'exécution : une deuxième passe ne les reconnaîtrait
 * pas, en attribuerait de nouvelles, et facturerait une deuxième fois les
 * mêmes escales. C'est ce couple-là qui dit si la créance existe déjà.
 */
function cle(imo: string, debut: string, fin: string): string {
    return `${imo}|${debut} → ${fin}`;
}

/** Rend le motif qui empêche d'émettre cette ligne, ou `null`. */
function motifDeBlocage(
    l: Ligne,
    v: NavireRegistre | undefined,
    proPrises: Set<string>,
): string | null {
    if (!v) return 'absent du registre `vessels`';
    if (l.proRef && proPrises.has(l.proRef)) {
        return `${l.proRef} déjà utilisée par une ligne non annulée`;
    }
    return null;
}

function trace(l: Ligne, proRef: string, etat: string): void {
    console.log(
        `${l.imo.padEnd(9)} ${l.name.slice(0, 22).padEnd(22)} ${String(l.nCalls).padEnd(4)} ` +
            `${l.usd.toFixed(2).padStart(11)}  ${proRef.padEnd(15)} ${etat}`,
    );
}

function construireTransaction(
    l: Ligne,
    v: NavireRegistre,
    ref: string,
    proRef: string,
    dueDate: Date,
): Record<string, unknown> {
    return {
        vessel_id: v.id,
        vessel_name: l.name,
        vessel_imo: l.imo,
        shipowner_id: v.shipowner_id,
        transaction_type: 'ENTRY_TAX',
        document_type: 'PROFORMA',
        mode: 'MARITIME',
        status: 'PENDING',
        emissions_tco2: l.billedTco2,
        tax_amount_usd: l.usd,
        rate_usd_per_tco2: 40.0,
        ref,
        invoice_ref: proRef,
        due_date: dueDate.toISOString(),
        jurisdiction_id: JURIDICTION_SOMALILAND,
        breakdown_json: {
            period: `${l.periodStart} → ${l.periodEnd}`,
            source: `backlog_${l.lot}_2026`,
            method: 'v11_HYBRID',
            gt: l.gt,
            n_calls: l.nCalls,
            // La pénalité est levée intégralement et rétroactivement depuis le
            // 09/09/2026 : elle ne doit apparaître nulle part.
            penaltyAfterDueUsd: 0,
        },
    };
}

async function main(): Promise<void> {
    const db: SupabaseClient = createClient(SUPABASE_URL as string, SERVICE_ROLE_KEY as string, {
        auth: { persistSession: false },
    });

    const lignes = [
        ...charger(AOUT_FILE, 'aout', '2026-08-04', '2026-08-31'),
        ...charger(SEPT_FILE, 'septembre', '2026-09-01', '2026-09-10'),
    ];
    if (lignes.length === 0) {
        console.error('❌ aucun lot chargé — passer --aout et/ou --septembre (sorties de greengate-calc)');
        process.exit(1);
    }

    console.log(`=== ${EXECUTE ? 'ÉCRITURE' : 'SIMULATION'} · ${PROD ? 'PRODUCTION' : 'staging'} · ${SUPABASE_URL} ===`);
    console.log(`émission ${ISSUE_DATE} · échéance à ${PAY_TERMS} jours\n`);

    const parImo = await chargerRegistre(db);
    const refs = await chargerRefs(db);

    // Les références portées par un lot sont RÉSERVÉES avant toute attribution
    // automatique. Sans cette passe, le lot de septembre repartait du dernier
    // PRO non annulé de la base — c'est-à-dire en plein milieu des références
    // qu'août porte déjà — et produisait des doublons dans le même envoi.
    for (const l of lignes) {
        if (l.proRef) refs.assignees.add(l.proRef);
    }

    const dueDate = new Date(`${ISSUE_DATE}T00:00:00Z`);
    dueDate.setUTCDate(dueDate.getUTCDate() + PAY_TERMS);

    const aInserer: Array<Record<string, unknown>> = [];
    const bloquants: string[] = [];
    let total = 0;
    let dejaLa = 0;

    console.log(`${'IMO'.padEnd(9)} ${'NAVIRE'.padEnd(22)} ${'ESC'.padEnd(4)} ${'USD'.padStart(11)}  REF          ÉTAT`);
    for (const l of lignes) {
        const v = parImo.get(l.imo);
        // Créance déjà enregistrée pour ce navire et cette période : on passe.
        // Ce n'est pas un blocage, c'est le cas normal d'une réexécution.
        if (refs.dejaEmises.has(cle(l.imo, l.periodStart, l.periodEnd))) {
            dejaLa += 1;
            continue;
        }
        const motif = motifDeBlocage(l, v, refs.proPrises);
        if (motif) {
            bloquants.push(`${l.imo} ${l.name} — ${motif}`);
            trace(l, l.proRef ?? '—', motif.startsWith('absent') ? 'NAVIRE ABSENT' : 'REF PRISE');
            continue;
        }
        const proRef = l.proRef ?? refs.prochainPro();
        const ref = refs.prochainInv();
        aInserer.push(construireTransaction(l, v as NavireRegistre, ref, proRef, dueDate));
        total += l.usd;
        trace(l, proRef, ref);
    }

    const horsLot = [...ecartes(AOUT_FILE), ...ecartes(SEPT_FILE)];
    if (horsLot.length) {
        console.log('\n--- écartés par le calcul Go, jamais facturés ---');
        for (const e of horsLot) console.log(`  ${e.imo.padEnd(9)} ${e.name.padEnd(22)} ${e.raison}`);
    }

    if (dejaLa > 0) {
        console.log(`\n${dejaLa} ligne(s) déjà en base pour ce navire et cette période — ignorée(s).`);
    }
    console.log(`\n${aInserer.length} pro-forma(s) prête(s) · TOTAL ${total.toFixed(2)} USD`);
    if (bloquants.length) {
        console.log(`\n⚠ ${bloquants.length} ligne(s) bloquée(s) :`);
        for (const b of bloquants) console.log(`   ${b}`);
    }

    if (!EXECUTE) {
        console.log('\nSimulation — rien n\'a été écrit. Ajouter --execute pour enregistrer.');
        return;
    }
    if (bloquants.length && !ALLOW_PARTIAL) {
        // Un lot partiel produit un total qui ne correspond à aucun document
        // déjà généré : c'est ainsi qu'un écart entre le courrier et la pièce
        // jointe s'installe. On refuse donc par défaut, et la levée doit être
        // EXPLICITE — jamais un effet de bord de `--execute`.
        console.error('\n❌ Des lignes sont bloquées : rien n\'est écrit. Résoudre d\'abord,');
        console.error('   ou assumer un lot partiel avec --allow-partial.');
        process.exit(1);
    }
    if (bloquants.length) {
        console.log(`\n⚠ LOT PARTIEL ASSUMÉ : ${bloquants.length} ligne(s) laissée(s) de côté, à traiter séparément.`);
    }

    const { error: insErr } = await db.from('transactions').insert(aInserer);
    if (insErr) {
        console.error(`\n❌ insertion refusée : ${insErr.message}`);
        process.exit(1);
    }
    console.log(`\n✅ ${aInserer.length} pro-forma(s) enregistrée(s), statut PENDING, aucune notification envoyée.`);
}

main().catch((err: unknown) => {
    console.error('❌', err instanceof Error ? err.message : String(err));
    process.exit(1);
});
