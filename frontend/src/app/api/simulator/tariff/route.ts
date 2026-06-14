// ─────────────────────────────────────────────────────────────────────────────
// GET /api/simulator/tariff — active MARITIME tariff for the caller's jurisdiction
// ─────────────────────────────────────────────────────────────────────────────
//
// Auth strategy: inline (NOT requirePrincipal) so the route can return a clean
// 401 JSON response instead of triggering Next.js redirect() which cannot be
// caught in API route tests.
//
// Resolution order:
//   1. No session → 401
//   2. Active shipowners row → operator; use shipowners.jurisdiction_id
//   3. No shipowners row → staff; call _getServerJurisdictionIdImpl (uncached
//      raw impl, avoids React cache() which does not work in API routes)
//   4. Jurisdiction resolution throws → { ratePerTco2: null, jurisdictionId: null }
//   5. Query tariffs for (jurisdictionId, MARITIME, ACTIVE, today in range)
//
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { _getServerJurisdictionIdImpl } from '@/lib/auth/tenantContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── Step 1: resolve jurisdiction ──────────────────────────────────────────

    // Check if caller is an active operator
    const { data: shipownerRow, error: shipownerError } = await supabase
        .from('shipowners')
        .select('jurisdiction_id')
        .eq('profile_id', user.id)
        .eq('account_state', 'ACTIVE')
        .maybeSingle();

    if (shipownerError) {
        console.error('[tariff] shipowners query failed', shipownerError);
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }

    let jurisdictionId: string | null = null;

    if (shipownerRow?.jurisdiction_id) {
        // Operator path
        jurisdictionId = shipownerRow.jurisdiction_id ?? null;
    } else {
        // Staff path — use the uncached impl to avoid React cache() in API routes
        try {
            jurisdictionId = await _getServerJurisdictionIdImpl();
        } catch {
            // Jurisdiction unresolvable (no memberships, missing cookie, etc.)
            return NextResponse.json({ jurisdictionId: null, ratePerTco2: null, currency: 'USD' });
        }
    }

    // ── Step 2: query active MARITIME tariff ──────────────────────────────────

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const { data: tariffRow, error: tariffError } = await supabase
        .from('tariffs')
        .select('rate_per_tco2, currency')
        .eq('jurisdiction_id', jurisdictionId)
        .eq('mode', 'MARITIME')
        .eq('status', 'ACTIVE')
        .lte('effective_from', today)
        .or(`effective_to.is.null,effective_to.gte.${today}`)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (tariffError) {
        console.error('[tariff] tariffs query failed', tariffError);
        return NextResponse.json({ jurisdictionId, ratePerTco2: null, currency: 'USD' });
    }

    return NextResponse.json({
        jurisdictionId,
        ratePerTco2: tariffRow ? Number(tariffRow.rate_per_tco2) : null,
        currency: tariffRow?.currency ?? 'USD',
    });
}
