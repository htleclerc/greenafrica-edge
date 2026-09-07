import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProfilePayload {
    id?: string;
    email?: string;
    full_name?: string;
    role?: string;
    is_active?: boolean;
}

interface UserJurisdictionRow {
    user_id: string;
    jurisdiction_id: string;
}

// ── Spies ─────────────────────────────────────────────────────────────────────

const profileUpsertSpy = vi.fn((_: ProfilePayload) => Promise.resolve({ error: null }));
const userJurisdictionsUpsertSpy = vi.fn((_: UserJurisdictionRow[]) =>
    Promise.resolve({ error: null }),
);
// `createUser` et non plus `inviteUserByEmail` : l'invitation part par notre
// rail, GoTrue n'expedie plus rien. Signature a UN argument.
const inviteSpy = vi.fn((_opts: { email: string; email_confirm?: boolean; user_metadata?: unknown }) =>
    Promise.resolve({ data: { user: { id: 'new-staff-uuid' } }, error: null }),
);
const generateLinkSpy = vi.fn((_opts: { type: string; email: string }) =>
    Promise.resolve({
        data: { properties: { hashed_token: 'th-staff', email_otp: '424242' } },
        error: null,
    }),
);
const sendStaffInviteSpy = vi.fn(
    (_p: { to: string; recipientName: string; role: string; link: string; code: string }) =>
        Promise.resolve({ success: true }),
);
vi.mock('@/services/emailService', () => ({
    sendStaffInviteEmail: (p: never) => sendStaffInviteSpy(p),
}));

let callerProfile: { role: string } | null = { role: 'SUPERADMIN' };
let callerUser: { id: string } | null = { id: 'admin-uuid' };

// ── Mocks ─────────────────────────────────────────────────────────────────────

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

