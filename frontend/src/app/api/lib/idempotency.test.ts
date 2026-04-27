import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { acquireIdempotency, hashBody } from './idempotency';

// ── Supabase mock ────────────────────────────────────────────────────────────
//
// We model `idempotency_keys` as an in-memory map. The mock supports the
// minimal subset the helper uses:
//   - .from('idempotency_keys').insert(row)
//   - .from('idempotency_keys').select(cols).eq('key', x).single()
//   - .from('idempotency_keys').update(payload).eq('key', x)
//
// `insert` raises a synthetic 23505 (unique violation) when the key exists.

interface KeyRow {
    key: string;
    user_id: string;
    method: string;
    path: string;
    request_hash: string;
    state: 'in_progress' | 'completed' | 'failed';
    response_status: number | null;
    response_body: unknown;
    completed_at: string | null;
}

let store: Map<string, KeyRow>;

beforeEach(() => {
    store = new Map();
});

function buildSupabaseMock() {
    return {
        from(table: string) {
            if (table !== 'idempotency_keys') {
                throw new Error(`unexpected table: ${table}`);
            }
            return {
                insert(payload: Partial<KeyRow>) {
                    if (store.has(payload.key!)) {
                        return Promise.resolve({
                            data: null,
                            error: { code: '23505', message: 'duplicate key' },
                        });
                    }
                    store.set(payload.key!, {
                        key: payload.key!,
                        user_id: payload.user_id!,
                        method: payload.method!,
                        path: payload.path!,
                        request_hash: payload.request_hash!,
                        state: 'in_progress',
                        response_status: null,
                        response_body: null,
                        completed_at: null,
                    });
                    return Promise.resolve({ data: null, error: null });
                },
                select(_cols: string) {
                    return {
                        eq: (_col: string, value: string) => ({
                            single: <T,>() => {
                                const row = store.get(value);
                                if (!row) return Promise.resolve({ data: null, error: { message: 'not found' } });
                                return Promise.resolve({ data: row as unknown as T, error: null });
                            },
                        }),
                    };
                },
                update(payload: Partial<KeyRow>) {
                    return {
                        eq: (_col: string, value: string) => {
                            const row = store.get(value);
                            if (!row) return Promise.resolve({ error: { message: 'not found' } });
                            Object.assign(row, payload);
                            return Promise.resolve({ error: null });
                        },
                    };
                },
            };
        },
    };
}

function buildRequest(headers: Record<string, string> = {}, url = 'https://example.com/api/transactions/mark-paid'): NextRequest {
    return new NextRequest(url, { method: 'POST', headers });
}

const USER_ID = '00000000-0000-0000-0000-000000000001';
const KEY = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';

// ── hashBody ──────────────────────────────────────────────────────────────────

describe('hashBody', () => {
    it('produces stable hash regardless of key order', () => {
        const a = hashBody({ a: 1, b: 2, c: { x: 'y', z: [1, 2] } });
        const b = hashBody({ c: { z: [1, 2], x: 'y' }, b: 2, a: 1 });
        expect(a).toBe(b);
    });

    it('differs on different content', () => {
        expect(hashBody({ a: 1 })).not.toBe(hashBody({ a: 2 }));
    });
});

// ── acquireIdempotency ───────────────────────────────────────────────────────

