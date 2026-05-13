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

// Plan 7H-1 Task 5.4 — master switch for the owner portal.
//
// React's `cache()` doesn't work in the Edge runtime (no render context).
// We layer a module-scoped TTL cache on top of a direct PostgREST SELECT
// against `app_config`. 60s TTL bounds the staleness window: an admin who
// flips the toggle in /admin/feature-flags sees the effect on owner routes
// within one minute.
//
// Failure mode: **fail-OPEN**. If env vars are missing, the network errors,
// or the DB returns a non-2xx, we default to portal ENABLED. The reasoning:
// the kill switch is a soft, operator-driven flag; a misconfigured DB read
// should not lock the whole portal out of mid-session users. A genuine
// emergency kill = redeploy with this middleware hard-coded.
let _flagCache: { portalV1Enabled: boolean; expiresAt: number } | null = null;
const FLAG_CACHE_TTL_MS = 60_000;

async function getPortalV1FlagCached(): Promise<boolean> {
    const now = Date.now();
    if (_flagCache && _flagCache.expiresAt > now) {
        return _flagCache.portalV1Enabled;
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        // Env missing → fail-open. Cache the answer to avoid hammering on
        // every request in a misconfigured environment.
        _flagCache = { portalV1Enabled: true, expiresAt: now + FLAG_CACHE_TTL_MS };
        return true;
    }

    try {
        const res = await fetch(
            `${url}/rest/v1/app_config?key=eq.feature.shipowner_portal_v1_enabled&select=value`,
            {
                headers: { apikey: key, Authorization: `Bearer ${key}` },
                // Edge fetch — no Node-specific options.
            },
        );
        if (!res.ok) {
            _flagCache = { portalV1Enabled: true, expiresAt: now + FLAG_CACHE_TTL_MS };
            return true;
        }
        const rows = (await res.json()) as Array<{ value: unknown }>;
        const enabled = rows.length > 0 && rows[0]?.value === true;
        _flagCache = { portalV1Enabled: enabled, expiresAt: now + FLAG_CACHE_TTL_MS };
        return enabled;
    } catch {
        _flagCache = { portalV1Enabled: true, expiresAt: now + FLAG_CACHE_TTL_MS };
        return true;
    }
}

// Routes that authenticated users shouldn't visit (redirect to /dashboard if logged in)
const AUTH_ROUTES = ['/login', '/post-login'];

// Public auth routes — accessible whether logged in or not
const PUBLIC_AUTH_ROUTES = ['/forgot-password', '/reset-password', '/pending-approval', '/auth/callback'];

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Plan 7H-1 Task 5.4 — master switch for the owner portal.
    // When `feature.shipowner_portal_v1_enabled` is false, all /owner/* paths
    // EXCEPT /owner/login and /owner/auth/* redirect to /login?portal_disabled=1.
    // The login pages stay reachable so an owner in the middle of a flow can
    // log out cleanly; auth callback stays reachable so OAuth round-trips
    // don't break. Per-request cost is bounded by a 60s TTL cache.
    const isOwnerLogin = pathname === '/owner/login' || pathname.startsWith('/owner/login/');
    const isOwnerAuthCallback = pathname.startsWith('/owner/auth/');
    if (pathname.startsWith('/owner/') && !isOwnerLogin && !isOwnerAuthCallback) {
        const portalEnabled = await getPortalV1FlagCached();
        if (!portalEnabled) {
            const url = request.nextUrl.clone();
            url.pathname = '/login';
            url.searchParams.set('portal_disabled', '1');
            return NextResponse.redirect(url);
        }
    }

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
