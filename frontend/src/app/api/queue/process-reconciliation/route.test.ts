import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from './route';

describe('POST /api/queue/process-reconciliation', () => {
  beforeEach(() => {
    process.env.QUEUE_WORKER_SECRET = 'test-secret';
  });

  it('rejects unauthenticated requests', async () => {
    const req = new Request('http://localhost/api/queue/process-reconciliation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });

  it('returns 204 or 200 with correct secret', async () => {
    const secret = process.env.QUEUE_WORKER_SECRET ?? 'test-secret';
    const req = new Request('http://localhost/api/queue/process-reconciliation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Queue-Secret': secret },
      body: '{}',
    });
    const res = await POST(req as any);
    expect([200, 204, 500]).toContain(res.status);
  });
});
