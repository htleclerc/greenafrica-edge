import type { UploadedProof } from '@/components/payments/ProofUploader';

interface ApiProof { id: string; storage_path: string; mime_type: string; size_bytes: number }

const nameOf = (path: string) => path.split('/').pop() ?? path;

export function ownerProofAdapter(paymentId: string) {
    const base = `/api/owner/payments/${paymentId}/proofs`;
    return {
        list: async (): Promise<UploadedProof[]> => {
            const res = await fetch(base);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return (data.proofs as ApiProof[]).map((p) => ({ id: p.id, name: nameOf(p.storage_path), sizeBytes: p.size_bytes, mimeType: p.mime_type }));
        },
        upload: async (file: File): Promise<void> => {
            const fd = new FormData();
            fd.set('file', file);
            const res = await fetch(base, { method: 'POST', body: fd });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
        },
        remove: async (id: string): Promise<void> => {
            const res = await fetch(`${base}/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
        },
    };
}
