import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth/requireOwner';
import { createTenantClient } from '@/lib/supabase/tenant';
import {
    generateWireInstructionsPdf,
    getWireBeneficiary,
} from '@/services/wireInstructionsPdf';
import { wireReference } from '@/lib/payments/wireBeneficiary';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('wire-instructions');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/owner/wire-instructions?transactionId=<uuid>
 * GET /api/owner/wire-instructions?amountUsd=<n>        (recharge de portefeuille)
 *
 * Rend l'ordre de virement à remettre à sa banque : coordonnées du compte de
 * collecte, référence à porter, montant. Réservé à l'armateur connecté, et la
 * facture doit être la sienne.
 *
 * Le montant vient de la BASE quand une facture est visée — jamais du
 * paramètre. Un document nominatif portant un montant choisi par l'appelant
 * serait un faux ordre de virement fabriqué avec notre en-tête.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
    const ctx = await requireOwner();
    const url = new URL(req.url);
    const transactionId = url.searchParams.get('transactionId');

    const admin = createTenantClient(ctx.jurisdictionId);

    let amountUsd: number;
    let invoiceRef: string | null = null;

    if (transactionId) {
        const { data: tx, error } = await admin
            .from('transactions')
            .select('id, shipowner_id, invoice_ref, tax_amount_usd')
            .eq('id', transactionId)
            .maybeSingle();
        if (error) throw error;
        if (!tx || tx.shipowner_id !== ctx.shipowner.id) {
            // Inconnue et « pas la vôtre » répondent pareil.
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        amountUsd = Number(tx.tax_amount_usd);
        invoiceRef = (tx.invoice_ref as string | null) ?? null;
    } else {
        // Recharge : il n'existe aucune ligne en base à ce stade, le montant
        // saisi par l'armateur est la seule source possible. Il n'engage que
        // lui — aucune créance n'est constituée par ce document.
        const raw = Number(url.searchParams.get('amountUsd') ?? '0');
        if (!Number.isFinite(raw) || raw <= 0) {
            return NextResponse.json({ error: 'amountUsd required' }, { status: 400 });
        }
        amountUsd = raw;
    }

    const beneficiary = await getWireBeneficiary(admin, ctx.jurisdictionId);
    const pdf = await generateWireInstructionsPdf({
        beneficiary,
        reference: wireReference(invoiceRef, ctx.shipowner.id),
        amountUsd,
        payerName: ctx.shipowner.name ?? '—',
        invoiceRef,
        issuedAt: new Date(),
    });

    log.info('wire_instructions_issued', {
        shipownerId: ctx.shipowner.id,
        transactionId: transactionId ?? null,
        amountUsd,
    });

    const filename = `wire-instructions-${wireReference(invoiceRef, ctx.shipowner.id)}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
        status: 200,
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`,
            // Document nominatif : jamais mis en cache par un intermédiaire.
            'Cache-Control': 'private, no-store',
        },
    });
}
