import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

interface ProfilePayload {
    id?: string;
    email?: string;
    full_name?: string;
    role?: string;
    is_active?: boolean;
}

interface ShipownerUpdate {
    profile_id?: string;
    account_state?: string;
    invited_at?: string;
    invited_by?: string;
    official_email?: string;
    official_email_source?: string;
}

const profileUpsertSpy = vi.fn((_: ProfilePayload) => ({ error: null }));
const shipownerUpdateSpy = vi.fn((_: ShipownerUpdate) => ({
    eq: () => Promise.resolve({ error: null }),
}));
const inviteSpy = vi.fn((_email: string, _opts?: unknown) =>
    Promise.resolve({ data: { user: { id: 'new-user-uuid' } }, error: null }),
);

let callerProfile: { role: string } | null = { role: 'SUPERADMIN' };
let callerUser: { id: string } | null = { id: 'admin-uuid' };
let mockOwner: {
    id: string;
    name: string;
    account_state: string;
    profile_id: string | null;
    official_email: string | null;
    official_email_source: string | null;
    jurisdiction_id: string;
    is_ofac_sdn: boolean;
    is_un_prohibited: boolean;
} | null = {
    id: 'owner-uuid',
    name: 'Acme Maritime',
    account_state: 'GHOST',
    profile_id: null,
    official_email: null,
    official_email_source: null,
    jurisdiction_id: '00000000-0000-4000-8000-00000000534f',
    is_ofac_sdn: false,
    is_un_prohibited: false,
};

interface AuditLogPayload {
    user_id?: string;
    user_full_name?: string;
    action?: string;
    severity?: string;
    entity_type?: string;
    entity_id?: string;
    details_json?: Record<string, unknown>;
}

const auditLogInsertSpy = vi.fn((_: AuditLogPayload) => Promise.resolve({ error: null }));

vi.mock('@/lib/supabase/server', () => ({
    createClient: () =>
        Promise.resolve({
            auth: {
                getUser: () => Promise.resolve({ data: { user: callerUser } }),
            },
            from: (table: string) => {
                if (table === 'profiles') {
                    return {
                        select: () => ({
                            eq: () => ({
                                single: () =>
                                    Promise.resolve({ data: callerProfile, error: null }),
                            }),
                        }),
                    };
                }
                throw new Error(`unexpected table on user client: ${table}`);
            },
        }),
}));

// The admin client is now minted via the sanctioned factories. Mock both to return
// the same mock (bypassing the real createTenantClient Proxy) so the existing
// single-.eq() chain assertions hold.
function buildAdminMock() {
    return {
        auth: {
            admin: {
                inviteUserByEmail: inviteSpy,
            },
        },
        from: (table: string) => {
            if (table === 'shipowners') {
                return {
                    select: () => ({
                        eq: () => ({
                            single: () =>
                                Promise.resolve({
                                    data: mockOwner,
                                    error: mockOwner ? null : { message: 'not found' },
                                }),
                        }),
                    }),
                    update: (payload: ShipownerUpdate) => {
                        shipownerUpdateSpy(payload);
                        return { eq: () => Promise.resolve({ error: null }) };
                    },
                };
            }
            if (table === 'profiles') {
                return {
                    upsert: (payload: ProfilePayload) => {
                        profileUpsertSpy(payload);
                        return Promise.resolve({ error: null });
                    },
                };
            }
            if (table === 'audit_logs') {
                return {
                    insert: (payload: AuditLogPayload) => auditLogInsertSpy(payload),
                };
            }
            throw new Error(`unexpected table on admin client: ${table}`);
        },
    };
}

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => buildAdminMock(),
    createTenantClient: () => buildAdminMock(),
}));

// Staff-isolation mock — getServerJurisdictionId resolves the acting admin's jurisdiction.
vi.mock('@/lib/auth/tenantContext', () => ({
    getServerJurisdictionId: vi.fn(async () => '00000000-0000-4000-8000-00000000534f'),
}));

const { inviteShipowner } = await import('./inviteShipowner');