describe('acquireIdempotency', () => {
    it('returns kind=fresh with no-op commit when no Idempotency-Key header is sent (backward compat)', async () => {
        const sup = buildSupabaseMock();
        const req = buildRequest();
        const out = await acquireIdempotency(req, sup as never, USER_ID, { foo: 1 });
        expect(out.kind).toBe('fresh');
        if (out.kind !== 'fresh') return;
        // commit + rollback must not throw and must not write anything
        await out.commit(200, { ok: true });
        await out.rollback();
        expect(store.size).toBe(0);
    });

    it('returns kind=conflict 400 on malformed Idempotency-Key', async () => {
        const sup = buildSupabaseMock();
        const req = buildRequest({ 'Idempotency-Key': 'short' });
        const out = await acquireIdempotency(req, sup as never, USER_ID, { foo: 1 });
        expect(out.kind).toBe('conflict');
        if (out.kind !== 'conflict') return;
        expect(out.response.status).toBe(400);
    });

    it('returns kind=fresh on first valid key, persists row in_progress', async () => {
        const sup = buildSupabaseMock();
        const req = buildRequest({ 'Idempotency-Key': KEY });
        const out = await acquireIdempotency(req, sup as never, USER_ID, { foo: 1 });
        expect(out.kind).toBe('fresh');
        const row = store.get(KEY);
        expect(row?.state).toBe('in_progress');
        expect(row?.user_id).toBe(USER_ID);
    });

    it('commit transitions row to completed and caches response', async () => {
        const sup = buildSupabaseMock();
        const req = buildRequest({ 'Idempotency-Key': KEY });
        const out = await acquireIdempotency(req, sup as never, USER_ID, { foo: 1 });
        if (out.kind !== 'fresh') throw new Error('expected fresh');
        await out.commit(200, { success: true, txId: 'abc' });
        const row = store.get(KEY);
        expect(row?.state).toBe('completed');
        expect(row?.response_status).toBe(200);
        expect(row?.response_body).toEqual({ success: true, txId: 'abc' });
        expect(row?.completed_at).not.toBeNull();
    });

    it('rollback transitions row to failed', async () => {
        const sup = buildSupabaseMock();
        const req = buildRequest({ 'Idempotency-Key': KEY });
        const out = await acquireIdempotency(req, sup as never, USER_ID, { foo: 1 });
        if (out.kind !== 'fresh') throw new Error('expected fresh');
        await out.rollback();
        expect(store.get(KEY)?.state).toBe('failed');
    });

    it('replays cached response on second call with same key + same body', async () => {
        const sup = buildSupabaseMock();

        // First call — fresh + commit
        const req1 = buildRequest({ 'Idempotency-Key': KEY });
        const out1 = await acquireIdempotency(req1, sup as never, USER_ID, { foo: 1 });
        if (out1.kind !== 'fresh') throw new Error('expected fresh');
        await out1.commit(200, { success: true, n: 42 });

        // Second call — same key, same body → replay
        const req2 = buildRequest({ 'Idempotency-Key': KEY });
        const out2 = await acquireIdempotency(req2, sup as never, USER_ID, { foo: 1 });
        expect(out2.kind).toBe('replay');
        if (out2.kind !== 'replay') return;
        expect(out2.response.status).toBe(200);
        const body = await out2.response.json();
        expect(body).toEqual({ success: true, n: 42 });
    });

    it('replays cached response when body keys are reordered (stable hashing)', async () => {
        const sup = buildSupabaseMock();
        const req1 = buildRequest({ 'Idempotency-Key': KEY });
        const out1 = await acquireIdempotency(req1, sup as never, USER_ID, { a: 1, b: 2 });
        if (out1.kind !== 'fresh') throw new Error('expected fresh');
        await out1.commit(200, { ok: true });

        const req2 = buildRequest({ 'Idempotency-Key': KEY });
        const out2 = await acquireIdempotency(req2, sup as never, USER_ID, { b: 2, a: 1 });
        expect(out2.kind).toBe('replay');
    });

    it('returns 422 when same key reused with different body (Stripe convention)', async () => {
        const sup = buildSupabaseMock();
        const req1 = buildRequest({ 'Idempotency-Key': KEY });
        const out1 = await acquireIdempotency(req1, sup as never, USER_ID, { txId: 'a' });
        if (out1.kind !== 'fresh') throw new Error('expected fresh');
        await out1.commit(200, { ok: true });

        const req2 = buildRequest({ 'Idempotency-Key': KEY });
        const out2 = await acquireIdempotency(req2, sup as never, USER_ID, { txId: 'b' });
        expect(out2.kind).toBe('conflict');
        if (out2.kind !== 'conflict') return;
        expect(out2.response.status).toBe(422);
    });

    it('returns 409 when same key is in_progress (concurrent request)', async () => {
        const sup = buildSupabaseMock();

        // First call — claim but do NOT commit (simulate in-flight)
        const req1 = buildRequest({ 'Idempotency-Key': KEY });
        const out1 = await acquireIdempotency(req1, sup as never, USER_ID, { foo: 1 });
        expect(out1.kind).toBe('fresh');

        // Second call — same key, still in_progress → 409
        const req2 = buildRequest({ 'Idempotency-Key': KEY });
        const out2 = await acquireIdempotency(req2, sup as never, USER_ID, { foo: 1 });
        expect(out2.kind).toBe('conflict');
        if (out2.kind !== 'conflict') return;
        expect(out2.response.status).toBe(409);
    });

    it('returns 409 when same key was previously failed (caller must use new key)', async () => {
        const sup = buildSupabaseMock();
        const req1 = buildRequest({ 'Idempotency-Key': KEY });
        const out1 = await acquireIdempotency(req1, sup as never, USER_ID, { foo: 1 });
        if (out1.kind !== 'fresh') throw new Error('expected fresh');
        await out1.rollback();

        const req2 = buildRequest({ 'Idempotency-Key': KEY });
        const out2 = await acquireIdempotency(req2, sup as never, USER_ID, { foo: 1 });
        expect(out2.kind).toBe('conflict');
        if (out2.kind !== 'conflict') return;
        expect(out2.response.status).toBe(409);
    });

    it('rejects cross-user reuse with 409 and generic message (no information leak)', async () => {
        const sup = buildSupabaseMock();
        const otherUser = '00000000-0000-0000-0000-000000000002';

        const req1 = buildRequest({ 'Idempotency-Key': KEY });
        const out1 = await acquireIdempotency(req1, sup as never, USER_ID, { foo: 1 });
        if (out1.kind !== 'fresh') throw new Error('expected fresh');
        await out1.commit(200, { ok: true });

        // Different user attempts to use the same key
        const req2 = buildRequest({ 'Idempotency-Key': KEY });
        const out2 = await acquireIdempotency(req2, sup as never, otherUser, { foo: 1 });
        expect(out2.kind).toBe('conflict');
        if (out2.kind !== 'conflict') return;
        expect(out2.response.status).toBe(409);
        const body = await out2.response.json();
        // No detail leakage about whether the key exists or what the other user posted
        expect(body.error).toMatch(/already in use/i);
    });

    it('accepts the lowercase header name (Idempotency-Key vs idempotency-key)', async () => {
        const sup = buildSupabaseMock();
        const req = buildRequest({ 'idempotency-key': KEY });
        const out = await acquireIdempotency(req, sup as never, USER_ID, { foo: 1 });
        expect(out.kind).toBe('fresh');
        expect(store.get(KEY)?.state).toBe('in_progress');
    });
});
