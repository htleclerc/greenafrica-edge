import type { SupabaseClient } from '@supabase/supabase-js';

export type EmailSource = 'AGENT_CLAIM' | 'PORT_OFFICER' | 'EQUASIS_VERIFIED';
export type ShipownerAccountState = 'GHOST' | 'INVITED' | 'ACTIVE';

export interface Shipowner {
  id: string;
  name: string;
  country_code: string | null;
  address: string | null;
  official_email: string | null;
  official_email_source: EmailSource | null;
  account_state: ShipownerAccountState;
  profile_id: string | null;
}

export interface ShipownerListRow extends Shipowner {
  imo_company_no: string | null;
  invited_at: string | null;
  kyc_level_c_completed_at: string | null;
}

/** List shipowners ordered by name. Used by the admin portal section. */
export async function listShipowners(db: SupabaseClient): Promise<ShipownerListRow[]> {
  const { data, error } = await db
    .from('shipowners')
    .select('id, name, country_code, address, official_email, official_email_source, account_state, profile_id, imo_company_no, invited_at')
    .order('name');
  if (error) throw error;
  return (data ?? []) as ShipownerListRow[];
}

const TRUST: Record<EmailSource, number> = {
  AGENT_CLAIM: 1,
  EQUASIS_VERIFIED: 2,
  PORT_OFFICER: 3,
};

export async function getOrCreateGhost(
  db: SupabaseClient,
  input: { name: string; country_code?: string; imo_company_no?: string },
): Promise<Shipowner> {
  // Prefer imo_company_no lookup when given (unique)
  if (input.imo_company_no) {
    const { data: existing } = await db
      .from('shipowners')
      .select('*')
      .eq('imo_company_no', input.imo_company_no)
      .maybeSingle();
    if (existing) return existing as Shipowner;
  }

  const { data, error } = await db
    .from('shipowners')
    .insert({
      name: input.name,
      country_code: input.country_code ?? null,
      imo_company_no: input.imo_company_no ?? null,
      account_state: 'GHOST',
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as Shipowner;
}

/**
 * Upsert the owner's official email with source-trust comparison: a lower-trust
 * source never overwrites a higher-trust source.
 */
export async function upsertShipownerEmail(
  db: SupabaseClient,
  ownerId: string,
  email: string,
  source: EmailSource,
): Promise<Shipowner> {
  const { data: current, error: readErr } = await db
    .from('shipowners')
    .select('official_email, official_email_source')
    .eq('id', ownerId)
    .single();
  if (readErr) throw readErr;

  const currentTrust = current.official_email_source
    ? TRUST[current.official_email_source as EmailSource]
    : 0;
  if (TRUST[source] < currentTrust) {
    // refuse silently — caller treats this as a no-op
    const { data } = await db
      .from('shipowners')
      .select('*')
      .eq('id', ownerId)
      .single();
    return data as Shipowner;
  }

  const { data, error } = await db
    .from('shipowners')
    .update({
      official_email: email,
      official_email_source: source,
      email_verified_at: source === 'PORT_OFFICER' ? new Date().toISOString() : null,
    })
    .eq('id', ownerId)
    .select('*')
    .single();
  if (error) throw error;
  return data as Shipowner;
}
