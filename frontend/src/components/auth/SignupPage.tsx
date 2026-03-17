'use client';

import * as React from 'react';
import {
    Anchor, Shield, ArrowRight, ArrowLeft, CheckCircle,
    Building2, Ship, Eye, EyeOff, AlertCircle,
    Globe, Bell, LayoutDashboard, UserCheck,
} from 'lucide-react';
// Registration is handled server-side via /api/auth/register

// ── Types ─────────────────────────────────────────────────────────────────────

type EntityType = 'port_authority' | 'shipping_agent';

interface FormData {
    // Common
    entityType: EntityType | null;
    // Step 1 – Organization
    jurisdiction: string;
    organizationName: string;
    registryId: string;
    role: string;
    // Step 2 – Account
    fullName: string;
    email: string;
    password: string;
    confirmPassword: string;
    // Step 3 – Preferences
    defaultRegion: string;
    accessScope: 'national' | 'regional';
    notifyProForma: boolean;
    notifyCo2: boolean;
    notifyRevenue: boolean;
    notifyWeekly: boolean;
    acceptTerms: boolean;
}

// ── Role options ───────────────────────────────────────────────────────────────

const PORT_AUTHORITY_ROLES = [
    { key: 'PORT_OFFICER',    label: 'Port Officer',     description: 'Vessel inspection & compliance monitoring' },
    { key: 'FINANCE_ADMIN',   label: 'Finance Administrator', description: 'Invoice management, revenue reporting' },
    { key: 'COMPLIANCE_AUDITOR', label: 'Compliance Auditor', description: 'Audit log review, exemption oversight' },
    { key: 'SUPERADMIN',      label: 'Platform Administrator', description: 'Full system access — ministry approval required' },
];

