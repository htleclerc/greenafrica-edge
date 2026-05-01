import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Routes that require authentication
// /auth/setup-password is here because it's reached AFTER /auth/sl has
// established a Supabase session — visiting it without auth means the
// invitation link is expired or the cookies were cleared; bounce to /login.
const PROTECTED_PREFIXES = ['/dashboard', '/admin', '/auth/setup-password'];

// Owner portal: same gate, but unauthenticated visits go to /owner/login
// (NOT /login — staff and owner entry points are deliberately separate).
const OWNER_PROTECTED_PREFIX = '/owner';
const OWNER_PUBLIC_PATHS = ['/owner/login', '/owner/register', '/owner/auth/callback'];

// Routes that authenticated users shouldn't visit (redirect to /dashboard if logged in)
const AUTH_ROUTES = ['/login', '/post-login'];

// Public auth routes — accessible whether logged in or not
const PUBLIC_AUTH_ROUTES = ['/forgot-password', '/reset-password', '/pending-approval', '/auth/callback'];

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Demo mode: gated by the build-time NEXT_PUBLIC_DEMO_ALLOWED flag.
    // Demo only reveals mock data (no real DB access, no real auth surface),
    // so the public flag is a sufficient kill-switch — an attacker forging
    // demo_active=true in a deployment where the flag is off still gets
    // redirected to /login. If DEMO_SECRET is configured we *also* accept a
    // cookie whose value matches it, preserving the stricter server-issued
    // path for hardened deployments.
    const demoAllowed = process.env.NEXT_PUBLIC_DEMO_ALLOWED === 'true';
    const demoCookie = request.cookies.get('demo_active')?.value;
    const demoSecret = process.env.DEMO_SECRET;
    const isDemo =
        (demoAllowed && demoCookie === 'true')
        || (!!demoSecret && demoCookie === demoSecret);

    const { supabaseResponse, user } = await updateSession(request);

    const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
    const isAuthRoute = AUTH_ROUTES.some((p) => pathname.startsWith(p));
    const isPublicAuth = PUBLIC_AUTH_ROUTES.some((p) => pathname.startsWith(p));

    const isOwnerPublic = OWNER_PUBLIC_PATHS.some(
        (p) => pathname === p || pathname.startsWith(`${p}/`),
    );
    const isOwnerProtected =
        pathname.startsWith(OWNER_PROTECTED_PREFIX) && !isOwnerPublic;

    // Public auth routes — always pass through
    if (isPublicAuth || isOwnerPublic) {
        return supabaseResponse;
    }

    // Owner portal — unauthenticated visits redirect to /owner/login (not /login)
    if (isOwnerProtected && !user) {
        const url = request.nextUrl.clone();
        url.pathname = '/owner/login';
        url.searchParams.set('redirectTo', pathname);
        return NextResponse.redirect(url);
    }

    // Not logged in AND not in demo → redirect to /login
    if (isProtected && !user && !isDemo) {
        const url = request.nextUrl.clone();
        url.pathname = '/login';
        url.searchParams.set('redirectTo', pathname);
        return NextResponse.redirect(url);
    }

    // Already logged in → skip auth pages, go to dashboard
    if (isAuthRoute && user && !request.nextUrl.searchParams.has('redirectTo')) {
        const url = request.nextUrl.clone();
        url.pathname = '/dashboard';
        return NextResponse.redirect(url);
    }

    return supabaseResponse;
}

export const config = {
    matcher: [
        /*
         * Match all request paths except:
         * - _next/static, _next/image, favicon.ico, public assets
         */
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
};
