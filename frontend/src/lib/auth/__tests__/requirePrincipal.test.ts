import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockAuthGetUser = vi.fn();
const mockSignOut = vi.fn();
const mockShipownerMaybeSingle = vi.fn();
const mockProfileSingle = vi.fn();

// Track which table is being queried so we can route to the right mock.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockAuthGetUser,
      signOut: mockSignOut,
    },
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => {
          if (table === 'shipowners') {
            return { maybeSingle: mockShipownerMaybeSingle };
          }
          // profiles
          return { single: mockProfileSingle };
        }),
      })),
    })),
  })),
}));

// redirect() must throw so async functions short-circuit and tests can assert.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

// Import AFTER vi.mock so the module picks up the mocked dependencies.
const { requirePrincipal } = await import('../requirePrincipal');

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const authUser = { id: 'user-abc', email: 'owner@example.com', last_sign_in_at: '2026-06-14T08:00:00Z' };

const activeShipowner = {
  id: 'so-001',
  name: 'Berbera Shipping Co.',
  country_code: 'SO',
  address: null,
  official_email: 'owner@example.com',
  official_email_source: 'AGENT_CLAIM',
  account_state: 'ACTIVE',
  profile_id: 'user-abc',
  imo_company_no: null,
  invited_at: null,
  kyc_level_c_completed_at: null,
  aoc_number: null,
  jurisdiction_id: 'jur-sl-001',
};

const invitedShipowner = { ...activeShipowner, account_state: 'INVITED' };

const activeProfile = {
  id: 'user-abc',
  email: 'staff@greengate.africa',
  full_name: 'Staff User',
  role: 'MANAGER',
  operational_site: 'BERBERA_PORT',
  country_code: 'SO',
  timezone: 'Africa/Mogadishu',
  preferred_language: 'en',
  is_active: true,
  ip_address: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockAuthGetUser.mockReset();
  mockSignOut.mockReset();
  mockShipownerMaybeSingle.mockReset();
  mockProfileSingle.mockReset();
  mockSignOut.mockResolvedValue({});
});

describe('requirePrincipal', () => {
  it('(a) redirects to /login when there is no session', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(requirePrincipal()).rejects.toThrow('REDIRECT:/login');
  });

  it('(b) returns operator principal when shipowner is ACTIVE', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: authUser }, error: null });
    mockShipownerMaybeSingle.mockResolvedValue({ data: activeShipowner, error: null });

    const principal = await requirePrincipal();

    expect(principal.kind).toBe('operator');
    if (principal.kind !== 'operator') return; // narrow type
    expect(principal.userId).toBe('user-abc');
    expect(principal.email).toBe('owner@example.com');
    expect(principal.shipowner.id).toBe('so-001');
    expect(principal.shipowner.account_state).toBe('ACTIVE');
    expect(principal.jurisdictionId).toBe('jur-sl-001');
    expect(principal.supabase).toBeDefined();
  });

  it('(c) redirects with state hint when shipowner is INVITED', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: authUser }, error: null });
    mockShipownerMaybeSingle.mockResolvedValue({ data: invitedShipowner, error: null });

    await expect(requirePrincipal()).rejects.toThrow('REDIRECT:/login?error=state_invited');
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('(d) returns staff principal when user has no shipowner row but has an active profile', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: authUser }, error: null });
    mockShipownerMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockProfileSingle.mockResolvedValue({ data: activeProfile, error: null });

    const principal = await requirePrincipal();

    expect(principal.kind).toBe('staff');
    if (principal.kind !== 'staff') return; // narrow type
    expect(principal.user.id).toBe('user-abc');
    expect(principal.user.email).toBe('staff@greengate.africa');
    expect(principal.user.role).toBe('MANAGER');
    expect(principal.supabase).toBeDefined();
  });

  it('(e) redirects to /pending-approval when staff profile is inactive', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: authUser }, error: null });
    mockShipownerMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockProfileSingle.mockResolvedValue({ data: { ...activeProfile, is_active: false }, error: null });

    await expect(requirePrincipal()).rejects.toThrow('REDIRECT:/pending-approval');
  });

  it('redirects to /login?error=no_profile when profile row is missing', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: authUser }, error: null });
    mockShipownerMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockProfileSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });

    await expect(requirePrincipal()).rejects.toThrow('REDIRECT:/login?error=no_profile');
  });
});
