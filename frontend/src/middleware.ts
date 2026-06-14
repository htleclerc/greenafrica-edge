import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { createPlatformClient } from '@/lib/supabase/tenant';

// Routes that require authentication
// /auth/setup-password is here because it's reached AFTER /auth/sl has
// established a Supabase session — visiting it without auth means the
// invitation link is expired or the cookies were cleared; bounce to /login.
const PROTECTED_PREFIXES = ['/dashboard', '/admin', '/auth/setup-password'];

// Owner portal: same gate; unauthenticated visits redirect to the unified /login.
// /owner/login is kept in OWNER_PUBLIC_PATHS so it stays reachable as a server
// redirect that preserves legacy invitation links.
const OWNER_PROTECTED_PREFIX = '/owner';
const OWNER_PUBLIC_PATHS = ['/owner/login', '/owner/register', '/owner/onboarding', '/owner/auth/callback', '/owner/reset-password'];

// Phase 2 — /owner/* surface relocation.
//
// The operator shell has been merged into /dashboard. Bookmarked /owner/* URLs
// and any links still stored in emails or the DB now receive a permanent (301)
// redirect to the canonical /dashboard/* path.
//
// Excluded from redirection (kept functional at their original paths):
//   /owner/register        — onboarding self-service entry point
//   /owner/onboarding/*   — multi-step onboarding wizard
//   /owner/reset-password — password reset flow
//   /owner/auth/callback  — OAuth / magic-link callback
//   /owner/login          — legacy login (still used by invitation emails)
//
// Order matters: longer/more-specific patterns first.
const OWNER_REDIRECTS: Array<[string, string]> = [
    ['/owner/dashboard',      '/dashboard'],
    ['/owner/vessels',        '/dashboard/vessels'],
    ['/owner/invoices',       '/dashboard/invoices'],
    ['/owner/alerts',         '/dashboard/alerts'],
    ['/owner/disputes',       '/dashboard/disputes'],
    ['/owner/wallet',         '/dashboard/wallet'],
    ['/owner/notifications',  '/dashboard/notifications'],
    ['/owner/simulator',      '/dashboard/simulator'],
    ['/owner/tco',            '/dashboard/tco'],
];

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
//
// Note (Phase 2): this gate now covers only the /owner/* paths that were NOT
// relocated to /dashboard (register, onboarding, login, reset-password, auth
// callback). The main operator surfaces are now under /dashboard and are
// protected by the standard auth gate — they are not behind this feature flag.
let _flagCache: { portalV1Enabled: boolean; expiresAt: number } | null = null;
const FLAG_CACHE_TTL_MS = 60_000;

async function getPortalV1FlagCached(): Promise<boolean> {
    const now = Date.now();
    if (_flagCache && _flagCache.expiresAt > now) {
        return _flagCache.portalV1Enabled;
    }

    // `app_config` is a global control-plane table — the UNSCOPED platform
    // factory is correct. It throws when the service-role env is missing; that
    // and any read error fall through to fail-OPEN (see module comment).
    // supabase-js runs in the Edge runtime here (updateSession already does).
    try {
        const admin = createPlatformClient();
        const { data, error } = await admin
            .from('app_config')
            .select('value')
            .eq('key', 'feature.shipowner_portal_v1_enabled')
            .maybeSingle<{ value: unknown }>();
        if (error) {
            _flagCache = { portalV1Enabled: true, expiresAt: now + FLAG_CACHE_TTL_MS };
            return true;
        }
        const enabled = data?.value === true;
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

    // ── Phase 2: permanent redirects for relocated /owner/* surfaces ──────────
    // Apply before any auth check so even unauthenticated bookmarks land on the
    // right URL (they'll be bounced to /login from /dashboard if not logged in).
    for (const [from, to] of OWNER_REDIRECTS) {
        if (pathname === from || pathname.startsWith(`${from}/`)) {
            const url = request.nextUrl.clone();
            // Preserve any sub-path suffix (e.g. /owner/vessels/123 → /dashboard/vessels/123)
            url.pathname = to + pathname.slice(from.length);
            url.search = request.nextUrl.search;
            return NextResponse.redirect(url, 301);
        }
    }

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

    // Owner portal — unauthenticated visits go to the unified /login.
    if (isOwnerProtected && !user) {
        const url = request.nextUrl.clone();
        url.pathname = '/login';
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
