'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
    User, Shield, Bell, Globe, Monitor, Key,
    Save, AlertTriangle, CheckCircle2, Eye, EyeOff,
    LogOut, Trash2, Download, Clock, Smartphone,
    Mail, Lock,
} from 'lucide-react';
import { useRole } from '@/lib/RoleContext';
import { SkinSwitcher } from '@/components/layout/SkinSwitcher';
import { UserRole, OperationalSite } from '@/types/secure';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROLE_I18N_KEY: Record<UserRole, string> = {
    [UserRole.PORT_OFFICER]:   'settings_role_port_officer',
    [UserRole.FINANCE_ADMIN]:  'settings_role_finance_admin',
    [UserRole.SUPERADMIN]:     'settings_role_superadmin',
    [UserRole.SHIPPING_AGENT]: 'settings_role_shipping_agent',
    [UserRole.MANAGER]:        'settings_role_operations_manager',
};

const SITE_I18N_KEY: Record<OperationalSite, string> = {
    [OperationalSite.BERBERA_PORT]:  'settings_site_berbera',
    [OperationalSite.NATIONAL_HQ]:   'settings_site_national_hq',
    [OperationalSite.ZEILA_PORT]:    'settings_site_zeila',
    [OperationalSite.DJIBOUTI_PORT]: 'settings_site_djibouti',
};

const TAB_I18N_KEY: Record<string, string> = {
    profile: 'settings_profile',
    security: 'settings_security',
    notifications: 'settings_notifications',
    preferences: 'settings_preferences',
    sessions: 'settings_sessions',
};

const TABS = [
    { key: 'profile',       icon: User },
    { key: 'security',      icon: Shield },
    { key: 'notifications', icon: Bell },
    { key: 'preferences',   icon: Globe },
    { key: 'sessions',      icon: Monitor },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-4">
            <div>
                <h3 className="text-sm font-bold" style={{ color: 'var(--os-text-primary)' }}>{title}</h3>
                {description && <p className="text-xs mt-0.5" style={{ color: 'var(--os-text-muted)' }}>{description}</p>}
            </div>
            {children}
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--os-text-muted)' }}>
                {label}
            </label>
            {children}
        </div>
    );
}

function Input({ value, onChange, type = 'text', readOnly, placeholder }: {
    value: string;
    onChange?: (v: string) => void;
    type?: string;
    readOnly?: boolean;
    placeholder?: string;
}) {
    return (
        <input
            type={type}
            value={value}
            onChange={onChange ? (e) => onChange(e.target.value) : undefined}
            readOnly={readOnly}
            placeholder={placeholder}
            className="w-full h-10 px-3 rounded-xl text-sm outline-none transition-all"
            style={{
                backgroundColor: readOnly ? 'var(--os-bg)' : 'var(--os-surface-2)',
                border: '1px solid var(--os-border)',
                color: readOnly ? 'var(--os-text-muted)' : 'var(--os-text-primary)',
                cursor: readOnly ? 'default' : 'text',
            }}
        />
    );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
    return (
        <div className="flex items-center justify-between py-3 border-b" style={{ borderColor: 'var(--os-border)' }}>
            <span className="text-sm" style={{ color: 'var(--os-text-secondary)' }}>{label}</span>
            <button
                onClick={() => onChange(!checked)}
                className="relative w-10 h-6 rounded-full transition-colors flex-shrink-0"
                style={{ backgroundColor: checked ? '#10B981' : 'var(--os-surface-3)' }}
            >
                <span
                    className="absolute top-1 w-4 h-4 rounded-full bg-white transition-all"
                    style={{ left: checked ? 22 : 4 }}
                />
            </button>
        </div>
    );
}

function SaveBar({ onSave, saved }: { onSave: () => void; saved: boolean }) {
    const t = useTranslations('DashboardPages');
    return (
        <div className="flex items-center justify-between pt-6 mt-2 border-t" style={{ borderColor: 'var(--os-border)' }}>
            {saved ? (
                <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {t('settings_saved')}
                </span>
            ) : (
                <span className="text-xs" style={{ color: 'var(--os-text-muted)' }}>{t('settings_unsaved')}</span>
            )}
            <button
                onClick={onSave}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#10B981' }}
            >
                <Save className="w-4 h-4" />
                {t('settings_save')}
            </button>
        </div>
    );
}

