'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Plus, AlertTriangle } from 'lucide-react';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsButton } from '@/components/ui/OsButton';
import { OsBadge, type BadgeVariant } from '@/components/ui/OsBadge';
import { OsInput } from '@/components/ui/OsInput';
import { applyEquasisProposal } from '@/actions/applyEquasisProposal';
import { rejectEquasisProposal } from '@/actions/rejectEquasisProposal';
import { createEquasisProposal } from '@/actions/createEquasisProposal';
import type { EquasisProposal, ProposalSource } from '@/services/equasisProposalService';

interface Props {
    pending: EquasisProposal[];
    resolved: EquasisProposal[];
}

function sourceVariant(source: ProposalSource): BadgeVariant {
    if (source === 'manual') return 'info';
    if (source === 'scraper') return 'active';
    return 'draft';
}

export function EquasisProposalsPanel({ pending, resolved }: Props) {
    const router = useRouter();
    const [pendingId, setPendingId] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [applyTarget, setApplyTarget] = React.useState<EquasisProposal | null>(null);
    const [rejectTarget, setRejectTarget] = React.useState<EquasisProposal | null>(null);
    const [rejectReason, setRejectReason] = React.useState('');
    const [createOpen, setCreateOpen] = React.useState(false);
    const [isPending, startTransition] = React.useTransition();

    function doApply() {
        if (!applyTarget) return;
        setError(null);
        setPendingId(applyTarget.id);
        startTransition(async () => {
            const result = await applyEquasisProposal({ proposalId: applyTarget.id });
            setPendingId(null);
            if (!result.ok) {
                setError(`${applyTarget.imo_number}: ${result.reason}`);
                return;
            }
            setApplyTarget(null);
            router.refresh();
        });
    }

    function doReject() {
        if (!rejectTarget) return;
        if (rejectReason.trim().length < 3) {
            setError('Reason must be at least 3 characters.');
            return;
        }
        setError(null);
        setPendingId(rejectTarget.id);
        startTransition(async () => {
            const result = await rejectEquasisProposal({
                proposalId: rejectTarget.id,
                reason: rejectReason,
            });
            setPendingId(null);
            if (!result.ok) {
                setError(`${rejectTarget.imo_number}: ${result.reason}`);
                return;
            }
            setRejectTarget(null);
            setRejectReason('');
            router.refresh();
        });
    }

    const pendingColumns: OsColumn<EquasisProposal>[] = [
        {
            key: 'imo',
            header: 'IMO',
            render: (r) => <span className="font-mono text-xs">{r.imo_number}</span>,
        },
        {
            key: 'owner',
            header: 'Proposed owner',
            render: (r) => (
                <div className="flex flex-col leading-tight">
                    <span className="text-sm text-[var(--os-text-primary)]">
                        {r.proposed_owner_name ?? '—'}
                    </span>
                    {r.proposed_manager && (
                        <span className="text-[10px] text-[var(--os-text-muted)]">
                            mgr: {r.proposed_manager}
                        </span>
                    )}
                </div>
            ),
        },
        {
            key: 'email',
            header: 'Email',
            render: (r) => (
                <span className="text-xs text-[var(--os-text-muted)]">
                    {r.proposed_email ?? '—'}
                </span>
            ),
        },
        {
            key: 'country',
            header: 'Country',
            render: (r) => (
                <span className="font-mono text-xs">{r.proposed_country ?? '—'}</span>
            ),
        },
        {
            key: 'source',
            header: 'Source',
            render: (r) => <OsBadge variant={sourceVariant(r.source)} label={r.source} />,
        },
        {
            key: 'scraped',
            header: 'Scraped',
            render: (r) => (
                <span className="text-xs text-[var(--os-text-muted)] tabular-nums">
                    {new Date(r.scraped_at).toLocaleDateString()}
                </span>
            ),
        },
        {
            key: 'actions',
            header: '',
            className: 'text-right',
            render: (r) => (
                <div className="flex justify-end gap-2">
                    <OsButton
                        size="sm"
                        variant="primary"
                        onClick={() => setApplyTarget(r)}
                        loading={isPending && pendingId === r.id}
                        disabled={isPending}
                        icon={<Check className="w-3.5 h-3.5" />}
                    >
                        Apply
                    </OsButton>
                    <OsButton
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                            setRejectTarget(r);
                            setRejectReason('');
                        }}
                        disabled={isPending}
                        icon={<X className="w-3.5 h-3.5" />}
                    >
                        Reject
                    </OsButton>
                </div>
            ),
        },
    ];

    const resolvedColumns: OsColumn<EquasisProposal>[] = [
        {
            key: 'imo',
            header: 'IMO',
            render: (r) => <span className="font-mono text-xs">{r.imo_number}</span>,
        },
        {
            key: 'outcome',
            header: 'Outcome',
            render: (r) =>
                r.applied ? (
                    <OsBadge variant="active" label="Applied" />
                ) : (
                    <OsBadge variant="archived" label="Rejected" />
                ),
        },
        {
            key: 'owner',
            header: 'Proposed owner',
            render: (r) => (
                <span className="text-sm">{r.proposed_owner_name ?? '—'}</span>
            ),
        },
        {
            key: 'email',
            header: 'Email',
            render: (r) => (
                <span className="text-xs text-[var(--os-text-muted)]">
                    {r.proposed_email ?? '—'}
                </span>
            ),
        },
        {
            key: 'reason',
            header: 'Reason',
            render: (r) => (
                <span className="text-xs text-[var(--os-text-muted)] line-clamp-2 max-w-[260px]">
                    {r.rejected_reason ?? '—'}
                </span>
            ),
        },
        {
            key: 'reviewed',
            header: 'Reviewed',
            render: (r) => (
                <span className="text-xs text-[var(--os-text-muted)] tabular-nums">
                    {r.reviewed_at ? new Date(r.reviewed_at).toLocaleDateString() : '—'}
                </span>
            ),
        },
    ];

    return (
        <>
            {/* ── Pending section ───────────────────────────────────────────────── */}
            <section className="mb-8">
                <div className="flex items-baseline justify-between mb-3">
                    <div>
                        <h2 className="text-lg font-semibold text-[var(--os-text-primary)]">
                            Pending review
                        </h2>
                        <p className="text-xs text-[var(--os-text-muted)] mt-0.5">
                            Owner-email proposals awaiting validation. Apply writes through
                            the trust chain (won't overwrite officer-set emails).
                        </p>
                    </div>
                    <OsButton
                        variant="primary"
                        size="sm"
                        icon={<Plus className="w-4 h-4" />}
                        onClick={() => setCreateOpen(true)}
                    >
                        New proposal
                    </OsButton>
                </div>

                {error && (
                    <div
                        className="mb-3 px-3 py-2 rounded-lg text-xs"
                        style={{
                            backgroundColor: 'rgba(239,68,68,0.10)',
                            border: '1px solid rgba(239,68,68,0.35)',
                            color: '#FCA5A5',
                        }}
                    >
                        {error}
                    </div>
                )}

                <OsTable
                    columns={pendingColumns}
                    rows={pending}
                    keyExtractor={(r) => r.id}
                    emptyMessage="No pending proposals."
                />
            </section>

            {/* ── Resolved section ──────────────────────────────────────────────── */}
            {resolved.length > 0 && (
                <section>
                    <h2 className="text-sm font-semibold text-[var(--os-text-muted)] mb-3">
                        Recently resolved (last 30 days, {resolved.length})
                    </h2>
                    <OsTable
                        columns={resolvedColumns}
                        rows={resolved}
                        keyExtractor={(r) => r.id}
                        emptyMessage=""
                    />
                </section>
            )}

            {/* ── Apply confirmation modal ──────────────────────────────────────── */}
            {applyTarget && (
                <ModalOverlay onClose={() => !isPending && setApplyTarget(null)}>
                    <h3 className="text-base font-semibold text-[var(--os-text-primary)] mb-1">
                        Apply this proposal?
                    </h3>
                    <p className="text-sm text-[var(--os-text-muted)] mb-4">
                        Writes the proposed values into the shipowner row using
                        source <strong>EQUASIS_VERIFIED</strong>. Officer-set emails are
                        preserved (trust chain prevents downgrade). Name + country fill
                        only if currently empty.
                    </p>

                    <DiffTable proposal={applyTarget} />

                    <div className="mt-5 flex justify-end gap-2">
                        <OsButton
                            variant="ghost"
                            onClick={() => setApplyTarget(null)}
                            disabled={isPending}
                        >
                            Cancel
                        </OsButton>
                        <OsButton
                            variant="primary"
                            onClick={doApply}
                            loading={isPending}
                            disabled={isPending}
                        >
                            Apply proposal
                        </OsButton>
                    </div>
                </ModalOverlay>
            )}

            {/* ── Reject modal ──────────────────────────────────────────────────── */}
            {rejectTarget && (
                <ModalOverlay onClose={() => !isPending && setRejectTarget(null)}>
                    <h3 className="text-base font-semibold text-[var(--os-text-primary)] mb-1">
                        Reject proposal
                    </h3>
                    <p className="text-sm text-[var(--os-text-muted)] mb-4">
                        Reject the proposal for IMO{' '}
                        <span className="font-mono text-emerald-400">
                            {rejectTarget.imo_number}
                        </span>
                        ? The shipowner row stays untouched.
                    </p>
                    <textarea
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        rows={3}
                        placeholder="Why is this proposal rejected? (visible in the audit trail)"
                        className="w-full px-3 py-2 rounded-lg text-sm resize-none"
                        style={{
                            backgroundColor: 'var(--os-surface)',
                            border: '1px solid var(--os-border)',
                            color: 'var(--os-text-primary)',
                        }}
                    />
                    <div className="mt-4 flex justify-end gap-2">
                        <OsButton
                            variant="ghost"
                            onClick={() => setRejectTarget(null)}
                            disabled={isPending}
                        >
                            Cancel
                        </OsButton>
                        <OsButton
                            variant="danger"
                            onClick={doReject}
                            loading={isPending}
                            disabled={isPending}
                        >
                            Reject
                        </OsButton>
                    </div>
                </ModalOverlay>
            )}

            {/* ── Create proposal modal ─────────────────────────────────────────── */}
            {createOpen && (
                <CreateProposalModal
                    onClose={() => setCreateOpen(false)}
                    onCreated={() => {
                        setCreateOpen(false);
                        router.refresh();
                    }}
                />
            )}
        </>
    );
}

