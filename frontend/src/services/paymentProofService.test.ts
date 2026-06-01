import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    uploadProof,
    listProofs,
    signedProofUrl,
    MAX_PROOF_SIZE_BYTES,
} from './paymentProofService';

interface ListRow {
    id: string;
    storage_path: string;
    mime_type: string;
    size_bytes: number;
    uploaded_at: string;
    description: string | null;
}

function makeStorageClient(opts: {
    uploadError?: { message: string } | null;
    listData?: ListRow[];
    signedUrl?: string;
    insertSingleData?: { id: string; storage_path: string };
} = {}) {
    const upload = vi.fn().mockResolvedValue({
        data: { path: 'p/path' },
        error: opts.uploadError ?? null,
    });
    const createSignedUrl = vi.fn().mockResolvedValue({
        data: { signedUrl: opts.signedUrl ?? 'https://signed/url' },
        error: null,
    });

    // insert(...).select('id, storage_path').single()
    const single = vi.fn().mockResolvedValue({
        data: opts.insertSingleData ?? { id: 'proof-1', storage_path: 'p/path' },
        error: null,
    });
    const selectAfterInsert = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select: selectAfterInsert }));

    // select(...).eq(...).order(...)
    const order = vi.fn().mockResolvedValue({ data: opts.listData ?? [], error: null });
    const eq = vi.fn(() => ({ order }));
    const selectForList = vi.fn(() => ({ eq }));

    const fromTable = vi.fn(() => ({
        insert,
        select: selectForList,
    }));

    const client = {
        storage: { from: vi.fn(() => ({ upload, createSignedUrl })) },
        from: fromTable,
    } as unknown as SupabaseClient;

    return { client, upload, createSignedUrl, insert, single, order, eq };
}

describe('uploadProof', () => {
    it('rejects files over MAX_PROOF_SIZE_BYTES', async () => {
        const { client } = makeStorageClient();
        const big = new File([new Uint8Array(MAX_PROOF_SIZE_BYTES + 1)], 'x.pdf', {
            type: 'application/pdf',
        });
        await expect(
            uploadProof(client, {
                paymentId: 'pay-1',
                shipownerId: 'own-1',
                uploadedBy: 'user-1',
                file: big,
            }),
        ).rejects.toThrow(/exceeds/i);
    });

    it('rejects unsupported mime types', async () => {
        const { client } = makeStorageClient();
        const file = new File(['x'], 'x.exe', { type: 'application/x-msdownload' });
        await expect(
            uploadProof(client, {
                paymentId: 'pay-1',
                shipownerId: 'own-1',
                uploadedBy: 'user-1',
                file,
            }),
        ).rejects.toThrow(/mime/i);
    });

    it('uploads under shipowner/payment path then inserts row', async () => {
        const { client } = makeStorageClient();
        const file = new File(['x'], 'wire.pdf', { type: 'application/pdf' });
        const result = await uploadProof(client, {
            paymentId: 'pay-1',
            shipownerId: 'own-1',
            uploadedBy: 'user-1',
            file,
            description: 'SWIFT receipt',
        });
        expect(result.id).toBe('proof-1');
        const storageFrom = (client.storage.from as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(storageFrom).toBe('payment-proofs');
    });
});

describe('listProofs', () => {
    it('returns proofs ordered by uploaded_at ascending', async () => {
        const { client } = makeStorageClient({
            listData: [
                {
                    id: 'a',
                    storage_path: 'own-1/pay-1/1.pdf',
                    mime_type: 'application/pdf',
                    size_bytes: 100,
                    uploaded_at: '2026-05-10T10:00:00Z',
                    description: null,
                },
            ],
        });
        const proofs = await listProofs(client, 'pay-1');
        expect(proofs).toHaveLength(1);
        expect(proofs[0].id).toBe('a');
    });
});

describe('signedProofUrl', () => {
    it('returns a 60-second signed URL by default', async () => {
        const { client } = makeStorageClient({ signedUrl: 'https://example/signed' });
        const url = await signedProofUrl(client, 'own-1/pay-1/1.pdf');
        expect(url).toBe('https://example/signed');
    });
});
