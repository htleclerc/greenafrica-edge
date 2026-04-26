import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runProformaPipeline } from '@/services/proformaPipelineService';

export const runtime = 'nodejs';

/**
 * POST /api/queue/process-proforma
 *
 * Thin route handler for the pro-forma pipeline worker.
 *
 * Auth: protected by `X-Queue-Secret` header (must match `QUEUE_WORKER_SECRET`
 * env var). Intended to be called by a pg_cron job every minute, which sends
 * the secret via pg_net. Same shared-secret pattern as other internal routes.
 *
 * Flow:
 *   1. Pop one message from the `proforma_queue` pgmq queue with a 30s
 *      visibility timeout (re-delivery on failure is automatic).
 *   2. Delegate the heavy lifting to `runProformaPipeline`.
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiUrl = process.env.AFRICGREEN_API_URL ?? 'http://127.0.0.1:8080';
  if (!supabaseUrl || !supabaseKey) return json(500, { error: 'supabase not configured' });

  const admin = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  // Pop one message with 30s visibility timeout. If no message, return 204.
  const { data: popped, error: popErr } = await admin.rpc('pgmq_pop_message', {
    queue_name: 'proforma_queue',
    visibility_sec: 30,
  });
  if (popErr) return json(500, { error: `pgmq pop: ${popErr.message}` });
  if (!popped) return new NextResponse(null, { status: 204 });

  const msg = popped as { msg_id: number; message: { arrival_alert_id: string } };

  const result = await runProformaPipeline({
    alertId: msg.message.arrival_alert_id,
    adminClient: admin,
    taxApiUrl: apiUrl,
  });

  if (!result.ok) {
    console.error('[proforma-queue] failed:', result.reason);
    return json(500, { error: result.reason, msg_id: msg.msg_id });
  }

  // Ack the message so it doesn't re-deliver.
  await admin.rpc('pgmq_ack_message', {
    queue_name: 'proforma_queue',
    msg_id: msg.msg_id,
  });

  return json(200, { transactionId: result.transactionId, msg_id: msg.msg_id });
}
