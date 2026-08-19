import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const effectsMock = vi.fn();
const auditMock = vi.fn();
const systemActorMock = vi.fn();

vi.mock('@/services/paymentConfirmationEffects', () => ({
    applyPaymentConfirmationEffects: (...a: unknown[]) => effectsMock(...a),
}));
vi.mock('@/services/auditService', () => ({
    writeAuditLog: (...a: unknown[]) => auditMock(...a),
}));
vi.mock('@/lib/system-actor', () => ({
    resolveSystemActor: (...a: unknown[]) => systemActorMock(...a),
}));

import {
    confirmPaypalPayment,
    rejectPaypalPayment,
    cancelPaypalPayment,
} from './paypalConfirmation';

// ── Faux client Supabase ────────────────────────────────────────────────────
// Scriptable : la ligne payments trouvee, le nombre de lignes que l'UPDATE
// garde renvoie, et les erreurs eventuelles.
interface Harness {
    paymentRow: Record<string, unknown> | null;
    updateReturnsRows: boolean; // false = course perdue
    updateError: { message: string } | null;
    rpcCalls: { fn: string; args: Record<string, unknown> }[];
    updatePayloads: Record<string, unknown>[];
    selectFilters: { col: string; val: unknown }[];
}

let h: Harness;

function fakeAdmin(): SupabaseClient {
    return {
        from: (table: string) => {
            if (table !== 'payments') throw new Error(`unexpected table ${table}`);
            return {
                select: () => {
                    const chain = {
                        eq: (col: string, val: unknown) => {
                            h.selectFilters.push({ col, val });
                            return chain;
                        },
                        maybeSingle: async () => ({ data: h.paymentRow, error: null }),
                    };
                    return chain;
                },
                update: (payload: Record<string, unknown>) => {
                    h.updatePayloads.push(payload);
                    const chain = {
                        eq: () => chain,
                        select: async () => ({
                            data: h.updateError
                                ? null
                                : h.updateReturnsRows
                                  ? [{ id: 'pay-1' }]
                                  : [],
                            error: h.updateError,
                        }),
                    };
                    return chain;
                },
            };
        },
        rpc: async (fn: string, args: Record<string, unknown>) => {
            h.rpcCalls.push({ fn, args });
            return { data: null, error: null };
        },
    } as unknown as SupabaseClient;
}

const PROCESSING_ROW = {
    id: 'pay-1',
    status: 'PROCESSING',
    transaction_id: 'tx-1',
    shipowner_id: 'so-1',
    amount_usd_minor: 125000, // $1250.00
    currency: 'USD',
    jurisdiction_id: 'jur-1',
    rail_details: { paypal_order_id: 'ORDER-1' },
};

const GOOD_INPUT = {
    orderId: 'ORDER-1',
    captureId: 'CAP-9',
    paidAmount: '1250.00',
    paidCurrency: 'USD',
    payerEmail: 'payer@example.com',
};

beforeEach(() => {
    effectsMock.mockReset().mockResolvedValue(undefined);
    auditMock.mockReset().mockResolvedValue(undefined);
    systemActorMock.mockReset().mockResolvedValue('sys-1');
    h = {
        paymentRow: { ...PROCESSING_ROW },
        updateReturnsRows: true,
        updateError: null,
        rpcCalls: [],
        updatePayloads: [],
        selectFilters: [],
    };
});

