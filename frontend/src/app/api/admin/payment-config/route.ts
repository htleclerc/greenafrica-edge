import { NextRequest, NextResponse } from 'next/server';
import { getAllProviderConfigs, setActiveProvider } from '@/services/paymentService';
import type { PaymentProvider } from '@/services/paymentService';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN];

/**
 * GET /api/admin/payment-config
 * Returns all payment provider configurations for the settings page.
 */
export async function GET() {
  const auth = await requireRole(ADMIN_ROLES);
  if (auth.error) return auth.error;

  try {
    const configs = await getAllProviderConfigs(auth.supabase);
    return NextResponse.json({ providers: configs });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const updateSchema = z.object({
  activeProvider: z.enum(['stripe', 'paystack', 'flutterwave', 'wave', 'payoneer', 'wire_transfer']),
});

/**
 * PUT /api/admin/payment-config
 * Switch the active payment provider.
 * Body: { activeProvider: "stripe" | "paystack" | "flutterwave" | "wave" | "payoneer" | "wire_transfer" }
 */
export async function PUT(request: NextRequest) {
  const auth = await requireRole(ADMIN_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
    }

    const success = await setActiveProvider(auth.supabase, parsed.data.activeProvider as PaymentProvider);
    if (!success) {
      return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      activeProvider: parsed.data.activeProvider,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
