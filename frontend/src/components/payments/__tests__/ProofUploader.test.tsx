import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ProofUploader, type UploadedProof } from '../ProofUploader';

// The component calls useTranslations('OwnerPortal.proofUpload'), but those i18n
// keys are added in a later task and do not exist yet. A local next-intl mock
// (scoped to this test file only) returns the key so the component renders
// without a missing-message error, and keeps this test independent of the global
// test setup so other component tests are unaffected.
vi.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));

function makeAdapter(initial: UploadedProof[]) {
    const proofs = [...initial];
    return {
        list: vi.fn(async () => [...proofs]),
        upload: vi.fn(async (f: File) => { proofs.push({ id: `id-${proofs.length}`, name: f.name, sizeBytes: f.size, mimeType: f.type }); }),
        remove: vi.fn(async (id: string) => { const i = proofs.findIndex((p) => p.id === id); if (i >= 0) proofs.splice(i, 1); }),
    };
}

describe('ProofUploader', () => {
    it('lists existing proofs on mount', async () => {
        const a = makeAdapter([{ id: 'pr1', name: 'mt103.pdf', sizeBytes: 2048, mimeType: 'application/pdf' }]);
        render(<ProofUploader list={a.list} upload={a.upload} remove={a.remove} />);
        expect(await screen.findByText('mt103.pdf')).toBeInTheDocument();
    });

    it('rejects an oversize file without calling upload', async () => {
        const a = makeAdapter([]);
        render(<ProofUploader list={a.list} upload={a.upload} remove={a.remove} maxSizeBytes={10} />);
        await screen.findByTestId('proof-input');
        const big = new File([new Uint8Array(20)], 'big.pdf', { type: 'application/pdf' });
        fireEvent.change(screen.getByTestId('proof-input'), { target: { files: [big] } });
        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
        expect(a.upload).not.toHaveBeenCalled();
    });
});
