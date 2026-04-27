// ─────────────────────────────────────────────────────────────────────────────
// Idempotency-Key helper — Stripe-style request deduplication
// ─────────────────────────────────────────────────────────────────────────────
//
// Protects money-rail routes against duplicate side effects on retry. Backed
// by the `idempotency_keys` table (see migration 039).
//
// Lifecycle (handler perspective):
//
//     const idem = await acquireIdempotency(request, admin, userId, body);
//     if (idem.kind === 'replay')   return idem.response;        // cached hit
//     if (idem.kind === 'conflict') return idem.response;        // 409 / 422
//     try {
//         // ... do the work, build `payload` + `status` ...
//         await idem.commit(status, payload);
//         return NextResponse.json(payload, { status });
//     } catch (err) {
//         await idem.rollback();
//         throw err;
//     }
//
// Backward compatibility: if the client does not send `Idempotency-Key`, the
// helper returns kind='fresh' with no-op commit/rollback. The caller is
// responsible for falling back to a domain-level state guard (e.g. WHERE
// status != 'PAID' on the UPDATE).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

export type IdempotencyOutcome =
    | { kind: 'fresh'; commit: (status: number, body: unknown) => Promise<void>; rollback: () => Promise<void> }
    | { kind: 'replay'; response: NextResponse }
    | { kind: 'conflict'; response: NextResponse };

const KEY_FORMAT = /^[A-Za-z0-9_-]{8,128}$/;

function noopOutcome(): IdempotencyOutcome {
    return {
        kind: 'fresh',
        commit: async () => {},
        rollback: async () => {},
    };
}

/**
 * Stable SHA-256 of the request body. Sorts object keys recursively so
 * `{a:1,b:2}` and `{b:2,a:1}` hash identically — clients sometimes
 * re-serialize on retry.
 */
export function hashBody(body: unknown): string {
    return crypto.createHash('sha256').update(stableStringify(body)).digest('hex');
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return '[' + value.map(stableStringify).join(',') + ']';
    }
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map(k => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]));
    return '{' + entries.join(',') + '}';
}

interface KeyRow {
    key: string;
    user_id: string;
    request_hash: string;
    state: 'in_progress' | 'completed' | 'failed';
    response_status: number | null;
    response_body: unknown;
}

/**
 * Acquire an idempotency lease for the current request.
 *
 * Returns:
 *   - kind='fresh' → caller proceeds normally; must call commit() on success
 *     or rollback() on error.
 *   - kind='replay' → caller MUST return the supplied cached response.
 *   - kind='conflict' → caller MUST return the supplied error response (409/422).
 */
export async function acquireIdempotency(
    request: NextRequest,
    supabase: SupabaseClient,
    userId: string,
    requestBody: unknown,
): Promise<IdempotencyOutcome> {
    const key = request.headers.get('Idempotency-Key') ?? request.headers.get('idempotency-key');
    if (!key) {
        // Backward compat: caller falls back to domain state guard
        return noopOutcome();
    }

    if (!KEY_FORMAT.test(key)) {
        return {
            kind: 'conflict',
            response: NextResponse.json(
                { error: 'Idempotency-Key must match /^[A-Za-z0-9_-]{8,128}$/' },
                { status: 400 },
            ),
        };
    }

    const path = new URL(request.url).pathname;
    const requestHash = hashBody(requestBody);

    // Try to atomically claim the key. UNIQUE constraint on `key` makes this
    // race-safe: two concurrent inserts resolve to one winner + one 23505.
    const { error: insertErr } = await supabase
        .from('idempotency_keys')
        .insert({
            key,
            user_id: userId,
            method: request.method,
            path,
            request_hash: requestHash,
            state: 'in_progress',
        });

    if (!insertErr) {
        // Won the race. Caller does the work then commits/rolls back.
        return {
            kind: 'fresh',
            commit: async (status, body) => {
                const { error } = await supabase
                    .from('idempotency_keys')
                    .update({
                        state: 'completed',
                        response_status: status,
                        response_body: body as object,
                        completed_at: new Date().toISOString(),
                    })
                    .eq('key', key);
                if (error) {
                    // Don't fail the response — we already did the work and
                    // the client got a successful answer. Log + move on.
                    console.error('[idempotency] commit failed:', error.message);
                }
            },
            rollback: async () => {
                const { error } = await supabase
                    .from('idempotency_keys')
                    .update({
                        state: 'failed',
                        completed_at: new Date().toISOString(),
                    })
                    .eq('key', key);
                if (error) {
                    console.error('[idempotency] rollback failed:', error.message);
                }
            },
        };
    }

    // Conflict path. Either it's a unique-violation (key already exists) or
    // a real DB error. Distinguish via Postgres error code 23505.
    const isUniqueViolation = (insertErr as { code?: string }).code === '23505';
    if (!isUniqueViolation) {
        // Unexpected — propagate
        throw insertErr;
    }

    const { data: row, error: selectErr } = await supabase
        .from('idempotency_keys')
        .select('key, user_id, request_hash, state, response_status, response_body')
        .eq('key', key)
        .single<KeyRow>();

    if (selectErr || !row) {
        // We just got 23505 but can't read the row — likely RLS / race during
        // cleanup. Tell caller to retry.
        return {
            kind: 'conflict',
            response: NextResponse.json(
                { error: 'Idempotency key state unreadable, retry' },
                { status: 409 },
            ),
        };
    }

    if (row.user_id !== userId) {
        // Cross-user reuse — security: do NOT leak whether the key exists for
        // the other user. Generic message.
        return {
            kind: 'conflict',
            response: NextResponse.json(
                { error: 'Idempotency-Key already in use' },
                { status: 409 },
            ),
        };
    }

    if (row.request_hash !== requestHash) {
        // Same key, different body — Stripe convention is 422
        return {
            kind: 'conflict',
            response: NextResponse.json(
                { error: 'Idempotency-Key reused with a different request body' },
                { status: 422 },
            ),
        };
    }

    if (row.state === 'in_progress') {
        // Another request with the same key is mid-flight. Tell caller to
        // back off and retry shortly.
        return {
            kind: 'conflict',
            response: NextResponse.json(
                { error: 'A request with this Idempotency-Key is already in progress' },
                { status: 409 },
            ),
        };
    }

    if (row.state === 'failed') {
        // The previous attempt errored. Surface a generic retryable error
        // rather than replaying nothing useful — the caller can retry with a
        // fresh key.
        return {
            kind: 'conflict',
            response: NextResponse.json(
                { error: 'Previous attempt with this Idempotency-Key failed; use a new key to retry' },
                { status: 409 },
            ),
        };
    }

    // state === 'completed' AND request_hash matches → replay cached response
    return {
        kind: 'replay',
        response: NextResponse.json(row.response_body as object, {
            status: row.response_status ?? 200,
        }),
    };
}
