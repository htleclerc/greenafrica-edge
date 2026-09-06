'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { OsInput, OsSelect } from '@/components/ui/OsInput';
import { OsFilterTabs } from '@/components/ui/OsFilterTabs';
import { OsGridTable, type OsGridColumn } from '@/components/ui/OsGridTable';
import { OsBadge } from '@/components/ui/OsBadge';
import { requestLoginLink } from '@/actions/requestLoginLink';
import { PRIVILEGE_KEYS } from '@/lib/auth/ownerPrivileges';
import { matchesUserSearch, type PlatformUser, type PlatformUserKind } from '@/services/platformUsersService';

type KindTab = 'ALL' | PlatformUserKind;
const KIND_TABS: KindTab[] = ['ALL', 'OWNER', 'MEMBER', 'REPRESENTATIVE', 'STAFF'];
type StateFilter = 'all' | 'active' | 'inactive' | 'dormant';

const KIND_BADGE: Record<PlatformUserKind, 'info' | 'active' | 'warning' | 'archived'> = {
    OWNER: 'active', MEMBER: 'info', REPRESENTATIVE: 'warning', STAFF: 'archived',
};

/** Un accès qui n'a pas servi depuis 90 jours est dormant : il mérite un regard. */
const DORMANT_DAYS = 90;

function isDormant(u: PlatformUser, now: number): boolean {
    if (!u.active) return false;
    if (!u.lastSignInAt) return true;
    return now - new Date(u.lastSignInAt).getTime() > DORMANT_DAYS * 86_400_000;
}

/**
 * Annuaire des personnes. Une ligne = une personne sur un compte : un
 * représentant de deux armateurs apparaît deux fois, c'est voulu — l'accès
 * se juge par compte.
 *
 * Trois gestes : voir le compte comme cette personne (lecture seule, §2 du
 * plan), lui envoyer un accès (le chemin de connexion public, réponse
 * invariable), ouvrir le dossier.
 */
