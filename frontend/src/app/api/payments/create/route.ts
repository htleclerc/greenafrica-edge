import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient, createTenantClient } from '@/lib/supabase/tenant';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import {
    createPaymentRequest,
    type PaymentProvider,
    type PaymentRequest,
} from '@/services/paymentService';
import { fetchJurisdictionName } from '@/lib/jurisdictionName';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('payments-create');

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
    // Money-rail action: authenticate + authorize BEFORE touching any data or
    // the payment provider. Without this gate, any unauthenticated caller could
    // enumerate transaction IDs and mint checkout sessions (the response echoes
    // the provider + checkout URL). This route backs the LEGACY /dashboard "Pay
    // Now" flow, whose only caller (InvoicesPage) exposes the button to the
    // debtor SHIPPING_AGENT; FINANCE_ADMIN/SUPERADMIN may also create a session
    // on a customer's behalf (mirrors the sibling /api/transactions/mark-paid
    // gate). The v7 owner portal pays via the `initiatePayment` server action,
    // not this route, so requireOwner (which redirects rather than returning
    // JSON, and keys off the v7 `shipowners` table) is the wrong tool here.
    // NB: this is authN/authZ. The jurisdiction scoping below is data isolation;
    // per-transaction ownership is intentionally not enforced — the legacy flow
    // never did, and a session only yields a checkout link for that invoice.
    const auth = await requireRole([
        UserRole.SHIPPING_AGENT,
        UserRole.SUPERADMIN,
        UserRole.FINANCE_ADMIN,
    ]);
    if (auth.error) return auth.error;

    let body: { transactionId: string; overrideProvider?: PaymentProvider };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body.transactionId) {
        return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }

    // Find the transaction regardless of tenant, then scope all reads/writes to ITS
    // jurisdiction — the payments row created below is auto-stamped jurisdiction_id.
    let platform: SupabaseClient;
    try {
        platform = createPlatformClient();
    } catch {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    // 1. Fetch the transaction with vessel + owner context
    const { data: tx, error: txErr } = await platform
        .from('transactions')
        .select(`
            id,
            jurisdiction_id,
            shipowner_id,
            invoice_ref,
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

    const admin = createTenantClient((tx as { jurisdiction_id: string }).jurisdiction_id);

    // Already paid? short-circuit
    if (tx.status === 'PAID') {
        return NextResponse.json(
            { error: 'Transaction is already PAID', alreadyPaid: true },
            { status: 409 },
        );
    }

    // I3 — NULL shipowner blocks at initiation: never take money we can't record.
    // A transaction without a shipowner has no owner to credit; the webhook would
    // receive a confirmed payment with nowhere to attach it.
    if (!tx.shipowner_id) {
        log.error('payments_create_no_shipowner', { transactionId: tx.id });
        return NextResponse.json(
            { error: 'transaction has no shipowner; online checkout unavailable' },
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

    // 3. Resolve (or mint + persist) the canonical invoice ref.
    // The provider echoes this ref back; the webhook matches transactions.invoice_ref
    // EXACTLY — never mint a divergent ref.
    // Format mirrors invoices/generate: INV-{year}-{first-uuid-segment-8hex}{4hex-entropy}
    // If invoice_ref is already set on the transaction (e.g. from invoice generation),
    // reuse it verbatim. If NULL, mint a fresh one using the same format and persist it
    // on the transaction row so the webhook can match it later.
    const createdAt = new Date(tx.created_at);
    let invoiceRef = (tx as { invoice_ref?: string | null }).invoice_ref ?? null;
    if (!invoiceRef) {
        const uuidSeg = tx.id.split('-')[0].toLowerCase();
        const entropy = Math.floor(Math.random() * 0xFFFF).toString(16).padStart(4, '0');
        invoiceRef = `INV-${createdAt.getFullYear()}-${uuidSeg}${entropy}`;
        // Race guard: only write if still NULL (another concurrent checkout may have
        // won the race and already persisted its own ref — the conditional UPDATE is a
        // no-op in that case, and we then adopt the winner's ref below).
        const { error: refPersistErr } = await platform
            .from('transactions')
            .update({ invoice_ref: invoiceRef })
            .eq('id', tx.id)
            .is('invoice_ref', null);
        if (refPersistErr) {
            log.error('payments_create_ref_persist_failed', {
                transactionId: tx.id,
                error: refPersistErr.message,
            });
            return NextResponse.json(
                { error: 'Failed to persist invoice reference; payment aborted' },
                { status: 500 },
            );
        }
        // Re-read the authoritative stored ref. If we lost the race, adopt the
        // winner's ref so both requests drive the provider with the same reference
        // that the webhook will later match.
        const { data: reRead } = await platform
            .from('transactions')
            .select('invoice_ref')
            .eq('id', tx.id)
            .single();
        if (!reRead?.invoice_ref) {
            log.error('payments_create_ref_reread_null', { transactionId: tx.id });
            return NextResponse.json(
                { error: 'Failed to persist invoice reference; payment aborted' },
                { status: 500 },
            );
        }
        invoiceRef = reRead.invoice_ref as string;
    }

    // 4. Build the PaymentRequest
    const jurisdictionName = await fetchJurisdictionName(
        admin,
        (tx as { jurisdiction_id?: string | null }).jurisdiction_id,
    );
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
            // Sovereign name from the transaction's jurisdiction_id — never hardcoded.
            jurisdiction: jurisdictionName,
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
