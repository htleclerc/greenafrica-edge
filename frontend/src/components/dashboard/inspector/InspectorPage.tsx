'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
    Search, Ship, ClipboardCheck, History, Camera,
    WifiOff, CheckCircle, XCircle, AlertTriangle,
} from 'lucide-react';
import { OsBadge } from '@/components/ui/OsBadge';
import { useRole } from '@/lib/RoleContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { MmsiScanner } from './MmsiScanner';
import {
    SecureVessel, VesselComplianceStatus, UserRole,
    InspectionType, InspectionStatus,
    type Inspection, type InspectionChecklist,
} from '@/types/secure';

// ── Types ────────────────────────────────────────────────────────────────────

type TabKey = 'scanner' | 'inspection' | 'history';
type HistoryFilter = 'ALL' | 'COMPLETED' | 'FLAGGED' | 'IN_PROGRESS';

// ── Mock Inspections ─────────────────────────────────────────────────────────

const MOCK_INSPECTIONS: Inspection[] = [
    {
        id: 'insp-001',
        ref: 'INS-2025-000001',
        vesselId: 'vsec-002',
        vesselName: 'MAERSK SEALAND',
        vesselMmsi: '219045000',
        inspectorId: 'usr-001',
        inspectorName: 'Officer Hassan',
        inspectionType: InspectionType.ROUTINE,
        status: InspectionStatus.COMPLETED,
        checklist: {
            aisTransponderActive: true,
            emissionDocumentsOnBoard: true,
            co2CertificateValid: true,
            fuelLogAvailable: true,
            safetyEquipmentOk: true,
        },
        findings: 'All documentation in order. Vessel fully compliant.',
        photoUrls: [],
        complianceVerified: true,
        offlineCreated: false,
        syncedAt: '2025-03-09T10:00:00Z',
        createdAt: '2025-03-09T09:30:00Z',
    },
    {
        id: 'insp-002',
        ref: 'INS-2025-000002',
        vesselId: 'vsec-006',
        vesselName: 'OCEAN VOYAGER',
        vesselMmsi: '241345000',
        inspectorId: 'usr-001',
        inspectorName: 'Officer Hassan',
        inspectionType: InspectionType.COMPLIANCE_CHECK,
        status: InspectionStatus.FLAGGED,
        checklist: {
            aisTransponderActive: true,
            emissionDocumentsOnBoard: false,
            co2CertificateValid: false,
            fuelLogAvailable: false,
            safetyEquipmentOk: true,
        },
        findings: 'Missing emission documents and CO2 certificate. Fuel log not available for review.',
        photoUrls: [],
        complianceVerified: false,
        offlineCreated: true,
        syncedAt: null,
        createdAt: '2025-03-09T11:15:00Z',
    },
    {
        id: 'insp-003',
        ref: 'INS-2025-000003',
        vesselId: 'vsec-001',
        vesselName: 'MSC BERBERA',
        vesselMmsi: '356224000',
        inspectorId: 'usr-001',
        inspectorName: 'Officer Hassan',
        inspectionType: InspectionType.RANDOM,
        status: InspectionStatus.IN_PROGRESS,
        checklist: {
            aisTransponderActive: true,
            emissionDocumentsOnBoard: true,
            co2CertificateValid: false,
            fuelLogAvailable: true,
            safetyEquipmentOk: true,
        },
        findings: '',
        photoUrls: [],
        complianceVerified: false,
        offlineCreated: false,
        syncedAt: null,
        createdAt: '2025-03-09T14:00:00Z',
    },
];

// ── Main Component ───────────────────────────────────────────────────────────

