import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Rafraichit la session et renvoie l'utilisateur courant.
 *
 * Degradation volontaire : toute defaillance ici rend `user: null` au lieu de
 * lever. Le middleware s'execute sur TOUTES les routes, donc une exception
 * mettait a terre l'integralite du site — y compris les pages entierement
 * publiques (/legal-basis, /pay, /how-to-pay) qui n'ont besoin d'aucune
 * authentification.
 *
 * C'est arrive en production le 2026-08-20 : MIDDLEWARE_INVOCATION_FAILED sur
 * chaque route, 500 partout, alors que le deploiement lui-meme etait sain
 * (/favicon.ico, hors matcher, repondait 200).
 *
 * Le `!` sur les variables d'environnement n'est qu'une assertion TypeScript :
 * a l'execution, `createServerClient` leve si l'URL ou la cle manquent — ce qui
 * arrive quand le projet Vercel n'a pas ses variables au moment du build, les
 * NEXT_PUBLIC_* etant inlinees a ce moment-la.
 *
 * Rendre `user: null` fait echouer l'authentification du bon cote : les routes
 * protegees redirigent vers /login, les routes publiques continuent de servir.
 */
export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({ request });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
        console.error(
            '[middleware] configuration Supabase absente — session non resolue, ' +
            'les routes protegees redirigeront vers /login',
        );
        return { supabaseResponse, user: null };
    }

    const supabase = createServerClient(
        url,
        anonKey,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll();
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
                    supabaseResponse = NextResponse.next({ request });
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    );
                },
            },
        }
    );

    // Refresh session — do not add logic between createServerClient and getUser
    try {
        const { data: { user } } = await supabase.auth.getUser();
        return { supabaseResponse, user };
    } catch (err) {
        // Panne reseau ou Supabase injoignable : on degrade au lieu de rendre
        // le site entier indisponible.
        console.error('[middleware] echec de resolution de session:', err);
        return { supabaseResponse, user: null };
    }
}