describe('confirmPaypalPayment — chemin nominal', () => {
    it('confirme, recalcule la transaction et declenche les effets une fois', async () => {
        const out = await confirmPaypalPayment(fakeAdmin(), GOOD_INPUT);

        expect(out).toEqual({ outcome: 'CONFIRMED', paymentId: 'pay-1' });

        const upd = h.updatePayloads[0];
        expect(upd.status).toBe('CONFIRMED');
        expect(upd.confirmed_by).toBe('sys-1');
        expect(typeof upd.confirmed_at).toBe('string');
        const details = upd.rail_details as Record<string, unknown>;
        expect(details.paypal_order_id).toBe('ORDER-1'); // details preexistants preserves
        expect(details.paypal_capture_id).toBe('CAP-9');
        expect(details.payer_email).toBe('payer@example.com');

        expect(h.rpcCalls).toEqual([
            { fn: 'recompute_transaction_status', args: { p_txn_id: 'tx-1' } },
        ]);
        expect(effectsMock).toHaveBeenCalledOnce();
    });

    it('cherche la ligne par external_reference ET rail=PAYPAL', async () => {
        await confirmPaypalPayment(fakeAdmin(), GOOD_INPUT);
        expect(h.selectFilters).toEqual([
            { col: 'external_reference', val: 'ORDER-1' },
            { col: 'rail', val: 'PAYPAL' },
        ]);
    });

    it('ne recalcule pas la transaction pour un top-up (transaction_id null)', async () => {
        h.paymentRow = { ...PROCESSING_ROW, transaction_id: null };
        await confirmPaypalPayment(fakeAdmin(), GOOD_INPUT);
        expect(h.rpcCalls).toEqual([]);
        expect(effectsMock).toHaveBeenCalledOnce();
    });

    it('passe au module d effets le contexte attendu', async () => {
        await confirmPaypalPayment(fakeAdmin(), GOOD_INPUT);
        expect(effectsMock.mock.calls[0][1]).toEqual({
            id: 'pay-1',
            shipowner_id: 'so-1',
            transaction_id: 'tx-1',
            amount_usd_minor: 125000,
        });
        expect(typeof effectsMock.mock.calls[0][2]).toBe('string');
    });
});

describe('confirmPaypalPayment — idempotence', () => {
    it('saute sans effet si la ligne est deja CONFIRMED', async () => {
        h.paymentRow = { ...PROCESSING_ROW, status: 'CONFIRMED' };
        const out = await confirmPaypalPayment(fakeAdmin(), GOOD_INPUT);
        expect(out.outcome).toBe('IDEMPOTENT_SKIP');
        expect(h.updatePayloads).toEqual([]);
        expect(effectsMock).not.toHaveBeenCalled();
    });

    it.each(['REJECTED', 'CANCELLED', 'REFUNDED'])(
        'saute sans effet si la ligne est %s',
        async (status) => {
            h.paymentRow = { ...PROCESSING_ROW, status };
            const out = await confirmPaypalPayment(fakeAdmin(), GOOD_INPUT);
            expect(out.outcome).toBe('IDEMPOTENT_SKIP');
            expect(effectsMock).not.toHaveBeenCalled();
        },
    );

    it('course perdue (0 ligne mise a jour) -> aucun effet, aucun recu en double', async () => {
        h.updateReturnsRows = false;
        const out = await confirmPaypalPayment(fakeAdmin(), GOOD_INPUT);
        expect(out.outcome).toBe('IDEMPOTENT_SKIP');
        expect(effectsMock).not.toHaveBeenCalled();
        expect(h.rpcCalls).toEqual([]);
    });

    it('ordre inconnu -> NOT_FOUND, aucune ecriture', async () => {
        h.paymentRow = null;
        const out = await confirmPaypalPayment(fakeAdmin(), GOOD_INPUT);
        expect(out.outcome).toBe('NOT_FOUND');
        expect(h.updatePayloads).toEqual([]);
    });
});

describe('confirmPaypalPayment — controle du montant', () => {
    it('rejette une devise non USD', async () => {
        const out = await confirmPaypalPayment(fakeAdmin(), {
            ...GOOD_INPUT,
            paidCurrency: 'EUR',
        });
        expect(out.outcome).toBe('REJECTED_AMOUNT_MISMATCH');
        expect(h.updatePayloads[0].status).toBe('REJECTED');
        expect(effectsMock).not.toHaveBeenCalled();

        const audit = auditMock.mock.calls[0][1];
        expect(audit.severity).toBe('WARNING');
        expect(audit.action).toBe('TRANSACTION_UPDATED');
        expect(audit.details_json.event).toBe('PAYMENT_AMOUNT_MISMATCH');
        expect(audit.details_json.reason).toBe('non_usd_currency');
        expect(audit.jurisdiction_id).toBe('jur-1');
    });

    it('rejette un ecart superieur a un cent', async () => {
        const out = await confirmPaypalPayment(fakeAdmin(), {
            ...GOOD_INPUT,
            paidAmount: '1249.50',
        });
        expect(out.outcome).toBe('REJECTED_AMOUNT_MISMATCH');
        expect(auditMock.mock.calls[0][1].details_json.expected_usd).toBe(1250);
        expect(auditMock.mock.calls[0][1].details_json.received_usd).toBe(1249.5);
    });

    it('accepte un ecart d un cent exactement (tolerance)', async () => {
        const out = await confirmPaypalPayment(fakeAdmin(), {
            ...GOOD_INPUT,
            paidAmount: '1249.99',
        });
        expect(out.outcome).toBe('CONFIRMED');
    });

    it('rejette un montant illisible', async () => {
        const out = await confirmPaypalPayment(fakeAdmin(), { ...GOOD_INPUT, paidAmount: 'abc' });
        expect(out.outcome).toBe('REJECTED_AMOUNT_MISMATCH');
        expect(auditMock.mock.calls[0][1].details_json.reason).toBe('unparseable_amount');
    });

    it('confirme quand PayPal ne renvoie pas de montant (capture connue par ailleurs)', async () => {
        const out = await confirmPaypalPayment(fakeAdmin(), {
            ...GOOD_INPUT,
            paidAmount: null,
            paidCurrency: null,
        });
        expect(out.outcome).toBe('CONFIRMED');
    });

    it('rejette meme si aucun acteur systeme n est resolvable (pas d audit, mais rejet)', async () => {
        systemActorMock.mockResolvedValue(null);
        const out = await confirmPaypalPayment(fakeAdmin(), {
            ...GOOD_INPUT,
            paidCurrency: 'EUR',
        });
        expect(out.outcome).toBe('REJECTED_AMOUNT_MISMATCH');
        expect(h.updatePayloads[0].status).toBe('REJECTED');
        expect(auditMock).not.toHaveBeenCalled();
    });
});

