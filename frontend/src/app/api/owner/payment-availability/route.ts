import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { selectProvidersForRail } from '@/services/paymentService';

const OWNER_RAILS = ['WIRE_TRANSFER', 'MOBILE_MONEY', 'THIRD_PARTY', 'WALLET'] as const;
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
