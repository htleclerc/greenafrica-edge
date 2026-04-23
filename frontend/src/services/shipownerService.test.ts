import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { upsertShipownerEmail, getOrCreateGhost } from './shipownerService';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe('shipownerService', () => {
  if (!key) {
    it.skip('SERVICE_ROLE_KEY unset', () => {});
    return;
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  it('getOrCreateGhost creates a GHOST row keyed by name', async () => {
    const owner = await getOrCreateGhost(admin, {
      name: 'Test Owner Ltd',
      country_code: 'SG',
    });
    expect(owner.account_state).toBe('GHOST');
  });

  it('upsertShipownerEmail sets AGENT_CLAIM source the first time, PORT_OFFICER wins later', async () => {
    const owner = await getOrCreateGhost(admin, { name: 'Source Test Owner' });
    const first = await upsertShipownerEmail(admin, owner.id, 'ops@ex.com', 'AGENT_CLAIM');
    expect(first.official_email).toBe('ops@ex.com');
    expect(first.official_email_source).toBe('AGENT_CLAIM');
    const second = await upsertShipownerEmail(admin, owner.id, 'legal@ex.com', 'PORT_OFFICER');
    expect(second.official_email).toBe('legal@ex.com');
    expect(second.official_email_source).toBe('PORT_OFFICER');
  });
});
