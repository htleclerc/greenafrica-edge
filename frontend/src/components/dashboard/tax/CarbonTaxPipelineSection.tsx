'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Save, CheckCircle, AlertTriangle, Eye, EyeOff, Lock } from 'lucide-react';
import { OsButton } from '@/components/ui/OsButton';
import { updateAppConfig } from '@/actions/updateAppConfig';
import type { AppConfigEntry } from '@/services/appConfigService';

const NUMBER_KEYS = new Set([
    // carbon_tax.rate_usd_per_tco2 retired: billing reads versioned tariffs table
    // (mig 080). The key is preserved in DB for rollback but removed from the UI.
    'arrival.corridor_radius_nm',
    'arrival.claim_sla_hours',
    'arrival.escalation_eta_buffer_h',
    'reconciliation.tolerance_pct',
    'reconciliation.check_interval_min',
    'owner_escalation.delay_days',
    'owner_escalation.reminder_count',
]);

const BOOLEAN_KEYS = new Set([
    'feature.ais_global_enabled',
    'feature.equasis_scraper_enabled',
    'feature.vessel_detention_enabled',
    'feature.shipowner_portal_enabled',
    // Plan 7H-1: shipowner portal v1 feature flags (master spec §12.2).
    'feature.shipowner_portal_v1_enabled',
    'feature.shipowner_self_service_enabled',
    'feature.online_payment_stripe_enabled',
    'feature.wallet_topup_enabled',
    'feature.notification_sms_enabled',
    // Montre les rails sans prestataire actif, marques « bientot disponible ».
    'feature.show_unavailable_rails',
]);

const STRING_KEYS = new Set([
    'queue.worker_url',
    'queue.worker_secret',
]);

const ARRAY_KEYS = new Set([
    'proforma.languages_default',
]);

const SECRET_KEYS = new Set([
    'queue.worker_secret',
]);

/** Ordered list of keys rendered in the section. */
const KEY_ORDER: string[] = [
    // carbon_tax.rate_usd_per_tco2 removed — billing now reads tariffs table (mig 080)
    'arrival.corridor_radius_nm',
    'arrival.claim_sla_hours',
    'arrival.escalation_eta_buffer_h',
    'reconciliation.tolerance_pct',
    'reconciliation.check_interval_min',
    'owner_escalation.delay_days',
    'owner_escalation.reminder_count',
    'proforma.languages_default',
    'feature.ais_global_enabled',
    'feature.equasis_scraper_enabled',
    'feature.vessel_detention_enabled',
    'feature.shipowner_portal_enabled',
    // Plan 7H-1: grouped with the other feature.* toggles.
    'feature.shipowner_portal_v1_enabled',
    'feature.shipowner_self_service_enabled',
    'feature.online_payment_stripe_enabled',
    'feature.wallet_topup_enabled',
    'feature.notification_sms_enabled',
    'feature.show_unavailable_rails',
    'queue.worker_url',
    'queue.worker_secret',
];

type SaveStatus =
    | { state: 'idle' }
    | { state: 'saving' }
    | { state: 'success' }
    | { state: 'error'; reason: string };

type PipelineValue = number | boolean | string | string[];

interface Props {
    entries: AppConfigEntry[];
    canEdit: boolean;
}

function detectType(
    key: string,
): 'number' | 'boolean' | 'string' | 'array' {
    if (NUMBER_KEYS.has(key)) return 'number';
    if (BOOLEAN_KEYS.has(key)) return 'boolean';
    if (ARRAY_KEYS.has(key)) return 'array';
    if (STRING_KEYS.has(key)) return 'string';
    return 'string';
}

function readAsString(value: unknown, key: string): string {
    const type = detectType(key);
    if (value === null || value === undefined) return '';
    if (type === 'array') {
        return Array.isArray(value) ? value.join(', ') : String(value);
    }
    if (type === 'boolean') {
        return value === true ? 'true' : 'false';
    }
    return String(value);
}

