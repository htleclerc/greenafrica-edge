import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { enforceRateLimit } from '@/lib/rateLimit';

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN];

export async function GET(req: NextRequest) {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) return auth.error;

    // Cap enumeration of the shipowner directory (per-admin).
    const rl = await enforceRateLimit('admin-read', auth.user.id);
    if (!rl.allowed) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const url = new URL(req.url);
    const q = url.searchParams.get('q') ?? '';
    if (q.length < 2) return NextResponse.json({ shipowners: [] });

    const { data, error } = await auth.supabase
        .from('shipowners')
        .select('id, name')
        .ilike('name', `%${q}%`)
        .eq('account_state', 'ACTIVE')
        .order('name')
        .limit(20);

    if (error) return NextResponse.json({ error: 'query failed' }, { status: 500 });
    return NextResponse.json({ shipowners: data ?? [] });
}
