// scripts/migrate-document-storage.ts
// Déplace les objets du bucket `documents` vers la nomenclature par juridiction :
//   invoices/proforma-<REF>.pdf → <code>/proformas/<YYYY>/<MM>/<REF>.pdf
//
// Copie → vérifie → supprime : tant que la lecture de la destination n'a pas
// réussi, la source reste en place et l'opération est réversible. invoice_pdf_url
// est réécrit ensuite (colonne libre, mig 089) ; invoice_ref n'est jamais touché,
// il est gelé et les PDF distribués le portent dans leur QR.
//
// Usage :
//   npx tsx scripts/migrate-document-storage.ts             → dry-run
//   npx tsx scripts/migrate-document-storage.ts --execute   → déplace

import { createClient } from '@supabase/supabase-js';
import { buildStoragePath } from '../frontend/src/services/invoiceIssuanceService';
import { fetchJurisdictionMeta } from '../frontend/src/lib/jurisdictionName';

process.loadEnvFile(new URL('../frontend/.env.local', import.meta.url));

const EXECUTE = process.argv.includes('--execute');
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('❌ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

interface Row {
    id: string;
    invoice_ref: string | null;
    invoice_pdf_url: string | null;
    status: string;
    created_at: string;
    jurisdiction_id: string | null;
}

async function main() {
    const { data, error } = await supabase
        .from('transactions')
        .select('id, invoice_ref, invoice_pdf_url, status, created_at, jurisdiction_id')
        .not('invoice_pdf_url', 'is', null);
    if (error) throw new Error(`transactions lookup failed: ${error.message}`);

    const rows = (data ?? []) as Row[];
    let moved = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
        const from = row.invoice_pdf_url!;
        // Les anciennes lignes stockaient une URL publique complète, pas un chemin.
        if (from.startsWith('http')) {
            console.log(`   ⏭️  ${row.id} — URL publique héritée, ignorée : ${from}`);
            skipped++;
            continue;
        }
        if (!row.invoice_ref) {
            console.log(`   ⏭️  ${row.id} — sans invoice_ref, relève du script d'émission`);
            skipped++;
            continue;
        }

        const jurisdiction = await fetchJurisdictionMeta(supabase, row.jurisdiction_id);
        const mode = row.invoice_ref.startsWith('INV') ? 'invoice' : 'proforma';
        const to = buildStoragePath({
            jurisdictionCode: jurisdiction.code,
            mode,
            createdAt: new Date(row.created_at),
            invoiceRef: row.invoice_ref,
        });

        if (from === to) { skipped++; continue; }
        console.log(`   ${EXECUTE ? '📦' : '🔍'} ${from}\n      → ${to}`);
        if (!EXECUTE) { moved++; continue; }

        const { error: copyErr } = await supabase.storage.from('documents').copy(from, to);
        if (copyErr) {
            console.error(`   ❌ copie échouée : ${copyErr.message}`);
            failed++;
            continue;
        }
        // Vérifier que la destination est lisible AVANT de supprimer la source.
        const { error: readErr } = await supabase.storage.from('documents').createSignedUrl(to, 60);
        if (readErr) {
            console.error(`   ❌ destination illisible, source conservée : ${readErr.message}`);
            failed++;
            continue;
        }
        const { error: updErr } = await supabase
            .from('transactions').update({ invoice_pdf_url: to }).eq('id', row.id);
        if (updErr) {
            console.error(`   ❌ mise à jour échouée, source conservée : ${updErr.message}`);
            failed++;
            continue;
        }
        await supabase.storage.from('documents').remove([from]);
        moved++;
    }

    console.log(`\n${EXECUTE ? '✅' : '🔍'} ${moved} objet(s) ${EXECUTE ? 'déplacés' : 'à déplacer'}, ${skipped} ignoré(s)${failed ? `, ❌ ${failed} en échec` : ''}.`);
    if (!EXECUTE) console.log('   Relancez avec --execute pour agir.');
    if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error('❌ Fatal:', e?.message ?? e); process.exit(1); });
