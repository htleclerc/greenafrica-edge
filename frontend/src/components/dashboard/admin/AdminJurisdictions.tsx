'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Globe2, Plus, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { OsBadge } from '@/components/ui/OsBadge';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput } from '@/components/ui/OsInput';
import { toggleJurisdictionMode } from '@/actions/toggleJurisdictionMode';
import { createTariffVersion } from '@/actions/createTariffVersion';
import { updateJurisdictionCcEmails } from '@/actions/updateJurisdictionCcEmails';

// ─────────────────────────────────────────────────────────────────────────────
// Types (exported so the page can cast DB results)
// ─────────────────────────────────────────────────────────────────────────────

export interface JurisdictionRow {
    id: string;
    code: string;
    name: string;
    default_currency: string;
    locales: string[];
    status: string;
}

export interface JurisdictionModeConfigRow {
    jurisdiction_id: string;
    mode: 'MARITIME' | 'AIR';
    enabled: boolean;
    activated_at: string | null;
}

export interface TariffRow {
    id: string;
    jurisdiction_id: string;
    mode: 'MARITIME' | 'AIR';
    asset_category: string | null;
    rate_per_tco2: number;
    currency: string;
    effective_from: string;
    effective_to: string | null;
    status: string;
    decree_ref: string | null;
}

export interface SplitRuleRow {
    id: string;
    jurisdiction_id: string;
    concessionaire_pct: number;
    sovereign_pct: number;
    contract_ref: string;
    effective_from: string;
    effective_to: string | null;
}

export interface SettlementRow {
    jurisdiction_id: string;
    jurisdiction_code: string;
    month: string; // ISO date string, 1st of month
    mode: 'MARITIME' | 'AIR';
    tx_count: number | string;
    total_usd: number | string | null;
    concessionaire_usd: number | string | null;
    sovereign_usd: number | string | null;
    unattributed_count: number | string;
    unattributed_usd: number | string | null;
    mismatched_count: number | string;
    mismatched_usd: number | string | null;
}

export interface JurisdictionBillingCcRow {
    jurisdiction_id: string;
    cc_emails: string[];
    bailiff_cc_emails: string[];
}

interface Props {
    jurisdictions: JurisdictionRow[];
    modeConfigs: JurisdictionModeConfigRow[];
    tariffs: TariffRow[];
    splitRules: SplitRuleRow[];
    settlement: SettlementRow[];
    viewerRole: string;
    ccByJurisdiction?: Record<string, { cc_emails: string[]; bailiff_cc_emails: string[] }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function jurisdictionStatusVariant(status: string) {
    if (status === 'ACTIVE') return 'active' as const;
    if (status === 'SUSPENDED') return 'overdue' as const;
    return 'draft' as const;
}

function formatDate(iso: string | null): string {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' });
    } catch {
        return '—';
    }
}

function today(): string {
    return new Date().toISOString().slice(0, 10);
}

