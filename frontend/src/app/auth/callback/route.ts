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
    // `/auth/setup-password` est dans la liste depuis que les invitations staff
    // passent par notre propre rail : c'est la page ou l'invite choisit son mot
    // de passe, et elle exige une session — donc d'etre atteinte APRES ce
    // callback, pas avant.
    const ALLOWED_PREFIXES = ['/dashboard', '/post-login', '/admin', '/settings', '/auth/setup-password'];
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

    /**
     * Les cookies de session sont posés sur `response`, un `NextResponse.next()`
     * que cette route ne renvoie JAMAIS : elle redirige. Sans ce report, la
     * session est vérifiée puis jetée, et l'utilisateur retombe sur /login
     * SANS message — le middleware le renvoie simplement comme non
     * authentifié, ce qui ne ressemble pas à une panne mais à un lien périmé.
     *
     * Mesuré en production le 2026-09-07 : le lien de connexion staff n'ouvrait
     * aucune session. Le callback armateur faisait déjà ce report ; celui-ci
     * l'avait toujours oublié, sur le chemin `code` comme sur `token_hash`.
     */
    const redirectTo = (target: string): NextResponse => {
        const redirectResp = NextResponse.redirect(target);
        response.cookies.getAll().forEach((c) => {
            redirectResp.cookies.set(c.name, c.value, c);
        });
        return redirectResp;
    };

    // Route based on the callback type
    if (type === 'recovery') {
        return redirectTo(`${origin}/reset-password`);
    }

    if (type === 'signup') {
        return redirectTo(`${origin}/pending-approval`);
    }

    return redirectTo(`${origin}${next}`);
}
