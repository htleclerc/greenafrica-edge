import { NextRequest, NextResponse } from 'next/server';
import {
    getAllProviderConfigs,
    isProviderConfigured,
    setActiveProvider,
    setProviderActive,
} from '@/services/paymentService';
import { readPortalFeatureFlags } from '@/lib/feature-flags';
import type { PaymentProvider } from '@/services/paymentService';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN];
const PROVIDER_ENUM = ['stripe', 'paystack', 'flutterwave', 'wave', 'payoneer', 'wire_transfer'] as const;

/**
 * GET /api/admin/payment-config
 * Returns all payment provider configurations for the settings page.
 *
 * `checkoutFlags` porte les feature flags qui gouvernent RÉELLEMENT les rails
 * de paiement en ligne du portail armateur (Stripe, PayPal) : le rail exige la
 * clé en environnement ET le flag, et ignore `payment_config`. Sans cette
 * information, l'admin activait Stripe ici et ne comprenait pas pourquoi
 * aucun armateur ne voyait la carte.
 */
export async function GET() {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) return auth.error;

    try {
        const [configs, flags] = await Promise.all([
            getAllProviderConfigs(auth.supabase),
            readPortalFeatureFlags(),
        ]);
        return NextResponse.json({
            providers: configs,
            checkoutFlags: {
                stripe: flags.onlinePaymentStripeEnabled,
                paypal: flags.onlinePaypalEnabled,
            },
        });
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// Two accepted body shapes:
//   1. Legacy: { activeProvider: <enum> }            → exclusive activation
//   2. Plan 7C-2: { provider: <enum>, isActive: bool } → independent toggle
const legacyBody = z.object({ activeProvider: z.enum(PROVIDER_ENUM) });
const toggleBody = z.object({ provider: z.enum(PROVIDER_ENUM), isActive: z.boolean() });

/**
 * PUT /api/admin/payment-config
 */
export async function PUT(request: NextRequest) {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) return auth.error;

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const toggle = toggleBody.safeParse(body);
    if (toggle.success) {
        // Activer un fournisseur dont la clé n'est pas chargée produirait des
        // paiements qui échouent tous : on refuse, avec la variable attendue.
        if (toggle.data.isActive && !isProviderConfigured(toggle.data.provider as PaymentProvider)) {
            return NextResponse.json(
                { error: `${toggle.data.provider}: secret key is not configured in this deployment` },
                { status: 409 },
            );
        }
        const ok = await setProviderActive(
            auth.supabase,
            toggle.data.provider as PaymentProvider,
            toggle.data.isActive,
        );
        if (!ok) return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
        return NextResponse.json({ success: true, provider: toggle.data.provider, isActive: toggle.data.isActive });
    }

    const legacy = legacyBody.safeParse(body);
    if (legacy.success) {
        const ok = await setActiveProvider(auth.supabase, legacy.data.activeProvider as PaymentProvider);
        if (!ok) return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
        return NextResponse.json({ success: true, activeProvider: legacy.data.activeProvider });
    }

    return NextResponse.json({ error: 'Invalid body — expected { activeProvider } or { provider, isActive }' }, { status: 400 });
}
