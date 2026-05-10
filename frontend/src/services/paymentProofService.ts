import type { SupabaseClient } from '@supabase/supabase-js';

export const MAX_PROOF_SIZE_BYTES = 5 * 1024 * 1024; // 5MB, matches mig 049 CHECK
export const ALLOWED_PROOF_MIME_TYPES = new Set([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/heic',
]);

const STORAGE_BUCKET = 'payment-proofs';

export interface PaymentProofRow {
    id: string;
    storage_path: string;
    mime_type: string;
    size_bytes: number;
    uploaded_at: string;
    description: string | null;
}

export interface UploadProofInput {
    paymentId: string;
    shipownerId: string;
    uploadedBy: string;
    file: File;
    description?: string;
}

/**
 * Upload a proof file to Supabase Storage and insert the metadata row.
 * Path convention: <shipownerId>/<paymentId>/<timestamp>-<sanitized-name>
 * Throws on size violation, mime rejection, or storage error.
 */
export async function uploadProof(
    client: SupabaseClient,
    input: UploadProofInput,
): Promise<{ id: string; storage_path: string }> {
    if (input.file.size > MAX_PROOF_SIZE_BYTES) {
        throw new Error(
            `File ${input.file.name} (${input.file.size} bytes) exceeds limit ${MAX_PROOF_SIZE_BYTES}`,
        );
    }
    if (!ALLOWED_PROOF_MIME_TYPES.has(input.file.type)) {
        throw new Error(`Unsupported mime type: ${input.file.type}`);
    }

    const sanitized = input.file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    const storagePath = `${input.shipownerId}/${input.paymentId}/${Date.now()}-${sanitized}`;

    const { error: storageError } = await client.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, input.file, {
            contentType: input.file.type,
            upsert: false,
        });
    if (storageError) throw new Error(`Storage upload failed: ${storageError.message}`);

    const { data, error } = await client
        .from('payment_proofs')
        .insert({
            payment_id: input.paymentId,
            storage_path: storagePath,
            mime_type: input.file.type,
            size_bytes: input.file.size,
            uploaded_by: input.uploadedBy,
            description: input.description ?? null,
        })
        .select('id, storage_path')
        .single();

    if (error || !data) {
        throw new Error(`payment_proofs insert failed: ${error?.message ?? 'no row'}`);
    }
    return data as { id: string; storage_path: string };
}

/**
 * List proofs for a payment, oldest first (chronological audit trail).
 */
export async function listProofs(
    client: SupabaseClient,
    paymentId: string,
): Promise<PaymentProofRow[]> {
    const { data, error } = await client
        .from('payment_proofs')
        .select('id, storage_path, mime_type, size_bytes, uploaded_at, description')
        .eq('payment_id', paymentId)
        .order('uploaded_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as PaymentProofRow[];
}

/**
 * Return a short-lived signed URL for in-browser preview/download.
 */
export async function signedProofUrl(
    client: SupabaseClient,
    storagePath: string,
    ttlSeconds = 60,
): Promise<string> {
    const { data, error } = await client.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(storagePath, ttlSeconds);
    if (error || !data) {
        throw new Error(`signed URL failed: ${error?.message ?? 'no url'}`);
    }
    return data.signedUrl;
}
