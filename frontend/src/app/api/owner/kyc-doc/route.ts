import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth/requireOwner';

/**
 * Proxy route to serve KYC documents to the owning shipowner.
 * Generates a signed URL from Supabase storage and redirects.
 * Requires an authenticated, ACTIVE shipowner (requireOwner) — and only
 * serves documents that belong to the caller's own shipowner record, so an
 * owner can't guess another shipowner's storage path.
 */
export async function GET(req: NextRequest) {
    const session = await requireOwner();
    const { supabase, shipowner } = session;

    // Get path from query
    const path = req.nextUrl.searchParams.get('path');
    if (!path) return new NextResponse('Missing path parameter', { status: 400 });

    // Ownership guard: only sign paths that belong to the caller's own
    // shipowner record. ShipownerListRow (returned by requireOwner) doesn't
    // carry the doc columns, so fetch them explicitly.
    const { data: doc, error: docError } = await supabase
        .from('shipowners')
        .select('proof_doc_url, billing_proof_doc_url')
        .eq('id', shipowner.id)
        .single();

    if (docError || !doc) {
        return new NextResponse('Forbidden', { status: 403 });
    }

    const isOwnDocument = path === doc.proof_doc_url || path === doc.billing_proof_doc_url;
    if (!isOwnDocument) {
        return new NextResponse('Forbidden', { status: 403 });
    }

    // Generate signed URL
    const { data, error } = await supabase.storage
        .from('shipowner-kyc')
        .createSignedUrl(path, 3600); // 1 hour expiry

    if (error || !data?.signedUrl) {
        return new NextResponse('Document not found', { status: 404 });
    }

    return NextResponse.redirect(data.signedUrl);
}