// ─────────────────────────────────────────────────────────────────────────────

function ModalOverlay({
    onClose,
    children,
}: {
    onClose: () => void;
    children: React.ReactNode;
}) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center px-4"
            style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg rounded-2xl p-5"
                style={{
                    backgroundColor: 'var(--os-surface-2)',
                    border: '1px solid var(--os-border)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {children}
            </div>
        </div>
    );
}

function DiffTable({ proposal }: { proposal: EquasisProposal }) {
    const owner = proposal.shipowner;
    const rows: { label: string; current: string; proposed: string; willChange: boolean }[] = [
        {
            label: 'Email',
            current: owner?.official_email ?? '—',
            proposed: proposal.proposed_email ?? '—',
            willChange:
                !!proposal.proposed_email &&
                proposal.proposed_email !== owner?.official_email,
        },
        {
            label: 'Email source',
            current: owner?.official_email_source ?? '—',
            proposed: 'EQUASIS_VERIFIED',
            willChange:
                !!proposal.proposed_email &&
                owner?.official_email_source !== 'PORT_OFFICER',
        },
        {
            label: 'Owner name',
            current: owner?.name ?? '—',
            proposed: proposal.proposed_owner_name ?? '(no change)',
            willChange:
                !!proposal.proposed_owner_name &&
                (!owner?.name || owner.name.startsWith('Owner of IMO')),
        },
        {
            label: 'Country',
            current: owner?.country_code ?? '—',
            proposed: proposal.proposed_country ?? '(no change)',
            willChange: !!proposal.proposed_country && !owner?.country_code,
        },
    ];

    if (owner?.official_email_source === 'PORT_OFFICER' && proposal.proposed_email) {
        return (
            <div
                className="px-3 py-2 rounded-lg text-xs flex items-start gap-2"
                style={{
                    backgroundColor: 'rgba(245,158,11,0.10)',
                    border: '1px solid rgba(245,158,11,0.35)',
                    color: '#FCD34D',
                }}
            >
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                    Email already set by a port officer (trust 3). The proposed
                    email won't overwrite it — apply will only update name/country
                    if empty.
                </span>
            </div>
        );
    }

    return (
        <table className="w-full text-xs border-separate border-spacing-y-1">
            <thead>
                <tr className="text-[10px] uppercase tracking-widest text-[var(--os-text-muted)]">
                    <th className="text-left px-2 py-1">Field</th>
                    <th className="text-left px-2 py-1">Current</th>
                    <th className="text-left px-2 py-1">After apply</th>
                </tr>
            </thead>
            <tbody>
                {rows.map((r) => (
                    <tr
                        key={r.label}
                        style={{
                            backgroundColor: r.willChange
                                ? 'rgba(16,185,129,0.06)'
                                : 'transparent',
                        }}
                    >
                        <td className="px-2 py-1 text-[var(--os-text-muted)]">{r.label}</td>
                        <td className="px-2 py-1 font-mono">{r.current}</td>
                        <td
                            className="px-2 py-1 font-mono"
                            style={{ color: r.willChange ? '#10B981' : 'var(--os-text-muted)' }}
                        >
                            {r.proposed}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function CreateProposalModal({
    onClose,
    onCreated,
}: {
    onClose: () => void;
    onCreated: () => void;
}) {
    const [imoNumber, setImoNumber] = React.useState('');
    const [ownerName, setOwnerName] = React.useState('');
    const [manager, setManager] = React.useState('');
    const [email, setEmail] = React.useState('');
    const [country, setCountry] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const [isPending, startTransition] = React.useTransition();

    function submit() {
        setError(null);
        startTransition(async () => {
            const result = await createEquasisProposal({
                imoNumber,
                proposedOwnerName: ownerName,
                proposedManager: manager,
                proposedEmail: email,
                proposedCountry: country,
            });
            if (!result.ok) {
                setError(result.reason);
                return;
            }
            onCreated();
        });
    }

    return (
        <ModalOverlay onClose={onClose}>
            <h3 className="text-base font-semibold text-[var(--os-text-primary)] mb-1">
                New manual proposal
            </h3>
            <p className="text-sm text-[var(--os-text-muted)] mb-4">
                Lands in the review queue with source <strong>manual</strong>. Same
                validation gate as scraper proposals — nothing is applied
                automatically.
            </p>

            <div className="flex flex-col gap-3">
                <OsInput
                    label="IMO number"
                    value={imoNumber}
                    onChange={(e) => setImoNumber(e.target.value)}
                    placeholder="9876543"
                    autoFocus
                    required
                />
                <OsInput
                    label="Proposed owner name"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="Acme Maritime Ltd"
                />
                <OsInput
                    label="Manager (optional)"
                    value={manager}
                    onChange={(e) => setManager(e.target.value)}
                />
                <OsInput
                    label="Email (optional)"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ops@acme-maritime.com"
                    error={error ?? undefined}
                />
                <OsInput
                    label="Country code (optional)"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    placeholder="PA"
                />
            </div>

            <div className="mt-5 flex justify-end gap-2">
                <OsButton variant="ghost" onClick={onClose} disabled={isPending}>
                    Cancel
                </OsButton>
                <OsButton
                    variant="primary"
                    onClick={submit}
                    loading={isPending}
                    disabled={isPending || imoNumber.trim().length < 3}
                >
                    Create proposal
                </OsButton>
            </div>
        </ModalOverlay>
    );
}
