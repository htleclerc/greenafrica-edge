import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth/requireOwner';
import { getOwnerKycProfile } from '@/services/ownerKycService';
import { listPaymentsForShipowner } from '@/services/paymentService';
import { confirmedPaidUsdByTransaction } from '@/services/confirmedPayments';
import { outstandingUsd } from '@/lib/outstanding';

interface ExportVessel {
    imo_number: string;
    name: string;
    category: string;
    flag_code: string | null;
}

interface ExportInvoice {
    invoice_ref: string | null;
    document_type: string;
    mode: string;
    created_at: string;
    tax_amount_usd: number;
    status: string;
    /**
     * Colonne telle qu'elle est stockee. Elle vaut zero sur toute facture en
     * cours (gelee par la mig 089, jamais ecrite) : sans `outstanding_usd` a
     * cote, l'export laissait croire qu'aucun reglement n'avait ete recu, la
     * liste des paiements ci-dessous disant l'inverse.
     */
    partial_paid_usd: number;
    /** Reste du reel : montant taxe moins les paiements CONFIRMED. */
    outstanding_usd: number;
}

interface ExportPayment {
    amount_minor: number;
    currency: string;
    amount_usd_minor: number;
    rail: string;
    status: string;
    external_reference: string | null;
    created_at: string;
}

interface ExportReminder {
    tier: string;
    sent_at: string;
    debtor_response_at: string | null;
    debtor_response_type: string;
    escalated_bailiff: boolean;
}

/**
 * RGPD Art. 20 (portabilité) — export self-service des données du shipowner
 * appelant, au format JSON téléchargeable.
 *
 * Isolation : requireOwner() fournit un client RLS-scopé (session utilisateur,
 * pas service-role) + on filtre explicitement chaque requête sur
 * `shipowner.id` — la RLS et le filtre applicatif garantissent tous les deux
 * qu'aucune donnée d'un AUTRE armateur ne peut apparaître dans l'export.
 * L'IBAN n'est JAMAIS exposé en clair : getOwnerKycProfile() ne renvoie que
 * `iban_masked` (déchiffrement + masquage côté serveur, jamais la valeur brute).
 */
export async function GET() {
    const session = await requireOwner();
    const { supabase, shipowner } = session;

    const profile = await getOwnerKycProfile(supabase, shipowner.id);
    if (!profile) {
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const [vesselsRes, transactionsRes, payments] = await Promise.all([
        supabase
            .from('vessels')
            .select('imo_number, name, category, flag_code')
            .eq('shipowner_id', shipowner.id),
        supabase
            .from('transactions')
            .select('id, invoice_ref, document_type, mode, created_at, tax_amount_usd, status, partial_paid_usd')
            .eq('shipowner_id', shipowner.id)
            .order('created_at', { ascending: false }),
        listPaymentsForShipowner(supabase, shipowner.id),
    ]);

    const transactionRows = (transactionsRes.data ?? []) as Record<string, unknown>[];
    const transactionIds = transactionRows.map((t) => t.id as string);

    // collection_reminders n'a pas de shipowner_id direct — scoping via les
    // transaction_id du seul shipowner appelant (mêmes id que ci-dessus).
    const remindersData = transactionIds.length
        ? (
              await supabase
                  .from('collection_reminders')
                  .select('tier, sent_at, debtor_response_at, debtor_response_type, escalated_bailiff')
                  .in('transaction_id', transactionIds)
                  .order('sent_at', { ascending: true })
          ).data
        : [];

    const vessels: ExportVessel[] = ((vesselsRes.data ?? []) as Record<string, unknown>[]).map((v) => ({
        imo_number: v.imo_number as string,
        name: v.name as string,
        category: v.category as string,
        flag_code: (v.flag_code as string | null) ?? null,
    }));

    const paidByTxn = await confirmedPaidUsdByTransaction(supabase, transactionIds);

    const invoices: ExportInvoice[] = transactionRows.map((t) => ({
        invoice_ref: (t.invoice_ref as string | null) ?? null,
        document_type: t.document_type as string,
        mode: t.mode as string,
        created_at: t.created_at as string,
        tax_amount_usd: Number(t.tax_amount_usd),
        status: t.status as string,
        partial_paid_usd: Number(t.partial_paid_usd ?? 0),
        outstanding_usd: outstandingUsd(t as never, paidByTxn.get(t.id as string) ?? 0),
    }));

    const paymentsOut: ExportPayment[] = payments.map((p) => ({
        amount_minor: p.amount_minor,
        currency: p.currency,
        amount_usd_minor: p.amount_usd_minor,
        rail: p.rail,
        status: p.status,
        external_reference: p.external_reference,
        created_at: p.created_at,
    }));

    const reminders: ExportReminder[] = ((remindersData ?? []) as Record<string, unknown>[]).map((r) => ({
        tier: r.tier as string,
        sent_at: r.sent_at as string,
        debtor_response_at: (r.debtor_response_at as string | null) ?? null,
        debtor_response_type: r.debtor_response_type as string,
        escalated_bailiff: !!r.escalated_bailiff,
    }));

    const exportPayload = {
        generated_at: new Date().toISOString(),
        shipowner: profile,
        vessels,
        invoices,
        payments: paymentsOut,
        reminders,
    };

    return new NextResponse(JSON.stringify(exportPayload, null, 2), {
        status: 200,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="greengate-export-${shipowner.id}.json"`,
            'Cache-Control': 'no-store',
        },
    });
}
