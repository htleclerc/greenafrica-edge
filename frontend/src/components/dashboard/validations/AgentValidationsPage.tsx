'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
    CheckCircle2, XCircle, Clock, Search,
    FileText, User, Building2, Mail, Phone, MapPin,
    Shield, Download, MessageSquare, ChevronDown, ChevronUp,
    Flag, Loader2,
} from 'lucide-react';
import {
    RegistrationRequest, RegistrationStatus, RegistrationEntityType, UserRole,
} from '@/types/secure';
import { createClient } from '@/lib/supabase/client';
import { useRole } from '@/lib/RoleContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<RegistrationStatus, { labelKey: string; bg: string; color: string; icon: React.ElementType }> = {
    [RegistrationStatus.PENDING]:   { labelKey: 'status_pending',    bg: 'rgba(234,179,8,0.1)',   color: '#EAB308',  icon: Clock },
    [RegistrationStatus.APPROVED]:  { labelKey: 'status_approved',   bg: 'rgba(16,185,129,0.1)',  color: '#10B981',  icon: CheckCircle2 },
    [RegistrationStatus.REJECTED]:  { labelKey: 'status_rejected',   bg: 'rgba(239,68,68,0.1)',   color: '#EF4444',  icon: XCircle },
    [RegistrationStatus.MORE_INFO]: { labelKey: 'status_more_info',  bg: 'rgba(59,130,246,0.1)',  color: '#3B82F6',  icon: MessageSquare },
};

const ENTITY_LABEL_KEYS: Record<RegistrationEntityType, string> = {
    [RegistrationEntityType.PORT_AUTHORITY]: 'entity_port_authority',
    [RegistrationEntityType.SHIPPING_AGENT]: 'entity_shipping_agent',
    [RegistrationEntityType.FINANCE_ADMIN]:  'entity_finance_admin',
    [RegistrationEntityType.INSTITUTION]:    'entity_institution',
};

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Map a Supabase row to the RegistrationRequest type used by the UI */
function mapRow(row: Record<string, unknown>): RegistrationRequest {
    return {
        id: row.id as string,
        submittedAt: row.created_at as string,
        entityType: row.entity_type as RegistrationEntityType,
        orgName: row.org_name as string,
        orgRegistryId: row.org_registry_id as string,
        contactName: row.contact_name as string,
        contactEmail: row.contact_email as string,
        contactPhone: (row.contact_phone as string) ?? undefined,
        jurisdiction: row.jurisdiction as string,
        requestedRole: row.requested_role as unknown as import('@/types/secure').UserRole,
        status: row.status as RegistrationStatus,
        reviewedBy: row.review_note ? 'Admin' : undefined,
        reviewedAt: (row.reviewed_at as string) ?? undefined,
        reviewNote: (row.review_note as string) ?? undefined,
        documents: [],
        ipAddress: (row.ip_address as string) ?? '',
        flagged: (row.flagged as boolean) ?? false,
    };
}

// ── Review modal ──────────────────────────────────────────────────────────────

interface ReviewModalProps {
    request: RegistrationRequest;
    action: 'approve' | 'reject' | 'more_info';
    loading: boolean;
    onConfirm: (note: string) => void;
    onClose: () => void;
}

function ReviewModal({ request, action, loading, onConfirm, onClose }: ReviewModalProps) {
    const t = useTranslations('ValidationsPage');
    const [note, setNote] = React.useState('');

    const config = {
        approve:   { title: t('modal_approve_title'),    color: '#10B981', btn: t('modal_approve_btn'),    placeholder: t('modal_approve_placeholder') },
        reject:    { title: t('modal_reject_title'),     color: '#EF4444', btn: t('modal_reject_btn'),     placeholder: t('modal_reject_placeholder') },
        more_info: { title: t('modal_more_info_title'),  color: '#3B82F6', btn: t('modal_more_info_btn'),  placeholder: t('modal_more_info_placeholder') },
    }[action];

    const canSubmit = action !== 'reject' || note.trim().length > 0;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
            <div className="w-full max-w-md rounded-2xl p-6" style={{ backgroundColor: 'var(--os-surface)', border: '1px solid var(--os-border-strong)' }}>
                <h3 className="text-base font-bold mb-1" style={{ color: 'var(--os-text-primary)' }}>{config.title}</h3>
                <p className="text-xs mb-5" style={{ color: 'var(--os-text-muted)' }}>
                    {request.orgName} — {request.contactName}
                </p>

                <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={config.placeholder}
                    rows={4}
                    className="w-full rounded-xl p-3 text-sm outline-none resize-none"
                    style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)', color: 'var(--os-text-primary)' }}
                />

                {action === 'reject' && !note.trim() && (
                    <p className="text-[11px] text-red-400 mt-1">{t('modal_reject_required')}</p>
                )}

                <div className="flex gap-3 mt-4">
                    <button
                        onClick={onClose}
                        disabled={loading}
                        className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors"
                        style={{ backgroundColor: 'var(--os-surface-2)', color: 'var(--os-text-muted)', border: '1px solid var(--os-border)' }}
                    >
                        {t('modal_cancel')}
                    </button>
                    <button
                        onClick={() => canSubmit && onConfirm(note)}
                        disabled={!canSubmit || loading}
                        className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
                        style={{ backgroundColor: config.color }}
                    >
                        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                        {config.btn}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Registration row ──────────────────────────────────────────────────────────

