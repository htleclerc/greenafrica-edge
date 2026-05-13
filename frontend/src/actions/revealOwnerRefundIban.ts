'use server';

import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { decryptIban } from '@/services/kycService';

// ─────────────────────────────────────────────────────────────────────────────
// Plan 7G — Task 9: revealOwnerRefundIban
//
// Admin-only audited action that decrypts a shipowner's IBAN for the refund
// arbitration drawer (WIRE_TRANSFER rail). Every reveal is logged with the
// admin's identity + the shipowner_id; volume can be reviewed in the admin
// audit dashboard to surface abuse / spamming.
//
// NEVER persist the decrypted IBAN past the request — the UI receives it,
// displays it, and discards on close. The encrypted token in
// shipowners.iban stays untouched.
// ─────────────────────────────────────────────────────────────────────────────

const schema = z.object({
    shipownerId: z.string().uuid(),
});

// NOTE: type kept un-exported — 'use server' files can only export async
// functions (memory gotcha: even `export type` makes next build fail at
// page-data collection on some Next.js versions). Callers infer via
// `Awaited<ReturnType<typeof revealOwnerRefundIban>>`.
type RevealOwnerRefundIbanResult =
    | { ok: true; iban: string }
    | { ok: false; error: string };

export async function revealOwnerRefundIban(input: {
    shipownerId: string;
}): Promise<RevealOwnerRefundIbanResult> {
    const parsed = schema.parse(input);

    const auth = await requireRole([UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN]);
    if (auth.error || !auth.user) {
        return { ok: false, error: 'Not authorized' };
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key);

    // 1. Look up the shipowner's encrypted IBAN.
    const { data: row, error: rowErr } = await admin
        .from('shipowners')
        .select('iban')
        .eq('id', parsed.shipownerId)
        .maybeSingle();
    if (rowErr) return { ok: false, error: rowErr.message };
    if (!row) return { ok: false, error: 'Shipowner not found' };
    const encrypted = (row as { iban: string | null }).iban;
    if (!encrypted) return { ok: false, error: 'No IBAN on file for this shipowner' };

    // 2. Decrypt via the runtime-detected strategy (vault → pgsodium → plaintext).
    let plaintext: string;
    try {
        plaintext = await decryptIban(encrypted);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `Decryption failed: ${msg}` };
    }

    // 3. Audit log — fire-and-forget; failures must not block the reveal
    //    response (admin already has the plaintext in this scope).
    try {
        await admin.from('audit_logs').insert({
            user_id: auth.user.id,
            user_full_name: auth.user.fullName,
            action: 'TRANSACTION_UPDATED',
            severity: 'INFO',
            entity_type: 'Shipowner',
            entity_id: parsed.shipownerId,
            details_json: { event: 'IBAN_REVEALED' },
        });
    } catch (err) {
        // Log only — don't fail the response.
        console.error('[revealOwnerRefundIban] audit_log insert failed:', err);
    }

    return { ok: true, iban: plaintext };
}
