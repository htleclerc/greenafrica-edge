import { createClient } from '@supabase/supabase-js';
import { CheckCircle2, Clock, AlertTriangle, Shield, XCircle } from 'lucide-react';

/**
 * Public verification page — anyone can scan a QR code on a printed
 * pro-forma or invoice and land here to check the document's status
 * in real time.
 *
 * No auth required. Read-only. Uses service_role key on the server
 * to bypass RLS, but only returns a small public-safe summary.
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
    pdfUrl?: string | null;
}

async function fetchInvoiceStatus(ref: string): Promise<VerifyResult> {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        return { found: false };
    }

    const admin = createClient(supabaseUrl, supabaseKey);

    // Strip the prefix (PRO- or INV-) and look up the transaction by ID suffix
    // The ref format is {PRO|INV}-{YEAR}-{TX_ID_SUFFIX} where TX_ID_SUFFIX is the
    // first segment of the transaction UUID after the dash.
    const match = ref.match(/^(PRO|INV)-\d{4}-(.+)$/i);
    if (!match) return { found: false };

    const idSuffix = match[2].toLowerCase();

    // Find transaction whose id starts with the suffix
    const { data: txs } = await admin
        .from('transactions')
        .select('id, vessel_name, vessel_imo, port_call, transaction_type, tax_amount_usd, status, paid_at, created_at, invoice_pdf_url')
        .ilike('id', `${idSuffix}%`)
        .limit(1);

    if (!txs || txs.length === 0) return { found: false };
    const tx = txs[0];

    return {
        found: true,
        invoiceRef: ref.toUpperCase(),
        vesselName: tx.vessel_name,
        vesselImo: tx.vessel_imo,
        portCall: tx.port_call,
        transactionType: tx.transaction_type,
        amountUsd: Number(tx.tax_amount_usd),
        status: tx.status,
        paidAt: tx.paid_at,
        createdAt: tx.created_at,
        pdfUrl: tx.invoice_pdf_url,
    };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; Icon: typeof CheckCircle2 }> = {
    PAID:     { label: 'Paid',      color: '#10B981', bg: 'rgba(16,185,129,0.1)', Icon: CheckCircle2 },
    PENDING:  { label: 'To Pay',    color: '#EAB308', bg: 'rgba(234,179,8,0.1)',  Icon: Clock },
    OVERDUE:  { label: 'Overdue',   color: '#DC2626', bg: 'rgba(220,38,38,0.1)',  Icon: AlertTriangle },
    DISPUTED: { label: 'Disputed',  color: '#F97316', bg: 'rgba(249,115,22,0.1)', Icon: AlertTriangle },
    EXEMPT:   { label: 'Exempt',    color: '#0EA5E9', bg: 'rgba(14,165,233,0.1)', Icon: Shield },
};

export default async function VerifyPage({ params }: { params: Promise<{ ref: string }> }) {
    const { ref } = await params;
    const result = await fetchInvoiceStatus(ref);

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
                            <p style={{ fontSize: '14px', fontWeight: 800, color: 'white', margin: 0, letterSpacing: '-0.3px' }}>AFRICGREEN</p>
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
                            No document matches reference <code style={{ color: '#10B981', fontFamily: 'monospace' }}>{ref}</code>
                        </p>
                        <p style={{ fontSize: '11px', color: '#64748B', marginTop: '16px' }}>
                            If you believe this is an error, contact the Maritime Carbon Tax Authority.
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

                            {/* Details */}
                            <div style={{ padding: '20px 24px' }}>
                                <DetailRow label="Vessel" value={result.vesselName} />
                                <DetailRow label="IMO Number" value={result.vesselImo} mono />
                                <DetailRow label="Port of Call" value={result.portCall} />
                                <DetailRow label="Transaction Type" value={result.transactionType?.replace('_', ' ')} />
                                <DetailRow
                                    label="Amount Due"
                                    value={`$${result.amountUsd?.toLocaleString()} USD`}
                                    bold
                                />
                                <DetailRow
                                    label="Issued"
                                    value={result.createdAt ? new Date(result.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}
                                />
                                {result.paidAt && (
                                    <DetailRow
                                        label="Paid On"
                                        value={new Date(result.paidAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        highlight={config.color}
                                    />
                                )}
                            </div>

                            {result.pdfUrl && (
                                <div style={{ padding: '0 24px 20px' }}>
                                    <a
                                        href={result.pdfUrl}
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
                        Republic of Somaliland · Maritime Carbon Tax Authority · AES-256 Encrypted
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
