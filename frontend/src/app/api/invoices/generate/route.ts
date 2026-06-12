import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient, createTenantClient } from '@/lib/supabase/tenant';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';
import {
    generateInvoicePdf,
    statusToMode,
    buildVerifyUrl,
    hashInvoiceFields,
    signInvoiceRef,
    type InvoiceData,
    type InvoiceMode,
} from '@/services/invoiceService';
import { sendInvoiceEmail } from '@/services/emailService';
import { createClient as createRequestClient } from '@/lib/supabase/server';
import { fetchJurisdictionName } from '@/lib/jurisdictionName';

/**
 * POST /api/invoices/generate
 *
 * Hardened invoice generation pipeline (see audit in 2026-04 fraud review):
 *
 *  1. Authenticate the caller via the SSR cookie. No auth → 401.
 *  2. Authorize by role (PORT_OFFICER, FINANCE_ADMIN, SUPERADMIN may issue
 *     for any transaction; SHIPPING_AGENT only for vessels they own).
 *  3. Reload the authoritative transaction + vessel + owner rows from the
 *     DB — the PDF is rendered from DB data only. The client is not trusted
 *     to supply amounts, owner names, IMOs, or ref. This kills the forge-a-
 *     PDF-in-someone-else's-name vector flagged as H1/H2.
 *  4. Build an immutable, long invoice ref if the transaction doesn't have
 *     one yet. Compute a SHA-256 content hash and an HMAC signature. Persist
 *     the three values on the transaction row so later regenerations /
 *     verifications are idempotent.
 *  5. Render the PDF with a QR URL that carries `?h=<hash>&s=<sig>` so /verify
 *     can reject unsigned / enumerated URLs before touching the DB.
 *  6. Upload to the (now private) documents bucket. Downloads go through
 *     /api/invoices/[ref]/download which mints a time-limited signed URL
 *     after validating the same HMAC.
 *  7. Audit log (INVOICE_GENERATED always; INVOICE_SENT only for sendEmail).
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

/**
 * Returns the hash/signature fields to include in the transactions UPDATE.
 * Both values must already be present (paired) to treat the row as signed —
 * an orphaned state (hash set, signature NULL) is treated as unsigned and a
 * fresh pair is written.  Mirrors the read guard in step 7.
 *
 * NOTE (mig 089): content_hash and verify_signature are first-write-only columns
 * guarded at the DB layer.  Writing a "fresh pair" only succeeds when the row
 * currently has BOTH columns NULL (first write).  If either column is already set
 * and the recomputed value differs from the stored one, the DB will reject the
 * UPDATE with insufficient_privilege — fail-closed.  This function intentionally
 * returns {} (skip overwrite) when both are already set, which is the only path
 * that avoids the guard on regeneration.
 */
export function buildHashFields(
    tx: { content_hash: string | null | undefined; verify_signature: string | null | undefined },
    contentHash: string,
    verifySignature: string,
): Record<string, string> {
    return tx.content_hash && tx.verify_signature
        ? {}  // both already set — reuse stored values, skip overwrite
        : { content_hash: contentHash, verify_signature: verifySignature };
}

/**
 * Builds the single-element lineItems array for a carbon-tax invoice.
 * The authoritative total is always one charge: emissions × effective rate.
 */
