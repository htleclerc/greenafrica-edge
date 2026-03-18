'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
    Anchor, Shield, ArrowRight, ArrowLeft, CheckCircle,
    Building2, Ship, Eye, EyeOff, AlertCircle,
    Globe, Bell, LayoutDashboard, UserCheck,
} from 'lucide-react';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
// Registration is handled server-side via /api/auth/register

// ── Types ─────────────────────────────────────────────────────────────────────

type EntityType = 'port_authority' | 'shipping_agent';

interface FormData {
    entityType: EntityType | null;
    jurisdiction: string;
    organizationName: string;
    registryId: string;
    role: string;
    fullName: string;
    email: string;
    password: string;
    confirmPassword: string;
    defaultRegion: string;
    accessScope: 'national' | 'regional';
    notifyProForma: boolean;
    notifyCo2: boolean;
    notifyRevenue: boolean;
    notifyWeekly: boolean;
    acceptTerms: boolean;
}

// ── Static data ───────────────────────────────────────────────────────────────

const JURISDICTIONS = [
    'Somaliland — Gulf of Aden EEZ',
    'Djibouti — Red Sea Corridor',
    'Eritrea — Southern Red Sea',
    'Ethiopia — Landlocked (Port Agent)',
    'Kenya — East African Coast',
    'Somalia — Federal Maritime',
];

