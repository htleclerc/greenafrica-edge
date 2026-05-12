// ─────────────────────────────────────────────────────────────────────────────
// GET /api/owner/notifications — paginated + unread_count
// ─────────────────────────────────────────────────────────────────────────────
//
// Returns the authenticated shipowner's notifications, latest first, plus the
// unread count for the bell badge.
//
// Query params:
//   - offset (default 0, clamped >= 0)
//   - limit  (default 20, clamped to [1, 100])
//
// Response:
//   { notifications: NotificationRow[], unread_count: number }
//
// RLS note: mig 053 enables RLS on owner_notifications but defines ZERO
// policies (same pattern Plan 7E discovered for wallets in mig 050). A
// session-aware client would therefore return 0 rows. We use the
// service-role client to bypass RLS, while preserving the auth boundary via
// `auth.getUser()` + the explicit `shipowner_id` filter resolved from the
// caller's profile_id. Mirrors `applyWallet.ts` pattern.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
    const n = Number(raw ?? String(fallback));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(n)));
}

export async function GET(req: NextRequest) {
    // 1. Auth gate via session client
    const session = await createServerClient();
    const { data: { user } } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // 2. Service-role client for the actual reads (mig 053 has RLS enabled
    //    with zero policies — session client would see nothing).
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createServiceClient(url, key);

    // 3. Resolve shipowner_id for this user.
    const { data: shipowner, error: ownerErr } = await admin
        .from('shipowners')
        .select('id')
        .eq('profile_id', user.id)
        .maybeSingle();
    if (ownerErr) return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    if (!shipowner) return NextResponse.json({ error: 'No shipowner record' }, { status: 403 });

    // 4. Parse pagination params.
    const reqUrl = new URL(req.url);
    const offset = clampInt(reqUrl.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = clampInt(reqUrl.searchParams.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);

    // 5. Parallel fetch: paginated list + unread count.
    const [listRes, countRes] = await Promise.all([
        admin
            .from('owner_notifications')
            .select('id, kind, title_key, body_key, body_params, deep_link, read_at, created_at')
            .eq('shipowner_id', shipowner.id)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1),
        admin
            .from('owner_notifications')
            .select('id', { count: 'exact', head: true })
            .eq('shipowner_id', shipowner.id)
            .is('read_at', null),
    ]);

    if (listRes.error || countRes.error) {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    return NextResponse.json({
        notifications: listRes.data ?? [],
        unread_count: countRes.count ?? 0,
    });
}
