/**
 * E2E auth helper — programmatic session bootstrap.
 *
 * Sidesteps the magic-link UI by using the Supabase admin API to:
 *   1. createUser({email, password, email_confirm: true})
 *   2. signInWithPassword to mint access + refresh tokens
 *   3. setSessionCookies(page, session) writes the @supabase/ssr cookie
 *      so subsequent `page.goto()` calls are authenticated.
 *
 * Cookie format discovered by inspecting node_modules/@supabase/ssr/dist:
 *   - Cookie name: `sb-${projectRef}-auth-token` (from storageKey default
 *     in @supabase/supabase-js; ssr forwards storage with that key).
 *   - Cookie value: `base64-${base64url(JSON.stringify(session))}` —
 *     the ssr client writes with cookieEncoding="base64url" by default
 *     (see createServerClient.js: `cookieEncoding: options?.cookieEncoding ?? "base64url"`).
 *   - Session shape mirrors supabase-js' Session: access_token, refresh_token,
 *     expires_at, expires_in, token_type, user.
 *
 * Profiles row: handle_new_user() trigger (mig 001) auto-INSERTs profiles
 * on auth.users insert, reading `role` from raw_user_meta_data. We pass it
 * via createUser's user_metadata and then upsert the row to flip is_active=true
 * (the trigger defaults to false).
 */

import { createClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';
import { randomBytes } from 'crypto';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
        '[e2e/auth] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set'
    );
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
});

export type TestRole = 'SHIPOWNER' | 'FINANCE_ADMIN' | 'SUPERADMIN' | 'PORT_OFFICER';

export interface TestSession {
    userId: string;
    email: string;
    role: TestRole;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
}

/**
 * Base64url-encode a UTF-8 string. Matches the encoder used by @supabase/ssr
 * (utils/base64url.ts → stringToBase64URL).
 */
function stringToBase64Url(value: string): string {
    return Buffer.from(value, 'utf-8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function getProjectRef(): string {
    return new URL(SUPABASE_URL!).hostname.split('.')[0];
}

export async function createTestUser(opts: {
    email: string;
    role?: TestRole;
    /** If provided, after profile creation we UPDATE shipowners.profile_id = userId. */
    shipownerId?: string;
}): Promise<TestSession> {
    const role: TestRole = opts.role ?? 'SHIPOWNER';
    const password = `Test_${randomBytes(12).toString('hex')}!Aa1`;

    // 1. Create auth user. handle_new_user() trigger auto-INSERTs a profiles row
    //    reading role + is_active from raw_user_meta_data.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: opts.email,
        password,
        email_confirm: true,
        user_metadata: {
            role,
            full_name: `E2E Test (${role})`,
            is_active: true,
        },
    });
    if (createErr || !created.user) {
        throw new Error(`[e2e/auth] createUser failed: ${createErr?.message ?? 'unknown'}`);
    }
    const userId = created.user.id;

    // 2. The trigger's INSERT ... ON CONFLICT DO NOTHING does NOT update existing
    //    rows. UPSERT the profile to ensure role + is_active + full_name are set
    //    (defensive — if the trigger's logic ever changes, we're insulated).
    const { error: upsertErr } = await admin
        .from('profiles')
        .upsert(
            {
                id: userId,
                email: opts.email,
                full_name: `E2E Test (${role})`,
                role,
                is_active: true,
            },
            { onConflict: 'id' }
        );
    if (upsertErr) {
        throw new Error(`[e2e/auth] profile upsert failed: ${upsertErr.message}`);
    }

    // 3. Optionally link to a pre-seeded shipowner row.
    if (opts.shipownerId) {
        const { error: linkErr } = await admin
            .from('shipowners')
            .update({ profile_id: userId, account_state: 'ACTIVE' })
            .eq('id', opts.shipownerId);
        if (linkErr) {
            throw new Error(`[e2e/auth] shipowner link failed: ${linkErr.message}`);
        }
    }

    // 4. Sign in via password to mint tokens. Use an anon-key client so we go
    //    through the auth endpoint, not the admin API.
    if (!ANON_KEY) {
        throw new Error('[e2e/auth] NEXT_PUBLIC_SUPABASE_ANON_KEY required for sign-in');
    }
    const userClient = createClient(SUPABASE_URL!, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signed, error: signErr } = await userClient.auth.signInWithPassword({
        email: opts.email,
        password,
    });
    if (signErr || !signed.session) {
        throw new Error(`[e2e/auth] signIn failed: ${signErr?.message ?? 'no session'}`);
    }

    return {
        userId,
        email: opts.email,
        role,
        accessToken: signed.session.access_token,
        refreshToken: signed.session.refresh_token,
        expiresAt: signed.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    };
}

/**
 * Set the @supabase/ssr auth cookie on the page's browser context so that
 * `page.goto(authedPath)` is treated as a logged-in user.
 *
 * Format (verified against node_modules/@supabase/ssr/dist/main/cookies.js):
 *   cookie name  = `sb-${projectRef}-auth-token`
 *   cookie value = `base64-${base64url(JSON.stringify(sessionPayload))}`
 *
 * sessionPayload mirrors the supabase-js Session object that the storage
 * adapter writes via setItem (the storage key is the cookie name).
 */
export async function setSessionCookies(page: Page, session: TestSession): Promise<void> {
    const projectRef = getProjectRef();
    const cookieName = `sb-${projectRef}-auth-token`;

    const sessionPayload = {
        access_token: session.accessToken,
        refresh_token: session.refreshToken,
        expires_at: session.expiresAt,
        expires_in: Math.max(0, session.expiresAt - Math.floor(Date.now() / 1000)),
        token_type: 'bearer',
        user: { id: session.userId, email: session.email },
    };

    const cookieValue = `base64-${stringToBase64Url(JSON.stringify(sessionPayload))}`;

    // Derive cookie domain from baseURL. For localhost we set domain=localhost
    // (Playwright requires either url or domain+path).
    const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3300';
    const url = new URL(baseUrl);

    await page.context().addCookies([
        {
            name: cookieName,
            value: cookieValue,
            domain: url.hostname,
            path: '/',
            httpOnly: false,
            secure: url.protocol === 'https:',
            sameSite: 'Lax',
            expires: session.expiresAt,
        },
    ]);
}

/**
 * Returns headers for direct API calls (Playwright `request.fetch`) when
 * cookie injection is too brittle for a given route.
 */
export function authedHeaders(session: TestSession): { Authorization: string } {
    return { Authorization: `Bearer ${session.accessToken}` };
}

/**
 * Cleanup — deletes the auth user (which cascades to profiles via FK
 * `profiles.id REFERENCES auth.users(id) ON DELETE CASCADE`).
 */
export async function deleteTestUser(userId: string): Promise<void> {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
        // Log but don't throw — cleanup must continue.
        console.warn(`[e2e/auth] deleteTestUser ${userId} warning: ${error.message}`);
    }
}
