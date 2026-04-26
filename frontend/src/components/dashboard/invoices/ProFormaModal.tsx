'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { X, Printer, Ship, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Transaction, TransactionType, JurisdictionZone } from '@/types/secure';
import { OsButton } from '@/components/ui/OsButton';
import { useVessels } from '@/hooks/useVessels';
import { useTaxConfigs } from '@/hooks/useTaxConfigs';
import { createClient } from '@/lib/supabase/client';
import { getProfileById, type ProfileSummary } from '@/services/profileService';
import { statusToMode, buildVerifyUrl, generateQrCodeDataUrl } from '@/services/invoiceService';
import { useRole } from '@/lib/RoleContext';

interface ProFormaModalProps {
    tx: Transaction;
    onClose: () => void;
    onSent?: () => void;
}

type SendStatus = 'idle' | 'generating' | 'success' | 'error';

export function ProFormaModal({ tx, onClose, onSent }: ProFormaModalProps) {
    const t = useTranslations('InvoicesPage');
    const { isDemo } = useRole();
    const { data: vessels } = useVessels();
    const { data: taxConfigs } = useTaxConfigs();

    // ── Resolve real vessel + tax config + owner from Supabase data ──
    const vessel = vessels.find((v) => v.id === tx.vesselId);

    // Match the active tax config for this vessel's category in EEZ
    const taxConfig = React.useMemo(() => {
        if (!vessel) return null;
        return taxConfigs.find(
            (c) => c.status === 'ACTIVE'
                && c.vesselCategory === vessel.category
                && c.jurisdictionZone === JurisdictionZone.EEZ,
        ) ?? null;
    }, [vessel, taxConfigs]);

    const realRate = taxConfig ? taxConfig.baseRateUsdPerTco2 * taxConfig.multiplier : 20;

    // Fetch the real owner profile
    const [owner, setOwner] = React.useState<ProfileSummary | null>(null);
    React.useEffect(() => {
        if (!vessel?.ownerId) {
            setOwner(null);
            return;
        }
        const client = createClient();
        getProfileById(client, vessel.ownerId).then(setOwner);
    }, [vessel?.ownerId]);

    const ownerName = owner?.fullName ?? 'Unassigned shipping agent';
    const ownerEmail = owner?.email ?? `operations@${tx.vesselName.toLowerCase().replace(/\s+/g, '')}.logistics.so`;

    // ── Mode + status badge from transaction status ──
    const { mode, badge } = React.useMemo(() => statusToMode(tx.status), [tx.status]);
    const isInvoice = mode === 'invoice';
    const docTitle = isInvoice ? 'Tax Invoice Preview' : 'Pro-forma Invoice Preview';
    const docTypeLabel = isInvoice ? 'TAX INVOICE' : 'PRO-FORMA INVOICE';

    // ── Invoice metadata ──
    const currentYear = new Date().getFullYear();
    const refPrefix = isInvoice ? 'INV' : 'PRO';
    const invoiceRef  = `${refPrefix}-${currentYear}-${tx.id.split('-')[1].toUpperCase()}`;
    const issueDate   = new Date(tx.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    const dueDate     = new Date(Date.now() + 30 * 86400000).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

    // ── Verification QR code ──
    // Pass the live browser origin so the QR resolves to the current deployment
    // (prod URL when viewed in prod, preview URL in preview, etc.) instead of
    // whatever NEXT_PUBLIC_APP_URL happens to be baked in at build time.
    const verifyUrl = React.useMemo(
        () => buildVerifyUrl(invoiceRef, { origin: typeof window !== 'undefined' ? window.location.origin : undefined }),
        [invoiceRef],
    );
    const [qrDataUrl, setQrDataUrl] = React.useState<string>('');
    React.useEffect(() => {
        generateQrCodeDataUrl(verifyUrl).then(setQrDataUrl).catch(() => setQrDataUrl(''));
    }, [verifyUrl]);

    // Badge colors for the HTML preview
    const badgeStyle: Record<string, { bg: string; fg: string }> = {
        'PAID':     { bg: '#10B981', fg: '#FFFFFF' },
        'EXEMPT':   { bg: '#0EA5E9', fg: '#FFFFFF' },
        'OVERDUE':  { bg: '#DC2626', fg: '#FFFFFF' },
        'DISPUTED': { bg: '#F97316', fg: '#FFFFFF' },
        'TO PAY':   { bg: '#EAB308', fg: '#0D1F18' },
    };
    const badgeColors = badgeStyle[badge];

    const TX_TYPE_LABEL: Record<TransactionType, string> = {
        [TransactionType.ENTRY_TAX]:   t('type_entry_tax'),
        [TransactionType.TRANSIT_FEE]: t('type_transit_fee'),
        [TransactionType.PORT_STAY]:   t('type_port_stay'),
    };

    // Fee breakdown (carbon tax + port + security)
    const carbonTaxFee  = Math.round(tx.taxAmountUsd * 0.75);
    const portCallFee   = Math.round(tx.taxAmountUsd * 0.20);
    const securityFee   = tx.taxAmountUsd - carbonTaxFee - portCallFee;

    // ── Three distinct actions, one shared generation pipeline ──
    //   1. Print & Save PDF (top button)  → generate + upload + window.print()
    //   2. Draft Save       (footer)      → generate + upload only (silent)
    //   3. Print & Send     (footer)      → generate + upload + email to armateur
    // The print dialog should only fire when the user explicitly asks for it;
    // the email should only fire on "Print & Send".
    type ActionKind = 'printSave' | 'draftSave' | 'sendEmail';
    const [sendStatus, setSendStatus] = React.useState<SendStatus>('idle');
    const [lastAction, setLastAction] = React.useState<ActionKind | null>(null);
    const [errorMsg, setErrorMsg]     = React.useState<string | null>(null);

    async function runGeneration(action: ActionKind) {
        if (sendStatus === 'generating') return;
        setSendStatus('generating');
        setLastAction(action);
        setErrorMsg(null);

        try {
            // The server now ignores any invoice fields in the body and
            // re-derives them from the authoritative `transactions` row.
            // This closes the fraud vector where a logged-in user could
            // mint a PDF with an arbitrary amount/owner for a real tx id.
            const response = await fetch('/api/invoices/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    transactionId: tx.id,
                    sendEmail: action === 'sendEmail',
                }),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Failed to generate invoice');
            }

            setSendStatus('success');
            if (action === 'printSave') {
                window.print();
            } else if (action === 'draftSave' && result.pdfUrl) {
                // Mirror the simulator UX: after Supabase upload, stream
                // the PDF back through a blob URL so the browser triggers
                // its native "Save As" download dialog.
                try {
                    const pdfResponse = await fetch(result.pdfUrl);
                    if (!pdfResponse.ok) {
                        throw new Error(`Download failed: HTTP ${pdfResponse.status}`);
                    }
                    const blob = await pdfResponse.blob();
                    const blobUrl = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = blobUrl;
                    // Use the server-minted ref so the saved file matches
                    // the ref embedded in the PDF content + QR code.
                    a.download = `${result.invoiceRef ?? invoiceRef}.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(blobUrl);
                } catch (downloadErr) {
                    console.error('[ProForma] PDF download failed:', downloadErr);
                    // Fall back to opening in a new tab — the file is still
                    // safely uploaded on Supabase, only the browser-initiated
                    // save failed.
                    window.open(result.pdfUrl, '_blank', 'noopener,noreferrer');
                }
            }
            onSent?.();
        } catch (err) {
            console.error('[ProForma] Failed:', err);
            setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
            setSendStatus('error');
        }
    }

    const handlePrintSave = () => runGeneration('printSave');
    const handleDraftSave = () => runGeneration('draftSave');
    const handleSendEmail = () => runGeneration('sendEmail');

    const isBusy = sendStatus === 'generating';
    const successMessage =
        lastAction === 'sendEmail' ? `PDF emailed to ${ownerEmail}.` :
        lastAction === 'draftSave' ? 'PDF saved — uploaded to Supabase and downloaded locally.' :
        'Pro-forma generated, uploaded to Supabase, and audit logged.';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center no-print" style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
            <div
                className="relative w-full max-w-4xl mx-4 rounded-2xl border overflow-hidden flex flex-col"
                style={{ backgroundColor: 'var(--os-surface)', borderColor: 'var(--os-border-strong)', maxHeight: '90vh' }}
            >
                {/* Modal toolbar */}
                <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--os-border)' }}>
                    <div className="flex items-center gap-3">
                        <div>
                            <h2 className="text-sm font-bold text-[var(--os-text-primary)]">{docTitle}</h2>
                            <p className="text-[10px] text-[var(--os-text-muted)]">{invoiceRef} · {tx.vesselName}</p>
                        </div>
                        <span
                            className="text-[10px] font-bold px-2 py-1 rounded-md tracking-wider"
                            style={{ backgroundColor: badgeColors.bg, color: badgeColors.fg }}
                        >
                            {badge}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <OsButton
                            variant="primary"
                            size="sm"
                            icon={isBusy && lastAction === 'printSave'
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Printer className="w-3.5 h-3.5" />}
                            onClick={handlePrintSave}
                            disabled={isBusy || isDemo}
                        >
                            {isBusy && lastAction === 'printSave' ? t('print_save_pdf') + '…' : t('print_save_pdf')}
                        </OsButton>
                        <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:bg-[var(--os-surface-2)] transition-colors">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Demo-mode guard. The Generate / Save / Send actions all hit
                     /api/invoices/generate which loads the row from `transactions`
                     by id. Mock txns (txn-001…) don't exist in the DB, so a click
                     in demo would 404. We hard-disable the buttons and surface a
                     banner that points to the env knob. */}
                {isDemo && (
                    <div className="px-5 py-2 bg-[rgba(234,179,8,0.08)] border-b border-[#EAB308]/20 flex items-center gap-2 text-xs text-[#EAB308]">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {t('demo_generate_disabled')}
                    </div>
                )}

                {/* Status banner */}
                {sendStatus === 'success' && (
                    <div className="px-5 py-2 bg-[rgba(0,217,126,0.08)] border-b border-[#00D97E]/20 flex items-center gap-2 text-xs text-[#00D97E]">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {successMessage}
                    </div>
                )}
                {sendStatus === 'error' && errorMsg && (
                    <div className="px-5 py-2 bg-[rgba(239,68,68,0.08)] border-b border-[#EF4444]/20 text-xs text-[#EF4444]">
                        Failed: {errorMsg}
                    </div>
                )}

                {/* Scrollable content */}
                <div className="overflow-y-auto flex-1 p-6">
                    {/* Two-col: left = form, right = PDF preview */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Left: calculation + delivery */}
                        <div className="flex flex-col gap-5">
                            {/* Vessel & Port Call */}
                            <div className="os-card p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-xs font-bold text-[var(--os-text-primary)] uppercase tracking-wide">{t('vessel_and_port_call')}</h3>
                                </div>
                                <div className="flex items-center gap-3 p-3 rounded-xl bg-[var(--os-surface-3)] border border-[var(--os-border)]">
                                    <div className="w-8 h-8 rounded-lg bg-[var(--os-surface-2)] flex items-center justify-center">
                                        <Ship className="w-4 h-4 text-[var(--os-text-muted)]" />
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-sm font-bold text-[var(--os-text-primary)]">{tx.vesselName}</p>
                                        <p className="text-[10px] text-[var(--os-text-muted)]">IMO: {tx.vesselImo} | Port: {tx.portCall}</p>
                                    </div>
                                </div>
                                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                    <div>
                                        <p className="text-[10px] text-[var(--os-text-muted)] mb-0.5">{t('arrival_date')}</p>
                                        <p className="font-medium text-[var(--os-text-primary)]">{issueDate}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-[var(--os-text-muted)] mb-0.5">{t('transaction_type')}</p>
                                        <p className="font-medium text-[var(--os-text-primary)]">{TX_TYPE_LABEL[tx.transactionType]}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Fee Calculation */}
                            <div className="os-card p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-xs font-bold text-[var(--os-text-primary)] uppercase tracking-wide">{t('fee_calculation_basis')}</h3>
                                    <span className="text-[9px] font-bold text-[#38BDF8] bg-[rgba(56,189,248,0.1)] px-2 py-0.5 rounded-full border border-[#38BDF8]/20 uppercase">
                                        {t('omi_cubic_law')}
                                    </span>
                                </div>
                                <div className="p-3 rounded-xl bg-[rgba(0,217,126,0.04)] border border-[#00D97E]/15 mb-3">
                                    <p className="text-[10px] text-[var(--os-text-muted)] mb-1">{t('apply_formula')}</p>
                                    <p className="text-sm font-mono font-bold text-[#00D97E]">
                                        TOTAL = ({tx.emissionsTco2} × ${realRate.toFixed(2)}) ≈ ${tx.taxAmountUsd.toLocaleString()}
                                    </p>
                                    {taxConfig && (
                                        <p className="text-[9px] text-[var(--os-text-muted)] mt-1">
                                            base ${taxConfig.baseRateUsdPerTco2.toFixed(2)} × multiplier {taxConfig.multiplier.toFixed(2)} (config {taxConfig.id.slice(0, 8)}…)
                                        </p>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    {[
                                        { label: t('co2_emissions'), value: `${tx.emissionsTco2} tCO₂` },
                                        { label: t('rate_per_tco2'), value: `$${realRate.toFixed(2)}` },
                                        { label: t('port_stay_fee'), value: `$${portCallFee.toLocaleString()}` },
                                        { label: t('fee_security_surcharge'), value: `$${securityFee.toLocaleString()}` },
                                    ].map(({ label, value }) => (
                                        <div key={label} className="flex flex-col">
                                            <span className="text-[10px] text-[var(--os-text-muted)]">{label}</span>
                                            <span className="font-mono font-semibold text-[var(--os-text-primary)]">{value}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Delivery details */}
                            <div className="os-card p-4">
                                <h3 className="text-xs font-bold text-[var(--os-text-primary)] uppercase tracking-wide mb-3">{t('delivery_details')}</h3>
                                <div className="flex flex-col gap-2">
                                    <div>
                                        <p className="text-[10px] text-[var(--os-text-muted)] mb-0.5">{t('agent_contact')}</p>
                                        <input
                                            type="text"
                                            defaultValue={ownerName}
                                            key={ownerName}
                                            className="w-full h-8 px-3 rounded-lg bg-[var(--os-surface-2)] border border-[var(--os-border)] text-xs text-[var(--os-text-primary)] focus:outline-none focus:border-[#00D97E]/50"
                                        />
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-[var(--os-text-muted)] mb-0.5">{t('email')}</p>
                                        <input
                                            type="email"
                                            defaultValue={ownerEmail}
                                            key={ownerEmail}
                                            className="w-full h-8 px-3 rounded-lg bg-[var(--os-surface-2)] border border-[var(--os-border)] text-xs text-[var(--os-text-primary)] focus:outline-none focus:border-[#00D97E]/50"
                                        />
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-[var(--os-text-muted)] mb-0.5">{t('notes_to_finance')}</p>
                                        <textarea
                                            rows={2}
                                            placeholder={t('add_notes_placeholder')}
                                            className="w-full px-3 py-2 rounded-lg bg-[var(--os-surface-2)] border border-[var(--os-border)] text-xs text-[var(--os-text-primary)] focus:outline-none focus:border-[#00D97E]/50 resize-none"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Right: Official PDF preview */}
                        <div
                            className="rounded-lg overflow-hidden print-only shadow-2xl"
                            style={{
                                backgroundColor: 'white',
                                color: '#0D1F18',
                                fontFamily: 'var(--font-plex), "IBM Plex Sans", "Open Sans", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif',
                                border: '1px solid #E2E8F0',
                            }}
                        >
                            {/* Top emerald accent bar */}
                            <div style={{ height: '6px', background: 'linear-gradient(90deg, #047857 0%, #10B981 50%, #EAB308 100%)' }} />

                            <div className="p-6">
                                {/* Official header with logo */}
                                <div className="flex items-start justify-between mb-5 pb-4" style={{ borderBottom: '2px solid #0D1F18' }}>
                                    <div className="flex items-start gap-3">
                                        {/* Logo + Somaliland flag (stacked) */}
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                                            <img
                                                src="/brand/africgreen-icon-emerald.svg"
                                                alt="Green Gate"
                                                style={{ width: '52px', height: '52px' }}
                                            />
                                            <img
                                                src="/brand/somaliland-flag.svg"
                                                alt="Somaliland"
                                                style={{ width: '52px', height: 'auto', border: '1px solid #CBD5E1' }}
                                            />
                                        </div>
                                        <div>
                                            <p style={{ fontSize: '20px', fontWeight: 800, color: '#0D1F18', letterSpacing: '-0.5px', lineHeight: 1 }}>
                                                GREEN GATE
                                            </p>
                                            <p style={{ fontSize: '8px', fontWeight: 700, color: '#059669', letterSpacing: '2px', marginTop: '3px' }}>
                                                SOVEREIGN CARBON PLATFORM
                                            </p>
                                            <p style={{ fontSize: '10px', fontWeight: 800, color: '#047857', marginTop: '6px', letterSpacing: '0.2px' }}>
                                                SOLIDE TECHNOLOGY <span style={{ fontWeight: 500, color: '#64748B' }}>— Concessionaire</span>
                                            </p>
                                            <p style={{ fontSize: '9px', color: '#475569', marginTop: '4px', lineHeight: 1.3 }}>
                                                Republic of Somaliland<br />
                                                Ministry of Environment & Climate Change<br />
                                                Maritime Carbon Tax Authority
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div style={{
                                            display: 'inline-block',
                                            padding: '4px 10px',
                                            background: '#0D1F18',
                                            color: '#10B981',
                                            fontSize: '9px',
                                            fontWeight: 700,
                                            letterSpacing: '2px',
                                            borderRadius: '2px',
                                        }}>
                                            OFFICIAL DOCUMENT
                                        </div>
                                        <p style={{ fontSize: '14px', fontWeight: 800, marginTop: '8px', color: '#0D1F18' }}>
                                            {docTypeLabel}
                                        </p>
                                        <p style={{ fontSize: '9px', color: '#475569', fontStyle: 'italic' }}>
                                            Maritime Environmental Levy Notice
                                        </p>
                                        {/* Status badge — TO PAY / PAID / OVERDUE / etc. */}
                                        <div style={{
                                            display: 'inline-block',
                                            marginTop: '6px',
                                            padding: '4px 10px',
                                            background: badgeColors.bg,
                                            color: badgeColors.fg,
                                            fontSize: '11px',
                                            fontWeight: 800,
                                            letterSpacing: '1.5px',
                                            borderRadius: '2px',
                                        }}>
                                            {badge}
                                        </div>
                                    </div>
                                </div>

                                {/* Reference block */}
                                <div className="grid grid-cols-2 gap-4 mb-4" style={{ fontSize: '10px' }}>
                                    <div>
                                        <p style={{ color: '#64748B', textTransform: 'uppercase', letterSpacing: '1px', fontSize: '8px', fontWeight: 700, marginBottom: '4px' }}>
                                            Issued To
                                        </p>
                                        <p style={{ fontWeight: 700, color: '#0D1F18', fontSize: '11px' }}>{ownerName}</p>
                                        <p style={{ color: '#334155', marginTop: '2px' }}>Vessel: {tx.vesselName}</p>
                                        <p style={{ color: '#334155' }}>IMO: {tx.vesselImo} · MMSI: {vessel?.mmsi ?? '—'}</p>
                                        <p style={{ color: '#334155' }}>Port of Call: {tx.portCall}</p>
                                    </div>
                                    <div className="text-right">
                                        <p style={{ color: '#64748B', textTransform: 'uppercase', letterSpacing: '1px', fontSize: '8px', fontWeight: 700, marginBottom: '4px' }}>
                                            Reference
                                        </p>
                                        <p style={{ fontFamily: 'monospace', fontSize: '12px', fontWeight: 700, color: '#047857' }}>
                                            {invoiceRef}
                                        </p>
                                        <p style={{ color: '#334155', marginTop: '4px' }}>
                                            <strong>Issued:</strong> {issueDate}
                                        </p>
                                        <p style={{ color: '#DC2626', fontWeight: 600 }}>
                                            <strong>Due:</strong> {dueDate}
                                        </p>
                                    </div>
                                </div>

                                {/* Legal preamble */}
                                <div style={{
                                    background: '#F0FAF4',
                                    borderLeft: '3px solid #10B981',
                                    padding: '8px 12px',
                                    marginBottom: '8px',
                                    fontSize: '9px',
                                    color: '#0D1F18',
                                    fontStyle: 'italic',
                                    lineHeight: 1.4,
                                }}>
                                    Pursuant to <strong>Ministerial Decree MOE&amp;CC/MWI/36/2026</strong> (Hargeisa, 31 March 2026),
                                    the Maritime Carbon Tax Act (2024) and IMO MEPC.346(78), the above-named vessel is hereby
                                    notified of carbon emission liabilities incurred within the Somaliland EEZ. Collection is
                                    exclusively managed by <strong>SOLIDE TECHNOLOGY</strong>.
                                </div>

                                {/* Late payment penalty notice */}
                                <div style={{
                                    background: '#FEF2F2',
                                    borderLeft: '3px solid #DC2626',
                                    padding: '6px 12px',
                                    marginBottom: '12px',
                                    fontSize: '9px',
                                    color: '#B91C1C',
                                    fontWeight: 700,
                                    lineHeight: 1.4,
                                }}>
                                    ⚠ LATE PAYMENT PENALTY — A flat fee of <strong>US$20,000</strong> applies if the amount is not settled by the due date.
                                </div>

                                {/* Line items */}
                                <table style={{ width: '100%', fontSize: '10px', borderCollapse: 'collapse', marginBottom: '8px' }}>
                                    <thead>
                                        <tr style={{ background: '#0D1F18', color: 'white' }}>
                                            <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 700, letterSpacing: '0.5px' }}>Description</th>
                                            <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, letterSpacing: '0.5px' }}>Qty</th>
                                            <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, letterSpacing: '0.5px' }}>Rate</th>
                                            <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, letterSpacing: '0.5px' }}>Amount (USD)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[
                                            { desc: 'Carbon Emissions Tax (IMO Cubic Law)', qty: `${tx.emissionsTco2.toFixed(2)} tCO₂`, rate: `$${realRate.toFixed(2)}/t`, amount: carbonTaxFee },
                                            { desc: 'Port Call Fixed Fee', qty: '1', rate: `$${portCallFee.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, amount: portCallFee },
                                            { desc: 'Maritime Security Surcharge', qty: '1', rate: `$${securityFee.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, amount: securityFee },
                                        ].map(({ desc, qty, rate, amount }, i) => (
                                            <tr key={desc} style={{ background: i % 2 === 0 ? '#F8FAFC' : 'white' }}>
                                                <td style={{ padding: '6px 8px', color: '#0D1F18' }}>{desc}</td>
                                                <td style={{ padding: '6px 8px', textAlign: 'right', color: '#475569', fontFamily: 'monospace' }}>{qty}</td>
                                                <td style={{ padding: '6px 8px', textAlign: 'right', color: '#475569', fontFamily: 'monospace' }}>{rate}</td>
                                                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: '#0D1F18', fontFamily: 'monospace' }}>${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>

                                {/* Total */}
                                <div style={{
                                    background: '#0D1F18',
                                    color: 'white',
                                    padding: '10px 12px',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    marginBottom: '12px',
                                }}>
                                    <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>Total Due (USD)</span>
                                    <span style={{ fontSize: '18px', fontWeight: 800, color: '#10B981', fontFamily: 'monospace' }}>
                                        ${tx.taxAmountUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                    </span>
                                </div>

                                {/* Signature, QR code & seal — 3 columns */}
                                <div className="grid grid-cols-3 gap-3 mb-3" style={{ fontSize: '8px', color: '#64748B' }}>
                                    {/* Left: signature line */}
                                    <div>
                                        <p style={{ borderTop: '1px solid #94A3B8', paddingTop: '4px', marginTop: '24px' }}>
                                            Authorized Signatory<br />
                                            <span style={{ color: '#0D1F18', fontWeight: 700 }}>Director, Solid Technology</span>
                                        </p>
                                    </div>
                                    {/* Center: verification QR code */}
                                    <div style={{ textAlign: 'center' }}>
                                        {qrDataUrl ? (
                                            <img
                                                src={qrDataUrl}
                                                alt="Verification QR code"
                                                style={{ width: '64px', height: '64px', display: 'inline-block' }}
                                            />
                                        ) : (
                                            <div style={{ width: '64px', height: '64px', display: 'inline-block', background: '#F1F5F9' }} />
                                        )}
                                        <p style={{ fontSize: '7px', fontWeight: 700, marginTop: '4px', color: '#0D1F18' }}>
                                            VERIFY ONLINE
                                        </p>
                                        <p style={{ fontSize: '6px', color: '#64748B', marginTop: '1px' }}>
                                            Scan to check status
                                        </p>
                                    </div>
                                    {/* Right: official seal */}
                                    <div className="text-right">
                                        <div style={{
                                            display: 'inline-block',
                                            border: '2px solid #047857',
                                            borderRadius: '50%',
                                            padding: '14px 10px',
                                            color: '#047857',
                                            fontSize: '7px',
                                            fontWeight: 800,
                                            letterSpacing: '0.5px',
                                            transform: 'rotate(-8deg)',
                                            opacity: 0.85,
                                            textAlign: 'center',
                                            lineHeight: 1.1,
                                        }}>
                                            OFFICIAL<br />SEAL<br />SOMALILAND
                                        </div>
                                    </div>
                                </div>

                                {/* Footer */}
                                <div style={{
                                    borderTop: '1px solid #E2E8F0',
                                    paddingTop: '8px',
                                    fontSize: '7px',
                                    color: '#94A3B8',
                                    lineHeight: 1.4,
                                }}>
                                    <p><strong>Payment terms:</strong> 30 days from issuance. Late settlement incurs a flat US$20,000 penalty fee.</p>
                                    <p><strong>Remit to:</strong> SOLIDE TECHNOLOGY (Concessionaire) · Bank of Somaliland · SWIFT BSSLSO21 · Ref: {invoiceRef}</p>
                                    <p style={{ marginTop: '4px', textAlign: 'center', color: '#CBD5E1' }}>
                                        Document generated by Green Gate OS · Sovereign Carbon Intelligence Platform · AES-256 Encrypted
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Modal footer */}
                <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--os-border)' }}>
                    <OsButton variant="ghost" size="sm" onClick={onClose}>{t('cancel')}</OsButton>
                    <div className="flex items-center gap-2">
                        <OsButton
                            variant="secondary"
                            size="sm"
                            icon={isBusy && lastAction === 'draftSave' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}
                            onClick={handleDraftSave}
                            disabled={isBusy || isDemo}
                        >
                            {isBusy && lastAction === 'draftSave' ? t('draft_save') + '…' : t('draft_save')}
                        </OsButton>
                        <OsButton
                            variant="primary"
                            size="sm"
                            icon={isBusy && lastAction === 'sendEmail' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
                            onClick={handleSendEmail}
                            disabled={isBusy || isDemo}
                        >
                            {isBusy && lastAction === 'sendEmail' ? 'Sending…' : t('print_and_send')}
                        </OsButton>
                    </div>
                </div>
            </div>
        </div>
    );
}
