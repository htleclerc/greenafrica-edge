import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { selectProvidersForRail } from '@/services/paymentService';
import { paypalConfigured } from '@/services/paypalService';
import { readPortalFeatureFlags, type PortalFeatureFlags } from '@/lib/feature-flags';
import { getIssuerProfile, primaryAccount } from '@/services/issuerProfileService';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';

const OWNER_RAILS = ['STRIPE', 'PAYPAL', 'WIRE_TRANSFER', 'MOBILE_MONEY', 'THIRD_PARTY', 'WALLET'] as const;
type Rail = typeof OWNER_RAILS[number];

interface RailEligibility {
    rail: Rail;
    eligible: boolean;
    providers: Array<{ provider: string; routes_rail: string[]; display_order: number }>;
    reason?: string;
}

/**
 * Rails « checkout en ligne » : leur provider ne vit PAS dans payment_config,
 * il est déterminé par la présence des credentials en environnement ET par un
 * feature flag app_config. Les deux sont requis — fail-secure.
 */
const CHECKOUT_RAILS: Record<'STRIPE' | 'PAYPAL', {
    provider: string;
    envConfigured: () => boolean;
    flag: keyof PortalFeatureFlags;
}> = {
    STRIPE: {
        provider: 'stripe',
        envConfigured: () => Boolean(process.env.STRIPE_SECRET_KEY),
        flag: 'onlinePaymentStripeEnabled',
    },
    PAYPAL: {
        provider: 'paypal',
        envConfigured: paypalConfigured,
        flag: 'onlinePaypalEnabled',
    },
};

function checkoutEligibility(
    rail: 'STRIPE' | 'PAYPAL',
    flags: PortalFeatureFlags,
): RailEligibility {
    const meta = CHECKOUT_RAILS[rail];
    const enabled = meta.envConfigured() && flags[meta.flag];
    return {
        rail,
        eligible: enabled,
        providers: enabled
            ? [{ provider: meta.provider, routes_rail: [rail], display_order: 0 }]
            : [],
        reason: enabled ? undefined : 'no_active_provider',
    };
}

/**
 * Le wallet ne peut couvrir qu'une facture entière. Le paiement partiel depuis
 * le wallet est hors périmètre.
 */
function walletEligibility(
    walletBalanceUsdMinor: number,
    amountUsdMinor: number,
): RailEligibility {
    if (walletBalanceUsdMinor === 0) {
        return { rail: 'WALLET', eligible: false, providers: [], reason: 'wallet_empty' };
    }
    if (walletBalanceUsdMinor < amountUsdMinor) {
        return { rail: 'WALLET', eligible: false, providers: [], reason: 'wallet_insufficient' };
    }
    return { rail: 'WALLET', eligible: true, providers: [] };
}

/** Rails manuels : l'éligibilité vient des providers actifs dans payment_config. */
async function providerBackedEligibility(
    supabase: SupabaseClient,
    rail: Rail,
): Promise<RailEligibility> {
    const providers = await selectProvidersForRail(supabase, rail);
    return {
        rail,
        eligible: providers.length > 0,
        providers,
        reason: providers.length === 0 ? 'no_active_provider' : undefined,
    };
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

    const flags = await readPortalFeatureFlags();

    const rails: RailEligibility[] = [];
    for (const rail of OWNER_RAILS) {
        if (rail === 'WALLET') {
            rails.push(walletEligibility(walletBalanceUsdMinor, amountUsdMinor));
        } else if (rail === 'STRIPE' || rail === 'PAYPAL') {
            rails.push(checkoutEligibility(rail, flags));
        } else {
            rails.push(await providerBackedEligibility(supabase, rail));
        }
    }

    // Un rail structurellement indisponible — aucun prestataire actif — n'est
    // pas descendu au navigateur quand le drapeau est eteint. Le filtrage se
    // fait ICI et non cote client : masquer a l'affichage laisserait
    // l'information dans la charge utile, et renseignerait sur l'outillage de
    // la plateforme quiconque ouvre l'onglet reseau.
    //
    // Le portefeuille echappe a ce filtre quel que soit le drapeau : « solde
    // insuffisant » est une information actionnable, pas une indisponibilite.
    // Le masquer laisserait croire que le moyen n'existe pas.
    const visible = flags.showUnavailableRails
        ? rails
        : rails.filter((r) => r.eligible || r.rail === 'WALLET');

    // Coordonnées du compte à créditer, servies avec les rails : l'écran de
    // virement les affichait depuis une constante compilée dans le bundle, donc
    // insensible à la mig 131. Le dialogue interroge déjà cette route, autant
    // qu'il y lise aussi le RIB plutôt que d'en ouvrir une seconde.
    const jurisdictionId = await getServerJurisdictionId().catch(() => null);
    const profile = await getIssuerProfile(supabase, jurisdictionId);
    const account = primaryAccount(profile);

    // TOUS les comptes, pas seulement le principal. Le profil en porte
    // plusieurs depuis la mig 131 — zone euro, hors-UE, et local depuis la
    // mig 150 — mais l'écran n'en montrait qu'un. Un armateur qui banque au
    // Somaliland payait donc un virement international pour une taxe perçue
    // sur place. Le payeur est seul à savoir où il banque : c'est à lui de
    // choisir.
    //
    // `wire` reste rendu tel quel : il porte le compte par défaut, et le
    // supprimer casserait un client qui n'aurait pas encore été redéployé.
    const toWire = (a: typeof account) => ({
        beneficiary: a.holder,
        bank: a.bank,
        bankAddress: a.bankAddress ?? '',
        swiftCode: a.swift,
        iban: a.iban ?? a.accountNumber ?? '',
        depositReference: a.depositReference,
    });

    return NextResponse.json({
        rails: visible,
        showUnavailable: flags.showUnavailableRails,
        wire: toWire(account),
        wireAccounts: profile.bankAccounts.map((a, index) => ({
            // L'index est la clé de sélection : les comptes n'ont pas d'id en
            // base, et le SWIFT ne discrimine pas deux comptes d'une même
            // banque. L'ordre du tableau fait foi, ici comme dans le PDF.
            index,
            label: a.label,
            currency: a.currency,
            isPrimary: a.isPrimary,
            intermediaryBank: a.intermediaryBank,
            intermediarySwift: a.intermediarySwift,
            ...toWire(a),
        })),
    });
}
