import { headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { CheckCircle2, Clock, AlertTriangle, Shield, XCircle } from 'lucide-react';
import { verifyInvoiceSignature } from '@/services/invoiceService';
import { enforceRateLimit, getClientId } from '@/lib/rateLimit';

/**
 * Public verification page — anyone can scan the QR on a printed pro-forma
 * or invoice and land here to confirm the document is authentic.
 *
 * Security model (post-2026-04 fraud audit):
 *
 *   1. The QR URL carries `?h=<contentHash>&s=<signature>`. Without both,
 *      the page returns "Document Not Found" with NO DB lookup — this
 *      neutralizes ref-enumeration: an attacker cannot probe refs by
 *      walking `PRO-2026-00000000` → `PRO-2026-ffffffff` because every
 *      response is identical.
 *
 *   2. The signature is a constant-time HMAC-SHA256 check. Forged URLs
 *      (valid ref, wrong signature) land in the same "Not Found" branch.
 *
 *   3. Only after the signature passes do we hit the DB — by equality on
 *      `transactions.invoice_ref`. We additionally compare the DB
 *      content_hash to the URL hash to catch any mismatch (stale link,
 *      rotated signing secret, replay).
 *
 *   4. The verifier sees the authoritative fields (amount, vessel, owner,
 *      IMO) with a prominent "Compare this to your printed document — if
 *      they don't match, it's a forgery" notice. This is the only signal
 *      the verifier has that the paper copy wasn't re-typed after issue.
 */

interface VerifyResult {
    found: boolean;
    invoiceRef?: string;
    vesselName?: string;
    vesselImo?: string;
    portCall?: string;
    transactionType?: string;
    amountUsd?: number;
    status?: 'PENDING' | 'PAID' | 'OVERDUE' | 'EXEMPT' | 'DISPUTED';
    paidAt?: string | null;
    createdAt?: string;
    contentHash?: string;
    downloadUrl?: string | null;
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

    // No signature tokens → treat as "not found" so enumeration attempts
    // get the same response as a missing ref.
    if (!hash || !signature) return { found: false };
    if (!verifyInvoiceSignature(ref, hash, signature)) return { found: false };

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) return { found: false };

    // Using the anon key + SECURITY DEFINER RPC so the set of columns
    // reachable from this public endpoint is hard-capped at the DB layer.
    // A future refactor that tries to read extra columns would need to
    // alter the function signature — a deliberate, reviewable change.
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

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; Icon: typeof CheckCircle2 }> = {
    PAID:     { label: 'Paid',      color: '#10B981', bg: 'rgba(16,185,129,0.1)', Icon: CheckCircle2 },
    PENDING:  { label: 'To Pay',    color: '#EAB308', bg: 'rgba(234,179,8,0.1)',  Icon: Clock },
    OVERDUE:  { label: 'Overdue',   color: '#DC2626', bg: 'rgba(220,38,38,0.1)',  Icon: AlertTriangle },
    DISPUTED: { label: 'Disputed',  color: '#F97316', bg: 'rgba(249,115,22,0.1)', Icon: AlertTriangle },
    EXEMPT:   { label: 'Exempt',    color: '#0EA5E9', bg: 'rgba(14,165,233,0.1)', Icon: Shield },
};

export default async function VerifyPage({
    params,
    searchParams,
}: {
    params: Promise<{ ref: string }>;
    searchParams: Promise<{ h?: string; s?: string }>;
}) {
    const { ref } = await params;
    const { h, s } = await searchParams;
    const result = await fetchVerifiedInvoice(ref, h ?? null, s ?? null);

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

                {/* Status content */}
                {!result.found ? (
                    <div style={{ padding: '40px 24px', textAlign: 'center' }}>
                        <XCircle style={{ width: '48px', height: '48px', color: '#DC2626', margin: '0 auto 12px' }} />
                        <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'white', margin: '0 0 6px' }}>Document Not Found</h1>
                        <p style={{ fontSize: '12px', color: '#94A3B8', margin: 0 }}>
                            The verification link is missing, invalid, or the document does not exist.
                        </p>
                        <p style={{ fontSize: '11px', color: '#64748B', marginTop: '16px' }}>
                            Always scan the QR code printed on an original document — typed or altered
                            links will not verify.
                        </p>
                    </div>
                ) : (() => {
                    const config = STATUS_CONFIG[result.status || 'PENDING'];
                    const Icon = config.Icon;
                    return (
                        <>
                            {/* Status hero */}
                            <div style={{
                                padding: '32px 24px',
                                background: config.bg,
                                textAlign: 'center',
                                borderBottom: '1px solid rgba(255,255,255,0.06)',
                            }}>
                                <Icon style={{ width: '56px', height: '56px', color: config.color, margin: '0 auto 12px' }} />
                                <p style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', letterSpacing: '2px', margin: 0 }}>
                                    DOCUMENT STATUS
                                </p>
                                <h1 style={{ fontSize: '32px', fontWeight: 800, color: config.color, margin: '4px 0', letterSpacing: '-0.5px' }}>
                                    {config.label.toUpperCase()}
                                </h1>
                                <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#64748B', margin: 0 }}>
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
                                    label="Amount Due"
                                    value={`$${result.amountUsd?.toLocaleString('en-US', { maximumFractionDigits: 0 })} USD`}
                                    bold
                                    highlight={config.color}
                                />
                                <DetailRow
                                    label="Issued"
                                    value={result.createdAt ? new Date(result.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}
                                />
                                {result.paidAt && (
                                    <DetailRow
                                        label="Paid On"
                                        value={new Date(result.paidAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        highlight="#10B981"
                                    />
                                )}
                            </div>

                            {/* Content-hash fingerprint — small, so paranoid verifiers
                                 can cross-check the 8-char prefix vs the PDF metadata */}
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
                })()}

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
