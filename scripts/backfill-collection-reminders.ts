// scripts/backfill-collection-reminders.ts
// Rattrape le registre collection_reminders au moment de la bascule vers le
// moteur de relance B1 (cf route.ts).
//
// Une pro-forma PENDING/OVERDUE créée avant la bascule n'a jamais eu de ligne
// collection_reminders : le premier passage du cron la trouverait « en retard »
// sur tous ses paliers échus (J3→J45 d'un coup) et enverrait une rafale de
// relances — y compris la notice pré-huissier J45 — pour une créance dont le
// débiteur n'a en réalité reçu aucun rappel antérieur.
//
// Ce script insère, pour chaque palier déjà échu à la date du run, une ligne
// de registre « backfill » SANS envoyer d'e-mail ni de notification in-app :
// il rattrape la trace, pas la relance elle-même. Le cron ne reprendra donc
// qu'au prochain palier réellement dû, avec un historique cohérent.
//
// Usage :
//   npx tsx scripts/backfill-collection-reminders.ts             → dry-run (aucun write)
//   npx tsx scripts/backfill-collection-reminders.ts --execute   → insère les lignes de rattrapage
//
// Idempotent : l'index unique (transaction_id, tier) (mig 094) est le
// garde-fou dur ; un pré-check applicatif évite en plus l'aller-retour DB en
// conflit systématique lors d'un deuxième run.
//
// Lit les credentials dans frontend/.env.local (NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY) — même convention que issue-invoice-documents.ts.

import { createClient } from '@supabase/supabase-js';

process.loadEnvFile(new URL('../frontend/.env.local', import.meta.url));

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('❌ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants dans frontend/.env.local');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

// Paliers auto + seuils en jours — copie volontaire de TIER_THRESHOLDS
// (frontend/src/services/collectionReminderService.ts) : ce script tourne via
// `npx tsx` depuis la racine du repo, où l'alias `@/*` du tsconfig frontend ne
// s'applique pas (même contrainte que invoiceIssuanceService.ts). Garder les
// deux listes identiques en cas d'évolution du moteur.
const TIER_THRESHOLDS: ReadonlyArray<{ tier: string; minAge: number }> = [
    { tier: 'J3', minAge: 3 },
    { tier: 'J7', minAge: 7 },
    { tier: 'J15', minAge: 15 },
    { tier: 'J30', minAge: 30 },
    { tier: 'J45', minAge: 45 },
];

interface PendingTxn {
    id: string;
    invoice_ref: string | null;
    vessel_name: string;
    status: string;
    created_at: string;
    shipowner_id: string | null;
}

function ageInDays(createdAtIso: string, now: Date): number {
    return Math.floor((now.getTime() - new Date(createdAtIso).getTime()) / 86_400_000);
}

async function findPending(): Promise<PendingTxn[]> {
    const { data, error } = await supabase
        .from('transactions')
        .select('id, invoice_ref, vessel_name, status, created_at, shipowner_id')
        .eq('document_type', 'PROFORMA')
        .in('status', ['PENDING', 'OVERDUE'])
        .not('shipowner_id', 'is', null)
        .order('created_at', { ascending: true });
    if (error) throw new Error(`transactions lookup failed: ${error.message}`);
    return (data ?? []) as PendingTxn[];
}

async function existingTiers(transactionId: string): Promise<Set<string>> {
    const { data, error } = await supabase
        .from('collection_reminders')
        .select('tier')
        .eq('transaction_id', transactionId);
    if (error) throw new Error(`collection_reminders lookup failed for ${transactionId}: ${error.message}`);
    return new Set((data ?? []).map((r) => (r as { tier: string }).tier));
}

interface BackfillRow {
    transaction_id: string;
    tier: string;
    sent_at: string;
    sent_email: string;
    cc_emails: string[];
    template_used: string;
    debtor_response_type: string;
}

async function main() {
    const now = new Date();
    const pending = await findPending();

    console.log(`\n📋 Pro-formas PENDING/OVERDUE candidates au rattrapage : ${pending.length}`);

    const toInsert: BackfillRow[] = [];
    for (const t of pending) {
        const age = ageInDays(t.created_at, now);
        const dueTiers = TIER_THRESHOLDS.filter((th) => th.minAge <= age).map((th) => th.tier);
        if (!dueTiers.length) continue;

        const already = await existingTiers(t.id);
        const missing = dueTiers.filter((tier) => !already.has(tier));
        if (!missing.length) continue;

        for (const tier of missing) {
            toInsert.push({
                transaction_id: t.id,
                tier,
                sent_at: t.created_at,
                sent_email: '(backfill)',
                cc_emails: [],
                template_used: 'backfill',
                debtor_response_type: 'SILENT',
            });
        }
        console.log(
            `   • ${t.id}  ${t.status.padEnd(8)} ${String(age).padStart(3)}j  ${t.vessel_name}` +
            (t.invoice_ref ? `  (${t.invoice_ref})` : '') +
            `  → paliers manquants : ${missing.join(', ')}`,
        );
    }

    if (!toInsert.length) {
        console.log('\n✅ Rien à rattraper — le registre est déjà cohérent avec les paliers échus.');
        return;
    }

    console.log(`\n🧾 ${toInsert.length} ligne(s) de registre à insérer (aucun e-mail, aucune notif).`);

    if (!EXECUTE) {
        console.log('\n🔍 Dry-run — relancez avec --execute pour écrire ces lignes.');
        return;
    }

    let inserted = 0;
    let failed = 0;
    for (const row of toInsert) {
        const { error } = await supabase.from('collection_reminders').insert(row);
        if (error) {
            // Conflit (transaction_id, tier) = déjà rattrapé entre-temps, bénin.
            if (error.code === '23505') {
                console.log(`   ⚠️  ${row.transaction_id} ${row.tier} déjà présent — ignoré.`);
                continue;
            }
            failed++;
            console.error(`   ❌ ${row.transaction_id} ${row.tier} → ${error.message}`);
            continue;
        }
        inserted++;
    }

    console.log(`\n✅ ${inserted} ligne(s) de rattrapage insérée(s)${failed ? `, ❌ ${failed} en échec` : ''}.`);
    if (failed) process.exitCode = 1;
}

main().catch((e) => {
    console.error('❌ Fatal:', e?.message ?? e);
    process.exit(1);
});
