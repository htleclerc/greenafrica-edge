import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';

/**
 * GET /api/statements/:id/download
 * Owner-scoped (no HMAC — informational). (1) read owner_statements with the
 * owner's RLS client → ownership proof; (2) mint a signed URL with the service
 * client (private bucket) and 302-redirect.
 */
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
    const { id } = await params;
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return new NextResponse('Not found', { status: 404 });

    const { data: row } = await supabase
        .from('owner_statements').select('pdf_path').eq('id', id).maybeSingle();
    if (!row || !(row as { pdf_path: string }).pdf_path) {
        return new NextResponse('Not found', { status: 404 });
    }

    const admin = createPlatformClient();
    const { data: signed, error } = await admin.storage
        .from('documents').createSignedUrl((row as { pdf_path: string }).pdf_path, 300);
    if (error || !signed?.signedUrl) return new NextResponse('Unavailable', { status: 502 });
    return NextResponse.redirect(signed.signedUrl, { status: 302 });
}
