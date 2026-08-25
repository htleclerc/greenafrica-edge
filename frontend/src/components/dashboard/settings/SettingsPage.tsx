'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
    User, Shield, Bell, Globe, Monitor,
    Save, CheckCircle2, Eye,
    LogOut, Trash2, Download, Clock, Smartphone,
    Lock,
} from 'lucide-react';
import { useRole } from '@/lib/RoleContext';
import { SkinSwitcher } from '@/components/layout/SkinSwitcher';
import { ThemePreferencePicker } from '@/components/dashboard/settings/ThemePreferencePicker';
import { UserRole, OperationalSite } from '@/types/secure';
import { changePassword } from '@/actions/changePassword';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/passwordPolicy';
import { enrollMfa, verifyMfaEnrollment, unenrollMfa } from '@/actions/mfa';
import { revokeSession } from '@/actions/revokeSession';
import { updateOwnProfile, updateNotificationPrefs } from '@/actions/updateOwnProfile';
import { NOTIFICATION_PREF_KEYS, type NotificationPrefKey } from '@/lib/notificationPrefs';
import type { ProfileSettings } from '@/services/profileSettingsService';
import type { SecurityOverview } from '@/services/securityService';

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

// Les motifs rendus par l'action, traduits ici. Un motif inconnu retombe sur
// un message générique plutôt que d'afficher un identifiant technique.
const PASSWORD_ERROR: Record<string, string> = {
    wrong_current_password: 'settings_pwd_err_wrong_current',
    too_short:              'settings_pwd_err_too_short',
    unchanged:              'settings_pwd_err_unchanged',
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

function ComingSoonBanner({ t }: { t: ReturnType<typeof useTranslations<'DashboardPages'>> }) {
    return (
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold w-fit"
            style={{ backgroundColor: 'rgba(234,179,8,0.10)', color: 'var(--os-yellow)', border: '1px solid rgba(234,179,8,0.20)' }}>
            <Clock className="w-3.5 h-3.5" />
            {t('settings_coming_soon')}
        </div>
    );
}

function PreferencesSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
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

// ── Tabs content ──────────────────────────────────────────────────────────────

function ProfileTab({ profile }: { profile: ProfileSettings }) {
    const t = useTranslations('DashboardPages');
    const { user } = useRole();
    const router = useRouter();
    const [pending, startTransition] = React.useTransition();

    const [fullName, setFullName] = React.useState(profile.fullName || user.fullName);
    const [phone, setPhone] = React.useState(profile.phone ?? '');
    const [bio, setBio] = React.useState(profile.bio ?? '');
    const [timezone, setTimezone] = React.useState(profile.timezone);
    const [error, setError] = React.useState<string | null>(null);
    const [saved, setSaved] = React.useState(false);

    const initials = (fullName || user.fullName).split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);

    // L'identifiant technique ne se montre qu'à qui en fait quelque chose : le
    // support, pour rapprocher un compte d'une ligne de journal. Pour son
    // titulaire il n'est ni actionnable ni mémorisable, et il traîne dans les
    // captures d'écran qu'on envoie au support, justement.
    const showsUserId = user.role === UserRole.SUPERADMIN;

    function save() {
        setError(null);
        setSaved(false);
        startTransition(async () => {
            const r = await updateOwnProfile({ fullName, phone, bio, timezone });
            if (!r.ok) { setError(t('settings_err_generic')); return; }
            setSaved(true);
            router.refresh();
        });
    }

    return (
        <div className="flex flex-col gap-8">
            <Section title={t('settings_profile_photo')}>
                <div className="flex items-center gap-4">
                    <div
                        className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold flex-shrink-0"
                        style={{ backgroundColor: 'var(--os-brand-green)', color: 'var(--os-on-primary)' }}
                    >
                        {initials}
                    </div>
                    <p className="text-[11px]" style={{ color: 'var(--os-text-muted)' }}>
                        {t('settings_photo_initials')}
                    </p>
                </div>
            </Section>

            <Section title={t('settings_identity')} description={t('settings_identity_desc')}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <Field label={t('settings_full_name')}>
                        <Input value={fullName} onChange={setFullName} />
                    </Field>
                    {/* L'adresse reste en lecture : elle doit suivre auth.users, et le
                        verrou de la mig 140 la refuse de toute façon. */}
                    <Field label={t('settings_official_email')}>
                        <Input value={user.email} readOnly />
                    </Field>
                    <Field label={t('settings_phone')}>
                        <Input value={phone} onChange={setPhone} type="tel" />
                    </Field>
                    <Field label={t('settings_timezone')}>
                        <Input value={timezone} onChange={setTimezone} />
                    </Field>
                </div>
                <Field label={t('settings_bio')}>
                    <textarea
                        value={bio}
                        onChange={(e) => setBio(e.target.value.slice(0, 500))}
                        placeholder={t('settings_bio_placeholder')}
                        rows={3}
                        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none transition-all"
                        style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)', color: 'var(--os-text-primary)' }}
                    />
                </Field>

                {error && <p className="mt-3 text-xs" style={{ color: 'var(--os-red)' }}>{error}</p>}
                {saved && <p className="mt-3 text-xs text-emerald-400">{t('settings_saved')}</p>}

                <button
                    type="button"
                    onClick={save}
                    disabled={pending || fullName.trim().length < 2}
                    className="mt-4 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold w-fit disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ backgroundColor: 'var(--os-brand-green)', color: 'var(--os-on-primary)' }}
                >
                    <Save className="w-4 h-4" />
                    {t('settings_save')}
                </button>
            </Section>

            <Section title={t('settings_role_assignment')} description={t('settings_role_assignment_desc')}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <Field label={t('settings_role')}>
                        <div
                            className="flex items-center gap-2 h-10 px-3 rounded-xl text-sm"
                            style={{ backgroundColor: 'var(--os-bg)', border: '1px solid var(--os-border)', color: 'var(--os-brand-cyan)' }}
                        >
                            <Shield className="w-3.5 h-3.5 flex-shrink-0" />
                            {t(ROLE_I18N_KEY[user.role])}
                        </div>
                    </Field>
                    <Field label={t('settings_operational_site')}>
                        <Input value={t(SITE_I18N_KEY[user.operationalSite])} readOnly />
                    </Field>
                    {showsUserId && (
                        <Field label={t('settings_user_id')}>
                            <Input value={user.id} readOnly />
                        </Field>
                    )}
                    <Field label={t('settings_last_login')}>
                        <Input value={new Date(user.lastLogin).toLocaleString()} readOnly />
                    </Field>
                </div>
            </Section>
        </div>
    );
}