const REGIONS = [
    'Full EEZ Overview',
    'Berbera Port Vicinity',
    'Zeila Port Vicinity',
    'Gulf of Aden Shipping Lane',
    'Horn of Africa Regional',
];

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
    return (
        <div className="flex items-center gap-2 mb-6">
            {Array.from({ length: total }, (_, i) => {
                const step = i + 1;
                const done = step < current;
                const active = step === current;
                return (
                    <React.Fragment key={step}>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                            done   ? 'bg-[#00D97E] text-[#060D1A]' :
                            active ? 'bg-[rgba(0,217,126,0.15)] text-[#00D97E] border border-[#00D97E]/40' :
                                     'bg-[var(--os-surface-2)] text-[var(--os-text-muted)] border border-[var(--os-border)]'
                        }`}>
                            {done ? <CheckCircle className="w-3.5 h-3.5" /> : step}
                        </div>
                        {step < total && (
                            <div className={`flex-1 h-px ${done ? 'bg-[#00D97E]' : 'bg-[var(--os-border)]'}`} />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
}

// ── Field helpers ─────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
    return <label className="text-[11px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{children}</label>;
}

function FieldInput({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            {...props}
            className={`w-full h-11 px-4 rounded-xl text-sm bg-[var(--os-surface-2)] border border-[var(--os-border)] text-[var(--os-text-primary)] placeholder:text-[var(--os-text-muted)] focus:outline-none focus:border-[#00D97E]/60 focus:ring-1 focus:ring-[#00D97E]/20 transition-colors ${props.className ?? ''}`}
        />
    );
}

function FieldSelect({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
    return (
        <select
            {...props}
            className="w-full h-11 px-4 rounded-xl text-sm bg-[var(--os-surface-2)] border border-[var(--os-border)] text-[var(--os-text-primary)] focus:outline-none focus:border-[#00D97E]/60 focus:ring-1 focus:ring-[#00D97E]/20 transition-colors appearance-none"
        >
            {children}
        </select>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

const INITIAL: FormData = {
    entityType: null,
    jurisdiction: '', organizationName: '', registryId: '', role: '',
    fullName: '', email: '', password: '', confirmPassword: '',
    defaultRegion: REGIONS[0], accessScope: 'national',
    notifyProForma: true, notifyCo2: false, notifyRevenue: true, notifyWeekly: true,
    acceptTerms: false,
};

export function SignupPage() {
    const t = useTranslations('Signup');
    const [step, setStep] = React.useState(0);
    const [form, setForm] = React.useState<FormData>(INITIAL);
    const [showPwd, setShowPwd]       = React.useState(false);
    const [showConfirm, setShowConfirm] = React.useState(false);
    const [loading, setLoading]       = React.useState(false);
    const [error, setError]           = React.useState('');
    const [submitted, setSubmitted]   = React.useState(false);
    const [legalModal, setLegalModal] = React.useState<'terms' | 'privacy' | 'security' | null>(null);

    const set = (key: keyof FormData, value: FormData[keyof FormData]) =>
        setForm((f) => ({ ...f, [key]: value }));

    const isPortAuth = form.entityType === 'port_authority';

    const PORT_AUTHORITY_ROLES = [
        { key: 'PORT_OFFICER',       label: t('role_port_officer'),       description: t('role_port_officer_desc') },
        { key: 'FINANCE_ADMIN',      label: t('role_finance_admin'),      description: t('role_finance_admin_desc') },
        { key: 'COMPLIANCE_AUDITOR', label: t('role_compliance_auditor'), description: t('role_compliance_auditor_desc') },
        { key: 'SUPERADMIN',         label: t('role_superadmin'),         description: t('role_superadmin_desc') },
    ];

    const SHIPPING_AGENT_ROLES = [
        { key: 'FLEET_MANAGER',   label: t('role_fleet_manager'),   description: t('role_fleet_manager_desc') },
        { key: 'FINANCE_CONTACT', label: t('role_finance_contact'), description: t('role_finance_contact_desc') },
        { key: 'LEGAL_REP',       label: t('role_legal_rep'),       description: t('role_legal_rep_desc') },
    ];

    const roles = isPortAuth ? PORT_AUTHORITY_ROLES : SHIPPING_AGENT_ROLES;

    // ── Validation per step ──────────────────────────────────────────────────

    function validate(): string {
        if (step === 1) {
            if (!form.jurisdiction) return t('error_jurisdiction');
            if (!form.organizationName.trim()) return t('error_org_name');
            if (!form.registryId.trim()) return t('error_registry');
            if (!form.role) return t('error_role');
        }
        if (step === 2) {
            if (!form.fullName.trim()) return t('error_fullname');
            if (!form.email.trim() || !form.email.includes('@')) return t('error_email');
            if (form.password.length < 8) return t('error_password_length');
            if (form.password !== form.confirmPassword) return t('error_password_match');
        }
        if (step === 3) {
            if (!form.acceptTerms) return t('error_terms');
        }
        return '';
    }

    async function handleNext() {
        setError('');
        const err = validate();
        if (err) { setError(err); return; }
        if (step < 3) { setStep(step + 1); return; }

        setLoading(true);
        try {
            const entityType = form.entityType === 'port_authority' ? 'PORT_AUTHORITY' : 'SHIPPING_AGENT';

            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: form.email.trim().toLowerCase(),
                    password: form.password,
                    fullName: form.fullName.trim(),
                    role: form.role,
                    entityType,
                    orgName: form.organizationName.trim(),
                    registryId: form.registryId.trim(),
                    jurisdiction: form.jurisdiction,
                    defaultRegion: form.defaultRegion,
                    accessScope: form.accessScope,
                    notifyProForma: form.notifyProForma,
                    notifyCo2: form.notifyCo2,
                    notifyRevenue: form.notifyRevenue,
                    notifyWeekly: form.notifyWeekly,
                }),
            });

            const result = await res.json();

            if (!res.ok) {
                setError(result.error || t('error_registration_failed'));
                setLoading(false);
                return;
            }

            setLoading(false);
            window.location.href = '/pending-approval';
        } catch {
            setError(t('error_server'));
            setLoading(false);
        }
    }

    // ── Success screen ───────────────────────────────────────────────────────

    if (submitted) {
        return (
            <AuthShell t={t}>
                <div className="w-full max-w-md flex flex-col items-center text-center">
                    <div className="w-16 h-16 rounded-2xl border border-[#00D97E]/30 flex items-center justify-center mb-5 shadow-[0_0_24px_rgba(0,217,126,0.15)]" style={{ backgroundColor: 'var(--ais-page-card)' }}>
                        <CheckCircle className="w-8 h-8 text-[#00D97E]" />
                    </div>
                    <h2 className="text-2xl font-bold text-[var(--os-text-primary)] mb-2">{t('success_title')}</h2>
                    <p className="text-xs text-[var(--os-text-muted)] mb-6 leading-relaxed max-w-xs">
                        {t('success_message', { org: form.organizationName })}
                    </p>
                    <div className="w-full rounded-2xl p-5 border mb-5" style={{ backgroundColor: 'var(--os-surface)', borderColor: 'var(--os-border-strong)' }}>
                        <div className="flex flex-col gap-3 text-left">
                            {[
                                { label: t('success_org'),      value: form.organizationName },
                                { label: t('success_registry'), value: form.registryId },
                                { label: t('success_account'),  value: form.email },
                                { label: t('success_role'),     value: form.role.replace('_', ' ') },
                            ].map(({ label, value }) => (
                                <div key={label} className="flex justify-between text-xs">
                                    <span className="text-[var(--os-text-muted)]">{label}</span>
                                    <span className="font-semibold text-[var(--os-text-primary)]">{value}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <a href="/login" className="text-xs text-[#38BDF8] hover:underline">
                        {t('success_back_login')}
                    </a>
                </div>
            </AuthShell>
        );
    }

    // ── Step 0: Entity type selection ─────────────────────────────────────────

    if (step === 0) {
        return (
            <AuthShell t={t}>
                <div className="w-full max-w-sm sm:max-w-lg flex flex-col items-center">
                    <LogoBlock />
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#00D97E]/60 mb-8">
                        {t('new_account_registration')}
                    </p>

                    <div className="w-full rounded-2xl p-4 sm:p-6 border" style={{ backgroundColor: 'var(--os-surface)', borderColor: 'var(--os-border-strong)' }}>
                        <h2 className="text-base font-bold text-[var(--os-text-primary)] mb-1">{t('entity_title')}</h2>
                        <p className="text-xs text-[var(--os-text-muted)] mb-5">
                            {t('entity_subtitle')}
                        </p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                            <button
                                onClick={() => { set('entityType', 'port_authority'); setStep(1); }}
                                className={`flex flex-col items-start gap-3 p-5 rounded-xl border text-left transition-all hover:border-[#00D97E]/50 hover:bg-[rgba(0,217,126,0.04)] group ${
                                    form.entityType === 'port_authority'
                                        ? 'border-[#00D97E]/50 bg-[rgba(0,217,126,0.06)]'
                                        : 'border-[var(--os-border)]'
                                }`}
                            >
                                <div className="w-10 h-10 rounded-xl bg-[rgba(0,217,126,0.1)] flex items-center justify-center">
                                    <Building2 className="w-5 h-5 text-[#00D97E]" />
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-[var(--os-text-primary)] mb-1">{t('port_authority')}</p>
                                    <p className="text-[10px] text-[var(--os-text-muted)] leading-relaxed">
                                        {t('port_authority_desc')}
                                    </p>
                                </div>
                                <div className="mt-auto flex flex-wrap gap-1">
                                    {[t('tag_compliance'), t('tag_revenue'), t('tag_audit')].map((tag) => (
                                        <span key={tag} className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[rgba(0,217,126,0.08)] text-[#00D97E]">{tag}</span>
                                    ))}
                                </div>
                            </button>

                            <button
                                onClick={() => { set('entityType', 'shipping_agent'); setStep(1); }}
                                className={`flex flex-col items-start gap-3 p-5 rounded-xl border text-left transition-all hover:border-[#38BDF8]/50 hover:bg-[rgba(56,189,248,0.04)] group ${
                                    form.entityType === 'shipping_agent'
                                        ? 'border-[#38BDF8]/50 bg-[rgba(56,189,248,0.06)]'
                                        : 'border-[var(--os-border)]'
                                }`}
                            >
                                <div className="w-10 h-10 rounded-xl bg-[rgba(56,189,248,0.1)] flex items-center justify-center">
                                    <Ship className="w-5 h-5 text-[#38BDF8]" />
                                </div>
                                <div>
                                    <p className="text-sm font-bold text-[var(--os-text-primary)] mb-1">{t('shipping_agent')}</p>
                                    <p className="text-[10px] text-[var(--os-text-muted)] leading-relaxed">
                                        {t('shipping_agent_desc')}
                                    </p>
                                </div>
                                <div className="mt-auto flex flex-wrap gap-1">
                                    {[t('tag_vessels'), t('tag_invoices'), t('tag_proforma')].map((tag) => (
                                        <span key={tag} className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[rgba(56,189,248,0.08)] text-[#38BDF8]">{tag}</span>
                                    ))}
                                </div>
                            </button>
                        </div>

                        <p className="text-center text-xs text-[var(--os-text-muted)]">
                            {t('already_have_account')}{' '}
                            <a href="/login" className="text-[#38BDF8] hover:underline">{t('sign_in')}</a>
                        </p>
                    </div>
                </div>
            </AuthShell>
        );
    }

    // ── Steps 1–3 ───────────────────────────────────────────────────────────

    const STEP_TITLES = ['', t('step_org_title'), t('step_account_title'), t('step_prefs_title')];
    const STEP_SUBS   = ['', t('step_org_sub'), t('step_account_sub'), t('step_prefs_sub')];

    return (
        <AuthShell t={t}>
            <div className="w-full max-w-sm sm:max-w-lg flex flex-col items-center">
                <LogoBlock />
                <div className="flex items-center gap-2 mb-6">
                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                        isPortAuth
                            ? 'bg-[rgba(0,217,126,0.08)] border-[#00D97E]/30 text-[#00D97E]'
                            : 'bg-[rgba(56,189,248,0.08)] border-[#38BDF8]/30 text-[#38BDF8]'
                    }`}>
                        {isPortAuth ? <Building2 className="w-3 h-3" /> : <Ship className="w-3 h-3" />}
                        {isPortAuth ? t('port_authority') : t('shipping_agent')}
                    </div>
                    <button
                        onClick={() => { setStep(0); setError(''); }}
                        className="text-[10px] text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] transition-colors"
                    >
                        {t('change_type')}
                    </button>
                </div>

                <div className="w-full rounded-2xl p-4 sm:p-6 border" style={{ backgroundColor: 'var(--os-surface)', borderColor: 'var(--os-border-strong)' }}>
                    <StepIndicator current={step} total={3} />

                    <h2 className="text-base font-bold text-[var(--os-text-primary)] mb-0.5">{STEP_TITLES[step]}</h2>
                    <p className="text-xs text-[var(--os-text-muted)] mb-5 leading-relaxed">{STEP_SUBS[step]}</p>

                    {/* ── Step 1: Organization ── */}
                    {step === 1 && (
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-col gap-1.5">
                                <FieldLabel>{t('label_jurisdiction')}</FieldLabel>
                                <FieldSelect value={form.jurisdiction} onChange={(e) => set('jurisdiction', e.target.value)}>
                                    <option value="">{t('placeholder_jurisdiction')}</option>
                                    {JURISDICTIONS.map((j) => <option key={j} value={j}>{j}</option>)}
                                </FieldSelect>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <FieldLabel>{isPortAuth ? t('label_org_name_port') : t('label_org_name_ship')}</FieldLabel>
                                <FieldInput
                                    type="text"
                                    placeholder={isPortAuth ? t('placeholder_org_port') : t('placeholder_org_ship')}
                                    value={form.organizationName}
                                    onChange={(e) => set('organizationName', e.target.value)}
                                />
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <FieldLabel>{isPortAuth ? t('label_registry_port') : t('label_registry_ship')}</FieldLabel>
                                <FieldInput
                                    type="text"
                                    placeholder={isPortAuth ? t('placeholder_registry_port') : t('placeholder_registry_ship')}
                                    value={form.registryId}
                                    onChange={(e) => set('registryId', e.target.value)}
                                />
                                <p className="text-[10px] text-[var(--os-text-muted)]">
                                    {isPortAuth ? t('hint_registry_port') : t('hint_registry_ship')}
                                </p>
                            </div>

                            <div className="flex flex-col gap-2">
                                <FieldLabel>{t('label_role')}</FieldLabel>
                                <div className="flex flex-col gap-2">
                                    {roles.map((r) => {
                                        const isSelected = form.role === r.key;
                                        const isRestricted = r.key === 'SUPERADMIN';
                                        return (
                                            <button
                                                key={r.key}
                                                onClick={() => !isRestricted && set('role', r.key)}
                                                disabled={isRestricted}
                                                className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all ${
                                                    isRestricted
                                                        ? 'opacity-50 cursor-not-allowed border-[var(--os-border)]'
                                                        : isSelected
                                                            ? 'border-[#00D97E]/50 bg-[rgba(0,217,126,0.06)]'
                                                            : 'border-[var(--os-border)] hover:border-[var(--os-border-strong)] hover:bg-[var(--os-surface-2)]'
                                                }`}
                                            >
                                                <div className={`w-4 h-4 rounded-full border flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                                                    isSelected ? 'border-[#00D97E] bg-[#00D97E]' : 'border-[var(--os-border)]'
                                                }`}>
                                                    {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-[#060D1A]" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <p className="text-xs font-semibold text-[var(--os-text-primary)]">{r.label}</p>
                                                        {isRestricted && (
                                                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[rgba(245,158,11,0.1)] text-[#F59E0B] font-bold">{t('ministry_only')}</span>
                                                        )}
                                                    </div>
                                                    <p className="text-[10px] text-[var(--os-text-muted)] mt-0.5">{r.description}</p>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── Step 2: Account Credentials ── */}
                    {step === 2 && (
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-col gap-1.5">
                                <FieldLabel>{t('label_fullname')}</FieldLabel>
                                <FieldInput
                                    type="text"
                                    placeholder={t('placeholder_fullname')}
                                    value={form.fullName}
                                    onChange={(e) => set('fullName', e.target.value)}
                                />
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <FieldLabel>{isPortAuth ? t('label_email_port') : t('label_email_ship')}</FieldLabel>
                                <FieldInput
                                    type="email"
                                    placeholder={isPortAuth ? t('placeholder_email_port') : t('placeholder_email_ship')}
                                    value={form.email}
                                    onChange={(e) => set('email', e.target.value)}
                                />
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <FieldLabel>{t('label_password')}</FieldLabel>
                                <div className="relative">
                                    <FieldInput
                                        type={showPwd ? 'text' : 'password'}
                                        placeholder={t('placeholder_password')}
                                        value={form.password}
                                        onChange={(e) => set('password', e.target.value)}
                                        className="pr-10"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPwd((v) => !v)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] transition-colors"
                                    >
                                        {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                                {form.password && <PasswordStrength password={form.password} t={t} />}
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <FieldLabel>{t('label_confirm_password')}</FieldLabel>
                                <div className="relative">
                                    <FieldInput
                                        type={showConfirm ? 'text' : 'password'}
                                        placeholder={t('placeholder_confirm_password')}
                                        value={form.confirmPassword}
                                        onChange={(e) => set('confirmPassword', e.target.value)}
                                        className="pr-10"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowConfirm((v) => !v)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] transition-colors"
                                    >
                                        {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                                {form.confirmPassword && form.password !== form.confirmPassword && (
                                    <p className="text-[10px] text-[#EF4444]">{t('passwords_no_match')}</p>
                                )}
                            </div>

                            <div className="flex gap-2.5 p-3 rounded-xl bg-[rgba(245,158,11,0.06)] border border-[#F59E0B]/20">
                                <Shield className="w-3.5 h-3.5 text-[#F59E0B] flex-shrink-0 mt-0.5" />
                                <p className="text-[10px] text-[var(--os-text-muted)] leading-relaxed">
                                    {t('security_notice')}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ── Step 3: Preferences ── */}
                    {step === 3 && (
                        <div className="flex flex-col gap-5">
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center gap-2 text-[var(--os-text-secondary)]">
                                    <LayoutDashboard className="w-3.5 h-3.5" />
                                    <span className="text-[11px] font-bold uppercase tracking-widest">{t('section_default_views')}</span>
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <FieldLabel>{t('label_default_region')}</FieldLabel>
                                    <FieldSelect value={form.defaultRegion} onChange={(e) => set('defaultRegion', e.target.value)}>
                                        {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                                    </FieldSelect>
                                </div>
                            </div>

                            <div className="flex flex-col gap-3">
                                <div className="flex items-center gap-2 text-[var(--os-text-secondary)]">
                                    <Globe className="w-3.5 h-3.5" />
                                    <span className="text-[11px] font-bold uppercase tracking-widest">{t('section_data_access')}</span>
                                </div>
                                <div className="flex flex-col gap-2">
                                    {[
                                        { key: 'national' as const, label: t('scope_national'), desc: t('scope_national_desc'), available: isPortAuth },
                                        { key: 'regional' as const, label: t('scope_regional'), desc: t('scope_regional_desc'), available: true },
                                    ].map((opt) => {
                                        const isSelected = form.accessScope === opt.key;
                                        return (
                                            <button
                                                key={opt.key}
                                                onClick={() => opt.available && set('accessScope', opt.key)}
                                                disabled={!opt.available}
                                                className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-all ${
                                                    !opt.available
                                                        ? 'opacity-40 cursor-not-allowed border-[var(--os-border)]'
                                                        : isSelected
                                                            ? 'border-[#00D97E]/50 bg-[rgba(0,217,126,0.06)]'
                                                            : 'border-[var(--os-border)] hover:border-[var(--os-border-strong)]'
                                                }`}
                                            >
                                                <div className={`w-4 h-4 rounded-full border flex-shrink-0 mt-0.5 flex items-center justify-center ${
                                                    isSelected ? 'border-[#00D97E] bg-[#00D97E]' : 'border-[var(--os-border)]'
                                                }`}>
                                                    {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-[#060D1A]" />}
                                                </div>
                                                <div>
                                                    <p className="text-xs font-semibold text-[var(--os-text-primary)]">{opt.label}</p>
                                                    <p className="text-[10px] text-[var(--os-text-muted)] mt-0.5">{opt.desc}</p>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="flex flex-col gap-3">
                                <div className="flex items-center gap-2 text-[var(--os-text-secondary)]">
                                    <Bell className="w-3.5 h-3.5" />
                                    <span className="text-[11px] font-bold uppercase tracking-widest">{t('section_notifications')}</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        { key: 'notifyProForma' as const,  label: t('notif_proforma'), icon: '📄' },
                                        { key: 'notifyCo2' as const,       label: t('notif_co2'),      icon: '🌿' },
                                        { key: 'notifyRevenue' as const,   label: t('notif_revenue'),  icon: '💰' },
                                        { key: 'notifyWeekly' as const,    label: t('notif_weekly'),   icon: '📊' },
                                    ].map(({ key, label, icon }) => (
                                        <button
                                            key={key}
                                            onClick={() => set(key, !form[key])}
                                            className={`flex items-center gap-2 p-3 rounded-xl border text-left transition-all ${
                                                form[key]
                                                    ? 'border-[#00D97E]/30 bg-[rgba(0,217,126,0.04)]'
                                                    : 'border-[var(--os-border)] hover:border-[var(--os-border-strong)]'
                                            }`}
                                        >
                                            <span className="text-sm">{icon}</span>
                                            <span className="text-[10px] font-semibold text-[var(--os-text-secondary)]">{label}</span>
                                            <div className={`ml-auto w-8 h-4 rounded-full transition-colors flex items-center px-0.5 ${form[key] ? 'bg-[#00D97E]' : 'bg-[var(--os-surface-2)] border border-[var(--os-border)]'}`}>
                                                <div className={`w-3 h-3 rounded-full transition-transform ${form[key] ? 'translate-x-4 bg-[#060D1A]' : 'bg-[var(--os-text-muted)]'}`} />
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <button
                                onClick={() => set('acceptTerms', !form.acceptTerms)}
                                className="flex items-start gap-3 p-3.5 rounded-xl border border-[var(--os-border)] text-left hover:border-[var(--os-border-strong)] transition-colors"
                            >
                                <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5 border transition-colors ${
                                    form.acceptTerms ? 'bg-[#00D97E] border-[#00D97E]' : 'border-[var(--os-border)]'
                                }`}>
                                    {form.acceptTerms && <CheckCircle className="w-3 h-3 text-[#060D1A]" />}
                                </div>
                                <div className="flex items-center gap-1.5 text-[var(--os-text-secondary)]">
                                    <UserCheck className="w-3.5 h-3.5 flex-shrink-0" />
                                </div>
                                <p className="text-[10px] text-[var(--os-text-muted)] leading-relaxed">
                                    {t('terms_text')}{' '}
                                    <button type="button" className="text-[#38BDF8] underline hover:text-[#60CAFF] transition-colors" onClick={(e) => { e.stopPropagation(); setLegalModal('terms'); }}>{t('terms_tos')}</button>,{' '}
                                    <button type="button" className="text-[#38BDF8] underline hover:text-[#60CAFF] transition-colors" onClick={(e) => { e.stopPropagation(); setLegalModal('privacy'); }}>{t('terms_privacy')}</button>, and the{' '}
                                    <button type="button" className="text-[#38BDF8] underline hover:text-[#60CAFF] transition-colors" onClick={(e) => { e.stopPropagation(); setLegalModal('security'); }}>{t('terms_maritime')}</button>.
                                </p>
                            </button>
                        </div>
                    )}

                    {error && (
                        <div className="flex items-center gap-2 mt-4 px-3 py-2.5 rounded-xl bg-[rgba(239,68,68,0.08)] border border-[#EF4444]/20">
                            <AlertCircle className="w-3.5 h-3.5 text-[#EF4444] flex-shrink-0" />
                            <p className="text-xs text-[#EF4444]">{error}</p>
                        </div>
                    )}

                    <div className="flex items-center gap-3 mt-6">
                        <button
                            onClick={() => { setError(''); setStep(step - 1); }}
                            className="flex items-center gap-1.5 h-11 px-4 rounded-xl border border-[var(--os-border)] text-xs font-semibold text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:border-[var(--os-border-strong)] transition-colors"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            {t('btn_back')}
                        </button>

                        <button
                            onClick={handleNext}
                            disabled={loading}
                            className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl bg-[#00D97E] text-[#060D1A] text-sm font-bold hover:bg-[#00C070] disabled:opacity-60 transition-colors shadow-[0_0_12px_rgba(0,217,126,0.2)]"
                        >
                            {loading ? (
                                <span className="w-4 h-4 border-2 border-[#060D1A]/30 border-t-[#060D1A] rounded-full animate-spin" />
                            ) : (
                                <>
                                    {step === 3 ? t('btn_submit') : t('btn_continue')}
                                    {step < 3 && <ArrowRight className="w-4 h-4" />}
                                </>
                            )}
                        </button>
                    </div>

                    <p className="text-center text-xs text-[var(--os-text-muted)] mt-4">
                        {t('step_x_of_y', { step, total: 3 })} · {t('already_registered')}{' '}
                        <a href="/login" className="text-[#38BDF8] hover:underline">{t('sign_in')}</a>
                    </p>
                </div>
            </div>

            {/* Legal content modal */}
            {legalModal && (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
                    <div className="bg-[var(--os-surface)] rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden border border-[var(--os-border)]">
                        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--os-border)]">
                            <h3 className="text-sm font-bold text-[var(--os-text-primary)]">
                                {legalModal === 'terms' ? t('terms_tos') : legalModal === 'privacy' ? t('terms_privacy') : t('terms_maritime')}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setLegalModal(null)}
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:bg-[var(--os-surface-2)] transition-colors"
                            >
                                &#x2715;
                            </button>
                        </div>
                        <iframe
                            src={`/${legalModal === 'terms' ? 'terms-of-service' : legalModal === 'privacy' ? 'privacy-policy' : 'security-audit'}`}
                            className="flex-1 w-full"
                            title={legalModal === 'terms' ? t('terms_tos') : legalModal === 'privacy' ? t('terms_privacy') : t('terms_maritime')}
                        />
                    </div>
                </div>
            )}
        </AuthShell>
    );
}

// ── Password strength meter ───────────────────────────────────────────────────

function PasswordStrength({ password, t }: { password: string; t: (key: string) => string }) {
    const checks = [
        password.length >= 8,
        /[A-Z]/.test(password),
        /[0-9]/.test(password),
        /[^A-Za-z0-9]/.test(password),
    ];
    const strength = checks.filter(Boolean).length;
    const labels = ['', t('strength_weak'), t('strength_fair'), t('strength_good'), t('strength_strong')];
    const colors = ['', '#EF4444', '#F59E0B', '#38BDF8', '#22C55E'];

    return (
        <div className="flex items-center gap-2 mt-1">
            {checks.map((ok, i) => (
                <div
                    key={i}
                    className="flex-1 h-1 rounded-full transition-colors"
                    style={{ backgroundColor: i < strength ? colors[strength] : 'var(--os-surface-2)' }}
                />
            ))}
            <span className="text-[10px] font-semibold ml-1" style={{ color: colors[strength] }}>
                {labels[strength]}
            </span>
        </div>
    );
}

// ── Shared layout wrappers ────────────────────────────────────────────────────

function LogoBlock() {
    return (
        <>
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center mb-5 shadow-[0_0_24px_rgba(16,185,129,0.1)]">
                <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7">
                    <path d="M12 22C12 22 20 18 20 12C20 6 12 2 12 2C12 2 4 6 4 12C4 18 12 22 12 22Z" fill="#10B981" />
                </svg>
            </div>
            <h1 className="text-2xl font-bold text-[var(--os-text-primary)] mb-1">
                AIS Portal
            </h1>
        </>
    );
}

function AuthShell({ children, t }: { children: React.ReactNode; t: (key: string) => string }) {
    return (
        <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--os-bg)', color: 'var(--os-text-primary)' }}>
            <div className="flex items-center justify-between px-3 sm:px-6 py-3 border-b" style={{ borderColor: 'var(--os-border)' }}>
                {/* Logo — home link */}
                <a href="/" className="flex items-center gap-2 flex-shrink-0">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center flex-shrink-0">
                        <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4">
                            <path d="M12 22C12 22 20 18 20 12C20 6 12 2 12 2C12 2 4 6 4 12C4 18 12 22 12 22Z" />
                        </svg>
                    </div>
                    <span className="text-sm font-bold auth-hide-mobile" style={{ color: 'var(--os-text-primary)' }}>AIS Portal</span>
                </a>
                {/* Online indicator — center (dot only on mobile) */}
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full os-dot-online animate-blink flex-shrink-0" />
                    <span className="text-xs font-semibold text-[#00D97E] tracking-widest uppercase auth-hide-mobile">{t('system_online')}</span>
                </div>
                {/* Locale switcher — right */}
                <LocaleSwitcher variant="dashboard" />
            </div>

            <div className="flex-1 flex items-center justify-center px-4 py-12 overflow-y-auto">
                {children}
            </div>

            <div className="flex items-center justify-between px-6 py-2 text-[10px] text-[var(--os-text-muted)] border-t" style={{ borderColor: 'var(--os-border)' }}>
                <span>{t('copyright')}</span>
                <div className="flex items-center gap-4">
                    <span>BER-DC1</span>
                    <span>v1.2.4-secure</span>
                    <span>AES-256</span>
                </div>
            </div>
        </div>
    );
}
