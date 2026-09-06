import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Handles Supabase Auth email callbacks:
 * - Password reset  → redirects to /reset-password
 * - Email confirm   → redirects to /login (or /pending-approval)
 * - Magic link      → redirects to /dashboard
 */
export async function GET(request: NextRequest) {
    const { searchParams, origin } = request.nextUrl;

    const code = searchParams.get('code');
    // `token_hash` n'est pas un doublon de `code` : les liens que NOUS
    // envoyons portent cette forme, parce que `action_link` de GoTrue dépose
    // le jeton dans un fragment que le serveur ne voit jamais. Le callback
    // armateur l'accepte depuis toujours ; celui-ci ne l'acceptait pas, et une
    // session staff ouverte par lien retombait sur /login sans un mot.
    const tokenHash = searchParams.get('token_hash');
    const type = searchParams.get('type');     // recovery | signup | magiclink
    const rawNext = searchParams.get('next') ?? '/dashboard';

    // Validate redirect target against allowlist to prevent open redirect
    const ALLOWED_PREFIXES = ['/dashboard', '/post-login', '/admin', '/settings'];
    const next = ALLOWED_PREFIXES.some((p) => rawNext.startsWith(p)) ? rawNext : '/dashboard';

    if (!code && !tokenHash) {
        return NextResponse.redirect(`${origin}/login`);
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
                        request.cookies.set(name, value)
                    );
                    cookiesToSet.forEach(({ name, value, options }) =>
                        response.cookies.set(name, value, options)
                    );
                },
            },
        }
    );

    const { error } = code
        ? await supabase.auth.exchangeCodeForSession(code)
        : await supabase.auth.verifyOtp({
            token_hash: tokenHash!,
            type: (type ?? 'magiclink') as 'magiclink' | 'invite' | 'recovery' | 'email',
        });

    if (error) {
        return NextResponse.redirect(
            `${origin}/login?error=auth_callback_failed`
        );
    }

    // Route based on the callback type
    if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/reset-password`);
    }

    if (type === 'signup') {
        return NextResponse.redirect(`${origin}/pending-approval`);
    }

    return NextResponse.redirect(`${origin}${next}`);
}
