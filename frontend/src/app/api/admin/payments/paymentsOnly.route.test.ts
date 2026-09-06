import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireRoleMock, listMock } = vi.hoisted(() => ({ requireRoleMock: vi.fn(), listMock: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireRole: requireRoleMock }));
vi.mock('@/services/paymentService', () => ({ listAdminPayments: listMock }));

import { GET } from './route';

function call(query: string) {
    return GET(new Request(`http://localhost/api/admin/payments${query}`) as never);
}

beforeEach(() => {
    vi.clearAllMocks();
    listMock.mockResolvedValue([]);
});

describe('GET /api/admin/payments — encaissements seulement (mig 154)', () => {
    it('borne les statuts à CONFIRMED / REFUNDED quoi que demande le client', async () => {
        requireRoleMock.mockResolvedValue({ user: { id: 'u1', paymentsOnly: true }, supabase: {}, error: null });
        await call('?status=INITIATED,PROCESSING,CONFIRMED');
        expect(listMock.mock.calls[0][1].status).toEqual(['CONFIRMED']);
        await call('');
        expect(listMock.mock.calls[1][1].status).toEqual(['CONFIRMED']);
        await call('?status=REFUNDED');
        expect(listMock.mock.calls[2][1].status).toEqual(['REFUNDED']);
    });

    it('laisse un profil ordinaire demander ce qu’il veut', async () => {
        requireRoleMock.mockResolvedValue({ user: { id: 'u1', paymentsOnly: false }, supabase: {}, error: null });
        await call('?status=INITIATED,PROCESSING');
        expect(listMock.mock.calls[0][1].status).toEqual(['INITIATED', 'PROCESSING']);
    });
});
