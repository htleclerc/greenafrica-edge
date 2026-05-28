import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getLegacyPaymentMethods } from '@/services/paymentService';

// GET /api/payments/methods
// Returns which legacy "Payment Capture" methods are active (driven by
// payment_config) so the invoice Payment tab can render real, clickable rows
// instead of static placeholders. Auth-gated (any logged-in user); the payload
// only exposes provider availability flags, not secrets.
export async function GET() {
    const session = await createServerClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const methods = await getLegacyPaymentMethods(admin);
    return NextResponse.json(methods);
}