// ── Tabs content ──────────────────────────────────────────────────────────────

function ProfileTab() {
    const t = useTranslations('DashboardPages');
    const { user } = useRole();
    const [fullName, setFullName] = React.useState(user.fullName);
    const [phone, setPhone]       = React.useState('+252 63 000 0000');
    const [bio, setBio]           = React.useState('');
    const [saved, setSaved]       = React.useState(false);

    function save() {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
    }

    const initials = fullName.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);

    return (
        <div className="flex flex-col gap-8">
            {/* Avatar */}
            <Section title={t('settings_profile_photo')}>
                <div className="flex items-center gap-4">
                    <div
                        className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold text-white flex-shrink-0"
                        style={{ backgroundColor: '#10B981' }}
                    >
                        {initials}
                    </div>
                    <div className="flex flex-col gap-2">
                        <button
                            className="text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                            style={{ backgroundColor: 'var(--os-surface-2)', color: 'var(--os-text-secondary)', border: '1px solid var(--os-border)' }}
                        >
                            {t('settings_change_photo')}
                        </button>
                        <p className="text-[11px]" style={{ color: 'var(--os-text-muted)' }}>{t('settings_photo_hint')}</p>
                    </div>
                </div>
            </Section>

            {/* Identity */}
            <Section title={t('settings_identity')} description={t('settings_identity_desc')}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <Field label={t('settings_full_name')}>
                        <Input value={fullName} onChange={setFullName} />
                    </Field>
                    <Field label={t('settings_official_email')}>
                        <Input value={user.email} readOnly />
                    </Field>
                    <Field label={t('settings_phone')}>
                        <Input value={phone} onChange={setPhone} type="tel" />
                    </Field>
                    <Field label={t('settings_timezone')}>
                        <Input value={user.timezone} readOnly />
                    </Field>
                </div>
                <Field label={t('settings_bio')}>
                    <textarea
                        value={bio}
                        onChange={(e) => setBio(e.target.value)}
                        placeholder={t('settings_bio_placeholder')}
                        rows={3}
                        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none transition-all"
                        style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)', color: 'var(--os-text-primary)' }}
                    />
                </Field>
            </Section>

            {/* Role (read-only) */}
            <Section title={t('settings_role_assignment')} description={t('settings_role_assignment_desc')}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <Field label={t('settings_role')}>
                        <div
                            className="flex items-center gap-2 h-10 px-3 rounded-xl text-sm"
                            style={{ backgroundColor: 'var(--os-bg)', border: '1px solid var(--os-border)', color: '#10B981' }}
                        >
                            <Shield className="w-3.5 h-3.5 flex-shrink-0" />
                            {t(ROLE_I18N_KEY[user.role])}
                        </div>
                    </Field>
                    <Field label={t('settings_operational_site')}>
                        <Input value={t(SITE_I18N_KEY[user.operationalSite])} readOnly />
                    </Field>
                    <Field label={t('settings_user_id')}>
                        <Input value={user.id} readOnly />
                    </Field>
                    <Field label={t('settings_last_login')}>
                        <Input value={new Date(user.lastLogin).toLocaleString('fr-FR')} readOnly />
                    </Field>
                </div>
            </Section>

            <SaveBar onSave={save} saved={saved} />
        </div>
    );
}

