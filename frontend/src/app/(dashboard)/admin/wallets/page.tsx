import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient, createTenantClient } from '@/lib/supabase/tenant';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';
import { AdminWalletsPanel, type AdminWalletRow } from '@/components/dashboard/admin/AdminWallets';

export const metadata: Metadata = {
    title: 'Wallets | Green Gate',
    description: 'Admin overview of all shipowner wallets — balance, auto-apply, last activity.',
};

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['SUPERADMIN', 'FINANCE_ADMIN', 'MANAGER']);

interface WalletRecord {
    id: string;
    shipowner_id: string;
    balance_usd_minor: number;
    auto_apply_to_proforma: boolean;
    shipowner: { name?: string } | { name?: string }[] | null;
}

interface LedgerActivity {
    wallet_id: string;
    created_at: string;
}

export default async function AdminWalletsRoute() {
    const supabase = await createClient();

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (!profile?.role || !ALLOWED_ROLES.has(profile.role)) {
        redirect('/dashboard');
    }

    // RLS bypass: mig 050 enables RLS on wallets + wallet_ledger with no policies.
    // RBAC gate above controls WHO; the tenant-scoped factory confines non-SUPERADMIN
    // admins to their own jurisdiction's wallets (GreenGate v8).
    const admin =
        profile.role === 'SUPERADMIN'
            ? createPlatformClient()
            : createTenantClient(await getServerJurisdictionId());

    // Query 1: wallets + shipowner name (top 200 by balance)
    const { data: walletsData, error: walletsError } = await admin
        .from('wallets')
        .select('id, shipowner_id, balance_usd_minor, auto_apply_to_proforma, shipowner:shipowners(name)')
        .order('balance_usd_minor', { ascending: false })
        .limit(200);

    if (walletsError) {
        throw new Error(`Failed to load wallets: ${walletsError.message}`);
    }

    const wallets = (walletsData ?? []) as unknown as WalletRecord[];
    const walletIds = wallets.map((w) => w.id);

    // Query 2: latest wallet_ledger entry per wallet (build a Map<wallet_id, created_at>)
    const lastActivityByWallet = new Map<string, string>();
    if (walletIds.length > 0) {
        const { data: ledgerData, error: ledgerError } = await admin
            .from('wallet_ledger')
            .select('wallet_id, created_at')
            .in('wallet_id', walletIds)
            .order('created_at', { ascending: false });

        if (ledgerError) {
            throw new Error(`Failed to load wallet ledger: ${ledgerError.message}`);
        }

        const lastActivities = (ledgerData ?? []) as LedgerActivity[];
        for (const entry of lastActivities) {
            if (!lastActivityByWallet.has(entry.wallet_id)) {
                lastActivityByWallet.set(entry.wallet_id, entry.created_at);
            }
        }
    }

    const rows: AdminWalletRow[] = wallets.map((w) => {
        // PostgREST can return the nested join either as an object or (in some shapes) an array.
        const shipownerJoin = Array.isArray(w.shipowner) ? w.shipowner[0] : w.shipowner;
        const name = (shipownerJoin as { name?: string } | null)?.name ?? '—';
        return {
            wallet_id: w.id,
            shipowner_id: w.shipowner_id,
            shipowner_name: name,
            balance_usd_minor: w.balance_usd_minor,
            auto_apply_to_proforma: w.auto_apply_to_proforma,
            last_activity_at: lastActivityByWallet.get(w.id) ?? null,
        };
    });

    return (
        <div className="px-6 py-4">
            <AdminWalletsPanel rows={rows} />
        </div>
    );
}
