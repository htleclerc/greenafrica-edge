import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';

/**
 * GET /auth/sl?t=<signed-jwt>[&r=<same-origin-path>]
 *
 * Custom signed login link. The JWT (HS256) is generated offline via
 * scripts/gen-signed-link.mjs OR server-side via lib/auth/signedLink.ts
 * (used by the invite-armateur flow) and carries { email, exp }. On valid
 * signature + not-expired, we mint a fresh Supabase OTP via the admin API,
 * exchange it for a session, set cookies via the SSR helper, and redirect.
 *
 * Optional `r` param: same-origin path to redirect to after auth (defaults
 * to /dashboard). Used by invite flow to land users on /auth/setup-password
 * so they can set their initial password before reaching the dashboard.
 *
 * Why not use Supabase's magic link directly?
 *   - Supabase OTP_EXP is a project-wide setting (default 1h).
 *   - Supabase redirect_to requires the target to be in the allow-list.
 *
 * Our signed envelope has its own 6h expiry, and the browser never hits
 * Supabase's /auth/v1/verify — we do the exchange server-side.
 */
export async function GET(request: NextRequest) {
    const token = request.nextUrl.searchParams.get('t');
    if (!token) return badRequest('Missing token');

    const secret = process.env.SIGNED_LINK_SECRET;
    if (!secret) {
        console.error('[auth/sl] SIGNED_LINK_SECRET is not configured');
        return NextResponse.json({ error: 'Not configured' }, { status: 500 });
    }

    const parts = token.split('.');
    if (parts.length !== 3) return badRequest('Malformed token');
    const [headerB64, payloadB64, signatureB64] = parts;

    const expected = createHmac('sha256', secret)
        .update(`${headerB64}.${payloadB64}`)
        .digest();
    const provided = Buffer.from(signatureB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
        return badRequest('Invalid signature');
    }

    let payload: { email?: string; exp?: number; iss?: string };
    try {
        payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    } catch {
        return badRequest('Malformed payload');
    }

    if (payload.iss !== 'greengate-signed-link') return badRequest('Bad issuer');
    if (!payload.email) return badRequest('Missing email claim');
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
        return NextResponse.json({ error: 'Link expired' }, { status: 410 });
    }

    // Mint a fresh Supabase OTP for this email and exchange it server-side.
    // Platform auth operation (no tenant context) → sanctioned UNSCOPED client.
    let admin: SupabaseClient;
    try {
        admin = createPlatformClient();
    } catch {
        return NextResponse.json({ error: 'Not configured' }, { status: 500 });
    }

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: payload.email,
    });
    if (linkErr || !linkData?.properties?.hashed_token) {
        console.error('[auth/sl] generateLink failed:', linkErr);
        return NextResponse.json({ error: 'Could not issue session' }, { status: 500 });
    }

    const supabase = await createServerClient();
    const { error: verifyErr } = await supabase.auth.verifyOtp({
        type: 'magiclink',
        token_hash: linkData.properties.hashed_token,
    });
    if (verifyErr) {
        console.error('[auth/sl] verifyOtp failed:', verifyErr);
        return NextResponse.json({ error: 'Session exchange failed' }, { status: 500 });
    }

    // Resolve the post-auth redirect target. Defaults to /dashboard; the
    // optional `r` param lets a caller (e.g. invite flow) send the user
    // somewhere else first. We strictly require a same-origin path (starts
    // with '/' and is NOT a protocol-relative '//host' URL) — anything else
    // would be an open-redirect vulnerability.
    let redirectPath = '/dashboard';
    const rParam = request.nextUrl.searchParams.get('r');
    if (rParam && rParam.startsWith('/') && !rParam.startsWith('//')) {
        redirectPath = rParam;
    }

    const response = NextResponse.redirect(new URL(redirectPath, request.url));
    // Wipe any stale demo-mode flag so the real Supabase session is what the
    // RoleContext picks up. localStorage is cleared client-side in RoleContext.
    response.cookies.set('demo_active', '', { path: '/', maxAge: 0 });
    response.cookies.set('demo_role', '', { path: '/', maxAge: 0 });
    return response;
}

function badRequest(message: string): NextResponse {
    return NextResponse.json({ error: message }, { status: 400 });
}
