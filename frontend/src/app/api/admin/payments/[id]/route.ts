import { NextRequest, NextResponse } from 'next/server';
import { listProofs, signedProofUrl, type PaymentProofRow } from '@/services/paymentProofService';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { PAYMENTS_ONLY_STATUSES } from '@/lib/auth/paymentsOnly';

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN];

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
) {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) return auth.error;

    const { id } = await ctx.params;

    try {
        const { data: payment, error } = await auth.supabase
            .from('payments')
            .select('*')
            .eq('id', id)
            .maybeSingle();
        if (error) throw error;
        if (!payment) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        // Encaissements seulement (mig 154) : un paiement non confirmé n'existe
        // pas pour cette personne — même réponse qu'un identifiant inconnu.
        if (auth.user.paymentsOnly && !PAYMENTS_ONLY_STATUSES.includes(String((payment as { status?: string }).status))) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        const proofs = await listProofs(auth.supabase, id);
        const proofsWithUrls = await Promise.all(
            proofs.map(async (p: PaymentProofRow) => ({
                ...p,
                signed_url: await signedProofUrl(auth.supabase, p.storage_path, 300),
            })),
        );

        return NextResponse.json({ payment, proofs: proofsWithUrls });
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
