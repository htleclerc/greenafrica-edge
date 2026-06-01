import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { selectProvidersForRail } from '@/services/paymentService';
import { readPortalFeatureFlags } from '@/lib/feature-flags';

const OWNER_RAILS = ['STRIPE', 'WIRE_TRANSFER', 'MOBILE_MONEY', 'THIRD_PARTY', 'WALLET'] as const;
type Rail = typeof OWNER_RAILS[number];

interface RailEligibility {
    rail: Rail;
    eligible: boolean;
    providers: Array<{ provider: string; routes_rail: string[]; display_order: number }>;
    reason?: string;
}

export async function GET(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(req.url);
    // Informational only — applyWallet/initiatePayment re-verify everything
    // server-side. Used here purely to drive UI eligibility filtering.
    const walletBalanceUsdMinor = Number(url.searchParams.get('walletBalanceUsdMinor') ?? '0');
    const amountUsdMinor = Number(url.searchParams.get('amountUsdMinor') ?? '0');

    // Plan 7H-1 Task 5.2 — STRIPE rail visibility is gated by both the
    // env-key check (Plan 7E) AND the `feature.online_payment_stripe_enabled`
    // app_config flag. Either being absent suppresses STRIPE.
    const flags = await readPortalFeatureFlags();

    const rails: RailEligibility[] = [];
    for (const rail of OWNER_RAILS) {
        if (rail === 'WALLET') {
            // Owner can only apply wallet if balance covers the FULL invoice
            // amount. Partial-wallet-against-invoice is out of scope until 7E.
            const eligible = walletBalanceUsdMinor > 0 && walletBalanceUsdMinor >= amountUsdMinor;
            const reason = walletBalanceUsdMinor === 0
                ? 'wallet_empty'
                : walletBalanceUsdMinor < amountUsdMinor
                    ? 'wallet_insufficient'
                    : undefined;
            rails.push({ rail, eligible, providers: [], reason });
            continue;
        }
        if (rail === 'STRIPE') {
            // Stripe is its own provider — no row in payment_config.
            // Eligibility is solely determined by whether STRIPE_SECRET_KEY
            // is configured in the environment.
            const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY)
                && flags.onlinePaymentStripeEnabled;
            rails.push({
                rail,
                eligible: stripeConfigured,
                providers: stripeConfigured
                    ? [{ provider: 'stripe', routes_rail: ['STRIPE'], display_order: 0 }]
                    : [],
                reason: stripeConfigured ? undefined : 'no_active_provider',
            });
            continue;
        }
        const providers = await selectProvidersForRail(supabase, rail);
        rails.push({
            rail,
            eligible: providers.length > 0,
            providers,
            reason: providers.length === 0 ? 'no_active_provider' : undefined,
        });
    }

    return NextResponse.json({ rails });
}
