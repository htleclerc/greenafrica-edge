import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceRoleClient } from '@supabase/supabase-js';
import { verifyInvoiceSignature } from '@/services/invoiceService';
import { enforceRateLimit, getClientId } from '@/lib/rateLimit';

/**
 * GET /api/invoices/:ref/download?h=<hash>&s=<signature>
 *
 * Serves the generated PDF from the now-private `documents` bucket, but only
 * after validating the HMAC signature on the query string. This closes the
 * audit finding C4 — before this route existed, PDFs sat on a public bucket
 * under guessable paths and anyone with a ref could download them.
 *
 * Flow:
 *   1. Parse `ref`, `h`, `s` from the URL. Any missing → 404 (deliberately
 *      indistinguishable from "ref doesn't exist" so we don't leak presence).
 *   2. Look up the transaction by invoice_ref (equality — no ILIKE, no prefix).
 *   3. Constant-time compare the HMAC. Mismatch → 404.
 *   4. Mint a short-lived Supabase signed URL (5 min) from the stored path
 *      and 302-redirect to it. The browser downloads the PDF; the URL is
 *      not reusable after the TTL.
 *
 * Why redirect instead of proxying the bytes: lets Supabase CDN stream
 * directly to the client, and the signed URL never appears in our access
 * logs beyond this route.
 */

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ ref: string }> },
) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
        return new NextResponse('Not configured', { status: 500 });
    }

    // Throttle BEFORE anything else — per-IP sliding window. Returns 429
    // with a generic body so scraping attempts can't distinguish rate-limit
    // from not-found based on response shape.
    const clientId = getClientId(request.headers);
    const rate = await enforceRateLimit('invoice-download', clientId);
    if (!rate.allowed) {
        return new NextResponse('Too many requests', {
            status: 429,
            headers: rate.reset ? { 'Retry-After': String(Math.ceil((rate.reset - Date.now()) / 1000)) } : undefined,
        });
    }

    const { ref } = await params;
    const url = new URL(request.url);
    const hash = url.searchParams.get('h');
    const signature = url.searchParams.get('s');

    // Missing query tokens → treat the same as "not found" to avoid
    // leaking whether a ref exists based on different error shapes.
    if (!ref || !hash || !signature) {
        return new NextResponse('Not found', { status: 404 });
    }

    if (!verifyInvoiceSignature(ref, hash, signature)) {
        return new NextResponse('Not found', { status: 404 });
    }

    const admin = createServiceRoleClient(supabaseUrl, supabaseKey);

    const { data: tx, error: txErr } = await admin
        .from('transactions')
        .select('invoice_ref, content_hash, invoice_pdf_url')
        .eq('invoice_ref', ref)
        .maybeSingle();

    if (txErr || !tx || !tx.invoice_pdf_url) {
        return new NextResponse('Not found', { status: 404 });
    }

    // Belt-and-braces: even if the HMAC validates, require the DB content
    // hash to match. Prevents any theoretical replay where the signing
    // secret rotates but an old URL is retried.
    if (tx.content_hash !== hash) {
        return new NextResponse('Not found', { status: 404 });
    }

    const { data: signed, error: signErr } = await admin.storage
        .from('documents')
        .createSignedUrl(tx.invoice_pdf_url, 300);

    if (signErr || !signed?.signedUrl) {
        console.error('[Invoice Download] signedUrl failed:', signErr?.message);
        return new NextResponse('Unavailable', { status: 502 });
    }

    return NextResponse.redirect(signed.signedUrl, { status: 302 });
}
