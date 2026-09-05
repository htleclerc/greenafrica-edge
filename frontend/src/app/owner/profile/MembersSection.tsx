'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { UserPlus, X } from 'lucide-react';
import { OsCard, OsCardHeader } from '@/components/ui/OsCard';
import { OsInput } from '@/components/ui/OsInput';
import { OsButton } from '@/components/ui/OsButton';
import { inviteOwnerMember } from '@/actions/inviteOwnerMember';
import { revokeOwnerMember } from '@/actions/revokeOwnerMember';
import {
    clampToGranter, DEFAULT_INVITE_PRIVILEGES, PRIVILEGE_KEYS, type OwnerPrivileges, type PrivilegeKey,
} from '@/lib/auth/ownerPrivileges';
import type { OwnerMemberView } from '@/services/ownerMembersService';

interface Props {
    members: OwnerMemberView[];
    /** Ce que l'utilisateur courant détient — il ne peut pas accorder au-delà. */
    granterPrivileges: OwnerPrivileges;
    /** Faux pour un membre : l'écran le dit, plutôt que de le laisser essayer. */
    canInvite: boolean;
}

/**
 * Gestion des membres du compte.
 *
 * Les cases que l'invitant ne détient pas sont **désactivées**, pas seulement
 * ignorées : `clampToGranter` les retirerait côté serveur, et laisser cocher
 * une case sans effet ferait croire à un droit accordé.
 */
export function MembersSection({ members, granterPrivileges, canInvite }: Props) {
    const t = useTranslations('OwnerProfile.members');
    const router = useRouter();

    const [email, setEmail] = React.useState('');
    const [fullName, setFullName] = React.useState('');
    // « Payer » est pré-coché (mig 148) — mais jamais au-delà de ce que
    // l'invitant détient : une case cochée et grisée annoncerait un droit que
    // le serveur retirerait.
    const initialPrivileges = React.useMemo(
        () => clampToGranter(DEFAULT_INVITE_PRIVILEGES, granterPrivileges),
        [granterPrivileges],
    );
    const [privileges, setPrivileges] = React.useState<OwnerPrivileges>(initialPrivileges);
    const [error, setError] = React.useState<string | null>(null);
    const [pending, startTransition] = React.useTransition();

    const active = members.filter((m) => m.active);
    const revoked = members.filter((m) => !m.active);

    function submit() {
        setError(null);
        startTransition(async () => {
            const result = await inviteOwnerMember({ email, fullName, privileges });
            if (!result.ok) { setError(t(`errors.${result.reason}`, { fallbackReason: result.reason })); return; }
            setEmail('');
            setFullName('');
            setPrivileges(initialPrivileges);
            router.refresh();
        });
    }

    function revoke(memberId: string) {
        setError(null);
        startTransition(async () => {
            const result = await revokeOwnerMember({ memberId });
            if (!result.ok) { setError(t(`errors.${result.reason}`, { fallbackReason: result.reason })); return; }
            router.refresh();
        });
    }

    return (
        <OsCard>
            <OsCardHeader title={t('title')} subtitle={t('subtitle')} />

            {!canInvite && (
                <p className="mb-4 rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)] px-3 py-2 text-xs text-[var(--os-text-secondary)]">
                    {t('readOnlyNotice')}
                </p>
            )}

            {active.length > 0 ? (
                <ul className="mb-4 flex flex-col gap-2">
                    {active.map((m) => (
                        <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)] px-3 py-2.5">
                            <span className="flex min-w-0 flex-col gap-1">
                                <span className="truncate text-[13px] font-semibold text-[var(--os-text-primary)]">
                                    {m.fullName ?? m.email}
                                </span>
                                <span className="truncate font-mono text-[11.5px] text-[var(--os-text-muted)]">{m.email}</span>
                                <span className="flex flex-wrap gap-1.5">
                                    {PRIVILEGE_KEYS.filter((k) => m.privileges[k]).map((k) => (
                                        <span key={k} className="rounded-md bg-[var(--os-brand-green)]/10 px-2 py-0.5 text-[11px] text-[var(--os-brand-cyan)]">
                                            {t(`privilege.${k}`)}
                                        </span>
                                    ))}
                                    {PRIVILEGE_KEYS.every((k) => !m.privileges[k]) && (
                                        <span className="text-[11px] text-[var(--os-text-muted)]">{t('privilege.none')}</span>
                                    )}
                                </span>
                            </span>
                            {canInvite && (
                                <button
                                    type="button"
                                    onClick={() => revoke(m.id)}
                                    disabled={pending}
                                    aria-label={t('revoke', { email: m.email })}
                                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--os-text-muted)] transition-colors duration-150 hover:bg-[var(--os-surface-3)] hover:text-[var(--os-red)] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]"
                                >
                                    <X className="size-4" aria-hidden />
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="mb-4 text-[12.5px] text-[var(--os-text-muted)]">{t('empty')}</p>
            )}

            {canInvite && (
                <div className="flex flex-col gap-3 border-t border-[var(--os-border)] pt-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <OsInput label={t('form.fullName')} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Amina Haji" />
                        <OsInput label={t('form.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="compta@exemple.com" />
                    </div>

                    <fieldset className="flex flex-col gap-2">
                        <legend className="mb-1 text-[12.5px] font-semibold text-[var(--os-text-primary)]">
                            {t('form.privileges')}
                        </legend>
                        <p className="mb-1 text-[11.5px] text-[var(--os-text-muted)]">{t('form.payDefault')}</p>
                        <div className="flex flex-wrap gap-2">
                            {PRIVILEGE_KEYS.map((key: PrivilegeKey) => {
                                // Ce que l'invitant ne détient pas ne peut pas être accordé.
                                const available = granterPrivileges[key];
                                return (
                                    <label
                                        key={key}
                                        title={available ? undefined : t('form.notYours')}
                                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] ${
                                            available
                                                ? 'cursor-pointer border-[var(--os-border)] text-[var(--os-text-secondary)] hover:bg-[var(--os-surface-2)]'
                                                : 'cursor-not-allowed border-[var(--os-border)] text-[var(--os-text-muted)] opacity-50'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={privileges[key]}
                                            disabled={!available || pending}
                                            onChange={(e) => setPrivileges((p) => ({ ...p, [key]: e.target.checked }))}
                                            className="size-4 accent-[var(--os-brand-green)]"
                                        />
                                        {t(`privilege.${key}`)}
                                    </label>
                                );
                            })}
                        </div>
                    </fieldset>

                    {error && <p className="text-xs text-[var(--os-red)]">{error}</p>}

                    <OsButton
                        variant="primary"
                        icon={<UserPlus className="size-4" />}
                        onClick={submit}
                        disabled={pending || !email.trim() || fullName.trim().length < 2}
                        className="self-start"
                    >
                        {t('form.submit')}
                    </OsButton>
                </div>
            )}

            {revoked.length > 0 && (
                <div className="mt-4 border-t border-[var(--os-border)] pt-3">
                    <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--os-text-muted)]">
                        {t('revokedTitle')}
                    </h3>
                    <ul className="flex flex-col gap-1">
                        {revoked.map((m) => (
                            <li key={m.id} className="flex items-baseline justify-between gap-3 text-[11.5px] text-[var(--os-text-muted)]">
                                <span className="truncate font-mono">{m.email}</span>
                                <span className="shrink-0">
                                    {m.revokedAt ? t('revokedOn', { date: new Date(m.revokedAt).toLocaleDateString() }) : ''}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </OsCard>
    );
}
