import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/requireRole', () => ({
    requireRole: vi.fn(async () => ({
        user: { id: 'admin-uuid', role: 'SUPERADMIN' },
        supabase: {},
        error: null,
    })),
}));

vi.mock('@/services/emailService', () => ({
    sendRegistrationApprovalEmail: vi.fn(async () => ({ success: true, id: 'email-id' })),
}));

interface ProfileUpdatePayload {
    is_active?: boolean;
    role?: string;
}

const profileUpdateSpy = vi.fn((_payload: ProfileUpdatePayload) => ({ error: null }));
const regUpdateSpy = vi.fn((_payload: Record<string, unknown>) => ({ error: null }));

vi.mock('@/lib/supabase/tenant', () => {
    return {
        createPlatformClient: () => buildAdminClientMock(),
    };
});

let lastRegRequest: { requested_role: string; contact_email: string } | null = null;

function buildAdminClientMock() {
    return {
        from(table: string) {
            if (table === 'registration_requests') {
                return {
                    select: () => ({
                        eq: () => ({
                            single: async () => ({
                                data: lastRegRequest
                                    ? { ...lastRegRequest, id: 'req-uuid', status: 'PENDING' }
                                    : null,
                                error: lastRegRequest ? null : { message: 'not found' },
                            }),
                        }),
                    }),
                    update: (payload: Record<string, unknown>) => {
                        regUpdateSpy(payload);
                        return { eq: async () => ({ error: null }) };
                    },
                };
            }
            if (table === 'profiles') {
                return {
                    select: (cols: string) => ({
                        eq: () => ({
                            single: async () => {
                                if (cols.includes('email') && cols.includes('full_name')) {
                                    return {
                                        data: {
                                            email: 'user@example.com',
                                            full_name: 'Test User',
                                            role: 'SHIPPING_AGENT',
                                            operational_site: null,
                                        },
                                        error: null,
                                    };
                                }
                                return { data: { id: 'profile-uuid' }, error: null };
                            },
                        }),
                    }),
                    update: (payload: ProfileUpdatePayload) => {
                        profileUpdateSpy(payload);
                        return { eq: async () => ({ error: null }) };
                    },
                };
            }
            throw new Error(`Unexpected table: ${table}`);
        },
    };
}

// ── Test setup ───────────────────────────────────────────────────────────────

const { POST } = await import('./route');

function buildReq(body: object): NextRequest {
    return {
        json: async () => body,
    } as unknown as NextRequest;
}

beforeEach(() => {
    profileUpdateSpy.mockClear();
    regUpdateSpy.mockClear();
    lastRegRequest = null;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/auth/approve — role enum safety (B2 audit fix)', () => {
    const FORM_ROLES = [
        'PORT_OFFICER',
        'FINANCE_ADMIN',
        'COMPLIANCE_AUDITOR',
        'OPERATIONS_MANAGER',
        'SHIPPING_AGENT',
        'FLEET_MANAGER',
        'FINANCE_CONTACT',
        'LEGAL_REP',
    ];

    for (const formRole of FORM_ROLES) {
        it(`approving a ${formRole} request never writes the form role onto profiles.role`, async () => {
            lastRegRequest = { requested_role: formRole, contact_email: 'user@example.com' };

            const res = await POST(buildReq({ requestId: 'req-uuid' }));
            expect(res.status).toBe(200);

            // The profile update must be called exactly once and contain ONLY is_active.
            expect(profileUpdateSpy).toHaveBeenCalledTimes(1);
            const payload = profileUpdateSpy.mock.calls[0]![0];
            expect(payload).toEqual({ is_active: true });
            expect(payload).not.toHaveProperty('role');
        });
    }

    it('returns 400 if requestId is missing', async () => {
        const res = await POST(buildReq({}));
        expect(res.status).toBe(400);
        expect(profileUpdateSpy).not.toHaveBeenCalled();
    });

    it('returns 404 if registration request is not found', async () => {
        lastRegRequest = null;
        const res = await POST(buildReq({ requestId: 'nope' }));
        expect(res.status).toBe(404);
        expect(profileUpdateSpy).not.toHaveBeenCalled();
    });
});
