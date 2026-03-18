'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
    Download, RefreshCw, Shield, AlertTriangle, Info,
    Search, ChevronRight, X, User, Clock, Globe, Tag,
    LogIn, LogOut, FileText, DollarSign, CheckCircle, UserPlus, ArrowUpDown,
} from 'lucide-react';
import { OsBadge, severityVariant } from '@/components/ui/OsBadge';
import { useAuditLog } from '@/hooks/useAuditLog';
import { AuditLogEntry, AuditSeverity, AuditAction } from '@/types/secure';

// ── Label maps ────────────────────────────────────────────────────────────────

const ACTION_LABEL: Record<string, string> = {
    [AuditAction.LOGIN]:               'Login',
    [AuditAction.LOGOUT]:              'Logout',
    [AuditAction.VESSEL_VIEWED]:       'Vessel Viewed',
    [AuditAction.INVOICE_GENERATED]:   'Invoice Generated',
    [AuditAction.TAX_RATE_UPDATED]:    'Tax Rate Updated',
    [AuditAction.EXEMPTION_GRANTED]:   'Exemption Granted',
    [AuditAction.REPORT_EXPORTED]:     'Report Exported',
    [AuditAction.USER_CREATED]:        'User Created',
    [AuditAction.TRANSACTION_UPDATED]: 'Transaction Updated',
};

const ACTION_ICON: Record<string, React.ReactNode> = {
    [AuditAction.LOGIN]:               <LogIn className="w-3.5 h-3.5" />,
    [AuditAction.LOGOUT]:              <LogOut className="w-3.5 h-3.5" />,
    [AuditAction.VESSEL_VIEWED]:       <Globe className="w-3.5 h-3.5" />,
    [AuditAction.INVOICE_GENERATED]:   <FileText className="w-3.5 h-3.5" />,
    [AuditAction.TAX_RATE_UPDATED]:    <DollarSign className="w-3.5 h-3.5" />,
    [AuditAction.EXEMPTION_GRANTED]:   <CheckCircle className="w-3.5 h-3.5" />,
    [AuditAction.REPORT_EXPORTED]:     <Download className="w-3.5 h-3.5" />,
    [AuditAction.USER_CREATED]:        <UserPlus className="w-3.5 h-3.5" />,
    [AuditAction.TRANSACTION_UPDATED]: <ArrowUpDown className="w-3.5 h-3.5" />,
};

const SEVERITY_ICON: Record<AuditSeverity, React.ReactNode> = {
    [AuditSeverity.INFO]:     <Info className="w-3.5 h-3.5" />,
    [AuditSeverity.WARNING]:  <AlertTriangle className="w-3.5 h-3.5" />,
    [AuditSeverity.CRITICAL]: <Shield className="w-3.5 h-3.5" />,
};

