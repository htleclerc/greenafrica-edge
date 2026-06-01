// frontend/src/components/dashboard/invoices/legacyProofAdapter.ts
import type { UploadedProof } from '@/components/payments/ProofUploader';

interface ApiEntry { path: string; mime_type: string; size_bytes: number }
const nameOf = (path: string) => path.split('/').pop() ?? path;

export function legacyProofAdapter(transactionId: string) {
    const base = `/api/transactions/${transactionId}/proof`;
    return {
        list: async (): Promise<UploadedProof[]> => {
            const res = await fetch(`${base}/list`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return (data.proofs as ApiEntry[]).map((p) => ({ id: p.path, name: nameOf(p.path), sizeBytes: p.size_bytes, mimeType: p.mime_type }));
        },
        upload: async (file: File): Promise<void> => {
            const fd = new FormData();
            fd.set('file', file);
            const res = await fetch(base, { method: 'POST', body: fd });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
        },
        remove: async (id: string): Promise<void> => {
            const res = await fetch(`${base}?path=${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
        },
    };
}
