import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateInvoicePdf, type InvoiceData } from '@/services/invoiceService';

/**
 * POST /api/invoices/generate
 *
 * Server-side pro-forma invoice generation. Uses the service_role key to:
 *  1. Render a real PDF with jsPDF
 *  2. Upload to Supabase Storage (bypasses RLS)
 *  3. Update transactions.invoice_pdf_url
 *  4. Mark vessels.pro_forma_generated = true
 *  5. Insert an audit_logs entry
 *
 * Returns the public PDF URL on success.
 *
 * Body: { invoiceData: InvoiceData, transactionId: string, vesselId: string,
 *         actingUserId: string, actingUserName: string }
 */
export async function POST(request: NextRequest) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
        return NextResponse.json(
            { error: 'Supabase not configured' },
            { status: 500 },
        );
    }

    let body: {
        invoiceData: InvoiceData;
        transactionId: string;
        vesselId: string | null;
        actingUserId: string;
        actingUserName: string;
    };

    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { invoiceData, transactionId, vesselId, actingUserId, actingUserName } = body;

    if (!invoiceData || !transactionId) {
        return NextResponse.json(
            { error: 'invoiceData and transactionId are required' },
            { status: 400 },
        );
    }

    const admin = createClient(supabaseUrl, supabaseKey);

    try {
        // 1. Generate PDF buffer
        const pdfBuffer = generateInvoicePdf(invoiceData);
        const fileName = `invoices/${invoiceData.invoiceRef}.pdf`;

        // 2. Upload to storage with service_role (bypasses RLS)
        const { error: uploadError } = await admin.storage
            .from('documents')
            .upload(fileName, pdfBuffer, {
                contentType: 'application/pdf',
                upsert: true,
            });

        if (uploadError) {
            console.error('[Invoice API] Upload failed:', uploadError.message);
            return NextResponse.json(
                { error: `Upload failed: ${uploadError.message}` },
                { status: 502 },
            );
        }

        // 3. Get the public URL
        const { data: urlData } = admin.storage.from('documents').getPublicUrl(fileName);
        const pdfUrl = urlData.publicUrl;

        // 4. Update transaction
        const { error: txError } = await admin
            .from('transactions')
            .update({ invoice_pdf_url: pdfUrl })
            .eq('id', transactionId);

        if (txError) {
            console.error('[Invoice API] Transaction update failed:', txError.message);
        }

        // 5. Mark vessel as having a pro-forma generated
        if (vesselId) {
            const { error: vesselError } = await admin
                .from('vessels')
                .update({ pro_forma_generated: true })
                .eq('id', vesselId);

            if (vesselError) {
                console.error('[Invoice API] Vessel update failed:', vesselError.message);
            }
        }

        // 6. Audit log
        const { error: auditError } = await admin.from('audit_logs').insert({
            user_id: actingUserId,
            user_full_name: actingUserName,
            action: 'INVOICE_GENERATED',
            severity: 'INFO',
            entity_type: 'Transaction',
            entity_id: transactionId,
            details_json: {
                vesselName: invoiceData.vesselName,
                invoiceRef: invoiceData.invoiceRef,
                amount: invoiceData.totalUsd,
                pdfUrl,
            },
        });

        if (auditError) {
            console.error('[Invoice API] Audit log failed:', auditError.message);
        }

        return NextResponse.json({
            success: true,
            pdfUrl,
            invoiceRef: invoiceData.invoiceRef,
        });
    } catch (err) {
        console.error('[Invoice API] Internal error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Internal server error' },
            { status: 500 },
        );
    }
}