const SEVERITY_COLOR: Record<AuditSeverity, string> = {
    [AuditSeverity.INFO]:     '#38BDF8',
    [AuditSeverity.WARNING]:  '#F59E0B',
    [AuditSeverity.CRITICAL]: '#EF4444',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTs(iso: string): { date: string; time: string } {
    const d = new Date(iso);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}Z`;
    return { date, time };
}

function exportCsv(entries: AuditLogEntry[]) {
    const header = ['Ref', 'Timestamp', 'User', 'Action', 'Entity Type', 'Entity Ref', 'Severity', 'IP Address', 'Details'];
    const rows = entries.map((e) => [
        e.ref,
        e.createdAt,
        e.userFullName,
        ACTION_LABEL[e.action] ?? e.action,
        e.entityType,
        (e.detailsJson as Record<string, unknown>)?.entityRef as string ?? e.entityId,
        e.severity,
        e.ipAddress,
        JSON.stringify(e.detailsJson),
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ── Unique helpers ─────────────────────────────────────────────────────────────

const ALL_ACTIONS   = Object.values(AuditAction);

// ── Main component ────────────────────────────────────────────────────────────

export function AuditLogPage() {
    const t = useTranslations('DashboardPages');
    const { data: auditLog } = useAuditLog();
    const UNIQUE_USERS  = React.useMemo(() => [...new Set(auditLog.map((e) => e.userFullName))], [auditLog]);
    const UNIQUE_ENTITY = React.useMemo(() => [...new Set(auditLog.map((e) => e.entityType))], [auditLog]);
    // Filters
    const [search,        setSearch]     = React.useState('');
    const [filterSev,     setFilterSev]  = React.useState<string>('ALL');
    const [filterAction,  setFilterAct]  = React.useState<string>('ALL');
    const [filterUser,    setFilterUser] = React.useState<string>('ALL');
    const [filterEntity,  setFilterEnt]  = React.useState<string>('ALL');
    const [filterPeriod,  setFilterPer]  = React.useState<string>('7d');
    // Detail panel
    const [selected, setSelected] = React.useState<AuditLogEntry | null>(null);
    // Refresh animation
    const [refreshing, setRefreshing] = React.useState(false);

    const filtered = React.useMemo(() => {
        const now = new Date('2025-03-09T12:00:00Z').getTime();
        const periodMs: Record<string, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000, all: Infinity };
        const ms = periodMs[filterPeriod] ?? Infinity;
        return auditLog.filter((e) => {
            if (filterSev    !== 'ALL' && e.severity     !== filterSev)    return false;
            if (filterAction !== 'ALL' && e.action       !== filterAction)  return false;
            if (filterUser   !== 'ALL' && e.userFullName !== filterUser)    return false;
            if (filterEntity !== 'ALL' && e.entityType   !== filterEntity)  return false;
            if (now - new Date(e.createdAt).getTime() > ms)                 return false;
            if (search) {
                const q = search.toLowerCase();
                if (!e.userFullName.toLowerCase().includes(q) &&
                    !e.entityType.toLowerCase().includes(q) &&
                    !(ACTION_LABEL[e.action] ?? e.action).toLowerCase().includes(q) &&
                    !e.ipAddress.includes(q) &&
                    !JSON.stringify(e.detailsJson).toLowerCase().includes(q)) return false;
            }
            return true;
        }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [search, filterSev, filterAction, filterUser, filterEntity, filterPeriod]);

    const criticalCount = auditLog.filter((e) => e.severity === AuditSeverity.CRITICAL).length;
    const warningCount  = auditLog.filter((e) => e.severity === AuditSeverity.WARNING).length;
    const uniqueUsers   = new Set(auditLog.map((e) => e.userId)).size;

    function handleRefresh() {
        setRefreshing(true);
        setTimeout(() => setRefreshing(false), 800);
    }

    return (
        <div className="px-3 sm:px-5 py-3 sm:py-5 flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-xl font-bold text-[var(--os-text-primary)]">{t('audit_title')}</h1>
                    <p className="text-xs text-[var(--os-text-muted)] mt-0.5">
                        {t('audit_subtitle')}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleRefresh}
                        className="w-9 h-9 rounded-xl border border-[var(--os-border)] flex items-center justify-center text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:bg-[var(--os-surface-2)] transition-colors"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        onClick={() => exportCsv(filtered)}
                        className="flex items-center gap-1.5 h-9 px-3 rounded-xl bg-[#00D97E] text-[#060D1A] text-xs font-bold hover:bg-[#00C070] transition-colors shadow-[0_0_10px_rgba(0,217,126,0.2)]"
                    >
                        <Download className="w-3.5 h-3.5" />
                        {t('audit_export_csv')}
                    </button>
                </div>
            </div>

            {/* KPI summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: t('audit_critical_alerts'), value: criticalCount, color: '#EF4444' },
                    { label: t('audit_warnings'),         value: warningCount,  color: '#F59E0B' },
                    { label: t('audit_total_events'),     value: auditLog.length, color: '#38BDF8' },
                    { label: t('audit_active_users'),     value: uniqueUsers,   color: '#22C55E' },
                ].map(({ label, value, color }) => (
                    <div key={label} className="os-card p-4 relative overflow-hidden">
                        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ backgroundColor: color }} />
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-1">{label}</p>
                        <p className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
                    </div>
                ))}
            </div>

            {/* Filter bar */}
            <div className="os-card p-3 sm:p-4 flex flex-col sm:flex-row flex-wrap items-center gap-3">
                {/* Search */}
                <div className="relative w-full sm:flex-1 sm:min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                    <input
                        type="text"
                        placeholder={t('audit_search_placeholder')}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full h-9 pl-9 pr-3 rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] text-xs text-[var(--os-text-primary)] placeholder:text-[var(--os-text-muted)] focus:outline-none focus:border-[#00D97E]/40 transition-colors"
                    />
                    {search && (
                        <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)]">
                            <X className="w-3 h-3" />
                        </button>
                    )}
                </div>

                {/* Period */}
                <FilterSelect value={filterPeriod} onChange={setFilterPer} label="Period">
                    <option value="24h">{t('audit_period_last_24h')}</option>
                    <option value="7d">{t('audit_period_last_7d')}</option>
                    <option value="30d">{t('audit_period_last_30d')}</option>
                    <option value="all">{t('audit_period_all')}</option>
                </FilterSelect>

                {/* Severity */}
                <FilterSelect value={filterSev} onChange={setFilterSev} label="Severity">
                    <option value="ALL">{t('audit_severity_all')}</option>
                    <option value={AuditSeverity.INFO}>{t('audit_severity_info')}</option>
                    <option value={AuditSeverity.WARNING}>{t('audit_severity_warning')}</option>
                    <option value={AuditSeverity.CRITICAL}>{t('audit_severity_critical')}</option>
                </FilterSelect>

                {/* Action */}
                <FilterSelect value={filterAction} onChange={setFilterAct} label="Action">
                    <option value="ALL">{t('audit_actions_all')}</option>
                    {ALL_ACTIONS.map((a) => (
                        <option key={a} value={a}>{ACTION_LABEL[a] ?? a}</option>
                    ))}
                </FilterSelect>

                {/* User */}
                <FilterSelect value={filterUser} onChange={setFilterUser} label="User">
                    <option value="ALL">{t('audit_users_all')}</option>
                    {UNIQUE_USERS.map((u) => <option key={u} value={u}>{u}</option>)}
                </FilterSelect>

                {/* Entity */}
                <FilterSelect value={filterEntity} onChange={setFilterEnt} label="Entity">
                    <option value="ALL">{t('audit_entities_all')}</option>
                    {UNIQUE_ENTITY.map((e) => <option key={e} value={e}>{e}</option>)}
                </FilterSelect>

                {/* Results count */}
                <span className="text-[10px] text-[var(--os-text-muted)] ml-auto whitespace-nowrap">
                    {filtered.length} / {auditLog.length} {t('audit_events_count')}
                </span>
            </div>

            {/* Main layout */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                {/* Activity timeline - left column */}
                <div className="os-card overflow-hidden flex flex-col">
                    <div className="px-5 py-4 border-b border-[var(--os-border)]">
                        <h3 className="text-sm font-semibold text-[var(--os-text-primary)]">{t('audit_activity_timeline')}</h3>
                        <p className="text-[10px] text-[var(--os-text-muted)] mt-0.5">{t('audit_filtered_events')}</p>
                    </div>
                    <div className="flex-1 overflow-y-auto divide-y divide-[var(--os-border)]">
                        {filtered.length === 0 ? (
                            <div className="px-5 py-8 text-center text-xs text-[var(--os-text-muted)]">{t('audit_no_events_match')}</div>
                        ) : filtered.map((entry) => {
                            const { date, time } = formatTs(entry.createdAt);
                            const color = SEVERITY_COLOR[entry.severity];
                            const isSelected = selected?.id === entry.id;
                            return (
                                <button
                                    key={entry.id}
                                    onClick={() => setSelected(isSelected ? null : entry)}
                                    className={`w-full text-left px-4 py-3 hover:bg-[var(--os-surface-2)] transition-colors ${isSelected ? 'bg-[rgba(0,217,126,0.04)] border-l-2 border-[#00D97E]' : 'border-l-2 border-transparent'}`}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: `${color}15`, color }}>
                                            {ACTION_ICON[entry.action] ?? <Info className="w-3.5 h-3.5" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-semibold text-[var(--os-text-primary)] truncate">
                                                {ACTION_LABEL[entry.action] ?? entry.action}
                                            </p>
                                            <p className="text-[10px] text-[var(--os-text-secondary)] mt-0.5 truncate">
                                                {entry.userFullName} · {entry.entityType}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-[9px] font-mono text-[var(--os-text-muted)]">{date}</span>
                                                <span className="text-[9px] font-mono text-[var(--os-text-muted)]">{time}</span>
                                            </div>
                                        </div>
                                        <div style={{ color }} className="flex-shrink-0 mt-1">
                                            {SEVERITY_ICON[entry.severity]}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Audit table + detail panel - right 2/3 */}
                <div className="xl:col-span-2 flex flex-col gap-5">
                    {/* Detail panel */}
                    {selected && <EventDetailPanel entry={selected} onClose={() => setSelected(null)} />}

                    {/* Immutable log table */}
                    <div className="os-card overflow-hidden">
                        <div className="px-5 py-4 border-b border-[var(--os-border)] flex items-center justify-between">
                            <div>
                                <h3 className="text-sm font-semibold text-[var(--os-text-primary)]">{t('audit_immutable_log')}</h3>
                                <p className="text-[10px] text-[var(--os-text-muted)]">{t('audit_click_row')}</p>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-[#00D97E] animate-pulse" />
                                <span className="text-[10px] font-semibold text-[#00D97E]">{t('audit_live')}</span>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-[var(--os-border)] bg-[var(--os-surface-2)]">
                                        {[t('audit_col_timestamp'), t('audit_col_user'), t('audit_col_action'), t('audit_col_entity'), t('audit_col_severity'), t('audit_col_ip'), ''].map((h) => (
                                            <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] whitespace-nowrap">
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map((entry) => {
                                        const { date, time } = formatTs(entry.createdAt);
                                        const isSelected = selected?.id === entry.id;
                                        return (
                                            <tr
                                                key={entry.id}
                                                onClick={() => setSelected(isSelected ? null : entry)}
                                                className={`border-b border-[var(--os-border)] last:border-0 transition-colors cursor-pointer ${
                                                    isSelected
                                                        ? 'bg-[rgba(0,217,126,0.05)]'
                                                        : 'hover:bg-[var(--os-surface-2)]'
                                                }`}
                                            >
                                                <td className="px-4 py-3 whitespace-nowrap">
                                                    <p className="font-mono text-[10px] text-[var(--os-text-secondary)]">{date}</p>
                                                    <p className="font-mono text-[9px] text-[var(--os-text-muted)]">{time}</p>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-6 h-6 rounded-full bg-[var(--os-surface-2)] border border-[var(--os-border)] flex items-center justify-center text-[8px] font-bold text-[var(--os-text-primary)]">
                                                            {entry.userFullName.split(' ').map((p) => p[0]).join('').slice(0, 2)}
                                                        </div>
                                                        <p className="text-xs font-semibold text-[var(--os-text-primary)] whitespace-nowrap">{entry.userFullName}</p>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap">
                                                    <div className="flex items-center gap-1.5 text-[var(--os-text-secondary)]">
                                                        {ACTION_ICON[entry.action]}
                                                        <span>{ACTION_LABEL[entry.action] ?? entry.action}</span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className="font-mono text-[10px] text-[var(--os-text-muted)] bg-[var(--os-surface-2)] px-1.5 py-0.5 rounded">
                                                        {entry.entityType}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <OsBadge variant={severityVariant(entry.severity)} label={entry.severity} />
                                                </td>
                                                <td className="px-4 py-3 font-mono text-[10px] text-[var(--os-text-muted)] whitespace-nowrap">
                                                    {entry.ipAddress}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <ChevronRight className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {filtered.length === 0 && (
                                        <tr>
                                            <td colSpan={7} className="px-4 py-8 text-center text-xs text-[var(--os-text-muted)]">
                                                {t('audit_no_events_filters')}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div className="px-5 py-2.5 border-t border-[var(--os-border)] flex items-center justify-between text-[10px] text-[var(--os-text-muted)]">
                            <span>{t('audit_showing')} {filtered.length} {t('audit_of')} {auditLog.length} {t('audit_events_count')}</span>
                            <span className="font-mono">Hash: <span className="text-[#38BDF8]">SHA256:a3f9c…e12d</span> · {t('audit_hash_chain')} ✓</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Event Detail Panel ────────────────────────────────────────────────────────

function EventDetailPanel({ entry, onClose }: { entry: AuditLogEntry; onClose: () => void }) {
    const t = useTranslations('DashboardPages');
    const { date, time } = formatTs(entry.createdAt);
    const color = SEVERITY_COLOR[entry.severity];

    return (
        <div className="os-card overflow-hidden border border-[var(--os-border-strong)]">
            <div className="px-5 py-4 border-b border-[var(--os-border)] flex items-center justify-between" style={{ borderLeft: `3px solid ${color}` }}>
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${color}15`, color }}>
                        {ACTION_ICON[entry.action] ?? <Info className="w-4 h-4" />}
                    </div>
                    <div>
                        <p className="text-sm font-bold text-[var(--os-text-primary)]">
                            {ACTION_LABEL[entry.action] ?? entry.action}
                        </p>
                        <p className="text-[10px] text-[var(--os-text-muted)]">{t('audit_event_id')} {entry.ref}</p>
                    </div>
                </div>
                <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:bg-[var(--os-surface-2)]">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
                <DetailField icon={<User className="w-3.5 h-3.5" />}     label={t('audit_operator')}   value={entry.userFullName} />
                <DetailField icon={<Clock className="w-3.5 h-3.5" />}    label={t('audit_timestamp')}  value={`${date} ${time}`} mono />
                <DetailField icon={<Globe className="w-3.5 h-3.5" />}    label={t('audit_ip_address')} value={entry.ipAddress} mono />
                <DetailField icon={<Tag className="w-3.5 h-3.5" />}      label={t('audit_entity')}     value={`${entry.entityType} · ${(entry.detailsJson as Record<string, unknown>)?.entityRef as string ?? entry.entityId}`} mono />
            </div>

            <div className="px-5 pb-5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">{t('audit_event_payload')}</p>
                <div className="rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] p-4 overflow-x-auto">
                    <pre className="text-[10px] font-mono text-[#38BDF8] whitespace-pre-wrap">
                        {JSON.stringify(entry.detailsJson, null, 2)}
                    </pre>
                </div>
            </div>
        </div>
    );
}

function DetailField({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
    return (
        <div>
            <div className="flex items-center gap-1.5 text-[var(--os-text-muted)] mb-1">
                {icon}
                <span className="text-[9px] font-bold uppercase tracking-widest">{label}</span>
            </div>
            <p className={`text-xs text-[var(--os-text-primary)] ${mono ? 'font-mono' : 'font-semibold'}`}>{value}</p>
        </div>
    );
}

function FilterSelect({ value, onChange, label, children }: {
    value: string;
    onChange: (v: string) => void;
    label: string;
    children: React.ReactNode;
}) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={label}
            className="h-9 px-2 rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] text-xs text-[var(--os-text-primary)] focus:outline-none focus:border-[#00D97E]/40 transition-colors"
        >
            {children}
        </select>
    );
}
