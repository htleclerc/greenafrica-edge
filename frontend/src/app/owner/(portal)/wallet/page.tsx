import { requireOwner } from '@/lib/auth/requireOwner';
import { getWalletForOwner, listLedgerEntries, predictNextTax } from '@/services/walletService';
import { WalletPageClient } from './WalletPageClient';

export const metadata = {
    title: 'Owner portal — wallet',
};

export const dynamic = 'force-dynamic';

export default async function OwnerWalletPage() {
    const session = await requireOwner();

    const wallet = await getWalletForOwner(session.supabase, session.shipowner.id);

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
                />
            </div>
        );
    }

    const [ledger, prediction] = await Promise.all([
        listLedgerEntries(session.supabase, wallet.id, { kinds: [], offset: 0, limit: 100 }),
        predictNextTax(session.supabase, session.shipowner.id),
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
            />
        </div>
    );
}
