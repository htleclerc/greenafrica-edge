import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Proxy route to serve KYC documents to authorized admins.
 * Generates a signed URL from Supabase storage and redirects.
 * Requires SUPERADMIN role.
 */
export async function GET(req: NextRequest) {
    // Check auth
    const supabase = await createClient();
    const { data: authUser } = await supabase.auth.getUser();
    if (!authUser?.user) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    // Check role
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', authUser.user.id)
        .single();

    const allowedRoles = ['SUPERADMIN'];
    if (!profile || !allowedRoles.includes(profile.role)) {
        return new NextResponse('Forbidden', { status: 403 });
    }

    // Get path from query
    const path = req.nextUrl.searchParams.get('path');
    if (!path) return new NextResponse('Missing path parameter', { status: 400 });

    // Generate signed URL
    const { data, error } = await supabase.storage
        .from('shipowner-kyc')
        .createSignedUrl(path, 3600); // 1 hour expiry

    if (error || !data?.signedUrl) {
        return new NextResponse('Document not found', { status: 404 });
    }

    return NextResponse.redirect(data.signedUrl);
}
