// Reusable server component for the operator wallet view.
// Used by /owner/wallet (via thin wrapper) and /dashboard/wallet when the
// principal is an operator. Always fetches via createTenantClient(jurisdictionId)
// (RLS-scoped through the tenant factory).

import { getTranslations } from 'next-intl/server';
import type { Principal } from '@/lib/auth/requirePrincipal';
import { createTenantClient } from '@/lib/supabase/tenant';
import { getWalletForOwner, listLedgerEntries, predictNextTax } from '@/services/walletService';
import { readPortalFeatureFlags } from '@/lib/feature-flags';
import { WalletPageClient } from '@/components/owner/Wallet/WalletPageClient';
import { PAYPAL_RETURNS, type PaypalReturn } from '@/components/owner/pages/OperatorInvoicesPage';

/** Teintes alignees sur les bannieres de retour de la page factures. */
const RETURN_STYLE: Record<'success' | 'cancel' | 'pending' | 'failed', string> = {
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    cancel: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    pending: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    failed: 'border-red-500/30 bg-red-500/10 text-red-200',
};

interface Props {
    principal: Extract<Principal, { kind: 'operator' }>;
    stripeReturn?: 'success' | 'cancel' | null;
    paypalReturn?: PaypalReturn | null;
}

/**
 * Banniere de retour d'un checkout externe pour une recharge. Le texte parle
 * de solde, pas de facture : un top-up ne solde rien.
 */
async function TopupReturnBanner({
    stripeReturn,
    paypalReturn,
}: Pick<Props, 'stripeReturn' | 'paypalReturn'>) {
    const outcome = stripeReturn ?? paypalReturn ?? null;
    if (!outcome) return null;
    const t = await getTranslations('OwnerPortal.wallet.topupReturn');
    return (
        <div className={`rounded-xl border p-3 mb-4 text-sm ${RETURN_STYLE[outcome]}`}>
            {t(outcome)}
        </div>
    );
}

export async function OperatorWalletPage({
    principal,
    stripeReturn = null,
    paypalReturn = null,
}: Props) {
    const flags = await readPortalFeatureFlags();
    const topupEnabled = flags.walletTopupEnabled;

    // Tenant-scoped client — auto-filters by jurisdiction_id (defense in depth).
    const admin = createTenantClient(principal.jurisdictionId);

    const wallet = await getWalletForOwner(admin, principal.shipowner.id);

    if (!wallet) {
        return (
            <div className="px-6 py-6 max-w-6xl mx-auto">
                <TopupReturnBanner stripeReturn={stripeReturn} paypalReturn={paypalReturn} />
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
            <TopupReturnBanner stripeReturn={stripeReturn} paypalReturn={paypalReturn} />
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
