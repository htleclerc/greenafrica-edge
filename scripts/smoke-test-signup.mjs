// Live smoke test for B1 + B2 + P1.4
//
// Exercises against the *running* dev server + hosted Supabase:
//   1. POST /api/auth/register with a fresh email + form role FLEET_MANAGER
//   2. Verify DB state: auth.users created, profiles.role mapped to
//      SHIPPING_AGENT (NOT 'FLEET_MANAGER'), is_active=false,
//      registration_requests.requested_role='FLEET_MANAGER', status='PENDING'
//   3. Simulate the approve route's effect (the route itself is cookie-gated,
//      hard to script — but the logic post-fix is just `UPDATE profiles SET
//      is_active=true`). The B2 unit tests already prove the route doesn't
//      write `role`; here we validate the DB-level outcome.
//   4. Verify the user can authenticate via Supabase signInWithPassword.
//   5. Cleanup: delete auth.users + profiles + registration_requests rows.
//
// Also probes the rate limiter (P1.4) by firing a few duplicate requests at
// the end. Fail-open in dev (no Upstash) so we just confirm 200/409 not 500.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('frontend/.env.local', 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1].trim();

const SUPABASE_URL = get('NEXT_PUBLIC_SUPABASE_URL');
const SERVICE_ROLE = get('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = get('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const APP_URL = 'http://127.0.0.1:3300';

if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
  console.error('[smoke] missing env');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

const stamp = Date.now();
const email = `smoke-test-${stamp}@africgreen.test`;
const password = `Smoke!Test${stamp}`;
const fullName = `Smoke Test ${stamp}`;

async function step(name, fn) {
  process.stdout.write(`[${name}] ... `);
  try {
    const result = await fn();
    console.log('✅', result ?? '');
    return result;
  } catch (e) {
    console.log('❌', e.message);
    throw e;
  }
}

let userId;
let regId;

try {
  // ── 1. Register ──────────────────────────────────────────────────────
  await step('register', async () => {
    const res = await fetch(`${APP_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        fullName,
        role: 'FLEET_MANAGER',           // form role — should map to SHIPPING_AGENT
        entityType: 'SHIPPING_AGENT',    // matches registration_entity_type enum
        orgName: 'Smoke Shipping Co',
        registryId: 'SMK-001',
        jurisdiction: 'SO',
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${JSON.stringify(body)}`);
    userId = body.userId;
    return `userId=${userId}`;
  });

  // ── 2. DB state — profile + registration_requests ────────────────────
  await step('verify profile.role mapped (FLEET_MANAGER → SHIPPING_AGENT)', async () => {
    const { data, error } = await admin
      .from('profiles').select('role, is_active, email').eq('id', userId).single();
    if (error) throw error;
    if (data.role !== 'SHIPPING_AGENT') throw new Error(`expected SHIPPING_AGENT, got ${data.role}`);
    if (data.is_active !== false) throw new Error(`expected is_active=false, got ${data.is_active}`);
    return `role=${data.role} is_active=${data.is_active}`;
  });

  await step('verify registration_requests.requested_role preserves form role', async () => {
    const { data, error } = await admin
      .from('registration_requests').select('id, requested_role, status, contact_email')
      .eq('contact_email', email).single();
    if (error) throw error;
    if (data.requested_role !== 'FLEET_MANAGER') throw new Error(`expected FLEET_MANAGER, got ${data.requested_role}`);
    if (data.status !== 'PENDING') throw new Error(`expected PENDING, got ${data.status}`);
    regId = data.id;
    return `regId=${regId} requested_role=${data.requested_role} status=${data.status}`;
  });

  // ── 3. Approve effect (post-B2-fix logic) ───────────────────────────
  await step('approve (simulate post-fix behaviour: only flip is_active)', async () => {
    const { error } = await admin.from('profiles').update({ is_active: true }).eq('id', userId);
    if (error) throw error;
    await admin.from('registration_requests').update({ status: 'APPROVED', reviewed_at: new Date().toISOString() }).eq('id', regId);
    return 'is_active=true, status=APPROVED';
  });

  await step('verify role still SHIPPING_AGENT after approve', async () => {
    const { data } = await admin.from('profiles').select('role, is_active').eq('id', userId).single();
    if (data.role !== 'SHIPPING_AGENT') throw new Error(`role corrupted: ${data.role}`);
    if (data.is_active !== true) throw new Error(`is_active not set: ${data.is_active}`);
    return `role=${data.role} is_active=${data.is_active}`;
  });

  // ── 4. User can authenticate ────────────────────────────────────────
  await step('signInWithPassword', async () => {
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!data.session?.access_token) throw new Error('no session token');
    return `session=${data.session.access_token.slice(0, 20)}...`;
  });

  // ── 5. Rate limiter probe ───────────────────────────────────────────
  await step('rate-limit probe (5 fast registers — should all 409 dup, no 500)', async () => {
    const codes = [];
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${APP_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email, password, fullName, role: 'FLEET_MANAGER',
          entityType: 'SHIPPING_AGENT', orgName: 'Smoke Shipping Co',
        }),
      });
      codes.push(r.status);
    }
    if (codes.some((c) => c === 500)) throw new Error(`got 500: ${codes.join(',')}`);
    return `codes=${codes.join(',')}`;
  });
} finally {
  // ── Cleanup ─────────────────────────────────────────────────────────
  console.log('\n[cleanup]');
  if (regId) {
    const { error } = await admin.from('registration_requests').delete().eq('id', regId);
    console.log(error ? `  registration_requests: ❌ ${error.message}` : '  registration_requests: ✅');
  }
  if (userId) {
    const { error: pErr } = await admin.from('profiles').delete().eq('id', userId);
    console.log(pErr ? `  profiles: ❌ ${pErr.message}` : '  profiles: ✅');
    const { error: aErr } = await admin.auth.admin.deleteUser(userId);
    console.log(aErr ? `  auth.users: ❌ ${aErr.message}` : '  auth.users: ✅');
  }
}

console.log('\n[smoke] done.');