function NotificationsTab({ profile }: { profile: ProfileSettings }) {
    const t = useTranslations('DashboardPages');
    const router = useRouter();
    const [pending, startTransition] = React.useTransition();
    const [prefs, setPrefs] = React.useState(profile.notificationPrefs);
    const [error, setError] = React.useState<string | null>(null);

    function toggle(key: NotificationPrefKey, value: boolean) {
        const next = { ...prefs, [key]: value };
        setPrefs(next);
        setError(null);
        startTransition(async () => {
            const r = await updateNotificationPrefs({ prefs: next });
            if (!r.ok) {
                // Remettre la bascule comme elle était : la laisser dans sa
                // nouvelle position ferait croire au réglage enregistré.
                setPrefs(prefs);
                setError(t('settings_err_generic'));
                return;
            }
            router.refresh();
        });
    }

    const LABEL: Record<NotificationPrefKey, string> = {
        vessel_alert: t('settings_notif_vessel_alert'),
        payment_due: t('settings_notif_payment_due'),
        monthly_statement: t('settings_notif_monthly_statement'),
    };

    return (
        <div className="flex flex-col gap-6">
            <Section title={t('settings_notif_email')} description={t('settings_notif_email_desc')}>
                <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--os-border)' }}>
                    {NOTIFICATION_PREF_KEYS.map((key) => (
                        <div key={key} className="px-4" style={{ backgroundColor: 'var(--os-surface)' }}>
                            <Toggle
                                checked={prefs[key]}
                                onChange={(v) => !pending && toggle(key, v)}
                                label={LABEL[key]}
                            />
                        </div>
                    ))}
                </div>
                {error && <p className="mt-3 text-xs" style={{ color: 'var(--os-red)' }}>{error}</p>}
                {/* Dire ce que la page ne gouverne PAS vaut mieux que laisser
                    croire qu'on peut tout couper. */}
                <p className="mt-3 text-[11.5px]" style={{ color: 'var(--os-text-muted)' }}>
                    {t('settings_notif_always_sent')}
                </p>
            </Section>
        </div>
    );
}


