import { NextRequest, NextResponse } from 'next/server';
import { listLedgerEntries } from '@/services/walletService';
import { requireRole } from '@/lib/auth/requireRole';
import { adminScopedClient } from '@/lib/auth/adminTenant';
import { UserRole } from '@/types/secure';

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN];

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
) {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) return auth.error;

    const { id } = await ctx.params;

    // RLS bypass: mig 050 enables RLS on wallets + wallet_ledger with no policies.
    // requireRole gates access; adminScopedClient confines non-SUPERADMIN admins to
    // their own jurisdiction (a wallet in another jurisdiction reads as not-found).
    const admin = await adminScopedClient(auth.user);

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
