import { headers } from 'next/headers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { CheckCircle2, Shield, XCircle, FileText, Receipt, RotateCcw } from 'lucide-react';
import { parseInvoiceRef, verifyInvoiceSignature } from '@/services/invoiceService';
import { enforceRateLimit, getClientId } from '@/lib/rateLimit';
import { paymentBadge, type VerifyStatus } from './paymentBadge';

/**
 * Public verification page — anyone can scan the QR on a printed pro-forma
 * or receipt and land here to confirm the document is authentic.
 *
 * Security model (post-2026-04 fraud audit):
 *
 *   1. The QR URL carries `?h=<contentHash>&s=<signature>`. Without both,
 *      the page returns "Unknown Document" with NO DB lookup — this
 *      neutralizes ref-enumeration: an attacker cannot probe refs by
 *      walking `PRO-2026-00000000` → `PRO-2026-ffffffff` because every
 *      response is identical.
 *
 *   2. The signature is a constant-time HMAC-SHA256 check. Forged URLs
 *      (valid ref, wrong signature) land in the same "Unknown" branch.
 *
 *   3. Only after the signature passes do we hit the DB — by equality on
 *      `transactions.invoice_ref`. We additionally compare the DB
 *      content_hash to the URL hash to catch any mismatch (stale link,
 *      rotated signing secret, replay).
 *
 *   4. The verifier sees the authoritative fields (amount, vessel, owner,
 *      IMO) plus a label that names the document flavor (Pro-forma /
 *      Receipt / Refund) and a generation date. For receipts we also call
 *      out the payment state (Paid, Unpaid, In Default) so the operator
 *      doesn't have to interpret an enum.
 */

type DocumentType = 'PROFORMA' | 'FINAL' | 'COMPLEMENT' | 'REFUND';

interface VerifyResult {
    found: boolean;
    invoiceRef?: string;
    documentType?: DocumentType;
    vesselName?: string;
    vesselImo?: string;
    portCall?: string;
    transactionType?: string;
    amountUsd?: number;
    status?: VerifyStatus;
    paidAt?: string | null;
    createdAt?: string;
    contentHash?: string;
    downloadUrl?: string | null;
}

/**
 * Receipt verify shape — distinct from VerifyResult so the renderer can
 * branch on `kind: 'receipt'` and pull payment-specific fields without
 * polluting the transaction-shaped invoice contract.
 *
 * Plan 7C-4: receipts (RCT-YYYY-XXXX) live in `payments`, not `transactions`.
 * They have no `content_hash` column — see security note in fetchVerifiedReceipt.
 */
interface ReceiptVerifyResult {
    found: boolean;
    receiptRef?: string;
    invoiceRef?: string;
    vesselName?: string;
    vesselImo?: string;
    ownerName?: string;
    amountUsd?: number;
    currency?: string;
    rail?: string;
    confirmedAt?: string | null;
    generatedAt?: string | null;
}

async function fetchVerifiedInvoice(
    ref: string,
    hash: string | null,
    signature: string | null,
): Promise<VerifyResult> {
    // Per-IP throttle. Returns { found: false } when exceeded so the
    // response shape is identical to "ref doesn't exist" / "bad signature"
    // — attackers can't distinguish throttling from missing data.
    const h = await headers();
    const clientId = getClientId(h);
    const rate = await enforceRateLimit('verify', clientId);
    if (!rate.allowed) return { found: false };

    if (!hash || !signature) return { found: false };
    if (!verifyInvoiceSignature(ref, hash, signature)) return { found: false };

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) return { found: false };

    const anon = createClient(supabaseUrl, anonKey);

    const { data, error } = await anon.rpc('verify_invoice_lookup', {
        p_ref: ref,
        p_hash: hash,
    });

    if (error || !data || data.length === 0) return { found: false };
    const tx = data[0];

    return {
        found: true,
        invoiceRef: tx.invoice_ref ?? ref,
        documentType: (tx.document_type ?? 'FINAL') as DocumentType,
        vesselName: tx.vessel_name,
        vesselImo: tx.vessel_imo,
        portCall: tx.port_call ?? '—',
        transactionType: tx.transaction_type,
        amountUsd: Number(tx.tax_amount_usd),
        status: tx.status as VerifyResult['status'],
        paidAt: tx.paid_at,
        createdAt: tx.created_at,
        contentHash: tx.content_hash ?? undefined,
        downloadUrl: `/api/invoices/${encodeURIComponent(ref)}/download?h=${hash}&s=${signature}`,
    };
}