function SecurityTab({ security }: { security: SecurityOverview }) {
    const t = useTranslations('DashboardPages');
    const router = useRouter();
    const [pending, startTransition] = React.useTransition();

    const [currentPassword, setCurrentPassword] = React.useState('');
    const [newPassword, setNewPassword] = React.useState('');
    const [confirmPassword, setConfirmPassword] = React.useState('');
    const [reveal, setReveal] = React.useState(false);
    const [pwdError, setPwdError] = React.useState<string | null>(null);
    const [pwdDone, setPwdDone] = React.useState(false);

    // Un enrôlement en cours n'est PAS une protection : le facteur reste non
    // vérifié tant que le code du téléphone n'a pas été confirmé.
    const [enrolling, setEnrolling] = React.useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
    const [code, setCode] = React.useState('');
    const [mfaError, setMfaError] = React.useState<string | null>(null);

    const factor = security.factors[0] ?? null;
    const otherSessions = security.sessions.filter((s) => !s.isCurrent).length;

    function submitPassword() {
        setPwdError(null);
        setPwdDone(false);
        if (newPassword !== confirmPassword) { setPwdError(t('settings_passwords_mismatch')); return; }
        startTransition(async () => {
            const r = await changePassword({ currentPassword, newPassword });
            if (!r.ok) { setPwdError(t(PASSWORD_ERROR[r.reason] ?? 'settings_err_generic')); return; }
            setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
            setPwdDone(true);
            router.refresh();
        });
    }

    function startEnrollment() {
        setMfaError(null);
        startTransition(async () => {
            const r = await enrollMfa();
            if (!r.ok) { setMfaError(t('settings_err_generic')); return; }
            setEnrolling({ factorId: r.factorId, qrCode: r.qrCode, secret: r.secret });
        });
    }

    function confirmEnrollment() {
        if (!enrolling) return;
        setMfaError(null);
        startTransition(async () => {
            const r = await verifyMfaEnrollment({ factorId: enrolling.factorId, code });
            if (!r.ok) { setMfaError(t('settings_mfa_err_invalid_code')); return; }
            setEnrolling(null); setCode('');
            router.refresh();
        });
    }

    function disableMfa() {
        if (!factor) return;
        setMfaError(null);
        startTransition(async () => {
            const r = await unenrollMfa({ factorId: factor.id });
            if (!r.ok) { setMfaError(t('settings_err_generic')); return; }
            router.refresh();
        });
    }

    function closeOtherSessions() {
        startTransition(async () => {
            for (const s of security.sessions.filter((x) => !x.isCurrent)) {
                await revokeSession({ sessionId: s.id });
            }
            router.refresh();
        });
    }

    return (
        <div className="flex flex-col gap-8">
            <Section title={t('settings_change_password')} description={t('settings_change_password_desc')}>
                <div className="flex flex-col gap-4 max-w-sm">
                    <Field label={t('settings_current_password')}>
                        <div className="relative">
                            <Input value={currentPassword} onChange={setCurrentPassword} type={reveal ? 'text' : 'password'} />
                            <button
                                type="button"
                                onClick={() => setReveal((v) => !v)}
                                aria-label={t('settings_password_reveal')}
                                className="absolute right-3 top-1/2 -translate-y-1/2"
                                style={{ color: 'var(--os-text-muted)' }}
                            >
                                <Eye className="w-4 h-4" />
                            </button>
                        </div>
                    </Field>
                    <Field label={t('settings_new_password')}>
                        <Input value={newPassword} onChange={setNewPassword} type={reveal ? 'text' : 'password'} />
                    </Field>
                    <Field label={t('settings_confirm_password')}>
                        <Input value={confirmPassword} onChange={setConfirmPassword} type={reveal ? 'text' : 'password'} />
                    </Field>

                    {pwdError && <p className="text-xs" style={{ color: '#EF4444' }}>{pwdError}</p>}
                    {pwdDone && <p className="text-xs text-emerald-400">{t('settings_password_changed')}</p>}

                    <button
                        type="button"
                        onClick={submitPassword}
                        disabled={pending || !currentPassword || newPassword.length < MIN_PASSWORD_LENGTH}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold w-fit disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: 'var(--os-brand-green)', color: 'var(--os-on-primary)' }}
                    >
                        <Lock className="w-4 h-4" />
                        {t('settings_password_save')}
                    </button>
                </div>
            </Section>

            <Section title={t('settings_mfa_title')} description={t('settings_mfa_desc')}>
                {factor ? (
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-3 p-3 rounded-xl" style={{ backgroundColor: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}>
                            <Smartphone className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                            <div>
                                <p className="text-xs font-semibold text-emerald-400">{t('settings_mfa_enabled')}</p>
                                <p className="text-[11px]" style={{ color: 'var(--os-text-muted)' }}>
                                    {t('settings_mfa_since', { date: new Date(factor.enrolledAt).toLocaleDateString() })}
                                </p>
                            </div>
                        </div>
                        {mfaError && <p className="text-xs" style={{ color: '#EF4444' }}>{mfaError}</p>}
                        <button
                            type="button"
                            onClick={disableMfa}
                            disabled={pending}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold w-fit disabled:opacity-50"
                            style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}
                        >
                            {t('settings_mfa_disable')}
                        </button>
                    </div>
                ) : enrolling ? (
                    <div className="flex flex-col gap-4 max-w-sm">
                        <p className="text-xs" style={{ color: 'var(--os-text-muted)' }}>{t('settings_mfa_scan')}</p>
                        {/* SVG rendu par GoTrue : le secret ne passe par aucun service tiers. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={enrolling.qrCode} alt={t('settings_mfa_scan')} className="w-44 h-44 rounded-xl bg-white p-2" />
                        <Field label={t('settings_mfa_secret')}>
                            <p className="font-mono text-xs break-all px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--os-surface-2)', color: 'var(--os-text-secondary)' }}>
                                {enrolling.secret}
                            </p>
                        </Field>
                        <Field label={t('settings_mfa_code')}>
                            <Input value={code} onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} />
                        </Field>
                        {mfaError && <p className="text-xs" style={{ color: '#EF4444' }}>{mfaError}</p>}
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={confirmEnrollment}
                                disabled={pending || code.length !== 6}
                                className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                                style={{ backgroundColor: 'var(--os-brand-green)', color: 'var(--os-on-primary)' }}
                            >
                                {t('settings_mfa_confirm')}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setEnrolling(null); setCode(''); setMfaError(null); }}
                                className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                                style={{ color: 'var(--os-text-muted)', border: '1px solid var(--os-border)' }}
                            >
                                {t('settings_mfa_cancel')}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <p className="text-xs" style={{ color: 'var(--os-text-muted)' }}>{t('settings_mfa_none')}</p>
                        {mfaError && <p className="text-xs" style={{ color: '#EF4444' }}>{mfaError}</p>}
                        <button
                            type="button"
                            onClick={startEnrollment}
                            disabled={pending}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold w-fit disabled:opacity-50"
                            style={{ backgroundColor: 'var(--os-brand-green)', color: 'var(--os-on-primary)' }}
                        >
                            <Shield className="w-4 h-4" />
                            {t('settings_mfa_enable')}
                        </button>
                    </div>
                )}
            </Section>

            <Section title={t('settings_danger_zone')} description={t('settings_danger_zone_desc')}>
                <div className="flex flex-col gap-3">
                    <button
                        type="button"
                        onClick={closeOtherSessions}
                        disabled={pending || otherSessions === 0}
                        className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold w-fit disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}
                    >
                        <LogOut className="w-4 h-4" />
                        {t('settings_disconnect_sessions')}
                    </button>
                    <button
                        disabled
                        title={t('settings_deletion_unavailable')}
                        className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold w-fit disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}
                    >
                        <Trash2 className="w-4 h-4" />
                        {t('settings_request_deletion')}
                    </button>
                </div>
            </Section>
        </div>
    );
}



function PreferencesTab() {
    const t = useTranslations('DashboardPages');
    const { user } = useRole();
    const [lang, setLang]         = React.useState<string>(user.preferredLanguage);
    const [dateFormat, setDateFmt] = React.useState('DD/MM/YYYY');
    const [currency, setCurrency] = React.useState('USD');
    const [density]               = React.useState('comfortable');

    return (
        <div className="flex flex-col gap-8">
            <Section title={t('settings_lang_region')}>
                <ComingSoonBanner t={t} />
                <div className="pointer-events-none opacity-60">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        <Field label={t('settings_interface_language')}>
                            <PreferencesSelect value={lang} onChange={setLang} options={[
                                { value: 'fr', label: 'Français' },
                                { value: 'so', label: 'Soomaali' },
                                { value: 'en', label: 'English' },
                                { value: 'pt', label: 'Português' },
                                { value: 'sw', label: 'Kiswahili' },
                                { value: 'ar', label: 'العربية' },
                            ]} />
                        </Field>
                        <Field label={t('settings_date_format')}>
                            <PreferencesSelect value={dateFormat} onChange={setDateFmt} options={[
                                { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (Europe)' },
                                { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (US)' },
                                { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (ISO)' },
                            ]} />
                        </Field>
                        <Field label={t('settings_display_currency')}>
                            <PreferencesSelect value={currency} onChange={setCurrency} options={[
                                { value: 'USD', label: 'USD — Dollar américain' },
                                { value: 'EUR', label: 'EUR — Euro' },
                                { value: 'SOS', label: 'SOS — Shilling somalien' },
                            ]} />
                        </Field>
                    </div>
                </div>
            </Section>

            <Section title={t('settings_display')} description={t('settings_display_desc')}>
                <ComingSoonBanner t={t} />
                <div className="pointer-events-none opacity-60">
                    <div className="flex gap-3">
                        {(['compact', 'comfortable', 'spacious'] as const).map((d) => (
                            <button
                                key={d}
                                disabled
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
                </div>
            </Section>

            <Section title={t('settings_theme_mode')} description={t('settings_theme_mode_desc')}>
                <ThemePreferencePicker />
            </Section>

            <Section title={t('settings_visual_theme')} description={t('settings_visual_theme_desc')}>
                <SkinSwitcher variant="settings" />
            </Section>

            <Section title={t('settings_data_export')} description={t('settings_data_export_desc')}>
                <button
                    disabled
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors w-fit disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ backgroundColor: 'var(--os-surface-2)', color: 'var(--os-text-secondary)', border: '1px solid var(--os-border)' }}
                >
                    <Download className="w-4 h-4" />
                    {t('settings_export_json')}
                </button>
            </Section>
        </div>
    );
}

/**
 * Décrit un appareil à partir de son en-tête `User-Agent`.
 *
 * Volontairement grossier : deux familles suffisent à reconnaître « ce n'est
 * pas moi ». Une chaîne inconnue est rendue telle quelle plutôt que devinée —
 * mieux vaut un libellé brut qu'un appareil inventé sur un écran de sécurité.
 */
export function describeDevice(ua: string | null): string {
    if (!ua) return '';
    const browser =
        /Edg\//.test(ua) ? 'Edge'
        : /OPR\//.test(ua) ? 'Opera'
        : /Chrome\//.test(ua) ? 'Chrome'
        : /Firefox\//.test(ua) ? 'Firefox'
        : /Safari\//.test(ua) ? 'Safari'
        : null;
    const os =
        /Windows NT/.test(ua) ? 'Windows'
        : /Android/.test(ua) ? 'Android'
        : /(iPhone|iPad|iOS)/.test(ua) ? 'iOS'
        : /Mac OS X/.test(ua) ? 'macOS'
        : /Linux/.test(ua) ? 'Linux'
        : null;
    if (!browser && !os) return ua;
    return [browser, os].filter(Boolean).join(' — ');
}

function SessionsTab({ security }: { security: SecurityOverview }) {
    const t = useTranslations('DashboardPages');
    const router = useRouter();
    const [pending, startTransition] = React.useTransition();
    const [error, setError] = React.useState<string | null>(null);

    function revoke(id: string) {
        setError(null);
        startTransition(async () => {
            const r = await revokeSession({ sessionId: id });
            if (!r.ok) { setError(t('settings_err_generic')); return; }
            router.refresh();
        });
    }

    return (
        <div className="flex flex-col gap-6">
            <Section title={t('settings_sessions_title')} description={t('settings_sessions_desc')}>
                {security.sessions.length === 0 ? (
                    <p className="text-sm" style={{ color: 'var(--os-text-muted)' }}>{t('settings_sessions_empty')}</p>
                ) : (
                    <div className="flex flex-col gap-3">
                        {security.sessions.map((s) => {
                            const device = describeDevice(s.userAgent) || t('settings_session_unknown_device');
                            return (
                                <div
                                    key={s.id}
                                    className="flex items-center gap-4 px-4 py-3.5 rounded-xl"
                                    style={{
                                        backgroundColor: s.isCurrent ? 'rgba(16,185,129,0.06)' : 'var(--os-surface)',
                                        border: s.isCurrent ? '1px solid rgba(16,185,129,0.2)' : '1px solid var(--os-border)',
                                    }}
                                >
                                    <Monitor className="w-5 h-5 flex-shrink-0" style={{ color: s.isCurrent ? '#10B981' : 'var(--os-text-muted)' }} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="text-sm font-semibold truncate" style={{ color: 'var(--os-text-primary)' }}>{device}</p>
                                            {s.isCurrent && (
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-emerald-400" style={{ backgroundColor: 'rgba(16,185,129,0.1)' }}>
                                                    {t('settings_current_session')}
                                                </span>
                                            )}
                                            {/* Une session qui a franchi le second facteur n'a pas la même
                                                valeur qu'une autre : c'est ce qu'on cherche en cas de doute. */}
                                            {s.elevated && (
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(37,99,235,0.10)', color: 'var(--os-blue)' }}>
                                                    {t('settings_session_elevated')}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs" style={{ color: 'var(--os-text-muted)' }}>
                                            {s.ip && <span className="flex items-center gap-1"><Lock className="w-3 h-3" />{s.ip}</span>}
                                            {s.lastSeenAt && (
                                                <span className="flex items-center gap-1">
                                                    <Clock className="w-3 h-3" />
                                                    {new Date(s.lastSeenAt).toLocaleString()}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    {!s.isCurrent && (
                                        <button
                                            type="button"
                                            onClick={() => revoke(s.id)}
                                            disabled={pending}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0 disabled:opacity-50"
                                            style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.2)' }}
                                        >
                                            <LogOut className="w-3.5 h-3.5" />
                                            {t('settings_revoke')}
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
                {error && <p className="mt-3 text-xs" style={{ color: '#EF4444' }}>{error}</p>}
            </Section>
        </div>
    );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function SettingsPage({ security, profile }: {
    security: SecurityOverview;
    profile: ProfileSettings;
}) {
    const t = useTranslations('DashboardPages');
    const [activeTab, setActiveTab] = React.useState<TabKey>('profile');

    const CONTENT: Record<TabKey, React.ReactNode> = {
        profile:       <ProfileTab profile={profile} />,
        security:      <SecurityTab security={security} />,
        notifications: <NotificationsTab profile={profile} />,
        preferences:   <PreferencesTab />,
        sessions:      <SessionsTab security={security} />,
    };

    return (
        <div className="flex flex-col gap-0 min-h-[calc(100vh-5.5rem)]">
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
                    className="flex sm:flex-col gap-1 p-3 flex-shrink-0 border-b sm:border-b-0 sm:border-r overflow-x-auto sm:overflow-x-visible sm:h-auto sm:self-stretch"
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
                </div>
            </div>
        </div>
    );
}