function parseInput(raw: string, key: string): PipelineValue | null {
    const type = detectType(key);
    if (type === 'number') {
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    }
    if (type === 'boolean') {
        return raw === 'true' || raw === 'on';
    }
    if (type === 'array') {
        return raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
    }
    return raw;
}

export function CarbonTaxPipelineSection({ entries, canEdit }: Props) {
    const t = useTranslations('AdminTaxPipeline');
    const router = useRouter();

    // Build a keyed map for lookup; render in the fixed KEY_ORDER so even
    // freshly seeded keys missing from the DB still render a row with empty
    // value (rather than silently disappearing).
    const byKey = React.useMemo(() => {
        const m = new Map<string, AppConfigEntry>();
        for (const e of entries) m.set(e.key, e);
        return m;
    }, [entries]);

    return (
        <div className="os-card overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--os-border)] flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-sm font-semibold text-[var(--os-text-primary)]">
                        {t('sectionTitle')}
                    </h3>
                    <p className="text-[10px] text-[var(--os-text-muted)] mt-0.5 max-w-[60ch]">
                        {t('sectionSubtitle')}
                    </p>
                </div>
                {!canEdit && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-[rgba(56,189,248,0.1)] text-[#38BDF8] border border-[#38BDF8]/20 whitespace-nowrap">
                        <Lock className="w-3 h-3" />
                        {t('readOnly')}
                    </span>
                )}
            </div>

            <div className="divide-y divide-[var(--os-border)]">
                {KEY_ORDER.map((key) => {
                    const entry = byKey.get(key);
                    return (
                        <PipelineRow
                            key={key}
                            configKey={key}
                            entry={entry}
                            canEdit={canEdit}
                            onSaved={() => router.refresh()}
                        />
                    );
                })}
            </div>
        </div>
    );
}

interface RowProps {
    configKey: string;
    entry: AppConfigEntry | undefined;
    canEdit: boolean;
    onSaved: () => void;
}

function PipelineRow({ configKey, entry, canEdit, onSaved }: RowProps) {
    const t = useTranslations('AdminTaxPipeline');
    const type = detectType(configKey);
    const isSecret = SECRET_KEYS.has(configKey);

    const currentValue = entry?.value ?? null;
    const [draft, setDraft] = React.useState<string>(readAsString(currentValue, configKey));
    const [draftBool, setDraftBool] = React.useState<boolean>(currentValue === true);
    const [showSecret, setShowSecret] = React.useState(false);
    const [status, setStatus] = React.useState<SaveStatus>({ state: 'idle' });
    const [isPending, startTransition] = React.useTransition();

    // Resync draft whenever the parent re-fetches a new entry.
    React.useEffect(() => {
        setDraft(readAsString(currentValue, configKey));
        setDraftBool(currentValue === true);
    }, [configKey, currentValue]);

    const isSaving = isPending || status.state === 'saving';

    function handleSave() {
        if (!canEdit || isSaving) return;
        let parsedValue: PipelineValue | null;
        if (type === 'boolean') {
            parsedValue = draftBool === true;
        } else {
            parsedValue = parseInput(draft, configKey);
        }
        if (parsedValue === null) {
            setStatus({ state: 'error', reason: 'invalid value' });
            return;
        }

        setStatus({ state: 'saving' });
        startTransition(async () => {
            const res = await updateAppConfig({ key: configKey, value: parsedValue });
            if (res.ok) {
                setStatus({ state: 'success' });
                onSaved();
                setTimeout(() => setStatus({ state: 'idle' }), 2500);
            } else {
                setStatus({ state: 'error', reason: res.reason });
            }
        });
    }

    return (
        <div className="px-5 py-3 grid grid-cols-1 md:grid-cols-[minmax(220px,1fr)_minmax(180px,1.2fr)_auto] gap-3 items-center">
            <div>
                <p className="text-xs font-semibold text-[var(--os-text-primary)]">
                    {t(`labels.${configKey.replace(/\./g, '_')}`)}
                </p>
                <p className="text-[10px] font-mono text-[var(--os-text-muted)] mt-0.5">
                    {configKey}
                </p>
            </div>

            <div>
                {renderInput({
                    configKey,
                    type,
                    isSecret,
                    showSecret,
                    setShowSecret,
                    draft,
                    setDraft,
                    draftBool,
                    setDraftBool,
                    disabled: !canEdit || isSaving,
                    maskLabel: t('secretMask'),
                    showLabel: t('showSecret'),
                    hideLabel: t('hideSecret'),
                })}
            </div>

            <div className="flex items-center gap-2 justify-end">
                {status.state === 'success' && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#00D97E]">
                        <CheckCircle className="w-3.5 h-3.5" /> {t('successToast')}
                    </span>
                )}
                {status.state === 'error' && (
                    <span
                        className="inline-flex items-center gap-1 text-[11px] text-[#EF4444]"
                        title={status.reason}
                    >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {status.reason.length > 32 ? `${status.reason.slice(0, 32)}…` : status.reason}
                    </span>
                )}
                {canEdit && (
                    <OsButton
                        variant="primary"
                        size="sm"
                        icon={<Save className="w-3.5 h-3.5" />}
                        onClick={handleSave}
                        disabled={isSaving}
                    >
                        {isSaving ? t('saving') : t('save')}
                    </OsButton>
                )}
            </div>
        </div>
    );
}

