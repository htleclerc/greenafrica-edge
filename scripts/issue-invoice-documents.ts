// scripts/issue-invoice-documents.ts
// Émet (rend + upload + signe) le PDF fiscal des transactions qui n'en ont pas.
//
// Une transaction insérée directement en base (seed, import onboarding, backfill)
// porte bien son document_type PROFORMA/FINAL, mais ni invoice_ref, ni content_hash,
// ni invoice_pdf_url — ces trois colonnes ne sont écrites que par le pipeline
// d'émission. Résultat côté portail armateur : la ligne existe, le document non.
// Ce script rejoue ce pipeline (le même que POST /api/invoices/generate) pour
// rattraper les lignes orphelines.
//
// Usage :
//   npx tsx --tsconfig frontend/tsconfig.json scripts/issue-invoice-documents.ts                  → dry-run (aucun write)
//   npx tsx --tsconfig frontend/tsconfig.json scripts/issue-invoice-documents.ts --execute        → émet les documents
//   npx tsx --tsconfig frontend/tsconfig.json scripts/issue-invoice-documents.ts --execute --id <uuid>       → une seule transaction
//   npx tsx --tsconfig frontend/tsconfig.json scripts/issue-invoice-documents.ts --execute --actor <email>   → auteur de l'audit
//   npx tsx --tsconfig frontend/tsconfig.json scripts/issue-invoice-documents.ts --execute --origin https://greengate.africa
//
// Mode RE-RENDU (--rerender) : reprend au contraire les transactions qui ONT
// deja un PDF, pour les regenerer au gabarit courant. Sert apres un changement
// de mise en page ou de coordonnees emetteur.
//
//   npx tsx --tsconfig frontend/tsconfig.json scripts/issue-invoice-documents.ts --rerender                 → dry-run
//   npx tsx --tsconfig frontend/tsconfig.json scripts/issue-invoice-documents.ts --rerender --execute --limit 20
//
// Le re-rendu est SANS RISQUE pour la chaine de verification : content_hash et
// verify_signature sont en ecriture unique et portent sur les CHAMPS fiscaux
// (reference, IMO, navire, armateur, total, dates, mode), jamais sur les octets
// du PDF. Les QR deja distribues continuent donc de verifier a l'identique.
// L'objet de stockage, lui, est ecrase : l'ancien PDF disparait.
//
// L'origine des QR vient de --origin, sinon de NEXT_PUBLIC_APP_URL. Une origine
// localhost est REFUSEE en execution (--allow-localhost-origin pour forcer) :
// elle produirait des QR inexploitables sans que le PDF le signale.
//
// N'envoie JAMAIS d'e-mail : le backfill rattrape des documents manquants, il ne
// relance pas les armateurs. La relance reste l'action « Print & Send » du staff.
//
// NOTE tsx : depuis que le generateur importe le profil emetteur et le module
// de mise en page par l'alias `@/`, il faut lui passer le tsconfig du frontend :
//   npx tsx --tsconfig frontend/tsconfig.json scripts/issue-invoice-documents.ts ...
// Sans lui, la resolution echoue sur « Cannot find module '@/services/...' ».
//
// Lit les credentials dans frontend/.env.local (NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, INVOICE_SIGNING_SECRET, NEXT_PUBLIC_APP_URL).

import { createClient } from '@supabase/supabase-js';
import { issueInvoiceDocument } from '../frontend/src/services/invoiceIssuanceService';

process.loadEnvFile(new URL('../frontend/.env.local', import.meta.url));

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
};

