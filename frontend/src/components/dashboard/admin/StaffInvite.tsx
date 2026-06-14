'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput, OsSelect } from '@/components/ui/OsInput';
import { inviteStaff, type InviteStaffResult } from '@/actions/inviteStaff';

interface Jurisdiction {
    id: string;
    name: string;
    code: string;
}

interface StaffInviteProps {
    jurisdictions: Jurisdiction[];
}

export function StaffInvite({ jurisdictions }: StaffInviteProps) {
    const t = useTranslations('AdminStaff');

    const [email, setEmail] = React.useState('');
    const [fullName, setFullName] = React.useState('');
    const [role, setRole] = React.useState('');
    const [selectedJurisdictions, setSelectedJurisdictions] = React.useState<string[]>([]);
    const [submitting, setSubmitting] = React.useState(false);
    const [result, setResult] = React.useState<InviteStaffResult | null>(null);

    const roleOptions = [
        { value: 'PORT_OFFICER',  label: t('role_port_officer') },
        { value: 'FINANCE_ADMIN', label: t('role_finance_admin') },
        { value: 'MANAGER',       label: t('role_manager') },
    ];

    function toggleJurisdiction(id: string) {
        setSelectedJurisdictions((prev) =>
            prev.includes(id) ? prev.filter((j) => j !== id) : [...prev, id],
        );
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setResult(null);
        setSubmitting(true);
        try {
            const res = await inviteStaff({
                email,
                fullName,
                role,
                jurisdictionIds: selectedJurisdictions,
            });
            setResult(res);
            if (res.ok) {
                setEmail('');
                setFullName('');
                setRole('');
                setSelectedJurisdictions([]);
            }
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div
            className="rounded-2xl p-6 max-w-lg"
            style={{ backgroundColor: 'var(--os-surface)', border: '1px solid var(--os-border)' }}
        >
            <h2
                className="text-base font-semibold mb-5"
                style={{ color: 'var(--os-text-primary)' }}
            >
                {t('form_title')}
            </h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <OsInput
                    label={t('label_email')}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('placeholder_email')}
                    required
                />

                <OsInput
                    label={t('label_full_name')}
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={t('placeholder_full_name')}
                    required
                />

                <OsSelect
                    label={t('label_role')}
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    options={roleOptions}
                    placeholder="—"
                    required
                />

                {/* Multi-jurisdiction selector */}
                <div className="flex flex-col gap-1.5">
                    <span
                        className="text-xs font-medium uppercase tracking-wider"
                        style={{ color: 'var(--os-text-secondary)' }}
                    >
                        {t('label_jurisdictions')}
                    </span>
                    <div className="flex flex-col gap-2">
                        {jurisdictions.map((j) => (
                            <label
                                key={j.id}
                                className="flex items-center gap-3 px-4 py-2.5 rounded-xl cursor-pointer transition-colors"
                                style={{
                                    backgroundColor: selectedJurisdictions.includes(j.id)
                                        ? 'rgba(0,217,126,0.08)'
                                        : 'var(--os-surface-2)',
                                    border: selectedJurisdictions.includes(j.id)
                                        ? '1px solid rgba(0,217,126,0.35)'
                                        : '1px solid var(--os-border)',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    className="accent-[#00D97E]"
                                    checked={selectedJurisdictions.includes(j.id)}
                                    onChange={() => toggleJurisdiction(j.id)}
                                />
                                <span
                                    className="text-sm"
                                    style={{ color: 'var(--os-text-primary)' }}
                                >
                                    {j.name}
                                    <span
                                        className="ml-2 text-xs font-mono"
                                        style={{ color: 'var(--os-text-muted)' }}
                                    >
                                        {j.code}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </div>
                </div>

                <OsButton
                    type="submit"
                    loading={submitting}
                    disabled={submitting || selectedJurisdictions.length === 0 || !role}
                    className="w-full mt-1"
                >
                    {submitting ? t('btn_sending') : t('btn_invite')}
                </OsButton>
            </form>

            {/* Result feedback */}
            {result && (
                <div
                    className="mt-4 px-4 py-3 rounded-xl text-sm"
                    style={{
                        backgroundColor: result.ok ? 'rgba(0,217,126,0.08)' : 'rgba(239,68,68,0.08)',
                        border: result.ok
                            ? '1px solid rgba(0,217,126,0.25)'
                            : '1px solid rgba(239,68,68,0.25)',
                        color: result.ok ? '#00D97E' : '#EF4444',
                    }}
                >
                    {result.ok
                        ? result.alreadyExisted
                            ? t('success_existing', { email })
                            : t('success_new', { email })
                        : `${t('error_prefix')}${result.reason}`}
                </div>
            )}
        </div>
    );
}