function buildAdminMock() {
    return {
        auth: {
            admin: {
                createUser: inviteSpy,
                generateLink: generateLinkSpy,
                listUsers: vi.fn((_opts?: unknown) =>
                    Promise.resolve({
                        data: {
                            users: [
                                { id: 'existing-staff-uuid', email: 'existing@example.com' },
                            ],
                        },
                        error: null,
                    }),
                ),
            },
        },
        from: (table: string) => {
            if (table === 'profiles') {
                return {
                    upsert: (payload: ProfilePayload) => {
                        profileUpsertSpy(payload);
                        return Promise.resolve({ error: null });
                    },
                };
            }
            if (table === 'user_jurisdictions') {
                return {
                    upsert: (rows: UserJurisdictionRow[], _opts?: unknown) => {
                        userJurisdictionsUpsertSpy(rows);
                        return Promise.resolve({ error: null });
                    },
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

const { inviteStaff } = await import('./inviteStaff');

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
    profileUpsertSpy.mockClear();
    userJurisdictionsUpsertSpy.mockClear();
    inviteSpy.mockClear();
    generateLinkSpy.mockClear();
    sendStaffInviteSpy.mockClear();
    inviteSpy.mockImplementation(() =>
        Promise.resolve({ data: { user: { id: 'new-staff-uuid' } }, error: null }),
    );
    callerProfile = { role: 'SUPERADMIN' };
    callerUser = { id: 'admin-uuid' };
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sk_test';
    process.env.NEXT_PUBLIC_APP_URL = 'http://app.test';
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('inviteStaff', () => {
    const validInput = {
        email: 'staff@example.com',
        fullName: 'Marie Dupont',
        role: 'PORT_OFFICER',
        jurisdictionIds: [
            '00000000-0000-4000-8000-00000000534f',
            '11111111-1111-4111-8111-111111111111',
        ],
    };

    it('rejects unauthenticated callers', async () => {
        callerUser = null;
        const r = await inviteStaff(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/not authenticated/i);
    });

    it('rejects PORT_OFFICER callers (insufficient role)', async () => {
        callerProfile = { role: 'PORT_OFFICER' };
        const r = await inviteStaff(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/insufficient role/i);
    });

    it('rejects FINANCE_ADMIN callers (insufficient role)', async () => {
        callerProfile = { role: 'FINANCE_ADMIN' };
        const r = await inviteStaff(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/insufficient role/i);
    });

    it('rejects MANAGER callers (insufficient role)', async () => {
        callerProfile = { role: 'MANAGER' };
        const r = await inviteStaff(validInput);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/insufficient role/i);
    });

    it('rejects invalid email', async () => {
        const r = await inviteStaff({ ...validInput, email: 'not-an-email' });
        expect(r.ok).toBe(false);
        expect(inviteSpy).not.toHaveBeenCalled();
    });

    it('rejects invalid role', async () => {
        const r = await inviteStaff({ ...validInput, role: 'SUPERADMIN' });
        expect(r.ok).toBe(false);
        expect(inviteSpy).not.toHaveBeenCalled();
    });

    it('rejects empty jurisdictionIds', async () => {
        const r = await inviteStaff({ ...validInput, jurisdictionIds: [] });
        expect(r.ok).toBe(false);
        expect(inviteSpy).not.toHaveBeenCalled();
    });

    it('rejects fullName shorter than 2 characters', async () => {
        const r = await inviteStaff({ ...validInput, fullName: 'X' });
        expect(r.ok).toBe(false);
        expect(inviteSpy).not.toHaveBeenCalled();
    });

    it('happy path — creates auth user, upserts profile with staff role, inserts user_jurisdictions', async () => {
        const r = await inviteStaff(validInput);
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.userId).toBe('new-staff-uuid');
            expect(r.alreadyExisted).toBe(false);
        }

        // profile upsert
        expect(profileUpsertSpy).toHaveBeenCalledTimes(1);
        const profilePayload = profileUpsertSpy.mock.calls[0]![0];
        expect(profilePayload).toMatchObject({
            id: 'new-staff-uuid',
            email: 'staff@example.com',
            full_name: 'Marie Dupont',
            role: 'PORT_OFFICER',
            is_active: true,
        });

        // user_jurisdictions upsert — one row per jurisdiction
        expect(userJurisdictionsUpsertSpy).toHaveBeenCalledTimes(1);
        const rows = userJurisdictionsUpsertSpy.mock.calls[0]![0] as UserJurisdictionRow[];
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            user_id: 'new-staff-uuid',
            jurisdiction_id: '00000000-0000-4000-8000-00000000534f',
        });
        expect(rows[1]).toMatchObject({
            user_id: 'new-staff-uuid',
            jurisdiction_id: '11111111-1111-4111-8111-111111111111',
        });
    });

    // Le lien doit frapper NOS routes et deposer l'invite sur la page de choix
    // du mot de passe. `action_link` de GoTrue n'y menait que si la cible etait
    // declaree dans les « Redirect URLs » du projet — ce qui n'etait pas le cas.
    it('envoie un lien vers notre callback, cible /auth/setup-password', async () => {
        await inviteStaff(validInput);
        expect(sendStaffInviteSpy).toHaveBeenCalledTimes(1);
        const { link, code } = sendStaffInviteSpy.mock.calls[0]![0];
        expect(link).toContain('/auth/callback?token_hash=th-staff');
        expect(link).toContain('type=magiclink');
        expect(link).toContain(encodeURIComponent('/auth/setup-password'));
        expect(link).not.toContain('/auth/v1/verify');
        expect(code).toBe('424242');
    });

    it('cree le compte confirme, avec le nom et le role en metadonnees', async () => {
        await inviteStaff({ ...validInput, role: 'FINANCE_ADMIN', fullName: 'Jean Finance' });
        const opts = inviteSpy.mock.calls[0]![0];
        expect(opts.email_confirm).toBe(true);
        expect(opts.user_metadata).toMatchObject({ full_name: 'Jean Finance', role: 'FINANCE_ADMIN' });
    });

    it('lowercases the email before invite and upsert', async () => {
        await inviteStaff({ ...validInput, email: 'STAFF@Example.COM' });
        expect(inviteSpy.mock.calls[0]![0].email).toBe('staff@example.com');
        const profilePayload = profileUpsertSpy.mock.calls[0]![0] as { email: string };
        expect(profilePayload.email).toBe('staff@example.com');
    });

    it('handles already-existing user — returns alreadyExisted:true', async () => {
        inviteSpy.mockResolvedValueOnce({
            data: { user: null } as unknown as { user: { id: string } },
            error: { code: 'email_exists', message: 'Email already registered' } as unknown as null,
        });

        const r = await inviteStaff({ ...validInput, email: 'existing@example.com' });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.userId).toBe('existing-staff-uuid');
            expect(r.alreadyExisted).toBe(true);
        }

        // Still upserts profile + jurisdictions for the existing user
        expect(profileUpsertSpy).toHaveBeenCalledTimes(1);
        const profilePayload = profileUpsertSpy.mock.calls[0]![0];
        expect(profilePayload).toMatchObject({ id: 'existing-staff-uuid', role: 'PORT_OFFICER' });
        expect(userJurisdictionsUpsertSpy).toHaveBeenCalledTimes(1);
    });

    it('accepts all valid staff roles', async () => {
        const roles = ['PORT_OFFICER', 'FINANCE_ADMIN', 'MANAGER'] as const;
        for (const role of roles) {
            profileUpsertSpy.mockClear();
            userJurisdictionsUpsertSpy.mockClear();
            inviteSpy.mockClear();
    generateLinkSpy.mockClear();
    sendStaffInviteSpy.mockClear();
            inviteSpy.mockResolvedValueOnce({ data: { user: { id: 'new-staff-uuid' } }, error: null });

            const r = await inviteStaff({ ...validInput, role });
            expect(r.ok).toBe(true);
            const payload = profileUpsertSpy.mock.calls[0]![0] as { role: string };
            expect(payload.role).toBe(role);
        }
    });
});
