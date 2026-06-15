import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserRole } from '@/types/secure';

// ─────────────────────────────────────────────────────────────────────────────
// Mock Supabase server client.
// We control auth.getUser() and the profile select chain via these holders,
// then re-import requireRole AFTER setting them per test.
// ─────────────────────────────────────────────────────────────────────────────

const mockAuthGetUser = vi.fn();
const mockProfileSingle = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockAuthGetUser,
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: mockProfileSingle,
        })),
      })),
    })),
  })),
}));

// Import AFTER vi.mock so the module picks up the mocked dependency.
const { requireRole } = await import('../requireRole');

beforeEach(() => {
  mockAuthGetUser.mockReset();
  mockProfileSingle.mockReset();
});

const validProfile = {
  id: 'user-123',
  email: 'admin@greengate.africa',
  full_name: 'Admin User',
  role: 'SUPERADMIN',
  operational_site: 'NATIONAL_HQ',
  country_code: 'SO',
  timezone: 'Africa/Mogadishu',
  preferred_language: 'fr',
  is_active: true,
  ip_address: null,
};

describe('requireRole — auth gating', () => {
  it('returns 401 when there is no session', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await requireRole([UserRole.SUPERADMIN]);

    expect(result.user).toBeNull();
    expect(result.supabase).toBeNull();
    expect(result.error).not.toBeNull();
    expect(result.error!.status).toBe(401);
  });

  it('returns 401 when getUser returns an auth error', async () => {
    mockAuthGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'JWT expired' },
    });

    const result = await requireRole([UserRole.SUPERADMIN]);

    expect(result.error!.status).toBe(401);
  });

  it('returns 403 when the profile row does not exist for the auth user', async () => {
    mockAuthGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', last_sign_in_at: null } },
      error: null,
    });
    mockProfileSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });

    const result = await requireRole([UserRole.SUPERADMIN]);

    expect(result.error!.status).toBe(403);
  });

  it('returns 403 when the profile is_active=false', async () => {
    mockAuthGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', last_sign_in_at: null } },
      error: null,
    });
    mockProfileSingle.mockResolvedValue({
      data: { ...validProfile, is_active: false },
      error: null,
    });

    const result = await requireRole([UserRole.SUPERADMIN]);

    expect(result.error!.status).toBe(403);
  });

  it('returns 403 when the role is not in the allowed set', async () => {
    mockAuthGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', last_sign_in_at: null } },
      error: null,
    });
    mockProfileSingle.mockResolvedValue({
      data: { ...validProfile, role: 'MANAGER' },
      error: null,
    });

    const result = await requireRole([UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN]);

    expect(result.error!.status).toBe(403);
  });

  it('returns user + supabase when the role is allowed', async () => {
    mockAuthGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', last_sign_in_at: '2026-04-20T10:00:00Z' } },
      error: null,
    });
    mockProfileSingle.mockResolvedValue({ data: validProfile, error: null });

    const result = await requireRole([UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN]);

    expect(result.error).toBeNull();
    expect(result.user).not.toBeNull();
    expect(result.user!.id).toBe('user-123');
    expect(result.user!.email).toBe('admin@greengate.africa');
    expect(result.user!.role).toBe(UserRole.SUPERADMIN);
    expect(result.user!.lastLogin).toBe('2026-04-20T10:00:00Z');
    expect(result.supabase).not.toBeNull();
  });
});

describe('requireRole — MANAGER guard on money-rail endpoints', () => {
  it('denies MANAGER on a SUPERADMIN+FINANCE_ADMIN endpoint (e.g. mark-paid)', async () => {
    mockAuthGetUser.mockResolvedValue({
      data: { user: { id: 'mgr-456', last_sign_in_at: null } },
      error: null,
    });
    mockProfileSingle.mockResolvedValue({
      data: { ...validProfile, id: 'mgr-456', role: 'MANAGER' },
      error: null,
    });

    const result = await requireRole([UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN]);
    expect(result.error!.status).toBe(403);
  });

  it('allows MANAGER when MANAGER is explicitly included in the allowed set (generic requireRole invariant)', async () => {
    mockAuthGetUser.mockResolvedValue({
      data: { user: { id: 'mgr-456', last_sign_in_at: null } },
      error: null,
    });
    mockProfileSingle.mockResolvedValue({
      data: { ...validProfile, id: 'mgr-456', role: 'MANAGER' },
      error: null,
    });

    const result = await requireRole([
      UserRole.SUPERADMIN, UserRole.PORT_OFFICER, UserRole.MANAGER,
    ]);
    expect(result.error).toBeNull();
    expect(result.user!.role).toBe(UserRole.MANAGER);
  });

  it('denies SHIPPING_AGENT on every admin endpoint', async () => {
    mockAuthGetUser.mockResolvedValue({
      data: { user: { id: 'agent-789', last_sign_in_at: null } },
      error: null,
    });
    mockProfileSingle.mockResolvedValue({
      data: { ...validProfile, id: 'agent-789', role: 'SHIPPING_AGENT' },
      error: null,
    });

    const adminSets = [
      [UserRole.SUPERADMIN],
      [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN],
      [UserRole.SUPERADMIN, UserRole.PORT_OFFICER, UserRole.MANAGER],
    ];

    for (const allowed of adminSets) {
      const result = await requireRole(allowed);
      expect(result.error!.status).toBe(403);
    }
  });
});

describe('requireRole — JWT vs DB consistency', () => {
  it('always trusts the DB role over what the JWT might claim', async () => {
    // Auth user exists (the JWT is valid) but the DB profile says the user
    // was demoted to PORT_OFFICER. requireRole MUST honor the DB row.
    mockAuthGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', last_sign_in_at: null } },
      error: null,
    });
    mockProfileSingle.mockResolvedValue({
      data: { ...validProfile, role: 'PORT_OFFICER' },
      error: null,
    });

    const result = await requireRole([UserRole.SUPERADMIN]);
    expect(result.error!.status).toBe(403);
  });
});
