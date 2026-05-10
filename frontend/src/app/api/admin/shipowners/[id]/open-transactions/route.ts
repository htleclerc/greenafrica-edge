import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN];

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
) {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) return auth.error;

    const { id } = await ctx.params;

    const { data: shipowner, error: ownerErr } = await auth.supabase
        .from('shipowners')
        .select('id')
        .eq('id', id)
        .maybeSingle();
    if (ownerErr || !shipowner) return NextResponse.json({ transactions: [] });

    // Transactions linked to vessels of this shipowner with PROFORMA / FINAL / COMPLEMENT not yet PAID.
    // Project pattern: vessels.shipowner_id; transactions.vessel_id.
    const { data, error } = await auth.supabase
        .from('transactions')
        .select('id, invoice_ref, tax_amount_usd, document_type, status, vessel:vessels!inner(shipowner_id)')
        .eq('vessel.shipowner_id', id)
        .in('document_type', ['PROFORMA', 'FINAL', 'COMPLEMENT'])
        .not('status', 'eq', 'PAID')
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) return NextResponse.json({ error: 'query failed' }, { status: 500 });

    const transactions = (data ?? []).map((t: { id: string; invoice_ref: string | null; tax_amount_usd: number }) => ({
        id: t.id,
        invoice_ref: t.invoice_ref,
        tax_amount_usd: Number(t.tax_amount_usd),
    }));

    return NextResponse.json({ transactions });
}
