// ─────────────────────────────────────────────────────────────────────────────
// Server-side role enforcement helper for the shipowner portal.
// ─────────────────────────────────────────────────────────────────────────────
//
// Use at the top of EVERY /owner/* server component to assert the caller is
// an authenticated SHIPOWNER linked to a shipowners row in ACTIVE state.
//
// Differs from requireRole() in three ways:
//   1. Redirects to /owner/login (not /login) on auth failure — staff and
//      owner portals must not bleed into each other.
//   2. Returns the shipowner record alongside the user, so pages don't have
//      to re-query.
//   3. Asserts account_state='ACTIVE' — INVITED owners who haven't redeemed
//      their magic link yet are bounced.
// ─────────────────────────────────────────────────────────────────────────────

import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import type { ShipownerListRow } from '@/services/shipownerService';

export interface OwnerSession {
    userId: string;
    email: string;
    shipowner: ShipownerListRow;
    /** The operator's home jurisdiction (GreenGate v8, Model B). Pass to createTenantClient(). */
    jurisdictionId: string;
    supabase: SupabaseClient;
}

export async function requireOwner(): Promise<OwnerSession> {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) redirect('/owner/login');

    // Look up the shipowners row attached to this profile. Single source of
    // truth — RLS ensures we can only see our own row.
    const { data: shipowner, error } = await supabase
        .from('shipowners')
        .select('id, name, country_code, address, official_email, official_email_source, account_state, profile_id, imo_company_no, invited_at, kyc_level_c_completed_at, aoc_number, jurisdiction_id')
        .eq('profile_id', user.id)
        .maybeSingle();

    if (error || !shipowner) {
        // Either profile_id wasn't set (corrupt invite) or auth user has no
        // matching shipowner — log out and bounce.
        await supabase.auth.signOut();
        redirect('/owner/login?error=no_owner_record');
    }

    if (shipowner.account_state !== 'ACTIVE') {
        // Invitation issued but never redeemed, or admin revoked access.
        // Sign out so refresh doesn't loop, then send to login with hint.
        await supabase.auth.signOut();
        redirect(`/owner/login?error=state_${shipowner.account_state.toLowerCase()}`);
    }

    return {
        userId: user.id,
        email: user.email ?? shipowner.official_email ?? '',
        shipowner: shipowner as ShipownerListRow,
        jurisdictionId: (shipowner as unknown as { jurisdiction_id: string }).jurisdiction_id,
        supabase,
    };
}
