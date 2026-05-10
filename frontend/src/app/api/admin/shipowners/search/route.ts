import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN];

export async function GET(req: NextRequest) {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) return auth.error;

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