beforeEach(() => {
    profileUpsertSpy.mockClear();
    shipownerUpdateSpy.mockClear();
    inviteSpy.mockClear();
    auditLogInsertSpy.mockClear();
    inviteSpy.mockImplementation((_email: string) =>
        Promise.resolve({ data: { user: { id: 'new-user-uuid' } }, error: null }),
    );
    callerProfile = { role: 'SUPERADMIN' };
    callerUser = { id: 'admin-uuid' };
    mockOwner = {
        id: 'owner-uuid',
        name: 'Acme Maritime',
        account_state: 'GHOST',
        profile_id: null,
        official_email: null,
        official_email_source: null,
        jurisdiction_id: '00000000-0000-4000-8000-00000000534f',
        is_ofac_sdn: false,
        is_un_prohibited: false,
    };
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sk_test';
    process.env.NEXT_PUBLIC_APP_URL = 'http://app.test';
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('inviteShipowner', () => {
    const validInput = {
        shipownerId: 'a1b2c3d4-e5f6-4789-9abc-def012345678',
        email: 'owner@example.com',
    };

    it('rejects unauthenticated callers', async () => {
        callerUser = null;
        const r = await inviteShipowner(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/not authenticated/i);
    });

    it('rejects PORT_OFFICER (not in SUPERADMIN allow-list)', async () => {
        callerProfile = { role: 'PORT_OFFICER' };
        const r = await inviteShipowner(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/insufficient role/i);
    });

    it('rejects MANAGER (vision-only role)', async () => {
        callerProfile = { role: 'MANAGER' };
        const r = await inviteShipowner(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/insufficient role/i);
    });

    it('rejects malformed email', async () => {
        const r = await inviteShipowner({ ...validInput, email: 'not-an-email' });
        expect(r.ok).toBe(false);
    });

    it('refuses to invite a shipowner already in ACTIVE state', async () => {
        mockOwner = { ...mockOwner!, account_state: 'ACTIVE' };
        const r = await inviteShipowner(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/already active/i);
        expect(inviteSpy).not.toHaveBeenCalled();
    });

    it('happy path — creates auth user, upserts profile as SHIPOWNER, stamps shipowners row', async () => {
        const r = await inviteShipowner(validInput);
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.userId).toBe('new-user-uuid');
            expect(r.alreadyExisted).toBe(false);
        }

        // profile upsert payload
        expect(profileUpsertSpy).toHaveBeenCalledTimes(1);
        const profilePayload = profileUpsertSpy.mock.calls[0]![0];
        expect(profilePayload).toMatchObject({
            id: 'new-user-uuid',
            email: 'owner@example.com',
            full_name: 'Acme Maritime',
            role: 'SHIPOWNER',
            is_active: true,
        });

        // shipowners stamp payload
        expect(shipownerUpdateSpy).toHaveBeenCalledTimes(1);
        const ownerPayload = shipownerUpdateSpy.mock.calls[0]![0];
        expect(ownerPayload).toMatchObject({
            profile_id: 'new-user-uuid',
            account_state: 'INVITED',
            invited_by: 'admin-uuid',
            official_email: 'owner@example.com',
            official_email_source: 'PORT_OFFICER',
        });
        expect(ownerPayload.invited_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("does not overwrite an existing official_email when the shipowner already has one", async () => {
        mockOwner = {
            ...mockOwner!,
            official_email: 'verified@example.com',
            official_email_source: 'EQUASIS_VERIFIED',
        };
        await inviteShipowner(validInput);
        const ownerPayload = shipownerUpdateSpy.mock.calls[0]![0];
        expect(ownerPayload.official_email).toBeUndefined();
        expect(ownerPayload.official_email_source).toBeUndefined();
    });

    it('lowercases the email before upsert + invite', async () => {
        await inviteShipowner({ ...validInput, email: 'OWNER@Example.COM' });
        expect(inviteSpy.mock.calls[0]![0]).toBe('owner@example.com');
        const profilePayload = profileUpsertSpy.mock.calls[0]![0] as { email: string };
        expect(profilePayload.email).toBe('owner@example.com');
    });

    it('blocks the invite and audit-logs a CRITICAL entry for an OFAC SDN shipowner', async () => {
        mockOwner = { ...mockOwner!, is_ofac_sdn: true };
        const r = await inviteShipowner(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/sanctioned/i);
        expect(inviteSpy).not.toHaveBeenCalled();
        expect(profileUpsertSpy).not.toHaveBeenCalled();
        expect(shipownerUpdateSpy).not.toHaveBeenCalled();

        expect(auditLogInsertSpy).toHaveBeenCalledTimes(1);
        const auditPayload = auditLogInsertSpy.mock.calls[0]![0];
        expect(auditPayload).toMatchObject({
            user_id: 'admin-uuid',
            action: 'SANCTIONS_CONTACT_BLOCKED',
            severity: 'CRITICAL',
            entity_type: 'Shipowner',
            entity_id: validInput.shipownerId,
            details_json: {
                code: 'OFAC_SDN',
                attempted: 'PORTAL_INVITE',
                email: 'owner@example.com',
            },
        });
    });

    it('blocks the invite for a UN-prohibited shipowner', async () => {
        mockOwner = { ...mockOwner!, is_un_prohibited: true };
        const r = await inviteShipowner(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/sanctioned/i);
        expect(inviteSpy).not.toHaveBeenCalled();

        const auditPayload = auditLogInsertSpy.mock.calls[0]![0];
        expect(auditPayload).toMatchObject({
            action: 'SANCTIONS_CONTACT_BLOCKED',
            details_json: expect.objectContaining({ code: 'UN_PROHIBITED' }),
        });
    });
});
