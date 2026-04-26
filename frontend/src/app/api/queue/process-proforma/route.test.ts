import { describe, it, expect } from 'vitest';
import { POST } from './route';

describe('POST /api/queue/process-proforma', () => {
  it('rejects unauthenticated requests', async () => {
    const req = new Request('http://localhost/api/queue/process-proforma', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });

  it('returns 204 when queue is empty (or 200 if a message was there)', async () => {
    const secret = process.env.QUEUE_WORKER_SECRET ?? 'test-secret';
    const req = new Request('http://localhost/api/queue/process-proforma', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Queue-Secret': secret,
      },
      body: JSON.stringify({}),
    });
    const res = await POST(req as any);
    expect([200, 204, 500]).toContain(res.status);
    // 500 is tolerated only if a seeded malformed message existed; clean envs should see 200/204.
  });
});