function SecurityTab() {
    const t = useTranslations('DashboardPages');
    const [currentPwd, setCurrentPwd] = React.useState('');
    const [newPwd, setNewPwd]         = React.useState('');
    const [confirmPwd, setConfirmPwd] = React.useState('');
    const [showCurrent, setShowCurrent] = React.useState(false);
    const [showNew, setShowNew]       = React.useState(false);
    const [mfa, setMfa]               = React.useState(true);
    const [saved, setSaved]           = React.useState(false);

    const strength = newPwd.length === 0 ? 0 : newPwd.length < 8 ? 1 : newPwd.length < 12 ? 2 : /[A-Z]/.test(newPwd) && /[0-9]/.test(newPwd) && /[^A-Za-z0-9]/.test(newPwd) ? 4 : 3;
    const strengthLabel = ['', t('settings_password_weak'), t('settings_password_medium'), t('settings_password_good'), t('settings_password_strong')][strength];
    const strengthColor = ['', '#EF4444', '#EAB308', '#10B981', '#10B981'][strength];

    function save() {
        setSaved(true);
        setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
        setTimeout(() => setSaved(false), 3000);
    }

    return (
        <div className="flex flex-col gap-8">
            <Section title={t('settings_change_password')} description={t('settings_change_password_desc')}>
                <div className="flex flex-col gap-4 max-w-sm">
                    <Field label={t('settings_current_password')}>
                        <div className="relative">
                            <Input value={currentPwd} onChange={setCurrentPwd} type={showCurrent ? 'text' : 'password'} placeholder="••••••••••••" />
                            <button onClick={() => setShowCurrent((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--os-text-muted)' }}>
                                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                    </Field>
                    <Field label={t('settings_new_password')}>
                        <div className="relative">
                            <Input value={newPwd} onChange={setNewPwd} type={showNew ? 'text' : 'password'} placeholder="••••••••••••" />
                            <button onClick={() => setShowNew((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--os-text-muted)' }}>
                                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                        {newPwd.length > 0 && (
                            <div className="flex items-center gap-2 mt-1">
                                <div className="flex gap-1 flex-1">
                                    {[1, 2, 3, 4].map((i) => (
                                        <div key={i} className="flex-1 h-1 rounded-full" style={{ backgroundColor: i <= strength ? strengthColor : 'var(--os-surface-3)' }} />
                                    ))}
                                </div>
                                <span className="text-[11px] font-semibold" style={{ color: strengthColor }}>{strengthLabel}</span>
                            </div>
                        )}
                    </Field>
                    <Field label={t('settings_confirm_password')}>
                        <Input value={confirmPwd} onChange={setConfirmPwd} type="password" placeholder="••••••••••••" />
                        {confirmPwd && confirmPwd !== newPwd && (
                            <p className="text-[11px] text-red-400 flex items-center gap-1 mt-1">
                                <AlertTriangle className="w-3 h-3" /> {t('settings_passwords_mismatch')}
                            </p>
                        )}
                    </Field>
                </div>
            </Section>

            <Section title={t('settings_mfa_title')} description={t('settings_mfa_desc')}>
                <Toggle checked={mfa} onChange={setMfa} label={t('settings_mfa_toggle')} />
                {mfa && (
                    <div className="flex items-center gap-3 p-3 rounded-xl" style={{ backgroundColor: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}>
                        <Smartphone className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                        <div>
                            <p className="text-xs font-semibold text-emerald-400">{t('settings_mfa_enabled')}</p>
                            <p className="text-[11px]" style={{ color: 'var(--os-text-muted)' }}>{t('settings_mfa_configured')}</p>
                        </div>
                        <button className="ml-auto text-[11px] font-semibold text-emerald-400 hover:underline">{t('settings_mfa_reconfigure')}</button>
                    </div>
                )}
            </Section>

            <Section title={t('settings_danger_zone')} description={t('settings_danger_zone_desc')}>
                <div className="flex flex-col gap-3">
                    <button
                        className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold transition-colors w-fit"
                        style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}
                    >
                        <LogOut className="w-4 h-4" />
                        {t('settings_disconnect_sessions')}
                    </button>
                    <button
                        className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold transition-colors w-fit"
                        style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}
                    >
                        <Trash2 className="w-4 h-4" />
                        {t('settings_request_deletion')}
                    </button>
                </div>
            </Section>

            <SaveBar onSave={save} saved={saved} />
        </div>
    );
}

function NotificationsTab() {
    const t = useTranslations('DashboardPages');
    const [notifs, setNotifs] = React.useState({
        vessel_alert:     true,
        payment_due:      true,
        new_declaration:  false,
        system_update:    true,
        weekly_report:    true,
        audit_activity:   false,
        email_digest:     true,
        sms_critical:     false,
    });
    const [saved, setSaved] = React.useState(false);

    const toggle = (key: keyof typeof notifs) => setNotifs((p) => ({ ...p, [key]: !p[key] }));

    function save() { setSaved(true); setTimeout(() => setSaved(false), 3000); }

    const groups = [
        {
            title: t('settings_notif_operational'),
            description: t('settings_notif_operational_desc'),
            items: [
                { key: 'vessel_alert',    label: t('settings_notif_vessel_alert') },
                { key: 'payment_due',     label: t('settings_notif_payment_due') },
                { key: 'new_declaration', label: t('settings_notif_new_declaration') },
            ],
        },
        {
            title: t('settings_notif_system_admin'),
            items: [
                { key: 'system_update',  label: t('settings_notif_system_update') },
                { key: 'audit_activity', label: t('settings_notif_audit_activity') },
            ],
        },
        {
            title: t('settings_notif_reports'),
            items: [
                { key: 'weekly_report', label: t('settings_notif_weekly_report') },
                { key: 'email_digest',  label: t('settings_notif_email_digest') },
            ],
        },
        {
            title: t('settings_notif_channels'),
            items: [
                { key: 'sms_critical', label: t('settings_notif_sms_critical') },
            ],
        },
    ] as const;

    return (
        <div className="flex flex-col gap-8">
            {groups.map((g) => (
                <Section key={g.title} title={g.title} description={'description' in g ? g.description : undefined}>
                    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--os-border)' }}>
                        <div style={{ backgroundColor: 'var(--os-surface-2)' }}>
                            {g.items.map(({ key, label }) => (
                                <div key={key} className="px-4" style={{ backgroundColor: 'var(--os-surface)' }}>
                                    <Toggle
                                        checked={notifs[key as keyof typeof notifs]}
                                        onChange={() => toggle(key as keyof typeof notifs)}
                                        label={label}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                </Section>
            ))}
            <SaveBar onSave={save} saved={saved} />
        </div>
    );
}

function PreferencesTab() {
    const t = useTranslations('DashboardPages');
    const { user } = useRole();
    const [lang, setLang]         = React.useState<string>(user.preferredLanguage);
    const [dateFormat, setDateFmt] = React.useState('DD/MM/YYYY');
    const [currency, setCurrency] = React.useState('USD');
    const [density, setDensity]   = React.useState('comfortable');
    const [saved, setSaved]       = React.useState(false);

    function save() { setSaved(true); setTimeout(() => setSaved(false), 3000); }

    function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
        return (
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full h-10 px-3 rounded-xl text-sm outline-none appearance-none"
                style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)', color: 'var(--os-text-primary)' }}
            >
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
        );
    }

    return (
        <div className="flex flex-col gap-8">
            <Section title={t('settings_lang_region')}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <Field label={t('settings_interface_language')}>
                        <Select value={lang} onChange={setLang} options={[
                            { value: 'fr', label: 'Français' },
                            { value: 'en', label: 'English' },
                            { value: 'so', label: 'Soomaali' },
                            { value: 'ar', label: 'العربية' },
                        ]} />
                    </Field>
                    <Field label={t('settings_date_format')}>
                        <Select value={dateFormat} onChange={setDateFmt} options={[
                            { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (Europe)' },
                            { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (US)' },
                            { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (ISO)' },
                        ]} />
                    </Field>
                    <Field label={t('settings_display_currency')}>
                        <Select value={currency} onChange={setCurrency} options={[
                            { value: 'USD', label: 'USD — Dollar américain' },
                            { value: 'EUR', label: 'EUR — Euro' },
                            { value: 'SOS', label: 'SOS — Shilling somalien' },
                        ]} />
                    </Field>
                </div>
            </Section>

            <Section title={t('settings_display')} description={t('settings_display_desc')}>
                <div className="flex gap-3">
                    {(['compact', 'comfortable', 'spacious'] as const).map((d) => (
                        <button
                            key={d}
                            onClick={() => setDensity(d)}
                            className="flex-1 flex flex-col items-center gap-2 p-4 rounded-xl text-xs font-semibold capitalize transition-all"
                            style={{
                                backgroundColor: density === d ? 'rgba(16,185,129,0.12)' : 'var(--os-surface-2)',
                                color: density === d ? '#10B981' : 'var(--os-text-muted)',
                                border: density === d ? '1px solid rgba(16,185,129,0.3)' : '1px solid var(--os-border)',
                            }}
                        >
                            <div className="flex flex-col gap-1 w-10">
                                {Array.from({ length: d === 'compact' ? 4 : d === 'comfortable' ? 3 : 2 }).map((_, i) => (
                                    <div key={i} className="h-1.5 rounded-full w-full" style={{ backgroundColor: density === d ? '#10B981' : 'var(--os-border)' }} />
                                ))}
                            </div>
                            {d === 'compact' ? t('settings_density_compact') : d === 'comfortable' ? t('settings_density_comfortable') : t('settings_density_spacious')}
                        </button>
                    ))}
                </div>
            </Section>

            <Section title={t('settings_visual_theme')} description={t('settings_visual_theme_desc')}>
                <SkinSwitcher variant="settings" />
            </Section>

            <Section title={t('settings_data_export')} description={t('settings_data_export_desc')}>
                <button
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors w-fit"
                    style={{ backgroundColor: 'var(--os-surface-2)', color: 'var(--os-text-secondary)', border: '1px solid var(--os-border)' }}
                >
                    <Download className="w-4 h-4" />
                    {t('settings_export_json')}
                </button>
            </Section>

            <SaveBar onSave={save} saved={saved} />
        </div>
    );
}

function SessionsTab() {
    const t = useTranslations('DashboardPages');
    const SESSIONS = [
        { id: '1', device: 'Chrome 122 — Windows 11',   ip: '197.231.44.12', location: 'Berbera, Somaliland',  lastKey: 'settings_active_now',        current: true },
        { id: '2', device: 'Firefox 124 — macOS 14',    ip: '197.231.44.88', location: 'Hargeisa, Somaliland', lastKey: 'settings_2h_ago',          current: false },
        { id: '3', device: 'Safari Mobile — iOS 17',    ip: '41.220.14.55',  location: 'Djibouti',             lastKey: 'settings_yesterday',             current: false },
        { id: '4', device: 'Chrome 121 — Ubuntu 22.04', ip: '197.231.45.01', location: 'Berbera, Somaliland',  lastKey: 'settings_3d_ago',           current: false },
    ];

    const [sessions, setSessions] = React.useState(SESSIONS);

    function revoke(id: string) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
    }

    return (
        <div className="flex flex-col gap-6">
            <Section title={t('settings_sessions_title')} description={t('settings_sessions_desc')}>
                <div className="flex flex-col gap-3">
                    {sessions.map((s) => (
                        <div
                            key={s.id}
                            className="flex items-center gap-4 px-4 py-3.5 rounded-xl"
                            style={{
                                backgroundColor: s.current ? 'rgba(16,185,129,0.06)' : 'var(--os-surface)',
                                border: s.current ? '1px solid rgba(16,185,129,0.2)' : '1px solid var(--os-border)',
                            }}
                        >
                            <Monitor className="w-5 h-5 flex-shrink-0" style={{ color: s.current ? '#10B981' : 'var(--os-text-muted)' }} />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--os-text-primary)' }}>{s.device}</p>
                                    {s.current && (
                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-emerald-400" style={{ backgroundColor: 'rgba(16,185,129,0.1)' }}>
                                            {t('settings_current_session')}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-3 mt-0.5 text-xs" style={{ color: 'var(--os-text-muted)' }}>
                                    <span className="flex items-center gap-1"><Lock className="w-3 h-3" />{s.ip}</span>
                                    <span>·</span>
                                    <span>{s.location}</span>
                                    <span>·</span>
                                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{t(s.lastKey as Parameters<typeof t>[0])}</span>
                                </div>
                            </div>
                            {!s.current && (
                                <button
                                    onClick={() => revoke(s.id)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex-shrink-0"
                                    style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}
                                >
                                    <LogOut className="w-3.5 h-3.5" />
                                    {t('settings_revoke')}
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </Section>

            <Section title={t('settings_login_security')}>
                <div className="flex flex-col gap-3 p-4 rounded-xl" style={{ backgroundColor: 'var(--os-surface)', border: '1px solid var(--os-border)' }}>
                    {[
                        { icon: Mail,  label: t('settings_login_notif_email'), active: true },
                        { icon: Shield, label: t('settings_auto_block'), active: true },
                        { icon: Key,   label: t('settings_token_rotation'), active: false },
                    ].map(({ icon: Icon, label, active }) => (
                        <div key={label} className="flex items-center gap-3 py-2.5 border-b last:border-0" style={{ borderColor: 'var(--os-border)' }}>
                            <Icon className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--os-text-muted)' }} />
                            <span className="text-sm flex-1" style={{ color: 'var(--os-text-secondary)' }}>{label}</span>
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: active ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: active ? '#10B981' : '#EF4444' }}>
                                {active ? t('settings_enabled') : t('settings_disabled')}
                            </span>
                        </div>
                    ))}
                </div>
            </Section>
        </div>
    );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function SettingsPage() {
    const t = useTranslations('DashboardPages');
    const [activeTab, setActiveTab] = React.useState<TabKey>('profile');

    const CONTENT: Record<TabKey, React.ReactNode> = {
        profile:       <ProfileTab />,
        security:      <SecurityTab />,
        notifications: <NotificationsTab />,
        preferences:   <PreferencesTab />,
        sessions:      <SessionsTab />,
    };

    return (
        <div className="flex flex-col gap-0 min-h-full">
            {/* Page header */}
            <div
                className="px-3 sm:px-6 py-3 sm:py-5 border-b"
                style={{ backgroundColor: 'var(--os-surface)', borderColor: 'var(--os-border)' }}
            >
                <h1 className="text-xl font-bold" style={{ color: 'var(--os-text-primary)' }}>{t('settings_title')}</h1>
                <p className="text-sm mt-0.5" style={{ color: 'var(--os-text-muted)' }}>
                    {t('settings_subtitle')}
                </p>
            </div>

            <div className="flex flex-col sm:flex-row flex-1">
                {/* Vertical tab sidebar */}
                <nav
                    className="flex sm:flex-col gap-1 p-3 flex-shrink-0 border-b sm:border-b-0 sm:border-r overflow-x-auto sm:overflow-x-visible"
                    style={{
                        width: undefined,
                        backgroundColor: 'var(--os-surface)',
                        borderColor: 'var(--os-border)',
                        minHeight: undefined,
                    }}
                >
                    {TABS.map(({ key, icon: Icon }) => (
                        <button
                            key={key}
                            onClick={() => setActiveTab(key)}
                            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-all"
                            style={{
                                backgroundColor: activeTab === key ? 'rgba(16,185,129,0.12)' : 'transparent',
                                color: activeTab === key ? '#10B981' : 'var(--os-text-muted)',
                                boxShadow: activeTab === key ? 'inset 2px 0 0 #10B981' : 'none',
                            }}
                        >
                            <Icon className="w-4 h-4 flex-shrink-0" />
                            {t(TAB_I18N_KEY[key] as Parameters<typeof t>[0])}
                        </button>
                    ))}
                </nav>

                {/* Content */}
                <div className="flex-1 p-4 sm:p-6 max-w-2xl">
                    {CONTENT[activeTab]}

                    {/* Data Export section */}
                    <div
                        className="mt-8 p-5 rounded-2xl flex flex-col gap-4"
                        style={{ backgroundColor: 'var(--os-surface)', border: '1px solid var(--os-border)' }}
                    >
                        <div>
                            <h3 className="text-sm font-bold" style={{ color: 'var(--os-text-primary)' }}>
                                Data Export
                            </h3>
                            <p className="text-xs mt-0.5" style={{ color: 'var(--os-text-muted)' }}>
                                Download a complete export of all your data including vessel records, transactions, invoices, and audit logs.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            <button
                                onClick={() => alert('Export request submitted. You will receive your data within 72 hours.')}
                                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors w-fit"
                                style={{ backgroundColor: 'var(--os-surface-2)', color: 'var(--os-text-secondary)', border: '1px solid var(--os-border)' }}
                            >
                                <Download className="w-4 h-4" />
                                Export My Data (CSV)
                            </button>
                            <button
                                onClick={() => alert('Export request submitted. You will receive your data within 72 hours.')}
                                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors w-fit"
                                style={{ backgroundColor: 'var(--os-surface-2)', color: 'var(--os-text-secondary)', border: '1px solid var(--os-border)' }}
                            >
                                <Download className="w-4 h-4" />
                                Export My Data (JSON)
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
