import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAllProviderConfigs, setActiveProvider } from '@/services/paymentService';
import type { PaymentProvider } from '@/services/paymentService';
import { z } from 'zod';

const ADMIN_ROLES = ['SUPERADMIN', 'FINANCE_ADMIN'];

/**
 * GET /api/admin/payment-config
 * Returns all payment provider configurations for the settings page.
 */
export async function GET() {
  try {
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await client
      .from('profiles').select('role').eq('id', user.id).single();
    if (!profile || !ADMIN_ROLES.includes(profile.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const configs = await getAllProviderConfigs(client);
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
  try {
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await client
      .from('profiles').select('role').eq('id', user.id).single();
    if (!profile || !ADMIN_ROLES.includes(profile.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
    }

    const success = await setActiveProvider(client, parsed.data.activeProvider as PaymentProvider);
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