interface RowProps {
    req: RegistrationRequest;
    onAction: (id: string, action: 'approve' | 'reject' | 'more_info') => void;
}

function RegistrationRow({ req, onAction }: RowProps) {
    const t = useTranslations('ValidationsPage');
    const [expanded, setExpanded] = React.useState(false);
    const s = STATUS_CONFIG[req.status];
    const SIcon = s.icon;
    const isPending = req.status === RegistrationStatus.PENDING || req.status === RegistrationStatus.MORE_INFO;

    return (
        <div
            className="rounded-2xl overflow-hidden transition-all"
            style={{ backgroundColor: 'var(--os-surface)', border: req.flagged ? '1px solid rgba(239,68,68,0.4)' : '1px solid var(--os-border)' }}
        >
            {/* Header row */}
            <div
                className="flex items-center gap-4 px-5 py-4 cursor-pointer"
                onClick={() => setExpanded((v) => !v)}
            >
                {/* Org avatar */}
                <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold text-white"
                    style={{ backgroundColor: req.flagged ? '#EF4444' : '#10B981' }}
                >
                    {req.flagged ? <Flag className="w-4 h-4" /> : req.orgName.charAt(0)}
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-sm" style={{ color: 'var(--os-text-primary)' }}>{req.orgName}</p>
                        {req.flagged && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">
                                {t('flagged')}
                            </span>
                        )}
                        <span
                            className="text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1"
                            style={{ backgroundColor: s.bg, color: s.color }}
                        >
                            <SIcon className="w-3 h-3" />
                            {t(s.labelKey)}
                        </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs flex-wrap" style={{ color: 'var(--os-text-muted)' }}>
                        <span className="flex items-center gap-1"><User className="w-3 h-3" />{req.contactName}</span>
                        <span>·</span>
                        <span>{t(ENTITY_LABEL_KEYS[req.entityType])}</span>
                        <span>·</span>
                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{req.jurisdiction}</span>
                        <span>·</span>
                        <span>{fmtDate(req.submittedAt)}</span>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                    {isPending && (
                        <>
                            <button
                                onClick={(e) => { e.stopPropagation(); onAction(req.id, 'approve'); }}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-opacity hover:opacity-85"
                                style={{ backgroundColor: '#10B981' }}
                            >
                                {t('btn_approve')}
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); onAction(req.id, 'more_info'); }}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                                style={{ backgroundColor: 'rgba(59,130,246,0.12)', color: '#3B82F6', border: '1px solid rgba(59,130,246,0.25)' }}
                            >
                                {t('btn_more_info')}
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); onAction(req.id, 'reject'); }}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                                style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}
                            >
                                {t('btn_reject')}
                            </button>
                        </>
                    )}
                    {expanded
                        ? <ChevronUp className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--os-text-muted)' }} />
                        : <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--os-text-muted)' }} />
                    }
                </div>
            </div>

            {/* Expanded detail */}
            {expanded && (
                <div className="border-t px-5 pb-5" style={{ borderColor: 'var(--os-border)' }}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 mt-4">
                        {/* Contact */}
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--os-text-muted)' }}>{t('detail_contact')}</p>
                            <div className="flex flex-col gap-1.5">
                                <p className="text-xs flex items-center gap-2" style={{ color: 'var(--os-text-secondary)' }}>
                                    <Mail className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--os-text-muted)' }} />
                                    {req.contactEmail}
                                </p>
                                {req.contactPhone && (
                                    <p className="text-xs flex items-center gap-2" style={{ color: 'var(--os-text-secondary)' }}>
                                        <Phone className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--os-text-muted)' }} />
                                        {req.contactPhone}
                                    </p>
                                )}
                                <p className="text-xs flex items-center gap-2" style={{ color: 'var(--os-text-secondary)' }}>
                                    <Building2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--os-text-muted)' }} />
                                    {req.orgRegistryId}
                                </p>
                                {req.ipAddress && (
                                    <p className="text-xs flex items-center gap-2" style={{ color: 'var(--os-text-secondary)' }}>
                                        <Shield className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--os-text-muted)' }} />
                                        IP: {req.ipAddress}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Documents */}
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--os-text-muted)' }}>
                                {t('detail_attachments', { count: req.documents.length })}
                            </p>
                            {req.documents.length === 0 ? (
                                <p className="text-xs" style={{ color: 'var(--os-text-muted)' }}>{t('no_documents')}</p>
                            ) : (
                                <div className="flex flex-col gap-1.5">
                                    {req.documents.map((doc, i) => (
                                        <a
                                            key={i}
                                            href={doc.url}
                                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors"
                                            style={{ backgroundColor: 'var(--os-surface-2)', color: 'var(--os-text-secondary)', border: '1px solid var(--os-border)' }}
                                        >
                                            <FileText className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#10B981' }} />
                                            <span className="flex-1 truncate">{doc.name}</span>
                                            <span style={{ color: 'var(--os-text-muted)' }}>{doc.sizeKb} Ko</span>
                                            <Download className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--os-text-muted)' }} />
                                        </a>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Review note */}
                        {req.reviewNote && (
                            <div className="sm:col-span-2">
                                <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--os-text-muted)' }}>
                                    {t('detail_review_note')} — {req.reviewedBy} · {req.reviewedAt && fmtDate(req.reviewedAt)}
                                </p>
                                <div className="px-4 py-3 rounded-xl text-xs leading-relaxed" style={{ backgroundColor: 'var(--os-surface-2)', color: 'var(--os-text-secondary)', border: '1px solid var(--os-border)' }}>
                                    {req.reviewNote}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Demo mock requests ───────────────────────────────────────────────────────

const DEMO_REQUESTS: RegistrationRequest[] = [
    {
        id: 'demo-reg-1',
        submittedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        entityType: RegistrationEntityType.SHIPPING_AGENT,
        orgName: 'Berbera Maritime Services',
        orgRegistryId: 'SL-BMS-2024-0891',
        contactName: 'Ahmed Hassan',
        contactEmail: 'ahmed@berberamaritime.so',
        contactPhone: '+252 63 412 7890',
        jurisdiction: 'Berbera',
        requestedRole: UserRole.SHIPPING_AGENT,
        status: RegistrationStatus.PENDING,
        documents: [
            { name: 'Trade_License_2025.pdf', type: 'LICENSE', url: '#', sizeKb: 245 },
            { name: 'ID_Ahmed_Hassan.pdf', type: 'ID', url: '#', sizeKb: 128 },
        ],
        ipAddress: '196.200.45.12',
        flagged: false,
    },
    {
        id: 'demo-reg-2',
        submittedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
        entityType: RegistrationEntityType.SHIPPING_AGENT,
        orgName: 'Red Sea Logistics Ltd',
        orgRegistryId: 'SL-RSL-2024-0723',
        contactName: 'Farah Omar',
        contactEmail: 'farah.omar@redsealogistics.com',
        contactPhone: '+252 63 555 3210',
        jurisdiction: 'Berbera',
        requestedRole: UserRole.SHIPPING_AGENT,
        status: RegistrationStatus.PENDING,
        documents: [
            { name: 'Company_Registration.pdf', type: 'LICENSE', url: '#', sizeKb: 310 },
        ],
        ipAddress: '196.200.78.33',
        flagged: true,
    },
    {
        id: 'demo-reg-3',
        submittedAt: new Date(Date.now() - 14 * 86_400_000).toISOString(),
        entityType: RegistrationEntityType.PORT_AUTHORITY,
        orgName: 'Somaliland Port Authority',
        orgRegistryId: 'SL-SPA-2024-0001',
        contactName: 'Muse Abdi',
        contactEmail: 'muse.abdi@slports.gov.sl',
        jurisdiction: 'Hargeisa',
        requestedRole: UserRole.PORT_OFFICER,
        status: RegistrationStatus.APPROVED,
        reviewedBy: 'SuperAdmin',
        reviewedAt: new Date(Date.now() - 12 * 86_400_000).toISOString(),
        reviewNote: 'Verified with Ministry of Transport',
        documents: [
            { name: 'Appointment_Letter.pdf', type: 'MANDATE', url: '#', sizeKb: 195 },
            { name: 'National_ID.pdf', type: 'ID', url: '#', sizeKb: 156 },
        ],
        ipAddress: '196.200.12.55',
        flagged: false,
    },
    {
        id: 'demo-reg-4',
        submittedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
        entityType: RegistrationEntityType.INSTITUTION,
        orgName: 'Horn of Africa Institute',
        orgRegistryId: 'SL-HAI-2024-0045',
        contactName: 'Dr. Sahra Warsame',
        contactEmail: 'sahra@hornafrica-institute.org',
        jurisdiction: 'Hargeisa',
        requestedRole: UserRole.PORT_OFFICER,
        status: RegistrationStatus.REJECTED,
        reviewedBy: 'SuperAdmin',
        reviewedAt: new Date(Date.now() - 18 * 86_400_000).toISOString(),
        reviewNote: 'Institution type not yet supported. Please reapply when institutional access is enabled.',
        documents: [],
        ipAddress: '196.200.90.11',
        flagged: false,
    },
];

// ── Main page ─────────────────────────────────────────────────────────────────

export function AgentValidationsPage() {
    const t = useTranslations('ValidationsPage');
    const { isDemo, ready } = useRole();
    const [requests, setRequests] = React.useState<RegistrationRequest[]>([]);
    const [search, setSearch]     = React.useState('');
    const [tabFilter, setTabFilter] = React.useState<'all' | RegistrationStatus>('all');
    const [modal, setModal] = React.useState<{ id: string; action: 'approve' | 'reject' | 'more_info' } | null>(null);
    const [loadingPage, setLoadingPage] = React.useState(true);
    const [actionLoading, setActionLoading] = React.useState(false);
    const [actionError, setActionError] = React.useState('');

    const activeReq = modal ? requests.find((r) => r.id === modal.id) : null;

    // ── Load requests (demo or Supabase) ─────────────────────────────────────

    const fetchRequests = React.useCallback(async () => {
        if (isDemo) {
            setRequests(DEMO_REQUESTS);
            setLoadingPage(false);
            return;
        }

        const supabase = createClient();
        const { data, error } = await supabase
            .from('registration_requests')
            .select('*')
            .order('created_at', { ascending: false });

        if (!error && data) {
            setRequests(data.map((row) => mapRow(row as Record<string, unknown>)));
        }
        setLoadingPage(false);
    }, [isDemo]);

    React.useEffect(() => { if (ready) fetchRequests(); }, [fetchRequests, ready]);

    // ── Actions ──────────────────────────────────────────────────────────────

    function handleAction(id: string, action: 'approve' | 'reject' | 'more_info') {
        setActionError('');
        setModal({ id, action });
    }

    async function confirmAction(note: string) {
        if (!modal) return;
        setActionLoading(true);
        setActionError('');

        const supabase = createClient();

        if (modal.action === 'approve') {
            // Call local API route to approve the registration
            const res = await fetch('/api/auth/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId: modal.id, reviewNote: note }),
            });
            const result = await res.json();
            if (!res.ok) {
                setActionError(result.error || t('error_approval'));
                setActionLoading(false);
                return;
            }
        } else {
            // reject or more_info → just update the status in DB
            const newStatus = modal.action === 'reject' ? 'REJECTED' : 'MORE_INFO';
            const { error } = await supabase
                .from('registration_requests')
                .update({
                    status: newStatus,
                    review_note: note || null,
                    reviewed_at: new Date().toISOString(),
                })
                .eq('id', modal.id);

            if (error) {
                setActionError(error.message || t('error_update'));
                setActionLoading(false);
                return;
            }
        }

        setActionLoading(false);
        setModal(null);
        // Refresh list
        await fetchRequests();
    }

    // ── Counts & filters ─────────────────────────────────────────────────────

    const counts = {
        all:       requests.length,
        pending:   requests.filter((r) => r.status === RegistrationStatus.PENDING).length,
        more_info: requests.filter((r) => r.status === RegistrationStatus.MORE_INFO).length,
        approved:  requests.filter((r) => r.status === RegistrationStatus.APPROVED).length,
        rejected:  requests.filter((r) => r.status === RegistrationStatus.REJECTED).length,
    };

    const filtered = requests.filter((r) => {
        const matchTab = tabFilter === 'all' || r.status === tabFilter;
        const q = search.toLowerCase();
        const matchSearch = !q ||
            r.orgName.toLowerCase().includes(q) ||
            r.contactName.toLowerCase().includes(q) ||
            r.contactEmail.toLowerCase().includes(q) ||
            r.jurisdiction.toLowerCase().includes(q);
        return matchTab && matchSearch;
    });

    const TABS: { key: 'all' | RegistrationStatus; label: string; count: number; color?: string }[] = [
        { key: 'all',                              label: t('tab_all'),         count: counts.all },
        { key: RegistrationStatus.PENDING,         label: t('tab_pending'),     count: counts.pending,   color: '#EAB308' },
        { key: RegistrationStatus.MORE_INFO,       label: t('tab_more_info'),   count: counts.more_info, color: '#3B82F6' },
        { key: RegistrationStatus.APPROVED,        label: t('tab_approved'),    count: counts.approved,  color: '#10B981' },
        { key: RegistrationStatus.REJECTED,        label: t('tab_rejected'),    count: counts.rejected,  color: '#EF4444' },
    ];

    return (
        <div className="flex-1 flex flex-col gap-6 p-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-xl font-bold" style={{ color: 'var(--os-text-primary)' }}>
                        {t('title')}
                    </h1>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--os-text-muted)' }}>
                        {t('subtitle')}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {counts.pending > 0 && (
                        <span className="text-xs font-bold px-3 py-1.5 rounded-full" style={{ backgroundColor: 'rgba(234,179,8,0.12)', color: '#EAB308', border: '1px solid rgba(234,179,8,0.25)' }}>
                            {t('pending_count', { count: counts.pending })}
                        </span>
                    )}
                    {requests.filter((r) => r.flagged).length > 0 && (
                        <span className="text-xs font-bold px-3 py-1.5 rounded-full" style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.25)' }}>
                            {t('flagged_count', { count: requests.filter((r) => r.flagged).length })}
                        </span>
                    )}
                </div>
            </div>

            {/* Tabs + search */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex items-center gap-1 flex-wrap">
                    {TABS.map((tab) => (
                        <button
                            key={tab.key}
                            onClick={() => setTabFilter(tab.key)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                            style={{
                                backgroundColor: tabFilter === tab.key ? (tab.color ? `${tab.color}18` : 'var(--os-surface-3)') : 'var(--os-surface)',
                                color: tabFilter === tab.key ? (tab.color ?? 'var(--os-text-primary)') : 'var(--os-text-muted)',
                                border: tabFilter === tab.key ? `1px solid ${tab.color ?? 'var(--os-border-strong)'}40` : '1px solid var(--os-border)',
                            }}
                        >
                            {tab.label}
                            <span className="px-1.5 py-0.5 rounded-full text-[10px]" style={{ backgroundColor: 'var(--os-surface-2)' }}>
                                {tab.count}
                            </span>
                        </button>
                    ))}
                </div>
                <div className="relative sm:ml-auto sm:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--os-text-muted)' }} />
                    <input
                        type="text"
                        placeholder={t('search_placeholder')}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full h-9 pl-8 pr-3 rounded-xl text-xs outline-none"
                        style={{ backgroundColor: 'var(--os-surface)', border: '1px solid var(--os-border)', color: 'var(--os-text-primary)' }}
                    />
                </div>
            </div>

            {/* List */}
            <div className="flex flex-col gap-3">
                {loadingPage ? (
                    <div className="flex items-center justify-center py-16 gap-3" style={{ color: 'var(--os-text-muted)' }}>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span className="text-sm">{t('loading')}</span>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-16" style={{ color: 'var(--os-text-muted)' }}>
                        <User className="w-8 h-8 mx-auto mb-3 opacity-30" />
                        <p className="text-sm">{t('no_requests')}</p>
                    </div>
                ) : (
                    filtered.map((req) => (
                        <RegistrationRow key={req.id} req={req} onAction={handleAction} />
                    ))
                )}
            </div>

            {/* Error toast */}
            {actionError && (
                <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-xs font-semibold text-white shadow-lg" style={{ backgroundColor: '#EF4444' }}>
                    {actionError}
                </div>
            )}

            {/* Review modal */}
            {modal && activeReq && (
                <ReviewModal
                    request={activeReq}
                    action={modal.action}
                    loading={actionLoading}
                    onConfirm={confirmAction}
                    onClose={() => { setModal(null); setActionError(''); }}
                />
            )}
        </div>
    );
}