const RERENDER = args.includes('--rerender');
const LIMIT = Number(flag('limit') ?? '0') || 0;
const ALLOW_LOCAL_ORIGIN = args.includes('--allow-localhost-origin');
const ONLY_ID = flag('id');
const ACTOR_EMAIL = flag('actor');
const ORIGIN = flag('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3300';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('❌ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants dans frontend/.env.local');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

/** Roles allowed to issue a fiscal document, most authoritative first. */
const STAFF_ROLES = ['SUPERADMIN', 'FINANCE_ADMIN', 'PORT_OFFICER'];

interface PendingTxn {
    id: string;
    invoice_ref: string | null;
    invoice_pdf_url: string | null;
    document_type: string | null;
    vessel_name: string;
    status: string;
    tax_amount_usd: number;
    jurisdiction_id: string;
}

async function resolveActor(): Promise<{ id: string; fullName: string }> {
    const query = supabase.from('profiles').select('id, full_name, email, role');
    const { data, error } = ACTOR_EMAIL
        ? await query.eq('email', ACTOR_EMAIL).limit(1)
        : await query.in('role', STAFF_ROLES).limit(50);
    if (error) throw new Error(`profiles lookup failed: ${error.message}`);
    if (!data?.length) {
        throw new Error(
            ACTOR_EMAIL
                ? `Aucun profil pour ${ACTOR_EMAIL}`
                : `Aucun profil staff (${STAFF_ROLES.join(', ')}) — passez --actor <email>`,
        );
    }
    // Prefer the most authoritative role when no explicit actor was requested.
    const rows = data as { id: string; full_name: string | null; email: string | null; role: string }[];
    const chosen = ACTOR_EMAIL
        ? rows[0]
        : [...rows].sort((a, b) => STAFF_ROLES.indexOf(a.role) - STAFF_ROLES.indexOf(b.role))[0];
    return { id: chosen.id, fullName: chosen.full_name || chosen.email || 'Backfill script' };
}

async function findPending(): Promise<PendingTxn[]> {
    let query = supabase
        .from('transactions')
        .select('id, invoice_ref, invoice_pdf_url, document_type, vessel_name, status, tax_amount_usd, jurisdiction_id')
        .order('created_at', { ascending: true });

    if (RERENDER) {
        // Ces lignes ont deja un document : on le regenere au gabarit courant.
        query = query.not('invoice_pdf_url', 'is', null);
    } else {
        // A row is "document-less" as soon as the storage path is missing — even
        // when a ref/hash pair was written, because the download route resolves
        // the object from invoice_pdf_url and 404s without it.
        query = query.is('invoice_pdf_url', null);
    }
    if (ONLY_ID) query = query.eq('id', ONLY_ID);
    // Un re-rendu de masse s'echelonne : --limit borne le lot.
    if (LIMIT > 0) query = query.limit(LIMIT);

    const { data, error } = await query;
    if (error) throw new Error(`transactions lookup failed: ${error.message}`);
    return (data ?? []) as PendingTxn[];
}

async function main() {
    const pending = await findPending();

    console.log(
        RERENDER
            ? `\n♻️  Transactions à re-rendre au gabarit courant : ${pending.length}`
            : `\n📄 Transactions sans document émis : ${pending.length}`,
    );
    for (const t of pending) {
        console.log(
            `   • ${t.id}  ${(t.document_type ?? '—').padEnd(10)} ${t.status.padEnd(8)} ` +
            `$${Number(t.tax_amount_usd).toLocaleString()}  ${t.vessel_name}` +
            (t.invoice_ref ? `  (ref existante ${t.invoice_ref})` : ''),
        );
    }

    if (!pending.length) {
        console.log('\n✅ Rien à faire.');
        return;
    }

    if (!EXECUTE) {
        console.log('\n🔍 Dry-run — relancez avec --execute pour émettre les documents.');
        return;
    }

    // L'origine part de NEXT_PUBLIC_APP_URL, qui vaut localhost dans
    // frontend/.env.local. Elle est encodee dans le QR /verify de chaque page 1
    // — un document emis avec une origine locale porte un QR inexploitable, et
    // rien dans le PDF ne le signale. Sur un lot de plusieurs centaines, la
    // reprise coute un second passage complet.
    if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(ORIGIN) && !ALLOW_LOCAL_ORIGIN) {
        console.error(
            `
❌ Origine locale (${ORIGIN}) : les QR /verify seraient inexploitables.
`
            + `   Passez --origin https://greengate.africa, ou --allow-localhost-origin`
            + ` si c'est bien un test local.
`,
        );
        process.exitCode = 1;
        return;
    }

    const actor = await resolveActor();
    console.log(`\n👤 Auteur de l'audit : ${actor.fullName} (${actor.id})`);
    console.log(`🔗 Origin des QR /verify : ${ORIGIN}\n`);

    let issued = 0;
    let failed = 0;
    for (const t of pending) {
        const result = await issueInvoiceDocument({
            admin: supabase,
            transactionId: t.id,
            jurisdictionId: t.jurisdiction_id,
            actor,
            origin: ORIGIN,
            sendEmail: false,
        });
        if (result.ok) {
            issued++;
            console.log(`   ✅ ${t.vessel_name} → ${result.invoiceRef} (${result.storagePath})`);
        } else {
            failed++;
            console.error(`   ❌ ${t.vessel_name} (${t.id}) → ${result.status} ${result.error}`);
        }
    }

    console.log(
        `\n✅ ${issued} document(s) ${RERENDER ? 're-rendus' : 'émis'}`
        + `${failed ? `, ❌ ${failed} en échec` : ''}.`,
    );
    if (failed) process.exitCode = 1;
}

main().catch((e) => {
    console.error('❌ Fatal:', e?.message ?? e);
    process.exit(1);
});
