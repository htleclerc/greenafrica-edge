import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
    createPaymentRequest,
    type PaymentProvider,
    type PaymentRequest,
} from '@/services/paymentService';

/**
 * POST /api/payments/create
 *
 * Creates a payment session via the admin-configured active provider
 * (or a specific override). Returns either a checkout URL (online providers)
 * or wire transfer instructions (manual providers).
 *
 * Body: {
 *   transactionId: string,
 *   overrideProvider?: 'stripe'|'paystack'|'flutterwave'|'wave'|'wire_transfer'
 * }
 *
 * Returns: {
 *   success: boolean,
 *   paymentId: string,
 *   provider: string,
 *   status: string,
 *   checkoutUrl?: string,        // for online providers — redirect here
 *   wireInstructions?: {...},    // for wire_transfer — show in modal
 * }
 */
export async function POST(request: NextRequest) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    let body: { transactionId: string; overrideProvider?: PaymentProvider };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body.transactionId) {
        return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }

    const admin = createClient(supabaseUrl, supabaseKey);

    // 1. Fetch the transaction with vessel + owner context
    const { data: tx, error: txErr } = await admin
        .from('transactions')
        .select(`
            id,
            vessel_id,
            vessel_name,
            vessel_imo,
            tax_amount_usd,
            transaction_type,
            port_call,
            created_at,
            status
        `)
        .eq('id', body.transactionId)
        .single();

    if (txErr || !tx) {
        return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    // Already paid? short-circuit
    if (tx.status === 'PAID') {
        return NextResponse.json(
            { error: 'Transaction is already PAID', alreadyPaid: true },
            { status: 409 },
        );
    }

    // 2. Look up the vessel owner email (best-effort, optional)
    let customerEmail: string | undefined;
    let ownerEntity = 'Unknown shipping agent';
    if (tx.vessel_id) {
        const { data: vessel } = await admin
            .from('vessels')
            .select('owner_id')
            .eq('id', tx.vessel_id)
            .single();

        if (vessel?.owner_id) {
            const { data: profile } = await admin
                .from('profiles')
                .select('email, full_name')
                .eq('id', vessel.owner_id)
                .single();
            if (profile) {
                customerEmail = profile.email;
                ownerEntity = profile.full_name || ownerEntity;
            }
        }
    }

    // 3. Build the canonical invoice ref (matches ProFormaModal logic)
    const createdAt = new Date(tx.created_at);
    const invoiceRef = `INV-${createdAt.getFullYear()}-${tx.id.split('-')[1].toUpperCase()}`;

    // 4. Build the PaymentRequest
    const paymentRequest: PaymentRequest = {
        transactionId: tx.id,
        amount: Number(tx.tax_amount_usd),
        currency: 'USD',
        invoiceRef,
        description: `Carbon Tax — ${tx.vessel_name} (${tx.transaction_type})`,
        metadata: {
            vesselImo: tx.vessel_imo,
            vesselName: tx.vessel_name,
            ownerEntity,
            jurisdiction: 'Republic of Somaliland',
            taxPeriod: createdAt.toISOString().slice(0, 7),
        },
        customerEmail,
    };

    // 5. Create the payment via paymentService (uses active provider from DB)
    try {
        let result = await createPaymentRequest(admin, paymentRequest, body.overrideProvider);
        let fellBackToWire = false;
        let originalProvider: string | null = null;

        // ── Fallback to wire on degenerate result ──────────────────────────
        // paymentService.createPaymentRequest renvoie `{ status: 'failed' }`
        // (sans checkoutUrl ni wireInstructions) quand la clé API du provider
        // actif manque ou que l'API tierce répond non-OK. Sans fallback ici,
        // le frontend reçoit un payload inutilisable et throw
        // "No checkout URL or wire instructions returned" — payment cassé.
        // On retry explicitement en wire_transfer (toujours dispo, pas d'API
        // externe) et on signale `fallback: true` pour que le frontend puisse
        // afficher un message d'info. L'admin voit la cause dans les logs.
        const isUnusable =
            result.status === 'failed' ||
            (!result.checkoutUrl && !result.wireInstructions);

        if (isUnusable && result.provider !== 'wire_transfer') {
            console.warn(
                `[Payment Create] Provider ${result.provider} returned unusable result (status=${result.status}). Falling back to wire_transfer.`,
            );
            originalProvider = result.provider;
            result = await createPaymentRequest(admin, paymentRequest, 'wire_transfer');
            fellBackToWire = true;
        }

        // 6. Audit log
        await admin.from('audit_logs').insert({
            user_id: '00000000-0000-0000-0000-000000000000',
            user_full_name: 'Payment System',
            action: 'TRANSACTION_UPDATED',
            severity: fellBackToWire ? 'WARNING' : 'INFO',
            entity_type: 'Transaction',
            entity_id: tx.id,
            details_json: {
                event: 'PAYMENT_CHECKOUT_CREATED',
                provider: result.provider,
                paymentId: result.paymentId,
                amount: paymentRequest.amount,
                invoiceRef,
                ...(fellBackToWire && { fellBackToWire: true, originalProvider }),
            },
        });

        return NextResponse.json({
            success: true,
            ...result,
            ...(fellBackToWire && { fallback: true, originalProvider }),
        });
    } catch (err) {
        console.error('[Payment Create] Failed:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Payment creation failed' },
            { status: 500 },
        );
    }
}