export function buildLineItems(
    emissionsTco2: number,
    effectiveRate: number,
    totalUsd: number,
): InvoiceData['lineItems'] {
    return [
        {
            zone: 'EEZ',
            days: 1,
            emissionsTco2,
            rate: effectiveRate,
            amount: totalUsd,
            description: `Carbon tax (${emissionsTco2.toFixed(2)} tCO2 × ${effectiveRate.toFixed(2)} USD/tCO2)`,
            qtyDisplay: `${emissionsTco2.toFixed(2)} tCO2`,
            rateDisplay: `$${effectiveRate.toFixed(2)}/t`,
        },
    ];
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

    // ── 4. Reload the authoritative transaction (ignore client fields) ──
    const { data: tx, error: txErr } = await admin
        .from('transactions')
        .select('id, vessel_id, vessel_name, vessel_imo, transaction_type, emissions_tco2, tax_amount_usd, status, port_call, created_at, paid_at, invoice_ref, content_hash, verify_signature, invoice_pdf_url, proforma_sent_at, jurisdiction_id')
        .eq('id', transactionId)
        .single();
    if (txErr || !tx) {
        return json(404, { error: 'Transaction not found' });
    }

    let vesselOwnerId: string | null = null;
    let vesselOwnerEmail: string | null = null;
    let vesselOwnerName: string | null = null;
    if (tx.vessel_id) {
        const { data: vessel } = await admin
            .from('vessels')
            .select('owner_id, mmsi')
            .eq('id', tx.vessel_id)
            .single();
        vesselOwnerId = vessel?.owner_id ?? null;
    }

    if (vesselOwnerId) {
        const { data: ownerProfile } = await admin
            .from('profiles')
            .select('email, full_name')
            .eq('id', vesselOwnerId)
            .single();
        vesselOwnerEmail = ownerProfile?.email ?? null;
        vesselOwnerName = ownerProfile?.full_name ?? null;
    }
    const ownerName = vesselOwnerName || 'Unassigned shipping agent';

    // ── 5. Derive canonical fields (mode, ref, dates) ───────────────────
    const { mode, badge } = statusToMode(tx.status);
    const issueDate = new Date(tx.created_at).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'long', year: 'numeric',
    });
    const dueDate = new Date(new Date(tx.created_at).getTime() + 30 * 86400000)
        .toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

    // Canonical ref: keep existing one if already minted (idempotent re-gen),
    // otherwise build a fresh one. Use the FULL uuid first segment (8 hex)
    // + 4 hex of entropy so brute-forcing is infeasible even without the
    // HMAC layer (12 hex = 2^48 combinations).
    function mintInvoiceRef(): string {
        const year = new Date().getFullYear();
        const uuidSeg = tx!.id.split('-')[0].toLowerCase();
        const entropy = Math.floor(Math.random() * 0xFFFF).toString(16).padStart(4, '0');
        const refPrefix = mode === 'invoice' ? 'INV' : 'PRO';
        return `${refPrefix}-${year}-${uuidSeg}${entropy}`;
    }
    const invoiceRef = tx.invoice_ref || mintInvoiceRef();

    // ── 6. Resolve the transaction's sovereign name ─────────────────────
    // Use the jurisdiction_id stamped on the row (W2+). Falls back to
    // 'Republic of Somaliland' for any pre-W2 row that lacks it.
    const txRecord = tx as typeof tx & { jurisdiction_id?: string | null };
    const jurisdictionName = await fetchJurisdictionName(admin, txRecord.jurisdiction_id);

    const totalUsd = Number(tx.tax_amount_usd);
    const emissionsTco2 = Number(tx.emissions_tco2);
    // Effective $/tCO2 rate as applied to this transaction — derive it so
    // we don't need to re-read the tax_configurations table.
    const effectiveRate = emissionsTco2 > 0 ? totalUsd / emissionsTco2 : 0;

    // ── 7. Content hash + HMAC signature (first-write-only) ─────────────
    // If the row already has a content_hash from a prior generation, reuse it
    // along with its verify_signature so that any previously distributed PDF
    // (carrying those values in its QR code) continues to verify.  Only compute
    // fresh values when the row has never been signed before.
    let contentHash: string;
    let verifySignature: string;
    if (tx.content_hash && tx.verify_signature) {
        contentHash = tx.content_hash;
        verifySignature = tx.verify_signature;
    } else {
        const canonicalFields = {
            invoiceRef,
            vesselImo: tx.vessel_imo,
            vesselName: tx.vessel_name,
            ownerName,
            totalUsd,
            periodStart: issueDate,
            periodEnd: dueDate,
            mode: mode as InvoiceMode,
        };
        contentHash = hashInvoiceFields(canonicalFields);
        verifySignature = signInvoiceRef(invoiceRef, contentHash);
    }

    // Build the QR URL with the signed token so /verify can accept/reject
    // it at the edge without touching the DB.
    const forwardedProto = request.headers.get('x-forwarded-proto');
    const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
    const requestOrigin = forwardedHost
        ? `${forwardedProto || 'https'}://${forwardedHost}`
        : new URL(request.url).origin;
    const verifyUrl = buildVerifyUrl(invoiceRef, {
        origin: requestOrigin,
        contentHash,
        signature: verifySignature,
    });

    // ── 8. Render the PDF ───────────────────────────────────────────────
    const invoiceData: InvoiceData = {
        invoiceRef,
        vesselName: tx.vessel_name,
        vesselImo: tx.vessel_imo,
        vesselMmsi: '',
        ownerName,
        // Sovereign name resolved from the transaction's jurisdiction_id — never
        // hardcoded so Djibouti invoices name Djibouti, not Somaliland.
        jurisdiction: jurisdictionName,
        periodStart: issueDate,
        periodEnd: dueDate,
        emissionsTco2,
        ratePerTco2: effectiveRate,
        subtotalUsd: totalUsd,
        exemptionUsd: 0,
        totalUsd,
        mode,
        badge,
        verifyUrl,
        // Fiscal documents must not invent sub-line items.  The authoritative
        // total is a single carbon-tax charge computed as emissions × rate.
        // The old 75/20/5 "Carbon Tax / Port Call Fee / Security Surcharge"
        // split was fabricated and had no basis in the underlying regulation.
        lineItems: buildLineItems(emissionsTco2, effectiveRate, totalUsd),
    };

    try {
        const pdfBuffer = await generateInvoicePdf(invoiceData);

        // ── 9. Upload to the private documents bucket ───────────────────
        const filePrefix = mode === 'invoice' ? 'invoice' : 'proforma';
        const fileName = `invoices/${filePrefix}-${invoiceRef}.pdf`;
        const { error: uploadError } = await admin.storage
            .from('documents')
            .upload(fileName, pdfBuffer, {
                contentType: 'application/pdf',
                upsert: true,
            });
        if (uploadError) {
            console.error('[Invoice API] Upload failed:', uploadError.message);
            return json(502, { error: `Upload failed: ${uploadError.message}` });
        }

        // ── 10. Persist ref, hash, signature + pdf storage path ─────────
        // content_hash and verify_signature are first-write-only: if they are
        // already set (a previously distributed PDF carries those values in its
        // QR code), we MUST NOT overwrite them or that PDF will stop verifying.
        // Only write them when BOTH are NULL — mirrors the read guard at step 7.
        const hashFields = buildHashFields(tx, contentHash, verifySignature);
        const { error: txUpdateErr } = await admin
            .from('transactions')
            .update({
                invoice_ref: invoiceRef,
                ...hashFields,
                invoice_pdf_url: fileName, // now a storage path, not a public URL
            })
            .eq('id', transactionId);
        if (txUpdateErr) {
            console.error('[Invoice API] Transaction update failed:', txUpdateErr.message);
        }

        if (tx.vessel_id) {
            const { error: vesselError } = await admin
                .from('vessels')
                .update({ pro_forma_generated: true })
                .eq('id', tx.vessel_id);
            if (vesselError) {
                console.error('[Invoice API] Vessel update failed:', vesselError.message);
            }
        }

        // ── 11. Audit log (always fired for INVOICE_GENERATED) ──────────
        const { error: auditError } = await admin.from('audit_logs').insert({
            user_id: callerId,
            user_full_name: callerProfile.full_name || callerProfile.email || 'Unknown',
            action: 'INVOICE_GENERATED',
            severity: 'INFO',
            entity_type: 'Transaction',
            entity_id: transactionId,
            details_json: {
                vesselName: tx.vessel_name,
                invoiceRef,
                amount: totalUsd,
                mode,
                badge,
                contentHash,
            },
        });
        if (auditError) {
            console.error('[Invoice API] Audit log failed:', auditError.message);
        }

        // ── 12. Email delivery (only when explicitly requested) ─────────
        let emailResult: { success: boolean; id?: string; error?: string; skipped?: boolean } = {
            success: false,
            skipped: !sendEmail,
        };
        if (sendEmail && vesselOwnerEmail) {
            emailResult = await sendInvoiceEmail({
                to: vesselOwnerEmail,
                recipientName: ownerName,
                vesselName: tx.vessel_name,
                invoiceRef,
                amountUsd: totalUsd,
                dueDate,
                mode,
                badge,
                pdfBuffer,
                verifyUrl,
            });
            if (!emailResult.success) {
                console.error('[Invoice API] Email failed:', emailResult.error);
            }
        }

        // ── 13. On "Print & Send": stamp proforma_sent_at (first time only)
        //        + always insert an INVOICE_SENT audit entry ─────────────
        if (sendEmail) {
            if (mode === 'proforma' && !tx.proforma_sent_at) {
                const { error: sentStampError } = await admin
                    .from('transactions')
                    .update({ proforma_sent_at: new Date().toISOString() })
                    .eq('id', transactionId);
                if (sentStampError) {
                    console.error('[Invoice API] proforma_sent_at update failed:', sentStampError.message);
                }
            }

            const { error: sentAuditError } = await admin.from('audit_logs').insert({
                user_id: callerId,
                user_full_name: callerProfile.full_name || callerProfile.email || 'Unknown',
                action: 'INVOICE_SENT',
                severity: 'INFO',
                entity_type: 'Transaction',
                entity_id: transactionId,
                details_json: {
                    vesselName: tx.vessel_name,
                    invoiceRef,
                    mode,
                    badge,
                    recipientEmail: vesselOwnerEmail,
                    recipientName: ownerName,
                    delivery: {
                        provider: 'resend',
                        succeeded: emailResult.success,
                        error: emailResult.error ?? null,
                    },
                },
            });
            if (sentAuditError) {
                console.error('[Invoice API] INVOICE_SENT audit log failed:', sentAuditError.message);
            }
        }

        // ── 14. Return a server-minted download URL (signed, short-lived)
        //    so the client can fetch the PDF without needing a public bucket ─
        const { data: signedUrlData } = await admin.storage
            .from('documents')
            .createSignedUrl(fileName, 60 * 10); // 10 minutes

        return json(200, {
            success: true,
            invoiceRef,
            mode,
            badge,
            verifyUrl,
            pdfUrl: signedUrlData?.signedUrl ?? null,
            downloadUrl: `/api/invoices/${encodeURIComponent(invoiceRef)}/download?h=${contentHash}&s=${verifySignature}`,
            email: emailResult,
        });
    } catch (err) {
        console.error('[Invoice API] Internal error:', err);
        return json(500, { error: err instanceof Error ? err.message : 'Internal server error' });
    }
}
