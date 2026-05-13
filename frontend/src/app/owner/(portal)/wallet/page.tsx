import { createClient as createServiceClient } from '@supabase/supabase-js';
import { requireOwner } from '@/lib/auth/requireOwner';
import { getWalletForOwner, listLedgerEntries, predictNextTax } from '@/services/walletService';
import { readPortalFeatureFlags } from '@/lib/feature-flags';
import { WalletPageClient } from './WalletPageClient';

export const metadata = {
    title: 'Owner portal — wallet',
};

export const dynamic = 'force-dynamic';

export default async function OwnerWalletPage() {
    const session = await requireOwner();

    // Plan 7H-1 Task 5.3 — gate the "Top up" surface behind
    // `feature.wallet_topup_enabled`. The wallet page itself stays visible
    // (so the owner can see balance + ledger), only the topup CTA is hidden.
    const flags = await readPortalFeatureFlags();
    const topupEnabled = flags.walletTopupEnabled;

    // RLS bypass: mig 050 enables RLS on wallets + wallet_ledger but adds no policies.
    // requireOwner() above is the auth gate (validates session + ACTIVE shipowner);
    // queries below are scoped by `session.shipowner.id` so a service-role client is
    // safe to use for the reads. Mirrors the pattern in actions/applyWallet.ts.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createServiceClient(url, key);

    const wallet = await getWalletForOwner(admin, session.shipowner.id);

    if (!wallet) {
        // Wallet auto-creates on first ledger entry (per mig 064 fallback). If it's still missing here,
        // there's literally been no payment activity. Show empty state with a topup CTA.
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
        predictNextTax(admin, session.shipowner.id),
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