describe('confirmPaypalPayment — erreurs', () => {
    it('ERROR si aucun acteur systeme n est resolvable', async () => {
        systemActorMock.mockResolvedValue(null);
        const out = await confirmPaypalPayment(fakeAdmin(), GOOD_INPUT);
        expect(out.outcome).toBe('ERROR');
        expect(h.updatePayloads).toEqual([]);
        expect(effectsMock).not.toHaveBeenCalled();
    });

    it('ERROR si l UPDATE echoue', async () => {
        h.updateError = { message: 'db down' };
        const out = await confirmPaypalPayment(fakeAdmin(), GOOD_INPUT);
        expect(out.outcome).toBe('ERROR');
        expect(effectsMock).not.toHaveBeenCalled();
    });
});

describe('rejectPaypalPayment / cancelPaypalPayment', () => {
    it('rejette une ligne PROCESSING avec la raison prefixee PayPal', async () => {
        const out = await rejectPaypalPayment(fakeAdmin(), 'ORDER-1', 'INSTRUMENT_DECLINED');
        expect(out.outcome).toBe('REJECTED');
        expect(h.updatePayloads[0].status).toBe('REJECTED');
        expect(h.updatePayloads[0].rejected_reason).toBe('PayPal: INSTRUMENT_DECLINED');
    });

    it('annule une ligne PROCESSING', async () => {
        const out = await cancelPaypalPayment(fakeAdmin(), 'ORDER-1');
        expect(out.outcome).toBe('CANCELLED');
        expect(h.updatePayloads[0].status).toBe('CANCELLED');
        expect(h.updatePayloads[0].rejected_reason).toBeUndefined();
    });

    it('annule avec une raison quand elle est fournie', async () => {
        await cancelPaypalPayment(fakeAdmin(), 'ORDER-1', 'order expired (6h)');
        expect(h.updatePayloads[0].rejected_reason).toBe('PayPal: order expired (6h)');
    });

    it('ne touche pas une ligne deja CONFIRMED', async () => {
        h.paymentRow = { ...PROCESSING_ROW, status: 'CONFIRMED' };
        expect((await cancelPaypalPayment(fakeAdmin(), 'ORDER-1')).outcome).toBe(
            'IDEMPOTENT_SKIP',
        );
        expect((await rejectPaypalPayment(fakeAdmin(), 'ORDER-1', 'x')).outcome).toBe(
            'IDEMPOTENT_SKIP',
        );
        expect(h.updatePayloads).toEqual([]);
    });

    it('NOT_FOUND sur ordre inconnu', async () => {
        h.paymentRow = null;
        expect((await rejectPaypalPayment(fakeAdmin(), 'ORDER-X', 'x')).outcome).toBe('NOT_FOUND');
        expect((await cancelPaypalPayment(fakeAdmin(), 'ORDER-X')).outcome).toBe('NOT_FOUND');
    });

    it('ERROR si l UPDATE echoue', async () => {
        h.updateError = { message: 'db down' };
        expect((await rejectPaypalPayment(fakeAdmin(), 'ORDER-1', 'x')).outcome).toBe('ERROR');
    });
});