export function UsersDirectory({ users, canViewAs }: { users: PlatformUser[]; canViewAs: boolean }) {
    const t = useTranslations('AdminUsers');
    const [search, setSearch] = React.useState('');
    const [kind, setKind] = React.useState<KindTab>('ALL');
    const [state, setState] = React.useState<StateFilter>('all');
    const [sent, setSent] = React.useState<Record<string, 'sending' | 'sent'>>({});
    // Figé au premier rendu : « dormant » ne doit pas changer d'avis à chaque re-rendu.
    const [now] = React.useState(() => Date.now());

    const hasStaff = users.some((u) => u.kind === 'STAFF');
    const tabs = KIND_TABS.filter((k) => k !== 'STAFF' || hasStaff);

    const visible = React.useMemo(() => users.filter((u) => {
        if (kind !== 'ALL' && u.kind !== kind) return false;
        if (state === 'active' && !u.active) return false;
        if (state === 'inactive' && u.active) return false;
        if (state === 'dormant' && !isDormant(u, now)) return false;
        return matchesUserSearch(u, search);
    }), [users, kind, state, search, now]);

    const counts = React.useMemo(() => {
        const c: Record<KindTab, number> = { ALL: users.length, OWNER: 0, MEMBER: 0, REPRESENTATIVE: 0, STAFF: 0 };
        for (const u of users) c[u.kind] += 1;
        return c;
    }, [users]);

    async function sendAccess(u: PlatformUser) {
        if (!u.email || sent[u.key]) return;
        setSent((s) => ({ ...s, [u.key]: 'sending' }));
        // Réponse volontairement invariable côté serveur : l'écran dit « envoyé
        // si l'adresse est admise », jamais plus.
        await requestLoginLink({ query: u.email });
        setSent((s) => ({ ...s, [u.key]: 'sent' }));
    }

    function viewAsHref(u: PlatformUser): string | null {
        if (!canViewAs || !u.ownerRef) return null;
        const base = `/admin/armateurs/${u.ownerRef}/portail`;
        if (u.kind === 'MEMBER' && u.memberRef) return `${base}?as=${u.memberRef}`;
        if (u.kind === 'OWNER') return base;
        return null;
    }

    const columns: OsGridColumn<PlatformUser>[] = [
        {
            key: 'person', header: t('col.person'), width: '1.6fr', primary: true,
            render: (u) => (
                <span className="flex min-w-0 flex-col gap-px">
                    <span className="truncate text-[13.5px] font-semibold text-[var(--os-text-primary)]">{u.fullName ?? '—'}</span>
                    <span className="truncate font-mono text-[11px] text-[var(--os-text-muted)]">{u.email ?? '—'}</span>
                </span>
            ),
        },
        {
            key: 'kind', header: t('col.kind'), width: '0.9fr',
            render: (u) => (
                <span className="flex flex-col gap-1">
                    <OsBadge variant={KIND_BADGE[u.kind]} label={t(`kind.${u.kind}`)} size="sm" />
                    {u.role && <span className="text-[10px] text-[var(--os-text-muted)]">{u.role}</span>}
                </span>
            ),
        },
        {
            key: 'account', header: t('col.account'), width: '1.2fr', secondary: true,
            render: (u) => u.ownerRef ? (
                <Link
                    href={`/admin/armateurs/${u.ownerRef}`}
                    onClick={(e) => e.stopPropagation()}
                    className="truncate text-[12.5px] text-[#00D97E] hover:underline"
                >
                    {u.ownerName ?? u.ownerRef}
                </Link>
            ) : <span className="text-[12.5px] text-[var(--os-text-muted)]">—</span>,
        },
        {
            key: 'rights', header: t('col.rights'), width: '1.3fr', secondary: true,
            render: (u) => {
                if (u.kind === 'OWNER') return <span className="text-[12px] text-[var(--os-text-secondary)]">{t('rights.all')}</span>;
                if (!u.privileges) return <span className="text-[12px] text-[var(--os-text-muted)]">—</span>;
                const granted = PRIVILEGE_KEYS.filter((k) => u.privileges?.[k]);
                if (granted.length === 0) return <span className="text-[12px] text-[var(--os-text-muted)]">{t('rights.none')}</span>;
                return (
                    <span className="flex flex-wrap gap-1">
                        {granted.map((k) => (
                            <span key={k} className="rounded-md border border-[var(--os-border)] px-1.5 py-0.5 text-[10px] text-[var(--os-text-secondary)]">
                                {t(`privilege.${k}`)}
                            </span>
                        ))}
                    </span>
                );
            },
        },
        {
            key: 'lastSignIn', header: t('col.lastSignIn'), width: '0.9fr',
            render: (u) => (
                <span className={`text-[12px] tabular-nums ${isDormant(u, now) ? 'text-[var(--os-yellow)]' : 'text-[var(--os-text-muted)]'}`}>
                    {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleDateString() : t('never')}
                </span>
            ),
        },
        {
            key: 'state', header: t('col.state'), width: '0.8fr',
            render: (u) => (
                <OsBadge
                    variant={u.active ? 'active' : 'archived'}
                    label={u.active ? t('state.active') : t(`state.${u.ownerState && u.kind === 'OWNER' ? u.ownerState : 'inactive'}`)}
                    size="sm"
                />
            ),
        },
        {
            key: 'actions', header: '', width: '250px', align: 'end',
            render: (u) => {
                const view = viewAsHref(u);
                const status = sent[u.key];
                return (
                    <span className="flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                        {view && (
                            <Link href={view} className="text-xs font-semibold text-[#00D97E] hover:underline whitespace-nowrap">
                                {t('action.viewAs')}
                            </Link>
                        )}
                        {u.email && u.kind !== 'STAFF' && u.active && (
                            <button
                                type="button"
                                onClick={() => sendAccess(u)}
                                disabled={Boolean(status)}
                                className="text-xs text-[var(--os-text-secondary)] hover:underline disabled:opacity-60 whitespace-nowrap"
                            >
                                {status === 'sent' ? t('action.sent') : status === 'sending' ? '…' : t('action.sendAccess')}
                            </button>
                        )}
                    </span>
                );
            },
        },
    ];

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
                <div className="w-72">
                    <OsInput
                        label={t('search')}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('searchPlaceholder')}
                    />
                </div>
                <div className="w-52">
                    <OsSelect
                        label={t('stateFilter')}
                        value={state}
                        onChange={(e) => setState(e.target.value as StateFilter)}
                        options={[
                            { value: 'all', label: t('state.all') },
                            { value: 'active', label: t('state.active') },
                            { value: 'dormant', label: t('state.dormant') },
                            { value: 'inactive', label: t('state.inactive') },
                        ]}
                    />
                </div>
            </div>

            <OsFilterTabs
                label={t('kindTabs')}
                value={kind}
                onChange={(v) => setKind(v as KindTab)}
                tabs={tabs.map((k) => ({ value: k, label: t(`kind.${k}`), count: counts[k] }))}
            />

            <OsGridTable
                columns={columns}
                rows={visible}
                keyExtractor={(u) => u.key}
                emptyMessage={t('empty')}
            />
        </div>
    );
}
