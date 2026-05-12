import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { listLedgerEntries } from '@/services/walletService';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN, UserRole.MANAGER];

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
) {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) return auth.error;

    const { id } = await ctx.params;

    // RLS bypass: mig 050 enables RLS on wallets + wallet_ledger with no policies.
    // The requireRole gate above is the actual access control; we just need a
    // client that can see the rows.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createServiceClient(url, key);

    try {
        const { data: wallet, error } = await admin
            .from('wallets')
            .select('id, shipowner_id, balance_usd_minor, auto_apply_to_proforma, created_at, updated_at, shipowner:shipowners(id, name)')
            .eq('id', id)
            .maybeSingle();
        if (error) throw error;
        if (!wallet) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        const ledger = await listLedgerEntries(admin, id, { kinds: [], offset: 0, limit: 200 });
        return NextResponse.json({ wallet, ledger });
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
