'use client';

import * as React from 'react';
import {
    CheckCircle2, XCircle, Clock, Search,
    FileText, User, Building2, Mail, Phone, MapPin,
    Shield, Download, MessageSquare, ChevronDown, ChevronUp,
    Flag, Loader2,
} from 'lucide-react';
import {
    RegistrationRequest, RegistrationStatus, RegistrationEntityType,
} from '@/types/secure';
import { createClient } from '@/lib/supabase/client';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<RegistrationStatus, { label: string; bg: string; color: string; icon: React.ElementType }> = {
    [RegistrationStatus.PENDING]:   { label: 'En attente',      bg: 'rgba(234,179,8,0.1)',   color: '#EAB308',  icon: Clock },
    [RegistrationStatus.APPROVED]:  { label: 'Approuvé',        bg: 'rgba(16,185,129,0.1)',  color: '#10B981',  icon: CheckCircle2 },
    [RegistrationStatus.REJECTED]:  { label: 'Refusé',          bg: 'rgba(239,68,68,0.1)',   color: '#EF4444',  icon: XCircle },
    [RegistrationStatus.MORE_INFO]: { label: 'Infos requises',  bg: 'rgba(59,130,246,0.1)',  color: '#3B82F6',  icon: MessageSquare },
};

const ENTITY_LABELS: Record<RegistrationEntityType, string> = {
    [RegistrationEntityType.PORT_AUTHORITY]: 'Autorité portuaire',
    [RegistrationEntityType.SHIPPING_AGENT]: 'Armateur / Agent',
    [RegistrationEntityType.FINANCE_ADMIN]:  'Administration financière',
    [RegistrationEntityType.INSTITUTION]:    'Institution publique',
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
    const [note, setNote] = React.useState('');

    const config = {
        approve:   { title: 'Approuver la demande',        color: '#10B981', btn: 'Approuver', placeholder: 'Remarque optionnelle pour l\'agent…' },
        reject:    { title: 'Refuser la demande',           color: '#EF4444', btn: 'Refuser',   placeholder: 'Motif de refus (obligatoire)…' },
        more_info: { title: 'Demander des informations',    color: '#3B82F6', btn: 'Envoyer',   placeholder: 'Précisez les documents ou infos manquants…' },
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
                    <p className="text-[11px] text-red-400 mt-1">Le motif de refus est obligatoire.</p>
                )}

                <div className="flex gap-3 mt-4">
                    <button
                        onClick={onClose}
                        disabled={loading}
                        className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors"
                        style={{ backgroundColor: 'var(--os-surface-2)', color: 'var(--os-text-muted)', border: '1px solid var(--os-border)' }}
                    >
                        Annuler
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
                                SIGNALÉ
                            </span>
                        )}
                        <span
                            className="text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1"
                            style={{ backgroundColor: s.bg, color: s.color }}
                        >
                            <SIcon className="w-3 h-3" />
                            {s.label}
                        </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs flex-wrap" style={{ color: 'var(--os-text-muted)' }}>
                        <span className="flex items-center gap-1"><User className="w-3 h-3" />{req.contactName}</span>
                        <span>·</span>
                        <span>{ENTITY_LABELS[req.entityType] ?? req.entityType}</span>
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
                                Approuver
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); onAction(req.id, 'more_info'); }}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                                style={{ backgroundColor: 'rgba(59,130,246,0.12)', color: '#3B82F6', border: '1px solid rgba(59,130,246,0.25)' }}
                            >
                                Infos
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); onAction(req.id, 'reject'); }}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                                style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}
                            >
                                Refuser
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
                            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--os-text-muted)' }}>Contact</p>
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
                                Pièces jointes ({req.documents.length})
                            </p>
                            {req.documents.length === 0 ? (
                                <p className="text-xs" style={{ color: 'var(--os-text-muted)' }}>Aucun document joint</p>
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
                                    Note de révision — {req.reviewedBy} · {req.reviewedAt && fmtDate(req.reviewedAt)}
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

// ── Main page ─────────────────────────────────────────────────────────────────

export function AgentValidationsPage() {
    const [requests, setRequests] = React.useState<RegistrationRequest[]>([]);
    const [search, setSearch]     = React.useState('');
    const [tabFilter, setTabFilter] = React.useState<'all' | RegistrationStatus>('all');
    const [modal, setModal] = React.useState<{ id: string; action: 'approve' | 'reject' | 'more_info' } | null>(null);
    const [loadingPage, setLoadingPage] = React.useState(true);
    const [actionLoading, setActionLoading] = React.useState(false);
    const [actionError, setActionError] = React.useState('');

    const activeReq = modal ? requests.find((r) => r.id === modal.id) : null;

    // ── Load requests from Supabase ──────────────────────────────────────────

    const fetchRequests = React.useCallback(async () => {
        const supabase = createClient();
        const { data, error } = await supabase
            .from('registration_requests')
            .select('*')
            .order('created_at', { ascending: false });

        if (!error && data) {
            setRequests(data.map((row) => mapRow(row as Record<string, unknown>)));
        }
        setLoadingPage(false);
    }, []);

    React.useEffect(() => { fetchRequests(); }, [fetchRequests]);

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
            // Call Edge Function to create the user account
            const { data: { session } } = await supabase.auth.getSession();
            const res = await fetch(
                `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/approve-registration`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session?.access_token}`,
                    },
                    body: JSON.stringify({ requestId: modal.id, reviewNote: note }),
                }
            );
            const result = await res.json();
            if (!res.ok) {
                setActionError(result.error || 'Erreur lors de l\'approbation.');
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
                setActionError(error.message || 'Erreur lors de la mise à jour.');
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
        { key: 'all',                              label: 'Toutes',         count: counts.all },
        { key: RegistrationStatus.PENDING,         label: 'En attente',     count: counts.pending,   color: '#EAB308' },
        { key: RegistrationStatus.MORE_INFO,       label: 'Infos requises', count: counts.more_info, color: '#3B82F6' },
        { key: RegistrationStatus.APPROVED,        label: 'Approuvées',     count: counts.approved,  color: '#10B981' },
        { key: RegistrationStatus.REJECTED,        label: 'Refusées',       count: counts.rejected,  color: '#EF4444' },
    ];

    return (
        <div className="flex-1 flex flex-col gap-6 p-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-xl font-bold" style={{ color: 'var(--os-text-primary)' }}>
                        Validation des agents
                    </h1>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--os-text-muted)' }}>
                        Demandes d&apos;accès en attente de vérification manuelle
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {counts.pending > 0 && (
                        <span className="text-xs font-bold px-3 py-1.5 rounded-full" style={{ backgroundColor: 'rgba(234,179,8,0.12)', color: '#EAB308', border: '1px solid rgba(234,179,8,0.25)' }}>
                            {counts.pending} en attente
                        </span>
                    )}
                    {requests.filter((r) => r.flagged).length > 0 && (
                        <span className="text-xs font-bold px-3 py-1.5 rounded-full" style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.25)' }}>
                            {requests.filter((r) => r.flagged).length} signalé(s)
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
                        placeholder="Rechercher…"
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
                        <span className="text-sm">Chargement des demandes…</span>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-16" style={{ color: 'var(--os-text-muted)' }}>
                        <User className="w-8 h-8 mx-auto mb-3 opacity-30" />
                        <p className="text-sm">Aucune demande dans cette catégorie.</p>
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
