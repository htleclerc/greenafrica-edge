// ─────────────────────────────────────────────────────────────────────────────
// GET /api/simulator/tariff — active tariff for the caller's jurisdiction + mode
// ─────────────────────────────────────────────────────────────────────────────
//
// Auth strategy: inline (NOT requirePrincipal) so the route can return a clean
// 401 JSON response instead of triggering Next.js redirect() which cannot be
// caught in API route tests.
//
// Query params:
//   ?mode=MARITIME|AIR — which tariff matrix to read. Defaults to MARITIME when
//   absent or invalid (backwards compatible with the maritime-only simulator).
//
// Resolution order:
//   1. No session → 401
//   2. Shipowners row exists for this user:
//        ACTIVE   → operator path; use shipowners.jurisdiction_id
//        otherwise → fail-closed (no cross-path fallback); return null tariff
//   3. No shipowners row → staff path; call _getServerJurisdictionIdImpl
//        (uncached raw impl, avoids React cache() which does not work in API routes)
//   4. Jurisdiction resolution throws → { ratePerTco2: null, jurisdictionId: null }
//   5. Query tariffs for (jurisdictionId, mode, ACTIVE, today in range)
//
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { _getServerJurisdictionIdImpl } from '@/lib/auth/tenantContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Parse and validate the ?mode= param; defaults to MARITIME. */
function resolveMode(request: NextRequest): 'MARITIME' | 'AIR' {
    const raw = request.nextUrl.searchParams.get('mode');
    return raw === 'AIR' ? 'AIR' : 'MARITIME';
}

export async function GET(request: NextRequest) {
    const mode = resolveMode(request);
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── Step 1: resolve jurisdiction ──────────────────────────────────────────

    // Check if caller has a shipowner row (any state)
    const { data: shipownerRow, error: shipownerError } = await supabase
        .from('shipowners')
        .select('jurisdiction_id, account_state')
        .eq('profile_id', user.id)
        .maybeSingle();

    if (shipownerError) {
        console.error('[tariff] shipowners query failed', shipownerError);
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }

    let jurisdictionId: string | null = null;

    if (shipownerRow) {
        // Operator path — ACTIVE required; no fallback to staff for non-ACTIVE operators
        if (shipownerRow.account_state !== 'ACTIVE') {
            return NextResponse.json({ jurisdictionId: null, ratePerTco2: null, currency: 'USD' });
        }
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

    // ── Step 2: query active tariff for the requested mode ─────────────────────

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const { data: tariffRow, error: tariffError } = await supabase
        .from('tariffs')
        .select('rate_per_tco2, currency')
        .eq('jurisdiction_id', jurisdictionId)
        .eq('mode', mode)
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
