// Generates a signed HS256 JWT wrapped in a /auth/sl?t=... URL.
// The server route verifies the signature, mints a fresh Supabase OTP,
// and sets session cookies — all server-side. The link itself is valid
// for SIGNED_LINK_TTL_HOURS (default 6h).

import { createHmac, randomBytes } from 'crypto';
import { existsSync, readFileSync, appendFileSync } from 'fs';
import { resolve } from 'path';

const EMAIL      = process.argv[2] || 'sadmin@greengate.africa';
const BASE_URL   = process.argv[3] || 'https://greengate.africa';
const TTL_HOURS  = parseInt(process.env.SIGNED_LINK_TTL_HOURS || '6', 10);

const envPath = resolve('frontend/.env.local');
const envText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';

let secret = (envText.match(/^SIGNED_LINK_SECRET=(.+)$/m) || [])[1];
if (!secret) {
    secret = randomBytes(32).toString('base64url');
    appendFileSync(envPath, `\n# Secret for /auth/sl custom signed login links\nSIGNED_LINK_SECRET=${secret}\n`);
    console.log(`ℹ️  Generated new SIGNED_LINK_SECRET and appended to ${envPath}`);
    console.log('   → Restart the Next.js dev server so the route picks it up.');
}

function b64url(buf) {
    return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

const now = Math.floor(Date.now() / 1000);
const header  = { alg: 'HS256', typ: 'JWT' };
const payload = {
    iss: 'greengate-signed-link',
    sub: EMAIL,
    email: EMAIL,
    iat: now,
    exp: now + TTL_HOURS * 3600,
};

const headerB64  = b64url(JSON.stringify(header));
const payloadB64 = b64url(JSON.stringify(payload));
const signature  = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest();
const signatureB64 = b64url(signature);

const token = `${headerB64}.${payloadB64}.${signatureB64}`;
const url   = `${BASE_URL.replace(/\/$/, '')}/auth/sl?t=${token}`;

const expiryDate = new Date((now + TTL_HOURS * 3600) * 1000);

console.log('');
console.log('✅ Signed login link generated');
console.log(`   Email:    ${EMAIL}`);
console.log(`   TTL:      ${TTL_HOURS}h`);
console.log(`   Expires:  ${expiryDate.toISOString()}`);
console.log('');
console.log(url);
console.log('');