const SHIPPING_AGENT_ROLES = [
    { key: 'FLEET_MANAGER',   label: 'Fleet Manager',    description: 'Manage vessels, view compliance status' },
    { key: 'FINANCE_CONTACT', label: 'Finance Contact',  description: 'Invoice payment, pro-forma management' },
    { key: 'LEGAL_REP',       label: 'Legal Representative', description: 'Exemption applications, bilateral agreements' },
];

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
    const [step, setStep] = React.useState(0); // 0 = entity type selection
    const [form, setForm] = React.useState<FormData>(INITIAL);
    const [showPwd, setShowPwd]       = React.useState(false);
    const [showConfirm, setShowConfirm] = React.useState(false);
    const [loading, setLoading]       = React.useState(false);
    const [error, setError]           = React.useState('');
    const [submitted, setSubmitted]   = React.useState(false);

    const set = (key: keyof FormData, value: FormData[keyof FormData]) =>
        setForm((f) => ({ ...f, [key]: value }));

    // ── Validation per step ────────────────────────────────────────────────────

    function validate(): string {
        if (step === 1) {
            if (!form.jurisdiction) return 'Please select your jurisdiction.';
            if (!form.organizationName.trim()) return 'Organization name is required.';
            if (!form.registryId.trim()) return 'Registry / IMO ID is required.';
            if (!form.role) return 'Please select your functional role.';
        }
        if (step === 2) {
            if (!form.fullName.trim()) return 'Full name is required.';
            if (!form.email.trim() || !form.email.includes('@')) return 'Valid email address required.';
            if (form.password.length < 8) return 'Password must be at least 8 characters.';
            if (form.password !== form.confirmPassword) return 'Passwords do not match.';
        }
        if (step === 3) {
            if (!form.acceptTerms) return 'You must accept the terms to continue.';
        }
        return '';
    }

    async function handleNext() {
        setError('');
        const err = validate();
        if (err) { setError(err); return; }
        if (step < 3) { setStep(step + 1); return; }

        // Step 3 → Server-side registration via API route
        // Creates auth user + profile + registration request atomically
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
                setError(result.error || 'Registration failed.');
                setLoading(false);
                return;
            }

            setLoading(false);
            window.location.href = '/pending-approval';
        } catch {
            setError('Server connection error. Please try again.');
            setLoading(false);
        }
    }

    // ── Success screen ─────────────────────────────────────────────────────────

    if (submitted) {
        return (
            <AuthShell>
                <div className="w-full max-w-md flex flex-col items-center text-center">
                    <div className="w-16 h-16 rounded-2xl border border-[#00D97E]/30 flex items-center justify-center mb-5 shadow-[0_0_24px_rgba(0,217,126,0.15)]" style={{ backgroundColor: 'var(--ais-page-card)' }}>
                        <CheckCircle className="w-8 h-8 text-[#00D97E]" />
                    </div>
                    <h2 className="text-2xl font-bold text-[var(--os-text-primary)] mb-2">Request Submitted</h2>
                    <p className="text-xs text-[var(--os-text-muted)] mb-6 leading-relaxed max-w-xs">
                        Your access request for <span className="text-[var(--os-text-primary)] font-semibold">{form.organizationName}</span> has been received.
                        A government administrator will review and activate your account within <span className="text-[#00D97E] font-semibold">24–48 hours</span>.
                    </p>
                    <div className="w-full rounded-2xl p-5 border mb-5" style={{ backgroundColor: 'var(--os-surface)', borderColor: 'var(--os-border-strong)' }}>
                        <div className="flex flex-col gap-3 text-left">
                            {[
                                { label: 'Organization', value: form.organizationName },
                                { label: 'Registry ID',  value: form.registryId },
                                { label: 'Account',      value: form.email },
                                { label: 'Role',         value: form.role.replace('_', ' ') },
                            ].map(({ label, value }) => (
                                <div key={label} className="flex justify-between text-xs">
                                    <span className="text-[var(--os-text-muted)]">{label}</span>
                                    <span className="font-semibold text-[var(--os-text-primary)]">{value}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <a
                        href="/login"
                        className="text-xs text-[#38BDF8] hover:underline"
                    >
                        ← Return to login
                    </a>
                </div>
            </AuthShell>
        );
    }

    // ── Step 0: Entity type selection ─────────────────────────────────────────

    if (step === 0) {
        return (
            <AuthShell>
                <div className="w-full max-w-lg flex flex-col items-center">
                    <LogoBlock />
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#00D97E]/60 mb-8">
                        New Account Registration
                    </p>

                    <div className="w-full rounded-2xl p-6 border" style={{ backgroundColor: 'var(--os-surface)', borderColor: 'var(--os-border-strong)' }}>
                        <h2 className="text-base font-bold text-[var(--os-text-primary)] mb-1">Who are you registering as?</h2>
                        <p className="text-xs text-[var(--os-text-muted)] mb-5">
                            Select the entity type that best describes your organization. Your access scope and available features will be configured accordingly.
                        </p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                            {/* Port Authority card */}
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
                                    <p className="text-sm font-bold text-[var(--os-text-primary)] mb-1">Port Authority</p>
                                    <p className="text-[10px] text-[var(--os-text-muted)] leading-relaxed">
                                        Government agency, ministry, or port regulatory body. Full EEZ oversight and tax enforcement access.
                                    </p>
                                </div>
                                <div className="mt-auto flex flex-wrap gap-1">
                                    {['Compliance', 'Revenue', 'Audit'].map((t) => (
                                        <span key={t} className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[rgba(0,217,126,0.08)] text-[#00D97E]">{t}</span>
                                    ))}
                                </div>
                            </button>

                            {/* Shipping Agent card */}
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
                                    <p className="text-sm font-bold text-[var(--os-text-primary)] mb-1">Armateur / Shipping Agent</p>
                                    <p className="text-[10px] text-[var(--os-text-muted)] leading-relaxed">
                                        Ship owner, operator, or maritime agent. Access vessel compliance status, invoices, and pro-forma management.
                                    </p>
                                </div>
                                <div className="mt-auto flex flex-wrap gap-1">
                                    {['Vessels', 'Invoices', 'Pro-forma'].map((t) => (
                                        <span key={t} className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[rgba(56,189,248,0.08)] text-[#38BDF8]">{t}</span>
                                    ))}
                                </div>
                            </button>
                        </div>

                        <p className="text-center text-xs text-[var(--os-text-muted)]">
                            Already have an account?{' '}
                            <a href="/login" className="text-[#38BDF8] hover:underline">Sign in</a>
                        </p>
                    </div>
                </div>
            </AuthShell>
        );
    }

    // ── Steps 1–3 ─────────────────────────────────────────────────────────────

    const isPortAuth = form.entityType === 'port_authority';
    const roles = isPortAuth ? PORT_AUTHORITY_ROLES : SHIPPING_AGENT_ROLES;
    const STEP_TITLES = ['', 'Organization Profile', 'Account Credentials', 'Preferences & Access'];
    const STEP_SUBS   = ['',
        'Tell us about your organization. This determines your data access scope.',
        'Set up your secure login credentials.',
        'Configure your dashboard defaults and notification preferences.',
    ];

    return (
        <AuthShell>
            <div className="w-full max-w-lg flex flex-col items-center">
                {/* Logo */}
                <LogoBlock />
                <div className="flex items-center gap-2 mb-6">
                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                        isPortAuth
                            ? 'bg-[rgba(0,217,126,0.08)] border-[#00D97E]/30 text-[#00D97E]'
                            : 'bg-[rgba(56,189,248,0.08)] border-[#38BDF8]/30 text-[#38BDF8]'
                    }`}>
                        {isPortAuth ? <Building2 className="w-3 h-3" /> : <Ship className="w-3 h-3" />}
                        {isPortAuth ? 'Port Authority' : 'Armateur / Shipping Agent'}
                    </div>
                    <button
                        onClick={() => { setStep(0); setError(''); }}
                        className="text-[10px] text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] transition-colors"
                    >
                        Change →
                    </button>
                </div>

                <div className="w-full rounded-2xl p-6 border" style={{ backgroundColor: 'var(--os-surface)', borderColor: 'var(--os-border-strong)' }}>
                    <StepIndicator current={step} total={3} />

                    <h2 className="text-base font-bold text-[var(--os-text-primary)] mb-0.5">{STEP_TITLES[step]}</h2>
                    <p className="text-xs text-[var(--os-text-muted)] mb-5 leading-relaxed">{STEP_SUBS[step]}</p>

                    {/* ── Step 1: Organization ── */}
                    {step === 1 && (
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-col gap-1.5">
                                <FieldLabel>Coastal State / Jurisdiction</FieldLabel>
                                <FieldSelect value={form.jurisdiction} onChange={(e) => set('jurisdiction', e.target.value)}>
                                    <option value="">— Select jurisdiction —</option>
                                    {JURISDICTIONS.map((j) => <option key={j} value={j}>{j}</option>)}
                                </FieldSelect>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <FieldLabel>{isPortAuth ? 'Ministry / Port Authority Name' : 'Company / Shipping Company Name'}</FieldLabel>
                                <FieldInput
                                    type="text"
                                    placeholder={isPortAuth ? 'e.g. Berbera Port Authority' : 'e.g. MSC Mediterranean Shipping'}
                                    value={form.organizationName}
                                    onChange={(e) => set('organizationName', e.target.value)}
                                />
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <FieldLabel>{isPortAuth ? 'Government Registry ID' : 'IMO Operator / Company Number'}</FieldLabel>
                                <FieldInput
                                    type="text"
                                    placeholder={isPortAuth ? 'e.g. SL-GOV-2024-0042' : 'e.g. IMO-OP-5812341'}
                                    value={form.registryId}
                                    onChange={(e) => set('registryId', e.target.value)}
                                />
                                <p className="text-[10px] text-[var(--os-text-muted)]">
                                    {isPortAuth
                                        ? 'Your official government registry number, used for verification.'
                                        : 'Your IMO-registered operator or company identifier.'}
                                </p>
                            </div>

                            <div className="flex flex-col gap-2">
                                <FieldLabel>Functional Role</FieldLabel>
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
                                                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[rgba(245,158,11,0.1)] text-[#F59E0B] font-bold">Ministry Only</span>
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
                                <FieldLabel>Full Name</FieldLabel>
                                <FieldInput
                                    type="text"
                                    placeholder="e.g. Hassan Warsame"
                                    value={form.fullName}
                                    onChange={(e) => set('fullName', e.target.value)}
                                />
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <FieldLabel>{isPortAuth ? 'Official Email (.gov.sl)' : 'Professional Email'}</FieldLabel>
                                <FieldInput
                                    type="email"
                                    placeholder={isPortAuth ? 'name@berbera.gov.sl' : 'name@company.com'}
                                    value={form.email}
                                    onChange={(e) => set('email', e.target.value)}
                                />
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <FieldLabel>Password</FieldLabel>
                                <div className="relative">
                                    <FieldInput
                                        type={showPwd ? 'text' : 'password'}
                                        placeholder="Min. 8 characters"
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
                                {/* Password strength */}
                                {form.password && (
                                    <PasswordStrength password={form.password} />
                                )}
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <FieldLabel>Confirm Password</FieldLabel>
                                <div className="relative">
                                    <FieldInput
                                        type={showConfirm ? 'text' : 'password'}
                                        placeholder="Repeat your password"
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
                                    <p className="text-[10px] text-[#EF4444]">Passwords do not match.</p>
                                )}
                            </div>

                            {/* Security notice */}
                            <div className="flex gap-2.5 p-3 rounded-xl bg-[rgba(245,158,11,0.06)] border border-[#F59E0B]/20">
                                <Shield className="w-3.5 h-3.5 text-[#F59E0B] flex-shrink-0 mt-0.5" />
                                <p className="text-[10px] text-[var(--os-text-muted)] leading-relaxed">
                                    Your credentials are encrypted with AES-256. A government administrator must approve your account before you can log in.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ── Step 3: Preferences ── */}
                    {step === 3 && (
                        <div className="flex flex-col gap-5">
                            {/* Default views */}
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center gap-2 text-[var(--os-text-secondary)]">
                                    <LayoutDashboard className="w-3.5 h-3.5" />
                                    <span className="text-[11px] font-bold uppercase tracking-widest">Default Views</span>
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <FieldLabel>Default Map Region</FieldLabel>
                                    <FieldSelect value={form.defaultRegion} onChange={(e) => set('defaultRegion', e.target.value)}>
                                        {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                                    </FieldSelect>
                                </div>
                            </div>

                            {/* Data access scope */}
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center gap-2 text-[var(--os-text-secondary)]">
                                    <Globe className="w-3.5 h-3.5" />
                                    <span className="text-[11px] font-bold uppercase tracking-widest">Data Access Scope</span>
                                </div>
                                <div className="flex flex-col gap-2">
                                    {[
                                        {
                                            key: 'national' as const,
                                            label: 'Full National Scope',
                                            desc: 'Access all maritime zones, ports, jurisdictions, and sovereign cargo data.',
                                            available: isPortAuth,
                                        },
                                        {
                                            key: 'regional' as const,
                                            label: 'Regional / Port Authority',
                                            desc: 'Limited to specific coastal regions, ports, and your registered vessels.',
                                            available: true,
                                        },
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

                            {/* Notifications */}
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center gap-2 text-[var(--os-text-secondary)]">
                                    <Bell className="w-3.5 h-3.5" />
                                    <span className="text-[11px] font-bold uppercase tracking-widest">Notification Preferences</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        { key: 'notifyProForma' as const,  label: 'New pro-forma invoice',  icon: '📄' },
                                        { key: 'notifyCo2' as const,       label: 'Carbon credit issuance', icon: '🌿' },
                                        { key: 'notifyRevenue' as const,   label: 'Revenue thresholds',     icon: '💰' },
                                        { key: 'notifyWeekly' as const,    label: 'Weekly digest',          icon: '📊' },
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

                            {/* Terms */}
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
                                    I certify that the information provided is accurate. I accept the{' '}
                                    <a href="/terms-of-service" target="_blank" rel="noopener noreferrer" className="text-[#38BDF8] underline hover:text-[#60CAFF] transition-colors" onClick={(e) => e.stopPropagation()}>Terms of Service</a>,{' '}
                                    <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-[#38BDF8] underline hover:text-[#60CAFF] transition-colors" onClick={(e) => e.stopPropagation()}>Privacy Protocol</a>, and the{' '}
                                    <a href="/security-audit" target="_blank" rel="noopener noreferrer" className="text-[#38BDF8] underline hover:text-[#60CAFF] transition-colors" onClick={(e) => e.stopPropagation()}>Maritime Carbon Act 2024</a>.
                                </p>
                            </button>
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="flex items-center gap-2 mt-4 px-3 py-2.5 rounded-xl bg-[rgba(239,68,68,0.08)] border border-[#EF4444]/20">
                            <AlertCircle className="w-3.5 h-3.5 text-[#EF4444] flex-shrink-0" />
                            <p className="text-xs text-[#EF4444]">{error}</p>
                        </div>
                    )}

                    {/* Navigation */}
                    <div className="flex items-center gap-3 mt-6">
                        <button
                            onClick={() => { setError(''); setStep(step - 1); }}
                            className="flex items-center gap-1.5 h-11 px-4 rounded-xl border border-[var(--os-border)] text-xs font-semibold text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:border-[var(--os-border-strong)] transition-colors"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back
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
                                    {step === 3 ? 'Submit Request' : 'Continue'}
                                    {step < 3 && <ArrowRight className="w-4 h-4" />}
                                </>
                            )}
                        </button>
                    </div>

                    <p className="text-center text-xs text-[var(--os-text-muted)] mt-4">
                        Step {step} of 3 · Already registered?{' '}
                        <a href="/login" className="text-[#38BDF8] hover:underline">Sign in</a>
                    </p>
                </div>
            </div>
        </AuthShell>
    );
}

// ── Password strength meter ───────────────────────────────────────────────────

function PasswordStrength({ password }: { password: string }) {
    const checks = [
        password.length >= 8,
        /[A-Z]/.test(password),
        /[0-9]/.test(password),
        /[^A-Za-z0-9]/.test(password),
    ];
    const strength = checks.filter(Boolean).length;
    const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
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
            <div className="w-16 h-16 rounded-2xl border border-[#00D97E]/25 flex items-center justify-center mb-5 shadow-[0_0_24px_rgba(0,217,126,0.15)]" style={{ backgroundColor: 'var(--ais-page-card)' }}>
                <Anchor className="w-8 h-8 text-[#00D97E]" />
            </div>
            <h1 className="text-2xl font-bold text-[var(--os-text-primary)] mb-1">
                Africgreen<span className="text-[#00D97E]">OS</span>
            </h1>
        </>
    );
}

function AuthShell({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--os-bg)', color: 'var(--os-text-primary)' }}>
            {/* Top bar */}
            <div className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: 'var(--os-border)' }}>
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full os-dot-online animate-blink" />
                    <span className="text-xs font-semibold text-[#00D97E] tracking-widest uppercase">System Online</span>
                </div>
                <div className="flex items-center gap-3">
                    {(['EN', 'SO', 'AR'] as const).map((lang) => (
                        <button key={lang} className={`text-xs font-semibold px-2 py-1 rounded-md transition-colors ${
                            lang === 'EN' ? 'bg-[var(--os-surface-2)] text-[var(--os-text-primary)]' : 'text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)]'
                        }`}>{lang}</button>
                    ))}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 flex items-center justify-center px-4 py-12 overflow-y-auto">
                {children}
            </div>

            {/* Bottom bar */}
            <div className="flex items-center justify-between px-6 py-2 text-[10px] text-[var(--os-text-muted)] border-t" style={{ borderColor: 'var(--os-border)' }}>
                <span>© 2025 Government of Somaliland</span>
                <div className="flex items-center gap-4">
                    <span>BER-DC1</span>
                    <span>v1.2.4-secure</span>
                    <span>AES-256</span>
                </div>
            </div>
        </div>
    );
}