export function InspectorPage() {
    const t = useTranslations('Inspector');
    const { role } = useRole();
    const { isOnline } = useOnlineStatus();

    const [activeTab, setActiveTab] = React.useState<TabKey>('scanner');
    const [selectedVessel, setSelectedVessel] = React.useState<SecureVessel | null>(null);

    // Restrict access
    if (role !== UserRole.PORT_OFFICER && role !== UserRole.SUPERADMIN) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <div className="text-center">
                    <AlertTriangle className="w-12 h-12 text-[#EAB308] mx-auto mb-3" />
                    <p className="text-lg font-semibold text-[var(--os-text-primary)]">Access Restricted</p>
                    <p className="text-sm text-[var(--os-text-muted)]">This page is only available to port inspectors.</p>
                </div>
            </div>
        );
    }

    const tabs: { key: TabKey; icon: React.ReactNode; label: string }[] = [
        { key: 'scanner',    icon: <Search className="w-5 h-5" />,         label: t('tab_scanner') },
        { key: 'inspection', icon: <ClipboardCheck className="w-5 h-5" />, label: t('tab_inspection') },
        { key: 'history',    icon: <History className="w-5 h-5" />,        label: t('tab_history') },
    ];

    function handleStartInspection(vessel: SecureVessel) {
        setSelectedVessel(vessel);
        setActiveTab('inspection');
    }

    return (
        <div className="flex flex-col h-full max-w-2xl mx-auto">
            {/* Header */}
            <div className="px-4 pt-4 pb-2">
                <h1 className="text-2xl font-bold text-[var(--os-text-primary)]">{t('title')}</h1>
                <p className="text-sm text-[var(--os-text-muted)] mt-1">{t('subtitle')}</p>
            </div>

            {/* Offline notice */}
            {!isOnline && (
                <div className="mx-4 mb-2 px-4 py-3 rounded-xl bg-[#EAB308]/10 border border-[#EAB308]/30 flex items-center gap-3">
                    <WifiOff className="w-5 h-5 text-[#EAB308] flex-shrink-0" />
                    <span className="text-sm font-medium text-[#EAB308]">{t('offline_notice')}</span>
                </div>
            )}

            {/* Tab bar */}
            <div className="px-4 pt-2 pb-1">
                <div className="flex rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] p-1 gap-1">
                    {tabs.map(({ key, icon, label }) => (
                        <button
                            key={key}
                            onClick={() => setActiveTab(key)}
                            className={`flex-1 flex items-center justify-center gap-2 h-12 rounded-lg text-sm font-semibold transition-all ${
                                activeTab === key
                                    ? 'bg-[#10B981] text-[#060D1A] shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                                    : 'text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:bg-[var(--os-surface-3)]'
                            }`}
                        >
                            {icon}
                            <span className="hidden sm:inline">{label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-auto">
                {activeTab === 'scanner' && (
                    <MmsiScanner
                        onVesselFound={() => {}}
                        onStartInspection={handleStartInspection}
                    />
                )}
                {activeTab === 'inspection' && (
                    <InspectionForm
                        vessel={selectedVessel}
                        isOnline={isOnline}
                        onComplete={() => {
                            setSelectedVessel(null);
                            setActiveTab('history');
                        }}
                    />
                )}
                {activeTab === 'history' && <InspectionHistory />}
            </div>
        </div>
    );
}

// ── Inspection Form ──────────────────────────────────────────────────────────

function InspectionForm({
    vessel,
    isOnline,
    onComplete,
}: {
    vessel: SecureVessel | null;
    isOnline: boolean;
    onComplete: () => void;
}) {
    const t = useTranslations('Inspector');

    const [inspectionType, setInspectionType] = React.useState<InspectionType>(InspectionType.ROUTINE);
    const [checklist, setChecklist] = React.useState<InspectionChecklist>({
        aisTransponderActive: false,
        emissionDocumentsOnBoard: false,
        co2CertificateValid: false,
        fuelLogAvailable: false,
        safetyEquipmentOk: false,
    });
    const [findings, setFindings] = React.useState('');

    const typeOptions: { type: InspectionType; label: string }[] = [
        { type: InspectionType.ROUTINE,          label: t('type_routine') },
        { type: InspectionType.COMPLIANCE_CHECK, label: t('type_compliance') },
        { type: InspectionType.RANDOM,           label: t('type_random') },
        { type: InspectionType.FOLLOW_UP,        label: t('type_follow_up') },
    ];

    const checklistItems: { key: keyof InspectionChecklist; label: string }[] = [
        { key: 'aisTransponderActive',      label: t('check_ais') },
        { key: 'emissionDocumentsOnBoard',   label: t('check_documents') },
        { key: 'co2CertificateValid',        label: t('check_co2_cert') },
        { key: 'fuelLogAvailable',           label: t('check_fuel_log') },
        { key: 'safetyEquipmentOk',          label: t('check_safety') },
    ];

    const allPassed = Object.values(checklist).every(Boolean);

    function toggleCheck(key: keyof InspectionChecklist) {
        setChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
    }

    function handleComplete() {
        onComplete();
    }

    function handleFlag() {
        onComplete();
    }

    if (!vessel) {
        return (
            <div className="flex flex-col items-center gap-4 py-12 px-4 text-center">
                <div className="w-16 h-16 rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] flex items-center justify-center">
                    <Ship className="w-8 h-8 text-[var(--os-text-muted)]" />
                </div>
                <p className="text-sm text-[var(--os-text-muted)]">
                    {t('mmsi_not_found').replace('No vessel found with this MMSI', 'Scan an MMSI first to start an inspection')}
                </p>
                <p className="text-xs text-[var(--os-text-muted)]">{t('tab_scanner')}</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-5 p-4">
            {/* Vessel info */}
            <div className="rounded-xl border border-[var(--os-border)] bg-[var(--os-surface)] p-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] flex items-center justify-center flex-shrink-0">
                        <Ship className="w-5 h-5 text-[var(--os-text-muted)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-2xl font-bold text-[var(--os-text-primary)] truncate">{vessel.name}</p>
                        <p className="text-sm text-[var(--os-text-muted)]">MMSI: {vessel.mmsi} · IMO: {vessel.imoNumber} · {vessel.flagCode}</p>
                    </div>
                </div>
            </div>

            {/* Inspection type selector */}
            <div className="flex flex-col gap-2">
                <label className="text-lg font-semibold text-[var(--os-text-primary)]">{t('tab_inspection')}</label>
                <div className="grid grid-cols-2 gap-2">
                    {typeOptions.map(({ type, label }) => (
                        <button
                            key={type}
                            onClick={() => setInspectionType(type)}
                            className={`h-14 rounded-xl border text-sm font-semibold transition-all ${
                                inspectionType === type
                                    ? 'bg-[#10B981]/15 border-[#10B981] text-[#10B981]'
                                    : 'border-[var(--os-border)] text-[var(--os-text-muted)] hover:border-[var(--os-border-strong)] hover:text-[var(--os-text-primary)]'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Compliance checklist */}
            <div className="flex flex-col gap-2">
                <label className="text-lg font-semibold text-[var(--os-text-primary)]">{t('checklist_title')}</label>
                <div className="rounded-xl border border-[var(--os-border)] bg-[var(--os-surface)] overflow-hidden divide-y divide-[var(--os-border)]">
                    {checklistItems.map(({ key, label }) => (
                        <button
                            key={key}
                            onClick={() => toggleCheck(key)}
                            className="w-full flex items-center justify-between px-4 py-4 hover:bg-[var(--os-surface-2)] transition-colors"
                        >
                            <span className="text-sm font-medium text-[var(--os-text-primary)]">{label}</span>
                            <div
                                className={`w-12 h-7 rounded-full transition-colors relative flex-shrink-0 ${
                                    checklist[key] ? 'bg-[#10B981]' : 'bg-[var(--os-surface-3)]'
                                }`}
                            >
                                <div
                                    className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${
                                        checklist[key] ? 'translate-x-[22px]' : 'translate-x-0.5'
                                    }`}
                                />
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Findings */}
            <div className="flex flex-col gap-2">
                <label className="text-lg font-semibold text-[var(--os-text-primary)]">{t('findings_label')}</label>
                <textarea
                    value={findings}
                    onChange={(e) => setFindings(e.target.value)}
                    placeholder={t('findings_placeholder')}
                    rows={4}
                    className="w-full px-4 py-4 rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] text-sm text-[var(--os-text-primary)] placeholder:text-[var(--os-text-muted)] focus:outline-none focus:border-[#10B981]/50 transition-colors resize-none"
                />
            </div>

            {/* Photos */}
            <div className="flex flex-col gap-2">
                <label className="text-lg font-semibold text-[var(--os-text-primary)]">{t('photos_label')}</label>
                <label className="w-full h-14 rounded-xl border-2 border-dashed border-[var(--os-border)] hover:border-[var(--os-border-strong)] transition-colors flex items-center justify-center gap-2 text-sm font-medium text-[var(--os-text-muted)] cursor-pointer">
                    <Camera className="w-5 h-5" />
                    {t('photos_add')}
                    <input type="file" accept="image/*" capture="environment" className="hidden" />
                </label>
            </div>

            {/* Offline indicator */}
            {!isOnline && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#EAB308]/10 border border-[#EAB308]/30">
                    <WifiOff className="w-4 h-4 text-[#EAB308] flex-shrink-0" />
                    <span className="text-xs font-medium text-[#EAB308]">{t('offline_notice')}</span>
                </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-col gap-3 pb-6">
                <button
                    onClick={handleComplete}
                    className="w-full h-14 rounded-xl bg-[#10B981] text-[#060D1A] text-lg font-bold hover:bg-[#0D9668] transition-colors shadow-[0_0_12px_rgba(16,185,129,0.25)] flex items-center justify-center gap-2"
                >
                    <CheckCircle className="w-5 h-5" />
                    {t('btn_complete')}
                </button>
                <button
                    onClick={handleFlag}
                    className="w-full h-14 rounded-xl bg-[#EF4444] text-white text-lg font-bold hover:bg-[#DC2626] transition-colors shadow-[0_0_12px_rgba(239,68,68,0.25)] flex items-center justify-center gap-2"
                >
                    <XCircle className="w-5 h-5" />
                    {t('btn_flag')}
                </button>
            </div>
        </div>
    );
}

// ── Inspection History ───────────────────────────────────────────────────────

const STATUS_VARIANT: Record<InspectionStatus, Parameters<typeof OsBadge>[0]['variant']> = {
    [InspectionStatus.COMPLETED]:   'compliant',
    [InspectionStatus.FLAGGED]:     'non_compliant',
    [InspectionStatus.IN_PROGRESS]: 'processing',
};

function InspectionHistory() {
    const t = useTranslations('Inspector');
    const [filter, setFilter] = React.useState<HistoryFilter>('ALL');

    const STATUS_LABEL: Record<InspectionStatus, string> = {
        [InspectionStatus.COMPLETED]:   t('status_completed'),
        [InspectionStatus.FLAGGED]:     t('status_flagged'),
        [InspectionStatus.IN_PROGRESS]: t('status_in_progress'),
    };

    const TYPE_LABEL: Record<InspectionType, string> = {
        [InspectionType.ROUTINE]:          t('type_routine'),
        [InspectionType.COMPLIANCE_CHECK]: t('type_compliance'),
        [InspectionType.RANDOM]:           t('type_random'),
        [InspectionType.FOLLOW_UP]:        t('type_follow_up'),
    };

    const filters: { key: HistoryFilter; label: string }[] = [
        { key: 'ALL',         label: t('filter_all') },
        { key: 'COMPLETED',   label: t('filter_completed') },
        { key: 'FLAGGED',     label: t('filter_flagged') },
        { key: 'IN_PROGRESS', label: t('filter_in_progress') },
    ];

    const filtered = MOCK_INSPECTIONS.filter((insp) => {
        if (filter === 'ALL') return true;
        return insp.status === filter;
    });

    return (
        <div className="flex flex-col gap-4 p-4">
            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
                {filters.map(({ key, label }) => (
                    <button
                        key={key}
                        onClick={() => setFilter(key)}
                        className={`px-4 h-10 rounded-xl text-sm font-semibold border transition-all ${
                            filter === key
                                ? 'bg-[var(--os-surface-3)] text-[var(--os-text-primary)] border-[var(--os-border-strong)]'
                                : 'text-[var(--os-text-muted)] border-[var(--os-border)] hover:border-[var(--os-border-strong)]'
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* Inspection cards */}
            {filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                    <ClipboardCheck className="w-12 h-12 text-[var(--os-text-muted)]" />
                    <p className="text-sm text-[var(--os-text-muted)]">{t('history_empty')}</p>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {filtered.map((insp) => (
                        <div
                            key={insp.id}
                            className="rounded-xl border border-[var(--os-border)] bg-[var(--os-surface)] p-4 flex flex-col gap-3"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <p className="text-lg font-bold text-[var(--os-text-primary)] truncate">{insp.vesselName}</p>
                                    <p className="text-xs text-[var(--os-text-muted)]">MMSI: {insp.vesselMmsi} · {insp.ref}</p>
                                </div>
                                <OsBadge variant={STATUS_VARIANT[insp.status]} label={STATUS_LABEL[insp.status]} />
                            </div>

                            <div className="flex items-center gap-3 flex-wrap">
                                <span className="px-3 py-1 rounded-lg text-xs font-semibold bg-[var(--os-surface-2)] border border-[var(--os-border)] text-[var(--os-text-secondary)]">
                                    {TYPE_LABEL[insp.inspectionType]}
                                </span>
                                <span className="text-xs text-[var(--os-text-muted)]">
                                    {new Date(insp.createdAt).toLocaleDateString()} · {new Date(insp.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>

                            <div className="flex items-center gap-2">
                                {insp.complianceVerified ? (
                                    <span className="flex items-center gap-1.5 text-xs font-semibold text-[#10B981]">
                                        <CheckCircle className="w-4 h-4" />
                                        {t('compliance_verified')}
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-1.5 text-xs font-semibold text-[#EF4444]">
                                        <XCircle className="w-4 h-4" />
                                        {t('compliance_failed')}
                                    </span>
                                )}

                                {insp.offlineCreated && !insp.syncedAt && (
                                    <span className="flex items-center gap-1 text-xs text-[#EAB308] ml-auto">
                                        <WifiOff className="w-3.5 h-3.5" />
                                        {t('pending_sync')}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
