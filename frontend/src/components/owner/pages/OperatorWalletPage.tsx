// Reusable server component for the operator wallet view.
// Used by /owner/wallet (via thin wrapper) and /dashboard/wallet when the
// principal is an operator. Always fetches via createTenantClient(jurisdictionId)
// (RLS-scoped through the tenant factory).

import type { Principal } from '@/lib/auth/requirePrincipal';
import { createTenantClient } from '@/lib/supabase/tenant';
import { getWalletForOwner, listLedgerEntries, predictNextTax } from '@/services/walletService';
import { readPortalFeatureFlags } from '@/lib/feature-flags';
import { WalletPageClient } from '@/app/owner/(portal)/wallet/WalletPageClient';

interface Props {
    principal: Extract<Principal, { kind: 'operator' }>;
}

export async function OperatorWalletPage({ principal }: Props) {
    const flags = await readPortalFeatureFlags();
    const topupEnabled = flags.walletTopupEnabled;

    // Tenant-scoped client — auto-filters by jurisdiction_id (defense in depth).
    const admin = createTenantClient(principal.jurisdictionId);

    const wallet = await getWalletForOwner(admin, principal.shipowner.id);

    if (!wallet) {
        return (
            <div className="px-6 py-6 max-w-6xl mx-auto">
                <header className="mb-6">
                    <h1 className="text-2xl font-semibold">Wallet</h1>
                    <p className="text-sm text-[var(--os-text-muted)] mt-1">
                        Your wallet is empty. Top it up to apply credits to future invoices.
                    </p>
                </header>
                <WalletPageClient
                    walletId="pending"
                    initialBalanceUsdMinor={0}
                    initialAutoApply={true}
                    initialLedger={[]}
                    prediction={{ estimated_count_30d: 0, estimated_amount_30d_usd: 0, confidence: 'low' }}
                    topupEnabled={topupEnabled}
                />
            </div>
        );
    }

    const [ledger, prediction] = await Promise.all([
        listLedgerEntries(admin, wallet.id, { kinds: [], offset: 0, limit: 100 }),
        predictNextTax(admin, principal.shipowner.id),
    ]);

    return (
        <div className="px-6 py-6 max-w-6xl mx-auto">
            <header className="mb-6">
                <h1 className="text-2xl font-semibold">Wallet</h1>
            </header>
            <WalletPageClient
                walletId={wallet.id}
                initialBalanceUsdMinor={wallet.balance_usd_minor}
                initialAutoApply={wallet.auto_apply_to_proforma}
                initialLedger={ledger}
                prediction={prediction}
                topupEnabled={topupEnabled}
            />
        </div>
    );
}
