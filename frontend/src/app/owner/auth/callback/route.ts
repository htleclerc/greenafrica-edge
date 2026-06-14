import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient } from '@/lib/supabase/tenant';

/**
 * Owner-portal magic-link callback.
 *
 * Flow:
 *   1. Supabase redirects here after the user clicks the magic link.
 *      Either ?code=... (PKCE-style) or ?token_hash=... + type=...
 *   2. Exchange the code/token for a session (writes auth cookies).
 *   3. If the linked profile is a SHIPOWNER and the matching shipowners
 *      row is in INVITED state, flip account_state to ACTIVE.
 *   4. Redirect to /owner/dashboard.
 *
 * Errors during exchange route the user back to /login with an
 * error code so they can request a fresh link.
 */
export async function GET(request: NextRequest) {
    const { searchParams, origin } = request.nextUrl;
    const code = searchParams.get('code');
    const tokenHash = searchParams.get('token_hash');
    const type = searchParams.get('type'); // magiclink | invite | recovery | email

    if (!code && !tokenHash) {
        return NextResponse.redirect(`${origin}/login?error=callback_failed`);
    }

    const response = NextResponse.next({ request });

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll();
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) =>
                        request.cookies.set(name, value),
                    );
                    cookiesToSet.forEach(({ name, value, options }) =>
                        response.cookies.set(name, value, options),
                    );
                },
            },
        },
    );

    let userId: string | null = null;

    if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error || !data.user) {
            return NextResponse.redirect(`${origin}/login?error=callback_failed`);
        }
        userId = data.user.id;
    } else if (tokenHash && type) {
        const { data, error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            // 'invite', 'magiclink', 'recovery', 'email' are all acceptable here
            type: type as 'magiclink' | 'invite' | 'recovery' | 'email',
        });
        if (error || !data.user) {
            return NextResponse.redirect(`${origin}/login?error=callback_failed`);
        }
        userId = data.user.id;
    }

    if (!userId) {
        return NextResponse.redirect(`${origin}/login?error=callback_failed`);
    }

    // Flip INVITED → ACTIVE on first successful redeem. Use the service role:
    // the user's own session would be denied by RLS for the UPDATE because
    // mig 024 + 033 only grant SELECT on shipowners to owners.
    // First-redeem flip on the user's OWN shipowner row, keyed by the
    // globally-unique profile_id. There is no tenant context at callback time
    // (the session was just minted) and we cannot resolve a jurisdiction before
    // the row is ACTIVE — so the UNSCOPED platform client is correct here.
    // Non-fatal if env is missing: the next requireOwner() call surfaces it.
    let admin: SupabaseClient | null = null;
    try {
        admin = createPlatformClient();
    } catch {
        admin = null;
    }
    if (admin) {
        await admin
            .from('shipowners')
            .update({ account_state: 'ACTIVE' })
            .eq('profile_id', userId)
            .eq('account_state', 'INVITED');
    }

    // Redirect into the portal with the cookies set on `response`.
    const redirectResp = NextResponse.redirect(`${origin}/dashboard`);
    response.cookies.getAll().forEach((c) => {
        redirectResp.cookies.set(c.name, c.value, c);
    });
    return redirectResp;
}