interface InputProps {
    configKey: string;
    type: 'number' | 'boolean' | 'string' | 'array';
    isSecret: boolean;
    showSecret: boolean;
    setShowSecret: (v: boolean) => void;
    draft: string;
    setDraft: (v: string) => void;
    draftBool: boolean;
    setDraftBool: (v: boolean) => void;
    disabled: boolean;
    maskLabel: string;
    showLabel: string;
    hideLabel: string;
}

function renderInput(p: InputProps) {
    const baseInput =
        'w-full h-8 px-2 rounded-lg bg-[var(--os-surface-3)] border border-[var(--os-border-strong)] text-xs text-[var(--os-text-primary)] focus:outline-none focus:border-[#00D97E] disabled:opacity-60 disabled:cursor-not-allowed';

    if (p.type === 'boolean') {
        return (
            <label className="inline-flex items-center gap-2 text-xs text-[var(--os-text-primary)] cursor-pointer">
                <input
                    type="checkbox"
                    checked={p.draftBool}
                    onChange={(e) => p.setDraftBool(e.target.checked)}
                    disabled={p.disabled}
                    className="w-4 h-4 accent-[#00D97E]"
                />
                <span className="font-mono text-[11px] text-[var(--os-text-muted)]">
                    {p.draftBool ? 'true' : 'false'}
                </span>
            </label>
        );
    }

    if (p.type === 'number') {
        return (
            <input
                type="number"
                step="any"
                value={p.draft}
                onChange={(e) => p.setDraft(e.target.value)}
                disabled={p.disabled}
                className={baseInput}
            />
        );
    }

    if (p.isSecret) {
        // Secret: when not editing, display a mask. Show the real value only
        // when user explicitly toggles "Show". When editing (user typing), we
        // always show plain text — the mask is not a form control.
        return (
            <div className="flex items-center gap-2">
                <input
                    type={p.showSecret ? 'text' : 'password'}
                    value={p.draft}
                    onChange={(e) => p.setDraft(e.target.value)}
                    disabled={p.disabled}
                    placeholder={p.maskLabel}
                    className={`${baseInput} font-mono`}
                />
                <button
                    type="button"
                    onClick={() => p.setShowSecret(!p.showSecret)}
                    className="text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)]"
                    title={p.showSecret ? p.hideLabel : p.showLabel}
                >
                    {p.showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
            </div>
        );
    }

    return (
        <input
            type="text"
            value={p.draft}
            onChange={(e) => p.setDraft(e.target.value)}
            disabled={p.disabled}
            className={baseInput}
        />
    );
}
