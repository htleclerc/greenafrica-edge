'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
    AlertTriangle, Shield, Bell, BellOff, CheckCheck,
    X, Clock, Ship, DollarSign, Zap, Info,
    ChevronRight, ArrowRight,
} from 'lucide-react';
import { useVessels } from '@/hooks/useVessels';
import { useTransactions } from '@/hooks/useTransactions';
import { VesselComplianceStatus, TransactionStatus, SecureVessel, Transaction } from '@/types/secure';

// ── Alert data model ──────────────────────────────────────────────────────────

type AlertSeverity = 'critical' | 'warning' | 'info';
type AlertCategory = 'Compliance' | 'Payment' | 'System' | 'Security';

interface Alert {
    id: string;
    title: string;
    message: string;
    severity: AlertSeverity;
    category: AlertCategory;
    entityRef?: string;
    timestamp: string;
    acknowledged: boolean;
}

// ── Static + derived alerts ───────────────────────────────────────────────────

function buildAlerts(vessels: SecureVessel[], txns: Transaction[]): Alert[] {
    const alerts: Alert[] = [];

    // Non-compliant vessels
    vessels
        .filter((v) => v.complianceStatus === VesselComplianceStatus.NON_COMPLIANT)
        .forEach((v) => {
            alerts.push({
                id: `alrt-nc-${v.id}`,
                title: 'Non-Compliant Vessel in EEZ',
                message: `${v.name} (IMO ${v.imoNumber}, flag: ${v.flagCode}) has outstanding tax liability of $${v.taxLiabilityUsd.toLocaleString()}. Port gate lock recommended.`,
                severity: 'critical',
                category: 'Compliance',
                entityRef: v.name,
                timestamp: v.position.lastSeenUtc,
                acknowledged: false,
            });
        });

    // Payment due vessels
    vessels
        .filter((v) => v.complianceStatus === VesselComplianceStatus.PAYMENT_DUE)
        .forEach((v) => {
            alerts.push({
                id: `alrt-pd-${v.id}`,
                title: 'Payment Due — Pro-forma Required',
                message: `${v.name} (IMO ${v.imoNumber}) owes $${v.taxLiabilityUsd.toLocaleString()} in carbon tax. Pro-forma invoice not yet generated.`,
                severity: 'warning',
                category: 'Payment',
                entityRef: v.name,
                timestamp: v.position.lastSeenUtc,
                acknowledged: false,
            });
        });

    // Overdue transactions
    txns
        .filter((t) => t.status === TransactionStatus.OVERDUE)
        .forEach((t) => {
            alerts.push({
                id: `alrt-ov-${t.id}`,
                title: 'Overdue Transaction — Enforcement Required',
                message: `Transaction ${t.id} for ${t.vesselName} (${t.transactionType}) totalling $${t.taxAmountUsd.toLocaleString()} has exceeded the 48h payment window.`,
                severity: 'critical',
                category: 'Payment',
                entityRef: t.vesselName,
                timestamp: t.createdAt,
                acknowledged: false,
            });
        });

    // Static system alerts
    alerts.push(
        {
            id: 'alrt-sys-001',
            title: 'AIS Feed Degraded — Zeila Sector',
            message: 'AIS data coverage for Zeila port vicinity is below 80% for the last 2 hours. Vessels in sector may not be tracked.',
            severity: 'warning',
            category: 'System',
            entityRef: 'AIS Feed · Zeila',
            timestamp: '2025-03-09T08:00:00Z',
            acknowledged: false,
        },
        {
            id: 'alrt-sys-002',
            title: 'New Tax Rate Policy Published',
            message: 'Minister Al Farid updated the TANKER EEZ rate from $20 to $22/tCO₂. Effective immediately. Review pending invoices.',
            severity: 'info',
            category: 'System',
            entityRef: 'Tax Configuration',
            timestamp: '2025-03-08T16:30:00Z',
            acknowledged: true,
        },
        {
            id: 'alrt-sec-001',
            title: 'New Admin Account Created',
            message: 'Adm. Fadumo Yusuf created a new PORT_OFFICER account (agent.ibrahim@berbera.port). Review if authorized.',
            severity: 'warning',
            category: 'Security',
            entityRef: 'User Management',
            timestamp: '2025-03-08T14:20:00Z',
            acknowledged: true,
        },
        {
            id: 'alrt-sec-002',
            title: 'Ministerial Exemption Granted',
            message: 'USS Missouri received a full carbon tax exemption (MILITARY) valid until Dec 31, 2025. Approved by Min. Al Farid.',
            severity: 'info',
            category: 'Security',
            entityRef: 'Exemption · exc-001',
            timestamp: '2025-03-09T07:45:00Z',
            acknowledged: false,
        },
    );

    return alerts.sort((a, b) => {
        const sevOrder = { critical: 0, warning: 1, info: 2 };
        if (sevOrder[a.severity] !== sevOrder[b.severity]) return sevOrder[a.severity] - sevOrder[b.severity];
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
}

// ── Config maps ───────────────────────────────────────────────────────────────

const SEV_CONFIG: Record<AlertSeverity, { color: string; bg: string; icon: React.ReactNode; label: string }> = {
    critical: { color: '#EF4444', bg: '#EF444415', icon: <Shield className="w-4 h-4" />,        label: 'CRITICAL' },
    warning:  { color: '#F59E0B', bg: '#F59E0B15', icon: <AlertTriangle className="w-4 h-4" />, label: 'WARNING'  },
    info:     { color: '#38BDF8', bg: '#38BDF815', icon: <Info className="w-4 h-4" />,           label: 'INFO'     },
};

const CAT_ICON: Record<AlertCategory, React.ReactNode> = {
    Compliance: <Ship className="w-3.5 h-3.5" />,
    Payment:    <DollarSign className="w-3.5 h-3.5" />,
    System:     <Zap className="w-3.5 h-3.5" />,
    Security:   <Shield className="w-3.5 h-3.5" />,
};

const CAT_COLOR: Record<AlertCategory, string> = {
    Compliance: '#38BDF8',
    Payment:    '#00D97E',
    System:     '#F59E0B',
    Security:   '#A78BFA',
};

function relativeTime(iso: string): string {
    const diff = new Date('2025-03-09T12:00:00Z').getTime() - new Date(iso).getTime();
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    if (h >= 24) return `${Math.floor(h / 24)}d ago`;
    if (h > 0)   return `${h}h ${m}m ago`;
    return `${m}m ago`;
}

// ── Main component ────────────────────────────────────────────────────────────

export function AlertsPage() {
    const t = useTranslations('DashboardPages');
    const { data: vessels } = useVessels();
    const { data: transactions } = useTransactions();
    const initialAlerts = React.useMemo(() => buildAlerts(vessels, transactions), [vessels, transactions]);
    const [alerts, setAlerts] = React.useState<Alert[]>([]);
    React.useEffect(() => { setAlerts(initialAlerts); }, [initialAlerts]);
    const [activeCategory, setActiveCategory] = React.useState<string>('ALL');
    const [showAcknowledged, setShowAcknowledged] = React.useState(false);
    const [selected, setSelected] = React.useState<Alert | null>(null);

    const acknowledge = (id: string) => {
        setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, acknowledged: true } : a));
        if (selected?.id === id) setSelected((a) => a ? { ...a, acknowledged: true } : null);
    };

    const acknowledgeAll = () => {
        setAlerts((prev) => prev.map((a) => ({ ...a, acknowledged: true })));
        setSelected(null);
    };

    const displayed = alerts.filter((a) => {
        if (!showAcknowledged && a.acknowledged) return false;
        if (activeCategory !== 'ALL' && a.category !== activeCategory) return false;
        return true;
    });

    const unackCount   = alerts.filter((a) => !a.acknowledged).length;
    const criticalCount= alerts.filter((a) => a.severity === 'critical').length;
    const warningCount = alerts.filter((a) => a.severity === 'warning').length;
    const infoCount    = alerts.filter((a) => a.severity === 'info').length;

    return (
        <div className="px-3 sm:px-5 py-3 sm:py-5 flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-xl font-bold text-[var(--os-text-primary)]">{t('alerts_title')}</h1>
                    <p className="text-xs text-[var(--os-text-muted)] mt-0.5">
                        {t('alerts_subtitle')}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowAcknowledged((v) => !v)}
                        className={`flex items-center gap-1.5 h-9 px-3 rounded-xl border text-xs font-semibold transition-colors ${
                            showAcknowledged
                                ? 'border-[#00D97E]/40 text-[#00D97E] bg-[rgba(0,217,126,0.08)]'
                                : 'border-[var(--os-border)] text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)]'
                        }`}
                    >
                        {showAcknowledged ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
                        {showAcknowledged ? t('alerts_hide_acknowledged') : t('alerts_show_all')}
                    </button>
                    {unackCount > 0 && (
                        <button
                            onClick={acknowledgeAll}
                            className="flex items-center gap-1.5 h-9 px-3 rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] text-xs font-semibold text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] transition-colors"
                        >
                            <CheckCheck className="w-3.5 h-3.5" />
                            {t('alerts_acknowledge_all')}
                        </button>
                    )}
                </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: t('alerts_critical'),    value: criticalCount, color: '#EF4444' },
                    { label: t('alerts_warnings'),    value: warningCount,  color: '#F59E0B' },
                    { label: t('alerts_info'),        value: infoCount,     color: '#38BDF8' },
                    { label: t('alerts_unacknowledged'), value: unackCount, color: unackCount > 0 ? '#EF4444' : '#22C55E' },
                ].map(({ label, value, color }) => (
                    <div key={label} className="os-card p-4 relative overflow-hidden">
                        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ backgroundColor: color }} />
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">{label}</p>
                        <p className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
                    </div>
                ))}
            </div>

            {/* Category filter tabs */}
            <div className="flex items-center gap-2 flex-wrap overflow-x-auto pb-2 md:pb-0">
                {(['ALL', 'Compliance', 'Payment', 'System', 'Security'] as const).map((cat) => {
                    const color = cat === 'ALL' ? '#64748B' : CAT_COLOR[cat];
                    const count = cat === 'ALL' ? alerts.filter((a) => !a.acknowledged || showAcknowledged).length
                        : alerts.filter((a) => a.category === cat && (!a.acknowledged || showAcknowledged)).length;
                    return (
                        <button
                            key={cat}
                            onClick={() => setActiveCategory(cat)}
                            className={`flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-semibold transition-all ${
                                activeCategory === cat
                                    ? 'text-[var(--os-text-primary)] bg-[var(--os-surface-2)] border border-[var(--os-border-strong)]'
                                    : 'text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] border border-transparent hover:border-[var(--os-border)]'
                            }`}
                        >
                            {cat !== 'ALL' && <span style={{ color }}>{CAT_ICON[cat]}</span>}
                            {cat}
                            {count > 0 && (
                                <span className="ml-1 min-w-[18px] h-[18px] rounded-full text-[9px] font-bold flex items-center justify-center px-1" style={{ backgroundColor: `${color}20`, color }}>
                                    {count}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Main layout */}
            <div className={`grid gap-4 sm:gap-5 ${selected ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'}`}>
                {/* Alert list */}
                <div className="os-card overflow-hidden">
                    <div className="px-5 py-4 border-b border-[var(--os-border)] flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-[var(--os-text-primary)]">
                            {displayed.length} Alert{displayed.length !== 1 ? 's' : ''}
                            {activeCategory !== 'ALL' && ` · ${activeCategory}`}
                        </h3>
                        <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-[#EF4444] animate-pulse" />
                            <span className="text-[10px] font-semibold text-[#EF4444]">{t('alerts_monitoring')}</span>
                        </div>
                    </div>

                    <div className="divide-y divide-[var(--os-border)]">
                        {displayed.length === 0 ? (
                            <div className="px-5 py-12 text-center">
                                <CheckCheck className="w-8 h-8 text-[#22C55E] mx-auto mb-2" />
                                <p className="text-sm font-semibold text-[var(--os-text-primary)]">{t('alerts_all_clear')}</p>
                                <p className="text-xs text-[var(--os-text-muted)] mt-1">{t('alerts_no_alerts_category')}</p>
                            </div>
                        ) : displayed.map((alert) => {
                            const sev = SEV_CONFIG[alert.severity];
                            const isSelected = selected?.id === alert.id;
                            return (
                                <div
                                    key={alert.id}
                                    onClick={() => setSelected(isSelected ? null : alert)}
                                    className={`px-5 py-4 cursor-pointer transition-colors flex items-start gap-4 ${
                                        alert.acknowledged ? 'opacity-50' : ''
                                    } ${isSelected ? 'bg-[rgba(0,217,126,0.04)]' : 'hover:bg-[var(--os-surface-2)]'}`}
                                    style={{ borderLeft: `3px solid ${isSelected ? '#00D97E' : sev.color}` }}
                                >
                                    {/* Severity icon */}
                                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: sev.bg, color: sev.color }}>
                                        {sev.icon}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-2 mb-1">
                                            <p className="text-xs font-semibold text-[var(--os-text-primary)] leading-snug">{alert.title}</p>
                                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-widest" style={{ backgroundColor: sev.bg, color: sev.color }}>
                                                    {sev.label}
                                                </span>
                                                {alert.acknowledged && (
                                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-widest bg-[var(--os-surface-2)] text-[var(--os-text-muted)]">
                                                        {t('alerts_ack')}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <p className="text-[10px] text-[var(--os-text-muted)] leading-relaxed line-clamp-2">{alert.message}</p>
                                        <div className="flex items-center gap-3 mt-2">
                                            <span className="flex items-center gap-1 text-[9px]" style={{ color: CAT_COLOR[alert.category] }}>
                                                {CAT_ICON[alert.category]}
                                                <span className="font-semibold">{alert.category}</span>
                                            </span>
                                            {alert.entityRef && (
                                                <span className="text-[9px] font-mono text-[var(--os-text-muted)] bg-[var(--os-surface-2)] px-1.5 py-0.5 rounded">
                                                    {alert.entityRef}
                                                </span>
                                            )}
                                            <span className="flex items-center gap-1 text-[9px] text-[var(--os-text-muted)] ml-auto">
                                                <Clock className="w-2.5 h-2.5" />
                                                {relativeTime(alert.timestamp)}
                                            </span>
                                        </div>
                                    </div>

                                    <ChevronRight className="w-3.5 h-3.5 text-[var(--os-text-muted)] flex-shrink-0 mt-1" />
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Alert detail panel */}
                {selected && (
                    <AlertDetailPanel
                        alert={selected}
                        onClose={() => setSelected(null)}
                        onAcknowledge={() => acknowledge(selected.id)}
                    />
                )}
            </div>
        </div>
    );
}

// ── Alert Detail Panel ────────────────────────────────────────────────────────

function AlertDetailPanel({ alert, onClose, onAcknowledge }: {
    alert: Alert;
    onClose: () => void;
    onAcknowledge: () => void;
}) {
    const t = useTranslations('DashboardPages');
    const sev = SEV_CONFIG[alert.severity];

    return (
        <div className="os-card overflow-hidden self-start">
            {/* Header */}
            <div className="px-5 py-4 border-b border-[var(--os-border)] flex items-center justify-between" style={{ borderLeft: `3px solid ${sev.color}` }}>
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: sev.bg, color: sev.color }}>
                        {sev.icon}
                    </div>
                    <div>
                        <p className="text-sm font-bold text-[var(--os-text-primary)]">{t('alerts_detail_title')}</p>
                        <p className="text-[10px] text-[var(--os-text-muted)]">{t('alerts_detail_id')} {alert.id}</p>
                    </div>
                </div>
                <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:bg-[var(--os-surface-2)]">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="p-5 flex flex-col gap-5">
                {/* Title + severity badge */}
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-widest" style={{ backgroundColor: sev.bg, color: sev.color }}>
                            {sev.label}
                        </span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-widest" style={{ backgroundColor: `${CAT_COLOR[alert.category]}15`, color: CAT_COLOR[alert.category] }}>
                            {alert.category}
                        </span>
                    </div>
                    <h3 className="text-sm font-bold text-[var(--os-text-primary)] leading-snug">{alert.title}</h3>
                </div>

                {/* Description */}
                <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">{t('alerts_description')}</p>
                    <p className="text-xs text-[var(--os-text-secondary)] leading-relaxed">{alert.message}</p>
                </div>

                {/* Meta */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">{t('alerts_triggered')}</p>
                        <p className="text-xs font-mono text-[var(--os-text-primary)]">{alert.timestamp.replace('T', ' ').slice(0, 19)}Z</p>
                    </div>
                    <div>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">{t('alerts_relative')}</p>
                        <p className="text-xs text-[var(--os-text-primary)]">{relativeTime(alert.timestamp)}</p>
                    </div>
                    {alert.entityRef && (
                        <div className="col-span-2">
                            <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">{t('alerts_entity_reference')}</p>
                            <p className="text-xs font-mono text-[#38BDF8]">{alert.entityRef}</p>
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2">
                    {!alert.acknowledged ? (
                        <button
                            onClick={onAcknowledge}
                            className="w-full h-9 rounded-xl bg-[#00D97E] text-[#060D1A] text-xs font-bold hover:bg-[#00C070] transition-colors flex items-center justify-center gap-2"
                        >
                            <CheckCheck className="w-3.5 h-3.5" />
                            {t('alerts_acknowledge')}
                        </button>
                    ) : (
                        <div className="w-full h-9 rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] text-xs font-semibold text-[#22C55E] flex items-center justify-center gap-2">
                            <CheckCheck className="w-3.5 h-3.5" />
                            {t('alerts_acknowledged')}
                        </div>
                    )}
                    {alert.category === 'Compliance' && (
                        <a
                            href="/dashboard/vessels"
                            className="w-full h-9 rounded-xl border border-[var(--os-border)] text-xs font-semibold text-[var(--os-text-secondary)] hover:text-[var(--os-text-primary)] hover:border-[var(--os-border-strong)] flex items-center justify-center gap-2 transition-colors"
                        >
                            {t('alerts_view_vessel')} <ArrowRight className="w-3 h-3" />
                        </a>
                    )}
                    {alert.category === 'Payment' && (
                        <a
                            href="/dashboard/invoices"
                            className="w-full h-9 rounded-xl border border-[var(--os-border)] text-xs font-semibold text-[var(--os-text-secondary)] hover:text-[var(--os-text-primary)] hover:border-[var(--os-border-strong)] flex items-center justify-center gap-2 transition-colors"
                        >
                            {t('alerts_view_invoice')} <ArrowRight className="w-3 h-3" />
                        </a>
                    )}
                </div>
            </div>
        </div>
    );
}
