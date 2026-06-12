import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runReconcilePipeline } from '@/services/reconcilePipelineService';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('reconciliationWorker');

export const runtime = 'nodejs';

/**
 * POST /api/queue/process-reconciliation
 *
 * Thin route handler for the reconciliation pipeline worker.
 *
 * Auth: protected by `X-Queue-Secret` header (must match `QUEUE_WORKER_SECRET`
 * env var). Intended to be called by a pg_cron job every minute, which sends
 * the secret via pg_net. Same shared-secret pattern as other internal routes.
 *
 * Flow:
 *   1. Pop one message from the `reconciliation_queue` pgmq queue with a 60s
 *      visibility timeout (reconciliation is slower than pro-forma due to
 *      distance-final aggregation, so re-delivery on failure is automatic
 *      after a longer grace period).
 *   2. Delegate the heavy lifting to `runReconcilePipeline`.
 *   3. On success → ack the message (removes it from the queue).
 *   4. On failure → return 500 without acking; pgmq will re-deliver after
 *      the visibility timeout expires, giving us free retries.
 *
 * Response codes:
 *   200 — a message was processed successfully
 *   204 — queue was empty, nothing to do
 *   401 — missing/incorrect X-Queue-Secret
 *   500 — pipeline failure (message NOT acked, will re-deliver)
 */
function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  const expected = process.env.QUEUE_WORKER_SECRET;
  if (!expected) return json(500, { error: 'queue worker secret not configured' });

  const got = req.headers.get('X-Queue-Secret');
  if (got !== expected) return json(401, { error: 'unauthorized' });

  const apiUrl = process.env.AFRICGREEN_API_URL ?? 'http://127.0.0.1:8080';

  // Queue worker draining reconciliation_queue across ALL jurisdictions →
  // UNSCOPED platform client (pipeline resolves per-alert jurisdiction).
  let admin: SupabaseClient;
  try {
    admin = createPlatformClient();
  } catch {
    return json(500, { error: 'supabase not configured' });
  }

  // Pop one message with 60s visibility timeout. If no message, return 204.
  const { data: popped, error: popErr } = await admin.rpc('pgmq_pop_message', {
    queue_name: 'reconciliation_queue',
    visibility_sec: 60,
  });
  if (popErr) return json(500, { error: `pgmq pop: ${popErr.message}` });
  if (!popped) return new NextResponse(null, { status: 204 });

  const msg = popped as { msg_id: number; read_ct: number; message: { arrival_alert_id: string } };
  const alertId = msg.message.arrival_alert_id;
  const readCt = msg.read_ct ?? 0;

  // ── FIX 5 (retry ceiling): dead-letter poison messages after 5 deliveries. ──
  // pgmq increments read_ct on every pop. If a message has been delivered more
  // than 5 times it is either a permanent failure or a pathological loop — archive
  // it so the queue doesn't spin forever. The archive RPC (mig 090) calls
  // pgmq.archive internally, same as ack, so the message is preserved for ops.
  const DEAD_LETTER_THRESHOLD = 5;
  if (readCt > DEAD_LETTER_THRESHOLD) {
    await admin.rpc('pgmq_archive_message', {
      queue_name: 'reconciliation_queue',
      msg_id: msg.msg_id,
    });
    log.error('reconcile_message_dead_lettered', { alertId, readCt, msg_id: msg.msg_id });
    return json(200, { dead_lettered: true, alertId, readCt, msg_id: msg.msg_id });
  }

  const result = await runReconcilePipeline({
    alertId,
    adminClient: admin,
    taxApiUrl: apiUrl,
  });

  if (!result.ok) {
    console.error('[reconciliation-queue] failed:', result.reason);
    return json(500, { error: result.reason, msg_id: msg.msg_id });
  }

  // Ack the message so it doesn't re-deliver.
  await admin.rpc('pgmq_ack_message', {
    queue_name: 'reconciliation_queue',
    msg_id: msg.msg_id,
  });

  return json(200, {
    transactionId: result.transactionId,
    documentType: result.documentType,
    msg_id: msg.msg_id,
  });
}
