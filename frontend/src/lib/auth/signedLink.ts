// ─────────────────────────────────────────────────────────────────────────────
// Signed login links — HS256 JWT envelopes consumed by /auth/sl
// ─────────────────────────────────────────────────────────────────────────────
//
// Server-side helper to mint signed JWT envelopes that /auth/sl/route.ts
// verifies and exchanges for a fresh Supabase OTP session. Mirrors the
// offline scripts/gen-signed-link.mjs but reusable from API routes (e.g.
// the invite-armateur flow).
//
// Format:
//   header  = { alg: 'HS256', typ: 'JWT' }
//   payload = { iss: 'greengate-signed-link', sub: email, email, iat, exp }
//   token   = base64url(header) + '.' + base64url(payload) + '.' + base64url(signature)
//   url     = ${origin}/auth/sl?t=${token}[&r=${redirectPath}]
//
// The optional `r` (redirect) param tells /auth/sl where to send the user
// after the session is established. It MUST be a same-origin path (e.g.
// '/auth/setup-password'); /auth/sl validates this strictly.
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac } from 'crypto';

export interface SignedLinkPayload {
    iss: 'greengate-signed-link';
    sub: string;     // email
    email: string;
    iat: number;
    exp: number;
}

function b64url(buf: Buffer | string): string {
    const b = typeof buf === 'string' ? Buffer.from(buf) : buf;
    return b.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Create a signed login URL for `email`.
 *
 * @param email - The recipient's email. Embedded as `sub` and `email` claims.
 * @param origin - Public origin (e.g. https://greengate.africa). The link is
 *                 anchored to this origin so the recipient lands on the
 *                 right environment when they click.
 * @param opts.ttlHours - Link validity in hours. Defaults to 6.
 * @param opts.redirectPath - Optional same-origin path to redirect to AFTER
 *                            the session is established (e.g. /auth/setup-password).
 *                            Must start with '/' — anything else is rejected.
 *
 * Throws if SIGNED_LINK_SECRET is not configured. Throws on invalid
 * redirectPath (caller should validate input first).
 */
export function createSignedLoginUrl(
    email: string,
    origin: string,
    opts: { ttlHours?: number; redirectPath?: string } = {},
): string {
    const secret = process.env.SIGNED_LINK_SECRET;
    if (!secret) {
        throw new Error('SIGNED_LINK_SECRET is not configured');
    }

    const ttlHours = opts.ttlHours ?? 6;
    const now = Math.floor(Date.now() / 1000);
    const payload: SignedLinkPayload = {
        iss: 'greengate-signed-link',
        sub: email,
        email,
        iat: now,
        exp: now + ttlHours * 3600,
    };

    const headerB64 = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payloadB64 = b64url(JSON.stringify(payload));
    const signature = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest();
    const signatureB64 = b64url(signature);
    const token = `${headerB64}.${payloadB64}.${signatureB64}`;

    const base = origin.replace(/\/+$/, '');
    let url = `${base}/auth/sl?t=${token}`;

    if (opts.redirectPath) {
        if (!opts.redirectPath.startsWith('/')) {
            throw new Error('redirectPath must start with "/" (same-origin path)');
        }
        url += `&r=${encodeURIComponent(opts.redirectPath)}`;
    }

    return url;
}
