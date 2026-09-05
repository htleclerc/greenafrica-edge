import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveOwnerAccount } from '@/lib/auth/resolveOwnerAccount';
import { createPlatformClient } from '@/lib/supabase/tenant';

/**
 * GET /api/owner/statements/:period/download — relevé mensuel officiel.
 *
 * `:period` est le mois du relevé, `YYYY-MM`. C'est la clé naturelle de
 * `owner_statements` (UNIQUE armateur × mois, mig 112) et elle dit ce qu'on
 * télécharge ; l'ancienne route portait l'UUID de la ligne, qui ne dit rien et
 * n'a rien à faire dans une URL (voir mig 144 / 147).
 *
 * L'armateur est celui de la session — titulaire ou membre invité — et le
 * relevé est cherché SUR SON COMPTE : un mois qui n'existe pas et un relevé
 * d'un autre armateur répondent pareil. Pas de HMAC : document informatif,
 * lu derrière la session.
 */

const PERIOD_SHAPE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ period: string }> },
): Promise<NextResponse> {
    const { period } = await params;
    if (!PERIOD_SHAPE.test(period)) return new NextResponse('Not found', { status: 404 });

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return new NextResponse('Not found', { status: 404 });

    const account = await resolveOwnerAccount(supabase, auth.user.id);
    if (!account || account.shipowner.account_state !== 'ACTIVE') {
        return new NextResponse('Not found', { status: 404 });
    }

    const { data: row } = await supabase
        .from('owner_statements')
        .select('pdf_path')
        .eq('shipowner_id', account.shipowner.id)
        .eq('period_month', `${period}-01`)
        .maybeSingle();
    const pdfPath = (row as { pdf_path?: string | null } | null)?.pdf_path;
    if (!pdfPath) return new NextResponse('Not found', { status: 404 });

    // Le bucket est privé : l'URL signée (5 min) est frappée avec le client
    // plateforme, une fois la propriété prouvée par la lecture RLS ci-dessus.
    const admin = createPlatformClient();
    const { data: signed, error } = await admin.storage
        .from('documents').createSignedUrl(pdfPath, 300);
    if (error || !signed?.signedUrl) return new NextResponse('Unavailable', { status: 502 });
    return NextResponse.redirect(signed.signedUrl, { status: 302 });
}
