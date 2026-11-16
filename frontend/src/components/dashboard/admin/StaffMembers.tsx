'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { OsBadge } from '@/components/ui/OsBadge';
import { OsButton } from '@/components/ui/OsButton';
import { removeStaffFromJurisdiction } from '@/actions/removeStaffFromJurisdiction';
import { setJurisdictionAdmin } from '@/actions/setJurisdictionAdmin';

export interface StaffMember {
    userId: string;
    fullName: string | null;
    email: string | null;
    role: string;
    isActive: boolean;
    isAdmin: boolean;
}

export interface StaffCountryGroup {
    jurisdictionId: string;
    code: string;
    name: string;
    members: StaffMember[];
}

interface StaffMembersProps {
    groups: StaffCountryGroup[];
    currentUserId: string;
    /** Vrai pour l'administrateur général : lui seul donne et retire l'administration d'un pays. */
    canGrantAdmin: boolean;
}

type Feedback = { tone: 'ok' | 'error'; text: string };

const ERROR_KEYS = {
    forbidden: 'err_forbidden',
    self: 'err_self',
    not_found: 'err_not_found',
    not_staff: 'err_not_staff',
    not_authenticated: 'err_forbidden',
    invalid_input: 'err_failed',
    failed: 'err_failed',
} as const;

/**
 * Le personnel de chaque pays administré, avec les deux gestes de
 * l'administration : retirer quelqu'un d'un pays, et — pour l'administrateur
 * général — donner ou retirer le droit d'administrer ce pays.
 *
 * Les boutons ne font que proposer : chaque action revérifie le droit côté
 * serveur. Le retrait demande une confirmation sur place, sans fenêtre
 * surgissante.
 */
export function StaffMembers({ groups, currentUserId, canGrantAdmin }: StaffMembersProps) {
    const t = useTranslations('AdminStaff');
    const router = useRouter();
    const [pendingKey, setPendingKey] = React.useState<string | null>(null);
    const [confirmKey, setConfirmKey] = React.useState<string | null>(null);
    const [feedback, setFeedback] = React.useState<Feedback | null>(null);

    async function remove(jurisdictionId: string, member: StaffMember, key: string) {
        setPendingKey(key);
        setFeedback(null);
        try {
            const res = await removeStaffFromJurisdiction({ userId: member.userId, jurisdictionId });
            if (res.ok) {
                setFeedback({ tone: 'ok', text: t('removed_ok') });
                router.refresh();
            } else {
                setFeedback({ tone: 'error', text: t(ERROR_KEYS[res.reason]) });
            }
        } catch {
            setFeedback({ tone: 'error', text: t('err_failed') });
        } finally {
            setPendingKey(null);
            setConfirmKey(null);
        }
    }

    async function toggleAdmin(jurisdictionId: string, member: StaffMember, key: string) {
        setPendingKey(key);
        setFeedback(null);
        try {
            const res = await setJurisdictionAdmin({
                userId: member.userId,
                jurisdictionId,
                isAdmin: !member.isAdmin,
            });
            if (res.ok) {
                router.refresh();
            } else {
                setFeedback({ tone: 'error', text: t(ERROR_KEYS[res.reason]) });
            }
        } catch {
            setFeedback({ tone: 'error', text: t('err_failed') });
        } finally {
            setPendingKey(null);
        }
    }

    return (
        <section className="mt-8">
            <h2 className="text-sm font-semibold text-[var(--os-text-primary)]">{t('members_title')}</h2>
            <p className="text-xs text-[var(--os-text-muted)] mt-1 mb-3 max-w-2xl leading-relaxed">
                {t('members_subtitle')}
            </p>

            <p
                role="status"
                aria-live="polite"
                className={`text-xs mb-2 min-h-[1rem] ${feedback?.tone === 'error' ? 'text-[#EF4444]' : 'text-[#00D97E]'}`}
            >
                {feedback?.text ?? ''}
            </p>

            <div className="flex flex-col gap-6">
                {groups.map((group) => (
                    <div key={group.jurisdictionId}>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--os-text-secondary)] mb-2">
                            {group.name}
                            <span className="ml-2 font-mono text-[var(--os-text-muted)]">{group.code}</span>
                        </h3>

                        {group.members.length === 0 ? (
                            <p className="text-xs text-[var(--os-text-muted)]">{t('members_empty')}</p>
                        ) : (
                            <div className="rounded-xl border border-[var(--os-border)] overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-[var(--os-surface-2)] text-[10px] uppercase tracking-widest text-[var(--os-text-muted)]">
                                            <th scope="col" className="text-left font-semibold px-3 py-2">{t('col_person')}</th>
                                            <th scope="col" className="text-left font-semibold px-3 py-2">{t('col_role')}</th>
                                            <th scope="col" className="text-right font-semibold px-3 py-2">{t('col_actions')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {group.members.map((member) => {
                                            const key = `${group.jurisdictionId}:${member.userId}`;
                                            const isSelf = member.userId === currentUserId;
                                            const busy = pendingKey === key;
                                            // Un administrateur de pays ne retire ni lui-même ni un pair.
                                            const canRemove = !isSelf && (canGrantAdmin || !member.isAdmin);
                                            return (
                                                <tr key={key} className="border-t border-[var(--os-border)]">
                                                    <td className="px-3 py-2">
                                                        <span className="text-[var(--os-text-primary)]">
                                                            {member.fullName ?? '—'}
                                                        </span>
                                                        <span className="block text-[11px] text-[var(--os-text-muted)]">
                                                            {member.email ?? '—'}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <div className="flex flex-wrap items-center gap-1.5">
                                                            <OsBadge variant="info" label={member.role} />
                                                            {member.isAdmin && <OsBadge variant="active" label={t('badge_admin')} />}
                                                            {!member.isActive && <OsBadge variant="warning" label={t('badge_inactive')} />}
                                                            {isSelf && <OsBadge variant="draft" label={t('badge_you')} />}
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <div className="flex flex-wrap items-center justify-end gap-2">
                                                            {canGrantAdmin && (
                                                                <OsButton
                                                                    type="button"
                                                                    variant="secondary"
                                                                    size="sm"
                                                                    disabled={busy}
                                                                    onClick={() => toggleAdmin(group.jurisdictionId, member, key)}
                                                                >
                                                                    {t(member.isAdmin ? 'btn_revoke_admin' : 'btn_make_admin')}
                                                                </OsButton>
                                                            )}
                                                            {canRemove && confirmKey !== key && (
                                                                <OsButton
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    disabled={busy}
                                                                    onClick={() => setConfirmKey(key)}
                                                                >
                                                                    {t('btn_remove')}
                                                                </OsButton>
                                                            )}
                                                            {canRemove && confirmKey === key && (
                                                                <>
                                                                    <OsButton
                                                                        type="button"
                                                                        variant="danger"
                                                                        size="sm"
                                                                        loading={busy}
                                                                        disabled={busy}
                                                                        onClick={() => remove(group.jurisdictionId, member, key)}
                                                                    >
                                                                        {t('btn_confirm_remove')}
                                                                    </OsButton>
                                                                    <OsButton
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        disabled={busy}
                                                                        onClick={() => setConfirmKey(null)}
                                                                    >
                                                                        {t('btn_cancel')}
                                                                    </OsButton>
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </section>
    );
}
