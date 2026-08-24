import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockAuthGetUser = vi.fn();
const mockSignOut = vi.fn();
const mockShipownerMaybeSingle = vi.fn();
const mockProfileSingle = vi.fn();
// Appartenance à un compte tiers (mig 135). Par défaut : aucune — la plupart
// des cas testés sont un titulaire ou un membre du personnel.
// Sans implémentation ici : une valeur par défaut inline figerait le type de
// retour à { data: null }, et les cas qui rendent une vraie ligne ne
// typecheckeraient plus. Le défaut est posé dans beforeEach.
const mockMembershipMaybeSingle = vi.fn();

// Track which table is being queried so we can route to the right mock.
// `eq` est chaînable : le vrai client accepte .eq().eq(), et la lecture des
// appartenances filtre à la fois sur le profil et sur `active`.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockAuthGetUser,
      signOut: mockSignOut,
    },
    from: vi.fn((table: string) => {
      const terminal =
        table === 'shipowners' ? { maybeSingle: mockShipownerMaybeSingle }
        : table === 'owner_members' ? { maybeSingle: mockMembershipMaybeSingle }
        : { single: mockProfileSingle };
      const chain: Record<string, unknown> = { ...terminal };
      chain.eq = vi.fn(() => chain);
      chain.select = vi.fn(() => chain);
      return chain;
    }),
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
  mockMembershipMaybeSingle.mockReset();
  mockMembershipMaybeSingle.mockResolvedValue({ data: null, error: null });
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

  // ── Membre invite d'un compte tiers (mig 135) ────────────────────────────

  it('resout un membre invite comme operateur, avec ses seuls privileges', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: authUser }, error: null });
    // Aucun compte possede : la premiere lecture ne rend rien...
    mockShipownerMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      // ...puis la lecture du compte dont il est membre.
      .mockResolvedValueOnce({ data: activeShipowner, error: null });
    mockMembershipMaybeSingle.mockResolvedValue({
      data: {
        shipowner_id: 'so-001',
        can_pay: true, can_dispute: false,
        can_manage_vessels: false, can_invite: false,
      },
      error: null,
    });

    const principal = await requirePrincipal();

    expect(principal.kind).toBe('operator');
    if (principal.kind !== 'operator') throw new Error('unreachable');
    expect(principal.isMember).toBe(true);
    expect(principal.shipowner.id).toBe('so-001');
    expect(principal.privileges).toEqual({
      canPay: true, canDispute: false, canManageVessels: false, canInvite: false,
    });
  });

  // La preseance est la meme que celle de current_shipowner_id() cote base :
  // accepter une invitation ne doit jamais deplacer un titulaire sur le compte
  // d'autrui. Si les deux resolutions divergeaient, l'ecran montrerait un
  // compte pendant que RLS en servirait un autre.
  it('fait primer la propriete sur l’appartenance', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: authUser }, error: null });
    mockShipownerMaybeSingle.mockResolvedValue({ data: activeShipowner, error: null });
    mockMembershipMaybeSingle.mockResolvedValue({
      data: { shipowner_id: 'so-AUTRE', can_pay: true, can_dispute: true, can_manage_vessels: true, can_invite: true },
      error: null,
    });

    const principal = await requirePrincipal();

    if (principal.kind !== 'operator') throw new Error('unreachable');
    expect(principal.shipowner.id).toBe('so-001');
    expect(principal.isMember).toBe(false);
    // Le titulaire detient tout, sans ligne owner_members.
    expect(principal.privileges.canInvite).toBe(true);
    expect(mockMembershipMaybeSingle).not.toHaveBeenCalled();
  });

  it('donne tous les privileges au titulaire', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: authUser }, error: null });
    mockShipownerMaybeSingle.mockResolvedValue({ data: activeShipowner, error: null });

    const principal = await requirePrincipal();

    if (principal.kind !== 'operator') throw new Error('unreachable');
    expect(principal.privileges).toEqual({
      canPay: true, canDispute: true, canManageVessels: true, canInvite: true,
    });
  });

  // Une table absente (migration pas encore appliquee) rend une erreur, pas une
  // exception : le membre retombe simplement sur la resolution staff.
  it('retombe sur le staff si la table des appartenances est absente', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: authUser }, error: null });
    mockShipownerMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockMembershipMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'relation "owner_members" does not exist' },
    });
    mockProfileSingle.mockResolvedValue({ data: activeProfile, error: null });

    const principal = await requirePrincipal();
    expect(principal.kind).toBe('staff');
  });
});