/**
 * Fetch a receipt by its RCT-YYYY-XXXX ref. Plan 7C-4.
 *
 * SECURITY MODEL — divergence from invoices:
 *   The receipt PDF embeds an UNSIGNED verify URL (see invoiceService
 *   `generateReceiptPdf` line ~758: `buildVerifyUrl(receiptRef)` is called
 *   without `contentHash`/`signature`). Therefore this branch CANNOT
 *   require an HMAC signature on the URL — doing so would break every
 *   already-issued receipt PDF in the wild. We accept this trade-off
 *   because:
 *
 *     1. RCT refs are RCT-YYYY-XXXXXXXX where XXXXXXXX is the first 8
 *        hex chars of a UUIDv4. That is 16^8 ≈ 4.3 billion values per
 *        year — enumeration is impractical.
 *
 *     2. The same per-IP rate limit (`verify` bucket) applied to invoice
 *        lookups is applied here, so a brute-force scanner is throttled.
 *
 *     3. The "found vs not found" response shape is identical (anti-
 *        enumeration) — same UnknownDocumentBlock for both branches.
 *
 *   When the security team requires stricter defense-in-depth, the
 *   follow-up is to (a) update `generateReceiptPdf` to embed `?s=<sig>`
 *   and (b) re-introduce the signature check here with a flag for legacy
 *   unsigned receipts. Tracked as TECH_DEBT in plan 7C-4 retro.
 */
async function fetchVerifiedReceipt(ref: string): Promise<ReceiptVerifyResult> {
    // Rate-limit identically to the invoice path so the response shape
    // is indistinguishable to a probing client.
    const h = await headers();
    const clientId = getClientId(h);
    const rate = await enforceRateLimit('verify', clientId);
    if (!rate.allowed) return { found: false };

    // Use the service role for the lookup ONLY because RLS on `payments`
    // restricts owner-row access to authenticated shipowners; the public
    // verify page has no auth session. We project a hard-coded whitelist
    // of columns and join paths so this can never leak unrelated rows.
    // receipt_ref is globally unique and this public page carries no tenant
    // context, so the UNSCOPED platform factory is correct (verifying any
    // jurisdiction's receipt by QR is by design). It throws on missing env;
    // swallow that and return the uniform "not found" shape.
    let svc: SupabaseClient;
    try {
        svc = createPlatformClient();
    } catch {
        return { found: false };
    }

    type PaymentRow = {
        receipt_ref: string | null;
        receipt_generated_at: string | null;
        amount_usd_minor: number;
        currency: string;
        rail: string;
        confirmed_at: string | null;
        shipowner: { name: string | null } | null;
        transaction: { invoice_ref: string | null; vessel_name: string | null; vessel_imo: string | null } | null;
    };

    const { data, error } = await svc
        .from('payments')
        .select(`
            receipt_ref,
            receipt_generated_at,
            amount_usd_minor,
            currency,
            rail,
            confirmed_at,
            shipowner:shipowners(name),
            transaction:transactions(invoice_ref, vessel_name, vessel_imo)
        `)
        .eq('receipt_ref', ref)
        .maybeSingle<PaymentRow>();

    if (error || !data) return { found: false };

    return {
        found: true,
        receiptRef: data.receipt_ref ?? ref,
        invoiceRef: data.transaction?.invoice_ref ?? '—',
        vesselName: data.transaction?.vessel_name ?? '—',
        vesselImo: data.transaction?.vessel_imo ?? '—',
        ownerName: data.shipowner?.name ?? '—',
        amountUsd: Number(data.amount_usd_minor) / 100,
        currency: data.currency,
        rail: data.rail,
        confirmedAt: data.confirmed_at,
        generatedAt: data.receipt_generated_at,
    };
}

interface DocumentDescriptor {
    kind: 'proforma' | 'receipt' | 'refund';
    title: string;          // e.g. "Pro-forma Invoice"
    issueLabel: string;     // e.g. "Pro-forma generated on"
    Icon: typeof FileText;
    accent: string;         // hex
}

