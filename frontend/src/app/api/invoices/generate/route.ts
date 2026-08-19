import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient, createTenantClient } from '@/lib/supabase/tenant';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';
import { issueInvoiceDocument } from '@/services/invoiceIssuanceService';
import { createClient as createRequestClient } from '@/lib/supabase/server';

// Re-exported so the pipeline internals stay testable from the route's own
// test file even though they now live in the shared issuance service (which
// the seed / backfill scripts also call).
export { buildHashFields, buildLineItems } from '@/services/invoiceIssuanceService';

/**
 * POST /api/invoices/generate
 *
 * Hardened invoice generation pipeline (see audit in 2026-04 fraud review):
 *
 *  1. Authenticate the caller via the SSR cookie. No auth → 401.
 *  2. Authorize by role (PORT_OFFICER, FINANCE_ADMIN, SUPERADMIN may issue
 *     for any transaction; non-SUPERADMIN staff are confined to their own
 *     jurisdiction).
 *  3. Delegate the actual issuance to `issueInvoiceDocument`, which reloads
 *     the authoritative rows, mints ref + hash + signature, renders and
 *     uploads the PDF, and writes the audit trail. The client is never
 *     trusted to supply amounts, owner names, IMOs, or refs — this kills the
 *     forge-a-PDF-in-someone-else's-name vector flagged as H1/H2.
 *  4. Mint a short-lived signed URL so the caller can fetch the PDF without
 *     the bucket being public.
 *
 * Request body (trusted fields ONLY — everything else ignored):
 *   { transactionId: string, sendEmail?: boolean }
 */

type PostBody = {
    transactionId: string;
    sendEmail?: boolean;
};

// STAFF_ROLES are the only roles that may POST /api/invoices/generate.
// SHIPPING_AGENT was removed 2026-04-21: armateurs consume proformas via the
// read-only /api/invoices/[ref]/download endpoint, they do not create them.
// MANAGER is excluded — managers onboard armateurs, they don't issue invoices.
export const STAFF_ROLES = new Set(['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN']);

export function canGenerateInvoice(role: string | null | undefined): boolean {
    return role !== null && role !== undefined && STAFF_ROLES.has(role);
}

function json(status: number, body: Record<string, unknown>) {
    return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest) {
    // ── 1. Authenticate ─────────────────────────────────────────────────
    const requestSupabase = await createRequestClient();
    const { data: authData, error: authError } = await requestSupabase.auth.getUser();
    if (authError || !authData.user) {
        return json(401, { error: 'Not authenticated' });
    }
    const callerId = authData.user.id;

    // ── Parse request body (only fields the server is willing to trust) ─
    let body: PostBody;
    try {
        body = await request.json();
    } catch {
        return json(400, { error: 'Invalid JSON body' });
    }
    const { transactionId } = body;
    const sendEmail = body.sendEmail === true;
    if (!transactionId || typeof transactionId !== 'string') {
        return json(400, { error: 'transactionId is required' });
    }

    // Resolve the transaction's jurisdiction first (find regardless of tenant),
    // confine the acting staff to it, then scope all reads/writes to it.
    let platform: SupabaseClient;
    try {
        platform = createPlatformClient();
    } catch {
        return json(500, { error: 'Supabase not configured' });
    }

    // ── 2. Load caller profile (for authz + audit) ──────────────────────
    const { data: callerProfile, error: callerProfileErr } = await platform
        .from('profiles')
        .select('id, role, full_name, email')
        .eq('id', callerId)
        .single();
    if (callerProfileErr || !callerProfile) {
        return json(403, { error: 'Profile not found' });
    }

    // ── 3. Authorize — staff only. Armateurs consume proformas via
    //       /api/invoices/[ref]/download; they do not issue them.
    if (!canGenerateInvoice(callerProfile.role)) {
        return json(403, { error: 'Forbidden' });
    }

    // ── 3b. Staff isolation: confine non-SUPERADMIN staff to the transaction's
    //        jurisdiction, then scope all writes to it (transactions + vessels are
    //        auto-filtered by jurisdiction_id by the tenant client).
    const { data: txJur } = await platform
        .from('transactions').select('jurisdiction_id').eq('id', transactionId).maybeSingle();
    if (!txJur) {
        return json(404, { error: 'Transaction not found' });
    }
    const jurisdictionId = (txJur as { jurisdiction_id: string }).jurisdiction_id;
    if (callerProfile.role !== 'SUPERADMIN') {
        const adminJurisdictionId = await getServerJurisdictionId();
        if (adminJurisdictionId !== jurisdictionId) {
            return json(403, { error: 'Forbidden: transaction belongs to another jurisdiction' });
        }
    }
    const admin = createTenantClient(jurisdictionId);

    // The /verify QR URL must point back at the origin the request came in on,
    // so a proforma issued from the staging host doesn't send verifiers to prod.
    const forwardedProto = request.headers.get('x-forwarded-proto');
    const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
    const requestOrigin = forwardedHost
        ? `${forwardedProto || 'https'}://${forwardedHost}`
        : new URL(request.url).origin;

    try {
        // ── 4. Issue the document (render + upload + persist + audit) ───
        const result = await issueInvoiceDocument({
            admin,
            transactionId,
            jurisdictionId,
            actor: {
                id: callerId,
                fullName: callerProfile.full_name || callerProfile.email || 'Unknown',
            },
            origin: requestOrigin,
            sendEmail,
        });

        if (!result.ok) {
            return json(result.status, { error: result.error });
        }

        // ── 5. Return a server-minted download URL (signed, short-lived) so
        //    the client can fetch the PDF without needing a public bucket ─
        const { data: signedUrlData } = await admin.storage
            .from('documents')
            .createSignedUrl(result.storagePath, 60 * 10); // 10 minutes

        return json(200, {
            success: true,
            invoiceRef: result.invoiceRef,
            mode: result.mode,
            badge: result.badge,
            verifyUrl: result.verifyUrl,
            pdfUrl: signedUrlData?.signedUrl ?? null,
            downloadUrl: `/api/invoices/${encodeURIComponent(result.invoiceRef)}/download?h=${result.contentHash}&s=${result.verifySignature}`,
            email: result.email,
        });
    } catch (err) {
        console.error('[Invoice API] Internal error:', err);
        return json(500, { error: err instanceof Error ? err.message : 'Internal server error' });
    }
}