function tomorrow(): string {
    return new Date(Date.now() + 86400000).toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode pill with two-step confirm
// ─────────────────────────────────────────────────────────────────────────────

interface ModePillProps {
    jid: string;
    mode: 'MARITIME' | 'AIR';
    config: JurisdictionModeConfigRow | undefined;
    canToggle: boolean;
    onRefresh: () => void;
}

function ModePill({ jid, mode, config, canToggle, onRefresh }: ModePillProps) {
    const t = useTranslations('AdminJurisdictions');
    const enabled = config?.enabled ?? false;
    const activatedAt = config?.activated_at;

    const [confirming, setConfirming] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const [err, setErr] = React.useState<string | null>(null);

    const handleToggle = async () => {
        setLoading(true);
        setErr(null);
        const res = await toggleJurisdictionMode({ jurisdictionId: jid, mode, enabled: !enabled });
        setLoading(false);
        setConfirming(false);
        if (!res.ok) {
            // M6: map raw error messages to i18n'd text; never render verbatim.
            const errMsg = res.error === 'not_found'
                ? t('mode.errorNotFound')
                : t('mode.error');
            setErr(errMsg);
        } else {
            onRefresh();
        }
    };

    const title = activatedAt
        ? `${t('mode.activatedAt')}: ${formatDate(activatedAt)}`
        : undefined;

    if (!canToggle) {
        return (
            <span title={title}>
                <OsBadge
                    variant={enabled ? 'paid' : 'exempt'}
                    label={mode}
                    dot
                />
            </span>
        );
    }

    // M1: trigger button is ALWAYS mounted — confirm/cancel appear adjacent rather than replacing it.
    return (
        <span className="inline-flex items-center gap-1">
            <button
                onClick={() => !confirming && setConfirming(true)}
                title={title}
                aria-label={`${mode} ${enabled ? 'enabled' : 'disabled'}`}
                className="inline-flex items-center cursor-pointer"
            >
                <OsBadge
                    variant={enabled ? 'paid' : 'exempt'}
                    label={mode}
                    dot
                    className="hover:opacity-80 transition-opacity"
                />
            </button>
            {confirming && (
                <>
                    <button
                        onClick={handleToggle}
                        disabled={loading}
                        className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[var(--os-surface-3)] hover:bg-[rgba(0,217,126,0.08)] transition-colors disabled:opacity-50"
                        style={{ color: 'var(--os-brand-green)', border: '1px solid rgba(0,217,126,0.30)' }}
                    >
                        {loading ? '…' : t('mode.confirm')}
                    </button>
                    <button
                        onClick={() => setConfirming(false)}
                        className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[var(--os-surface-3)] border border-[var(--os-border)] text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] transition-colors"
                    >
                        {t('mode.cancel')}
                    </button>
                    {err && (
                        <span role="alert" className="text-[10px]" style={{ color: 'var(--os-red)' }}>{err}</span>
                    )}
                </>
            )}
        </span>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// New tariff version inline form
// ─────────────────────────────────────────────────────────────────────────────

interface NewTariffFormProps {
    jid: string;
    defaultMode: 'MARITIME' | 'AIR';
    onSuccess: () => void;
    onCancel: () => void;
}

function NewTariffForm({ jid, defaultMode, onSuccess, onCancel }: NewTariffFormProps) {
    const t = useTranslations('AdminJurisdictions');
    const [mode, setMode] = React.useState<'MARITIME' | 'AIR'>(defaultMode);
    const [rate, setRate] = React.useState('');
    const [effectiveFrom, setEffectiveFrom] = React.useState(tomorrow());
    const [decreeRef, setDecreeRef] = React.useState('');
    const [assetCategory, setAssetCategory] = React.useState('');
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        const parsed = Number(rate);
        if (!rate || !Number.isFinite(parsed) || parsed <= 0) {
            setError(t('tariff.errorInvalidRate'));
            return;
        }
        if (!decreeRef.trim()) {
            setError(t('tariff.errorDecreeRequired'));
            return;
        }
        setSaving(true);
        const res = await createTariffVersion({
            jurisdictionId: jid,
            mode,
            ratePerTco2: parsed,
            effectiveFrom,
            decreeRef: decreeRef.trim(),
            assetCategory: assetCategory.trim() || undefined,
        });
        setSaving(false);
        if (!res.ok) {
            if (res.error === 'overlap') setError(t('tariff.errorOverlap'));
            else if (res.error === 'past_date') setError(t('tariff.errorPastDate'));
            else if (res.error === 'forbidden') setError(t('tariff.errorForbidden'));
            else setError(res.error);
        } else {
            onSuccess();
        }
    }

    return (
        <form
            onSubmit={handleSubmit}
            className="mt-3 p-4 rounded-xl border border-[var(--os-border)] bg-[var(--os-surface-2)] flex flex-col gap-3"
        >
            <p className="text-xs font-semibold text-[var(--os-text-primary)]">{t('tariff.newVersionTitle')}</p>

            {error && (
                <div
                    role="alert"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgba(239,68,68,0.05)] text-xs"
                    style={{ color: 'var(--os-red)', border: '1px solid rgba(239,68,68,0.40)' }}
                >
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    {error}
                </div>
            )}

            <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-[var(--os-text-secondary)] uppercase tracking-wider">
                        {t('tariff.fieldMode')}
                    </label>
                    <select
                        value={mode}
                        onChange={(e) => setMode(e.target.value as 'MARITIME' | 'AIR')}
                        className="h-9 rounded-xl px-3 bg-[var(--os-surface-3)] border border-[var(--os-border)] text-xs text-[var(--os-text-primary)] focus:outline-none focus:border-[var(--os-brand-green)] appearance-none"
                    >
                        <option value="MARITIME">MARITIME</option>
                        <option value="AIR">AIR</option>
                    </select>
                </div>
                <OsInput
                    label={t('tariff.fieldRate')}
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    placeholder="e.g. 40"
                    className="h-9 text-xs rounded-xl"
                />
            </div>

            <div className="grid grid-cols-2 gap-3">
                <OsInput
                    label={t('tariff.fieldEffectiveFrom')}
                    type="date"
                    value={effectiveFrom}
                    min={tomorrow()}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    className="h-9 text-xs rounded-xl"
                />
                <OsInput
                    label={t('tariff.fieldDecreeRef')}
                    type="text"
                    value={decreeRef}
                    onChange={(e) => setDecreeRef(e.target.value)}
                    placeholder="e.g. DECREE-2026-001"
                    className="h-9 text-xs rounded-xl"
                />
            </div>

            <OsInput
                label={t('tariff.fieldAssetCategory')}
                type="text"
                value={assetCategory}
                onChange={(e) => setAssetCategory(e.target.value)}
                placeholder={t('tariff.fieldAssetCategoryHint')}
                className="h-9 text-xs rounded-xl"
            />

            <div className="flex items-center gap-2 justify-end">
                <OsButton type="button" variant="secondary" size="sm" onClick={onCancel}>
                    {t('tariff.cancel')}
                </OsButton>
                <OsButton type="submit" variant="primary" size="sm" loading={saving}>
                    {t('tariff.submit')}
                </OsButton>
            </div>
        </form>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tariff section per jurisdiction + mode
// ─────────────────────────────────────────────────────────────────────────────

const TRANSPORT_MODES: Array<'MARITIME' | 'AIR'> = ['MARITIME', 'AIR'];

interface TariffSectionProps {
    jid: string;
    tariffs: TariffRow[];
    canEdit: boolean;
    onRefresh: () => void;
}

function TariffSection({ jid, tariffs, canEdit, onRefresh }: TariffSectionProps) {
    const t = useTranslations('AdminJurisdictions');
    const [showForm, setShowForm] = React.useState<'MARITIME' | 'AIR' | null>(null);
    const [historyOpen, setHistoryOpen] = React.useState(false);

    // Active null-category tariffs per mode.
    // M2: if the open row's effective_from is in the future (scheduled), also surface the
    // currently-billing row (the closed row whose window contains today).
    const activeTariffs = React.useMemo(() => {
        const map: Partial<Record<'MARITIME' | 'AIR', TariffRow>> = {};
        for (const mode of TRANSPORT_MODES) {
            const row = tariffs.find(
                (r) =>
                    r.jurisdiction_id === jid &&
                    r.mode === mode &&
                    r.status === 'ACTIVE' &&
                    r.asset_category === null &&
                    r.effective_to === null,
            );
            if (row) map[mode] = row;
        }
        return map;
    }, [jid, tariffs]);

    // M2: currently-billing row for each mode (closed row whose [from, to) contains today).
    const billingTariffs = React.useMemo(() => {
        const todayStr = today();
        const map: Partial<Record<'MARITIME' | 'AIR', TariffRow>> = {};
        for (const mode of TRANSPORT_MODES) {
            const open = activeTariffs[mode];
            // Only relevant when the open row is scheduled (future effective_from)
            if (!open || open.effective_from <= todayStr) continue;
            const billing = tariffs.find(
                (r) =>
                    r.jurisdiction_id === jid &&
                    r.mode === mode &&
                    r.asset_category === null &&
                    r.effective_to !== null &&
                    r.effective_from <= todayStr &&
                    r.effective_to > todayStr,
            );
            if (billing) map[mode] = billing;
        }
        return map;
    }, [jid, tariffs, activeTariffs]);

    // Category-specific active count per mode
    const categoryActiveCounts = React.useMemo(() => {
        const map: Partial<Record<'MARITIME' | 'AIR', number>> = {};
        for (const mode of TRANSPORT_MODES) {
            map[mode] = tariffs.filter(
                (r) =>
                    r.jurisdiction_id === jid &&
                    r.mode === mode &&
                    r.status === 'ACTIVE' &&
                    r.asset_category !== null &&
                    r.effective_to === null,
            ).length;
        }
        return map;
    }, [jid, tariffs]);

    const modes = TRANSPORT_MODES;

    const closedTariffs = tariffs.filter(
        (r) => r.jurisdiction_id === jid && r.effective_to !== null,
    );

    return (
        <div className="mt-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">
                {t('tariff.sectionTitle')}
            </p>

            <div className="flex flex-col gap-3">
                {modes.map((mode) => {
                    const active = activeTariffs[mode];
                    const billing = billingTariffs[mode];
                    const catCount = categoryActiveCounts[mode] ?? 0;
                    const isScheduled = active && active.effective_from > today();
                    return (
                        <div key={mode} className="flex items-start justify-between gap-3 p-3 rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)]">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{mode}</span>
                                    {active ? (
                                        isScheduled ? (
                                            <OsBadge variant="pending" label={t('tariff.scheduled')} size="sm" />
                                        ) : (
                                            <OsBadge variant="active" label="ACTIVE" size="sm" />
                                        )
                                    ) : (
                                        <OsBadge variant="archived" label={t('tariff.noActive')} size="sm" />
                                    )}
                                </div>
                                {/* M2: show the scheduled upcoming version */}
                                {active && isScheduled && (
                                    <div className="flex flex-wrap items-center gap-3 text-xs mb-1">
                                        <span className="font-mono font-bold" style={{ color: 'var(--os-yellow)' }}>
                                            {Number(active.rate_per_tco2).toFixed(2)} {active.currency}/tCO₂
                                        </span>
                                        <span className="text-[var(--os-text-muted)]">
                                            {t('tariff.scheduledFrom')} {formatDate(active.effective_from)}
                                        </span>
                                        {active.decree_ref && (
                                            <span className="text-[var(--os-text-muted)] font-mono text-[10px]">
                                                {active.decree_ref}
                                            </span>
                                        )}
                                    </div>
                                )}
                                {/* M2: currently-billing row when a version is scheduled */}
                                {billing && isScheduled && (
                                    <div className="flex flex-wrap items-center gap-3 text-xs">
                                        <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">{t('tariff.currentlyBilling')}</span>
                                        <span className="font-mono font-bold" style={{ color: 'var(--os-brand-green)' }}>
                                            {Number(billing.rate_per_tco2).toFixed(2)} {billing.currency}/tCO₂
                                        </span>
                                        <span className="text-[var(--os-text-muted)]">
                                            {t('tariff.since')} {formatDate(billing.effective_from)}
                                        </span>
                                    </div>
                                )}
                                {/* Normal active (non-scheduled) display */}
                                {active && !isScheduled && (
                                    <div className="flex flex-wrap items-center gap-3 text-xs">
                                        {/* M3: use row's currency instead of hardcoded '$' */}
                                        <span className="font-mono font-bold" style={{ color: 'var(--os-brand-green)' }}>
                                            {Number(active.rate_per_tco2).toFixed(2)} {active.currency}/tCO₂
                                        </span>
                                        <span className="text-[var(--os-text-muted)]">
                                            {t('tariff.since')} {formatDate(active.effective_from)}
                                        </span>
                                        {active.decree_ref && (
                                            <span className="text-[var(--os-text-muted)] font-mono text-[10px]">
                                                {active.decree_ref}
                                            </span>
                                        )}
                                        {catCount > 0 && (
                                            <span className="text-[var(--os-text-muted)] text-[10px]">
                                                +{catCount} {t('tariff.categorySpecific')}
                                            </span>
                                        )}
                                    </div>
                                )}
                                {!active && (
                                    <p className="text-[11px] text-[var(--os-text-muted)]">{t('tariff.noActiveLong')}</p>
                                )}
                            </div>
                            {canEdit && (
                                <OsButton
                                    variant="outline"
                                    size="sm"
                                    icon={<Plus className="w-3.5 h-3.5" />}
                                    onClick={() => setShowForm(showForm === mode ? null : mode)}
                                >
                                    {t('tariff.newVersion')}
                                </OsButton>
                            )}
                        </div>
                    );
                })}
            </div>

            {showForm && (
                <NewTariffForm
                    jid={jid}
                    defaultMode={showForm}
                    onSuccess={() => { setShowForm(null); onRefresh(); }}
                    onCancel={() => setShowForm(null)}
                />
            )}

            {closedTariffs.length > 0 && (
                <div className="mt-2">
                    <button
                        onClick={() => setHistoryOpen((v) => !v)}
                        className="flex items-center gap-1 text-[10px] text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] transition-colors"
                    >
                        {historyOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        {t('tariff.history', { count: closedTariffs.length })}
                    </button>
                    {historyOpen && (
                        <div className="mt-2 flex flex-col gap-1">
                            {closedTariffs.map((r) => (
                                <div key={r.id} className="flex items-center gap-3 text-[11px] text-[var(--os-text-muted)] px-2">
                                    <span className="font-mono text-[10px]">{r.mode}</span>
                                    {/* M3: currency from row */}
                                    <span className="font-mono">{Number(r.rate_per_tco2).toFixed(2)} {r.currency}</span>
                                    <span>{formatDate(r.effective_from)} → {formatDate(r.effective_to)}</span>
                                    {r.decree_ref && <span className="font-mono text-[10px]">{r.decree_ref}</span>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Split section
// ─────────────────────────────────────────────────────────────────────────────

function SplitSection({ split }: { split: SplitRuleRow | undefined }) {
    const t = useTranslations('AdminJurisdictions');
    if (!split) {
        return (
            <p className="mt-3 text-[11px] text-[var(--os-text-muted)]">{t('split.noRule')}</p>
        );
    }
    const isEscrow = Number(split.concessionaire_pct) === 0;
    return (
        <div className="mt-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5">
                {t('split.sectionTitle')}
            </p>
            <div className="flex items-center gap-2 text-xs">
                <span className="text-[var(--os-text-primary)]">
                    {t('split.concessionairePct', { pct: Number(split.concessionaire_pct).toFixed(0) })}
                    {' / '}
                    {t('split.sovereignPct', { pct: Number(split.sovereign_pct).toFixed(0) })}
                </span>
                <span className="text-[var(--os-text-muted)] font-mono text-[10px]">— {split.contract_ref}</span>
                {isEscrow && (
                    <OsBadge variant="pending" label="ESCROW" size="sm" />
                )}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Recovery CC section (billing + bailiff CC lists per jurisdiction)
// ─────────────────────────────────────────────────────────────────────────────

interface RecoveryCcSectionProps {
    jid: string;
    initial: { cc_emails: string[]; bailiff_cc_emails: string[] };
    canEdit: boolean;
}

function RecoveryCcSection({ jid, initial, canEdit }: RecoveryCcSectionProps) {
    const t = useTranslations('AdminJurisdictions');
    const [billing, setBilling] = React.useState(initial.cc_emails.join(', '));
    const [bailiff, setBailiff] = React.useState(initial.bailiff_cc_emails.join(', '));
    const [saving, startSave] = React.useTransition();
    const [msg, setMsg] = React.useState<string | null>(null);

    function parse(s: string): string[] {
        return s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
    }
    function save() {
        setMsg(null);
        startSave(async () => {
            const res = await updateJurisdictionCcEmails({
                jurisdictionId: jid, billingCcEmails: parse(billing), bailiffCcEmails: parse(bailiff),
            });
            setMsg(res.ok ? t('cc_saved') : res.reason);
        });
    }

    return (
        <div className="mt-3 border-t border-[var(--os-border)] pt-3">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">{t('recovery_cc_title')}</h4>
            <label className="block text-xs text-[var(--os-text-secondary)] mb-1">{t('billing_cc_label')}</label>
            <OsInput value={billing} disabled={!canEdit} onChange={(e) => setBilling(e.target.value)} placeholder="a@x.gov, b@x.gov" />
            <label className="block text-xs text-[var(--os-text-secondary)] mt-2 mb-1">{t('bailiff_cc_label')}</label>
            <OsInput value={bailiff} disabled={!canEdit} onChange={(e) => setBailiff(e.target.value)} placeholder="huissier@cabinet.so" />
            {canEdit && (
                <div className="flex items-center gap-2 mt-2">
                    <OsButton size="sm" variant="secondary" loading={saving} onClick={save}>{t('cc_save')}</OsButton>
                    {msg && <span className="text-xs text-[var(--os-text-muted)]">{msg}</span>}
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settlement section
// ─────────────────────────────────────────────────────────────────────────────

function fmtUsd(raw: number | string | null | undefined): string {
    const n = Number(raw ?? 0);
    return (Number.isFinite(n) ? n : 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }) + ' USD';
}

interface SettlementSectionProps {
    jid: string;
    rows: SettlementRow[];
}

function SettlementSection({ jid, rows }: SettlementSectionProps) {
    const t = useTranslations('AdminJurisdictions');

    const jurRows = rows.filter((r) => r.jurisdiction_id === jid);

    // Current month = the most recent month bucket (rows already ordered DESC by month)
    const latestMonth = jurRows[0]?.month ?? '';
    const currentMonthRows = jurRows.filter((r) => r.month === latestMonth);

    // Cumulative: sum across ALL rows for this jurisdiction
    const cumulative = jurRows.reduce(
        (acc, r) => ({
            total: acc.total + Number(r.total_usd ?? 0),
            concessionaire: acc.concessionaire + Number(r.concessionaire_usd ?? 0),
            sovereign: acc.sovereign + Number(r.sovereign_usd ?? 0),
            unattributed_count: acc.unattributed_count + Number(r.unattributed_count ?? 0),
            mismatched_count: acc.mismatched_count + Number(r.mismatched_count ?? 0),
        }),
        { total: 0, concessionaire: 0, sovereign: 0, unattributed_count: 0, mismatched_count: 0 },
    );

    if (jurRows.length === 0) {
        return (
            <div className="mt-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5">
                    {t('settlement.sectionTitle')}
                </p>
                <p className="text-[11px] text-[var(--os-text-muted)]">{t('settlement.empty')}</p>
            </div>
        );
    }

    return (
        <div className="mt-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-1.5">
                {t('settlement.sectionTitle')}
            </p>

            {/* Current month rows */}
            <div className="flex flex-col gap-1 mb-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
                    {t('settlement.currentMonth')}
                </p>
                {currentMonthRows.map((r) => {
                    const unattr = Number(r.unattributed_count ?? 0);
                    const mismatch = Number(r.mismatched_count ?? 0);
                    return (
                        <div key={`${r.month}-${r.mode}`} className="flex flex-wrap items-center gap-3 text-xs">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{r.mode}</span>
                            <span className="text-[var(--os-text-secondary)]">
                                {t('settlement.total')}: <span className="font-mono text-[var(--os-text-primary)]">{fmtUsd(r.total_usd)}</span>
                            </span>
                            <span className="text-[var(--os-text-muted)] text-[11px]">
                                {t('settlement.concessionaire')}: <span className="font-mono">{fmtUsd(r.concessionaire_usd)}</span>
                            </span>
                            <span className="text-[var(--os-text-muted)] text-[11px]">
                                {t('settlement.sovereign')}: <span className="font-mono">{fmtUsd(r.sovereign_usd)}</span>
                            </span>
                            {(unattr > 0 || mismatch > 0) && (
                                <span className="text-[10px] text-[var(--os-text-muted)] opacity-70">
                                    {unattr > 0 && t('settlement.unattributed', { count: unattr })}
                                    {unattr > 0 && mismatch > 0 && ' · '}
                                    {mismatch > 0 && t('settlement.mismatched', { count: mismatch })}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Cumulative row */}
            {jurRows.length > 1 && (
                <div className="flex flex-wrap items-center gap-3 text-xs mt-1 pt-1 border-t border-[var(--os-border)]">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
                        {t('settlement.cumulative')}
                    </span>
                    <span className="text-[var(--os-text-secondary)]">
                        {t('settlement.total')}: <span className="font-mono text-[var(--os-text-primary)]">{fmtUsd(cumulative.total)}</span>
                    </span>
                    <span className="text-[var(--os-text-muted)] text-[11px]">
                        {t('settlement.concessionaire')}: <span className="font-mono">{fmtUsd(cumulative.concessionaire)}</span>
                    </span>
                    <span className="text-[var(--os-text-muted)] text-[11px]">
                        {t('settlement.sovereign')}: <span className="font-mono">{fmtUsd(cumulative.sovereign)}</span>
                    </span>
                    {(cumulative.unattributed_count > 0 || cumulative.mismatched_count > 0) && (
                        <span className="text-[10px] text-[var(--os-text-muted)] opacity-70">
                            {cumulative.unattributed_count > 0 && t('settlement.unattributed', { count: cumulative.unattributed_count })}
                            {cumulative.unattributed_count > 0 && cumulative.mismatched_count > 0 && ' · '}
                            {cumulative.mismatched_count > 0 && t('settlement.mismatched', { count: cumulative.mismatched_count })}
                        </span>
                    )}
                </div>
            )}

            {/* Footnote */}
            <p className="text-[10px] text-[var(--os-text-muted)] opacity-60 mt-1.5">
                {t('settlement.gross')}
            </p>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Jurisdiction card
// ─────────────────────────────────────────────────────────────────────────────

interface JurisdictionCardProps {
    jur: JurisdictionRow;
    modeConfigs: JurisdictionModeConfigRow[];
    tariffs: TariffRow[];
    splitRule: SplitRuleRow | undefined;
    settlement: SettlementRow[];
    ccInitial: { cc_emails: string[]; bailiff_cc_emails: string[] };
    canToggleModes: boolean;
    canCreateTariff: boolean;
    canEditCc: boolean;
    onRefresh: () => void;
}

function JurisdictionCard({
    jur, modeConfigs, tariffs, splitRule, settlement, ccInitial, canToggleModes, canCreateTariff, canEditCc, onRefresh,
}: JurisdictionCardProps) {
    const t = useTranslations('AdminJurisdictions');
    const modes = TRANSPORT_MODES;

    return (
        <div className="os-card p-5">
            {/* Header row */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-sm font-bold text-[var(--os-text-primary)]">
                        {jur.code}
                    </span>
                    <span className="text-sm text-[var(--os-text-secondary)]">{jur.name}</span>
                    <OsBadge
                        variant={jurisdictionStatusVariant(jur.status)}
                        label={jur.status}
                        size="sm"
                    />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">
                        {jur.default_currency}
                    </span>
                    {jur.locales.length > 0 && (
                        <span className="text-[10px] text-[var(--os-text-muted)]">
                            {jur.locales.join(' · ')}
                        </span>
                    )}
                </div>
            </div>

            {/* Mode pills */}
            <div className="flex items-center gap-2 mt-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">
                    {t('mode.sectionTitle')}
                </span>
                {modes.map((mode) => {
                    const config = modeConfigs.find(
                        (m) => m.jurisdiction_id === jur.id && m.mode === mode,
                    );
                    return (
                        <ModePill
                            key={mode}
                            jid={jur.id}
                            mode={mode}
                            config={config}
                            canToggle={canToggleModes}
                            onRefresh={onRefresh}
                        />
                    );
                })}
            </div>
            {/* I1: modes disclosure */}
            <p className="text-[10px] text-[var(--os-text-muted)] mt-1 opacity-70">
                {t('modesDisclosure')}
            </p>

            {/* Tariffs */}
            <TariffSection
                jid={jur.id}
                tariffs={tariffs}
                canEdit={canCreateTariff}
                onRefresh={onRefresh}
            />

            {/* Split */}
            <SplitSection split={splitRule} />

            {/* Settlement */}
            <SettlementSection jid={jur.id} rows={settlement} />

            {/* Recovery CC (billing + bailiff) */}
            <RecoveryCcSection jid={jur.id} initial={ccInitial} canEdit={canEditCc} />
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────────────────────────────────────

export function AdminJurisdictions({ jurisdictions, modeConfigs, tariffs, splitRules, settlement, viewerRole, ccByJurisdiction }: Props) {
    const t = useTranslations('AdminJurisdictions');
    const router = useRouter();

    const isSuperAdmin = viewerRole === 'SUPERADMIN';
    const canCreateTariff = viewerRole === 'SUPERADMIN' || viewerRole === 'FINANCE_ADMIN';
    const canToggleModes = isSuperAdmin;
    // Matches updateJurisdictionCcEmails' STAFF_ROLES gate (SUPERADMIN, FINANCE_ADMIN, PORT_OFFICER),
    // i.e. the same set already required to reach this page (ALLOWED_ROLES in page.tsx).
    const canEditCc = viewerRole === 'SUPERADMIN' || viewerRole === 'FINANCE_ADMIN' || viewerRole === 'PORT_OFFICER';

    const onRefresh = () => router.refresh();

    return (
        <div className="flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <Globe2 className="w-5 h-5" style={{ color: 'var(--os-brand-green)' }} />
                    <div>
                        <h1 className="text-xl font-bold text-[var(--os-text-primary)]">{t('title')}</h1>
                        <p className="text-xs text-[var(--os-text-muted)] mt-0.5">{t('subtitle')}</p>
                    </div>
                </div>
                <OsBadge variant="active" label={`${jurisdictions.length} ${t('jurisdictionCount')}`} size="sm" />
            </div>

            {/* Cards */}
            {jurisdictions.length === 0 ? (
                <div className="os-card p-10 text-center text-[var(--os-text-muted)] text-sm">
                    {t('empty')}
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    {jurisdictions.map((jur) => {
                        const jurModeConfigs = modeConfigs.filter((m) => m.jurisdiction_id === jur.id);
                        const jurTariffs = tariffs.filter((r) => r.jurisdiction_id === jur.id);
                        const splitRule = splitRules.find((s) => s.jurisdiction_id === jur.id);
                        const ccInitial = ccByJurisdiction?.[jur.id] ?? { cc_emails: [], bailiff_cc_emails: [] };
                        return (
                            <JurisdictionCard
                                key={jur.id}
                                jur={jur}
                                modeConfigs={jurModeConfigs}
                                tariffs={jurTariffs}
                                splitRule={splitRule}
                                settlement={settlement}
                                ccInitial={ccInitial}
                                canToggleModes={canToggleModes}
                                canCreateTariff={canCreateTariff}
                                canEditCc={canEditCc}
                                onRefresh={onRefresh}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
}