function describeDocument(documentType: DocumentType): DocumentDescriptor {
    switch (documentType) {
        case 'PROFORMA':
            return {
                kind: 'proforma',
                title: 'Pro-forma Invoice',
                issueLabel: 'Pro-forma generated on',
                Icon: FileText,
                accent: '#EAB308',
            };
        case 'REFUND':
            return {
                kind: 'refund',
                title: 'Refund Note',
                issueLabel: 'Refund note generated on',
                Icon: RotateCcw,
                accent: '#0EA5E9',
            };
        case 'COMPLEMENT':
            return {
                kind: 'receipt',
                title: 'Complementary Receipt',
                issueLabel: 'Receipt generated on',
                Icon: Receipt,
                accent: '#10B981',
            };
        case 'FINAL':
        default:
            return {
                kind: 'receipt',
                title: 'Tax Receipt',
                issueLabel: 'Receipt generated on',
                Icon: Receipt,
                accent: '#10B981',
            };
    }
}


function formatDate(iso?: string, withTime = false): string {
    if (!iso) return '—';
    const opts: Intl.DateTimeFormatOptions = withTime
        ? { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { day: '2-digit', month: 'long', year: 'numeric' };
    return new Date(iso).toLocaleDateString('en-GB', opts);
}

export default async function VerifyPage({
    params,
    searchParams,
}: {
    params: Promise<{ ref: string }>;
    searchParams: Promise<{ h?: string; s?: string }>;
}) {
    const { ref } = await params;
    const { h, s } = await searchParams;

    // Plan 7C-4: receipts (RCT-YYYY-XXXX) live in `payments`, not
    // `transactions`. Branch BEFORE the invoice path so the result shape
    // doesn't have to be unified. See fetchVerifiedReceipt for the
    // security model (no HMAC; rate-limited; uniform 'not found' shape).
    const parsed = parseInvoiceRef(ref);
    const isReceipt = parsed?.type === 'RCT';
    const receiptResult = isReceipt ? await fetchVerifiedReceipt(ref) : null;
    const result = isReceipt
        ? { found: false } as VerifyResult
        : await fetchVerifiedInvoice(ref, h ?? null, s ?? null);

    return (
        <div
            style={{
                minHeight: '100vh',
                background: 'linear-gradient(180deg, #0A1110 0%, #0D1F18 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px',
                fontFamily: 'var(--font-plex), "IBM Plex Sans", "Open Sans", -apple-system, sans-serif',
            }}
        >
            <div
                style={{
                    width: '100%',
                    maxWidth: '480px',
                    background: '#111C18',
                    borderRadius: '16px',
                    border: '1px solid rgba(255,255,255,0.08)',
                    overflow: 'hidden',
                    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
                }}
            >
                {/* Top accent bar */}
                <div style={{ height: '4px', background: 'linear-gradient(90deg, #047857 0%, #10B981 50%, #EAB308 100%)' }} />

                {/* Header */}
                <div style={{ padding: '24px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#10B981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Shield style={{ width: '18px', height: '18px', color: 'white' }} />
                        </div>
                        <div>
                            <p style={{ fontSize: '14px', fontWeight: 800, color: 'white', margin: 0, letterSpacing: '-0.3px' }}>GREEN GATE</p>
                            <p style={{ fontSize: '8px', fontWeight: 700, color: '#10B981', margin: 0, letterSpacing: '1.5px' }}>SOVEREIGN CARBON PLATFORM</p>
                        </div>
                    </div>
                    <p style={{ fontSize: '11px', color: '#64748B', margin: 0 }}>Document Verification Service</p>
                </div>

                {isReceipt ? (
                    receiptResult?.found
                        ? <ReceiptVerifyView result={receiptResult} />
                        : <UnknownDocumentBlock />
                ) : !result.found ? (
                    <UnknownDocumentBlock />
                ) : (
                    <FoundDocumentBlock result={result} />
                )}

                {/* Footer */}
                <div style={{
                    padding: '12px 24px',
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    fontSize: '9px',
                    color: '#475569',
                    textAlign: 'center',
                }}>
                    <p style={{ margin: 0 }}>
                        Republic of Somaliland · Maritime Carbon Tax Authority · Verified by SOLIDE TECHNOLOGY
                    </p>
                </div>
            </div>
        </div>
    );
}

function UnknownDocumentBlock() {
    return (
        <div style={{ padding: '40px 24px', textAlign: 'center' }}>
            <XCircle style={{ width: '48px', height: '48px', color: '#DC2626', margin: '0 auto 12px' }} />
            <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'white', margin: '0 0 6px' }}>Unknown Document</h1>
            <p style={{ fontSize: '12px', color: '#94A3B8', margin: 0, lineHeight: 1.5 }}>
                This document was not issued by Green Gate, or the verification link
                has been altered after printing.
            </p>
            <p style={{ fontSize: '11px', color: '#64748B', marginTop: '16px', lineHeight: 1.5 }}>
                Always scan the QR code printed on an original document — typed or
                hand-edited links cannot be verified.
            </p>
        </div>
    );
}

function FoundDocumentBlock({ result }: { result: VerifyResult }) {
    const descriptor = describeDocument(result.documentType ?? 'FINAL');
    const badge = paymentBadge(descriptor, result.status);
    const HeroIcon = badge?.Icon ?? descriptor.Icon;
    const heroColor = badge?.color ?? descriptor.accent;
    const heroBg = badge?.bg ?? 'rgba(255,255,255,0.03)';

    return (
        <>
            {/* Document type hero — always names the document flavor first,
                  then (when applicable) the payment state underneath. */}
            <div style={{
                padding: '32px 24px',
                background: heroBg,
                textAlign: 'center',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
                <HeroIcon style={{ width: '56px', height: '56px', color: heroColor, margin: '0 auto 12px' }} />
                <p style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', letterSpacing: '2px', margin: 0 }}>
                    {descriptor.title.toUpperCase()}
                </p>
                {badge && (
                    <h1 style={{ fontSize: '28px', fontWeight: 800, color: heroColor, margin: '4px 0', letterSpacing: '-0.5px' }}>
                        {badge.label.toUpperCase()}
                    </h1>
                )}
                <p style={{ fontSize: '12px', color: '#94A3B8', margin: '4px 0 0' }}>
                    {descriptor.issueLabel}{' '}
                    <strong style={{ color: 'white' }}>{formatDate(result.createdAt)}</strong>
                </p>
                <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#64748B', marginTop: '8px' }}>
                    {result.invoiceRef}
                </p>
            </div>

            {/* Anti-forgery notice */}
            <div style={{
                margin: '16px 24px 0',
                padding: '10px 12px',
                background: 'rgba(16,185,129,0.08)',
                borderLeft: '3px solid #10B981',
                borderRadius: '6px',
                fontSize: '11px',
                color: '#94A3B8',
                lineHeight: 1.5,
            }}>
                <strong style={{ color: '#10B981' }}>Verify these fields</strong> against your printed document.
                If the amount, vessel, or IMO differ, <strong style={{ color: '#DC2626' }}>the document is a forgery</strong> —
                contact the Maritime Carbon Tax Authority.
            </div>

            {/* Details */}
            <div style={{ padding: '12px 24px 4px' }}>
                <DetailRow label="Vessel" value={result.vesselName} bold />
                <DetailRow label="IMO Number" value={result.vesselImo} mono />
                <DetailRow label="Port of Call" value={result.portCall} />
                <DetailRow label="Transaction Type" value={result.transactionType?.replace('_', ' ')} />
                <DetailRow
                    label={descriptor.kind === 'refund' ? 'Refund Amount' : 'Amount Due'}
                    value={`$${result.amountUsd?.toLocaleString('en-US', { maximumFractionDigits: 0 })} USD`}
                    bold
                    highlight={heroColor}
                />
                {result.paidAt && (
                    <DetailRow
                        label="Paid On"
                        value={formatDate(result.paidAt, true)}
                        highlight="#10B981"
                    />
                )}
            </div>

            {/* Content-hash fingerprint — small, so paranoid verifiers
                  can cross-check the 16-char prefix vs the PDF metadata */}
            {result.contentHash && (
                <div style={{ padding: '4px 24px 12px', fontFamily: 'monospace', fontSize: '10px', color: '#475569' }}>
                    Fingerprint: {result.contentHash.slice(0, 16)}…
                </div>
            )}

            {result.downloadUrl && (
                <div style={{ padding: '0 24px 20px' }}>
                    <a
                        href={result.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            display: 'block',
                            textAlign: 'center',
                            padding: '12px',
                            background: '#10B981',
                            color: '#0D1F18',
                            fontSize: '12px',
                            fontWeight: 700,
                            textDecoration: 'none',
                            borderRadius: '10px',
                            letterSpacing: '0.5px',
                        }}
                    >
                        Download Original PDF →
                    </a>
                </div>
            )}
        </>
    );
}

/**
 * Plan 7C-4: receipt-shaped verification view.
 *
 * Mirrors the FoundDocumentBlock layout (hero + anti-forgery notice +
 * details) but pulls payment-specific fields (rail, currency, amount,
 * confirmed_at, generated_at) from the `payments` table. No badge logic —
 * a receipt that is rendered on this page is by definition CONFIRMED
 * (only CONFIRMED payments get a receipt_ref via mig 061 + receiptService).
 */
function ReceiptVerifyView({ result }: { result: ReceiptVerifyResult }) {
    const heroColor = '#10B981'; // emerald — matches PAID stamp on receipt PDF
    const heroBg = 'rgba(16,185,129,0.1)';
    return (
        <>
            {/* Hero — names the document and surfaces the PAID state */}
            <div style={{
                padding: '32px 24px',
                background: heroBg,
                textAlign: 'center',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
                <CheckCircle2 style={{ width: '56px', height: '56px', color: heroColor, margin: '0 auto 12px' }} />
                <p style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', letterSpacing: '2px', margin: 0 }}>
                    OFFICIAL RECEIPT
                </p>
                <h1 style={{ fontSize: '28px', fontWeight: 800, color: heroColor, margin: '4px 0', letterSpacing: '-0.5px' }}>
                    PAID
                </h1>
                <p style={{ fontSize: '12px', color: '#94A3B8', margin: '4px 0 0' }}>
                    Receipt issued on{' '}
                    <strong style={{ color: 'white' }}>{formatDate(result.generatedAt ?? undefined)}</strong>
                </p>
                <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#64748B', marginTop: '8px' }}>
                    {result.receiptRef}
                </p>
            </div>

            {/* Anti-forgery notice */}
            <div style={{
                margin: '16px 24px 0',
                padding: '10px 12px',
                background: 'rgba(16,185,129,0.08)',
                borderLeft: '3px solid #10B981',
                borderRadius: '6px',
                fontSize: '11px',
                color: '#94A3B8',
                lineHeight: 1.5,
            }}>
                <strong style={{ color: '#10B981' }}>Verify these fields</strong> against your printed receipt.
                If the amount, vessel, or invoice reference differ,{' '}
                <strong style={{ color: '#DC2626' }}>the receipt is a forgery</strong> —
                contact the Maritime Carbon Tax Authority.
            </div>

            {/* Details */}
            <div style={{ padding: '12px 24px 4px' }}>
                <DetailRow label="Owner"        value={result.ownerName} bold />
                <DetailRow label="Vessel"       value={result.vesselName} />
                <DetailRow label="IMO Number"   value={result.vesselImo} mono />
                <DetailRow label="Settles"      value={result.invoiceRef} mono />
                <DetailRow label="Payment Rail" value={result.rail?.replace(/_/g, ' ')} />
                <DetailRow
                    label="Amount Paid"
                    value={`$${result.amountUsd?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${result.currency ?? 'USD'}`}
                    bold
                    highlight={heroColor}
                />
                {result.confirmedAt && (
                    <DetailRow
                        label="Confirmed On"
                        value={formatDate(result.confirmedAt, true)}
                        highlight="#10B981"
                    />
                )}
            </div>

            <div style={{ padding: '8px 24px 20px', fontSize: '10px', color: '#475569', textAlign: 'center' }}>
                ✓ This receipt was issued by Green Gate.
            </div>
        </>
    );
}

function DetailRow({ label, value, mono, bold, highlight }: {
    label: string;
    value?: string | number | null;
    mono?: boolean;
    bold?: boolean;
    highlight?: string;
}) {
    return (
        <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 0',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
        }}>
            <span style={{ fontSize: '11px', color: '#64748B', letterSpacing: '0.3px' }}>{label}</span>
            <span style={{
                fontSize: '12px',
                color: highlight || (bold ? '#10B981' : 'white'),
                fontWeight: bold ? 700 : 500,
                fontFamily: mono ? 'monospace' : 'inherit',
            }}>
                {value || '—'}
            </span>
        </div>
    );
}
