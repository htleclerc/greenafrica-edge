import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { confirmPayment } from '@/services/paymentService';
import { writeAuditLog } from '@/services/auditService';

/**
 * POST /api/webhooks/payment
 *
 * Webhook handler for Wave Mobile Money payment notifications.
 * Wave sends a POST when payment status changes.
 *
 * Authenticated via WAVE_WEBHOOK_SECRET in the x-wave-signature header.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify webhook signature
    const signature = request.headers.get('x-wave-signature') || request.headers.get('authorization');
    const expectedSecret = process.env.WAVE_WEBHOOK_SECRET;

    if (!expectedSecret || signature !== expectedSecret) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const body = await request.json();
    const { client_reference, payment_status, id: wavePaymentId } = body as {
      client_reference: string;  // our invoiceRef
      payment_status: string;    // 'succeeded' | 'failed' | 'cancelled'
      id: string;                // Wave payment ID
    };

    if (!client_reference || !payment_status) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    if (payment_status === 'succeeded') {
      // Find transaction by invoice ref pattern (ref is in format AG-XXXX)
      const { data: transaction } = await adminClient
        .from('transactions')
        .select('id, vessel_id, vessel_name, tax_amount_usd')
        .eq('id', client_reference)
        .single();

      if (!transaction) {
        // Try matching by a ref-like pattern
        const { data: txByRef } = await adminClient
          .from('transactions')
          .select('id, vessel_id, vessel_name, tax_amount_usd')
          .ilike('id', `%${client_reference}%`)
          .limit(1)
          .single();

        if (!txByRef) {
          return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
        }

        await confirmPayment(adminClient, txByRef.id, wavePaymentId);

        await writeAuditLog(adminClient, {
          action: 'PAYMENT_RECEIVED',
          entity_type: 'transaction',
          entity_id: txByRef.id,
          user_id: '00000000-0000-0000-0000-000000000000', // system
          severity: 'info',
          details: {
            wave_ref: wavePaymentId,
            amount_usd: txByRef.tax_amount_usd,
            vessel: txByRef.vessel_name,
          },
        });

        return NextResponse.json({ success: true });
      }

      await confirmPayment(adminClient, transaction.id, wavePaymentId);

      await writeAuditLog(adminClient, {
        action: 'PAYMENT_RECEIVED',
        entity_type: 'transaction',
        entity_id: transaction.id,
        user_id: '00000000-0000-0000-0000-000000000000',
        severity: 'info',
        details: {
          wave_ref: wavePaymentId,
          amount_usd: transaction.tax_amount_usd,
          vessel: transaction.vessel_name,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
