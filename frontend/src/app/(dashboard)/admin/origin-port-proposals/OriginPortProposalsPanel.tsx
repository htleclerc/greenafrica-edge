'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsBadge } from '@/components/ui/OsBadge';
import { OsInput } from '@/components/ui/OsInput';
import { OsButton } from '@/components/ui/OsButton';
import type { DestinationProposal } from '@/services/destinationProposalService';
import { approveDestinationProposal } from '@/actions/approveDestinationProposal';
import { rejectDestinationProposal } from '@/actions/rejectDestinationProposal';

type Props = { proposals: DestinationProposal[]; canDecide: boolean };

export default function OriginPortProposalsPanel({ proposals, canDecide }: Props) {
    const router = useRouter();
    const [pendingId, setPendingId] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [approveTarget, setApproveTarget] = React.useState<DestinationProposal | null>(null);
    const [rejectTarget, setRejectTarget] = React.useState<DestinationProposal | null>(null);
    const [isPending, startTransition] = React.useTransition();

    const columns: OsColumn<DestinationProposal>[] = [
        {
            key: 'mmsi',
            header: 'MMSI',
            render: (r) => <span className="font-mono text-xs">{r.mmsi}</span>,
        },
        {
            key: 'vessel_name',
            header: 'Vessel',
            render: (r) => (
                <span className="text-sm text-[var(--os-text-primary)]">
                    {r.vessel_name ?? '—'}
                </span>
            ),
        },
        {
            key: 'raw_destination',
            header: 'Raw destination',
            render: (r) => (
                <span className="font-mono text-xs text-[var(--os-text-muted)]">
                    {r.raw_destination}
                </span>
            ),
        },
        {
            key: 'normalized',
            header: 'Normalized',
            render: (r) => (
                <span className="font-mono text-xs">{r.normalized}</span>
            ),
        },
        {
            key: 'matched_port_guess',
            header: 'Port guess',
            render: (r) => (
                <OsBadge variant="pending" label={r.matched_port_guess ?? '—'} />
            ),
        },
        {
            key: 'fuzzy_score',
            header: 'Score',
            render: (r) => (
                <span className="tabular-nums text-xs">{r.fuzzy_score.toFixed(2)}</span>
            ),
        },
        {
            key: 'created_at',
            header: 'Created',
            render: (r) => (
                <span className="text-xs text-[var(--os-text-muted)] tabular-nums">
                    {new Date(r.created_at).toLocaleDateString()}
                </span>
            ),
        },
        ...(canDecide
            ? [
                  {
                      key: 'actions',
                      header: '',
                      className: 'text-right',
                      render: (r: DestinationProposal) => (
                          <div className="flex justify-end gap-2">
                              <OsButton
                                  size="sm"
                                  variant="primary"
                                  onClick={() => {
                                      setError(null);
                                      setApproveTarget(r);
                                  }}
                                  loading={isPending && pendingId === r.id}
                                  disabled={isPending}
                                  icon={<Check className="w-3.5 h-3.5" />}
                              >
                                  Approve
                              </OsButton>
                              <OsButton
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                      setError(null);
                                      setRejectTarget(r);
                                  }}
                                  disabled={isPending}
                                  icon={<X className="w-3.5 h-3.5" />}
                              >
                                  Reject
                              </OsButton>
                          </div>
                      ),
                  } satisfies OsColumn<DestinationProposal>,
              ]
            : []),
    ];

    return (
        <>
            {error && (
                <div
                    className="mb-4 px-3 py-2 rounded-lg text-xs"
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
                columns={columns}
                rows={proposals}
                keyExtractor={(r) => r.id}
                emptyMessage="No pending proposals."
            />

            {/* ── Approve modal ──────────────────────────────────────────────── */}
            {approveTarget && (
                <ModalOverlay onClose={() => !isPending && setApproveTarget(null)}>
                    <h3 className="text-base font-semibold text-[var(--os-text-primary)] mb-1">
                        Approve proposal
                    </h3>
                    <p className="text-sm text-[var(--os-text-muted)] mb-4">
                        Raw:{' '}
                        <strong className="text-[var(--os-text-primary)]">
                            {approveTarget.raw_destination}
                        </strong>{' '}
                        → normalized:{' '}
                        <code className="font-mono text-emerald-400">
                            {approveTarget.normalized}
                        </code>
                    </p>
                    <ApproveForm
                        proposal={approveTarget}
                        isPending={isPending}
                        onSubmit={({ port, addToAllowList, createAlert }) => {
                            setError(null);
                            setPendingId(approveTarget.id);
                            startTransition(async () => {
                                const result = await approveDestinationProposal({
                                    proposalId: approveTarget.id,
                                    port,
                                    addToAllowList,
                                    createAlert,
                                });
                                setPendingId(null);
                                if (!result.ok) {
                                    setError(result.reason);
                                    return;
                                }
                                setApproveTarget(null);
                                router.refresh();
                            });
                        }}
                        onCancel={() => setApproveTarget(null)}
                    />
                </ModalOverlay>
            )}

            {/* ── Reject modal ───────────────────────────────────────────────── */}
            {rejectTarget && (
                <ModalOverlay onClose={() => !isPending && setRejectTarget(null)}>
                    <h3 className="text-base font-semibold text-[var(--os-text-primary)] mb-1">
                        Reject proposal
                    </h3>
                    <p className="text-sm text-[var(--os-text-muted)] mb-4">
                        Reject the proposal for{' '}
                        <span className="font-mono text-emerald-400">
                            {rejectTarget.raw_destination}
                        </span>
                        ? The allow-list stays untouched.
                    </p>
                    <RejectForm
                        proposal={rejectTarget}
                        isPending={isPending}
                        onSubmit={({ note }) => {
                            setError(null);
                            setPendingId(rejectTarget.id);
                            startTransition(async () => {
                                const result = await rejectDestinationProposal({
                                    proposalId: rejectTarget.id,
                                    note,
                                });
                                setPendingId(null);
                                if (!result.ok) {
                                    setError(result.reason);
                                    return;
                                }
                                setRejectTarget(null);
                                router.refresh();
                            });
                        }}
                        onCancel={() => setRejectTarget(null)}
                    />
                </ModalOverlay>
            )}
        </>
    );
}

// ─── Shared modal overlay ─────────────────────────────────────────────────────

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

// ─── Approve form ─────────────────────────────────────────────────────────────

interface ApproveFormProps {
    proposal: DestinationProposal;
    isPending: boolean;
    onSubmit: (p: { port: 'BERBERA' | 'ZEILA'; addToAllowList: boolean; createAlert: boolean }) => void;
    onCancel: () => void;
}

function ApproveForm({ proposal, isPending, onSubmit, onCancel }: ApproveFormProps) {
    const [port, setPort] = React.useState<'BERBERA' | 'ZEILA'>(
        (proposal.matched_port_guess === 'BERBERA' || proposal.matched_port_guess === 'ZEILA')
            ? proposal.matched_port_guess
            : 'BERBERA',
    );
    const [addToAllowList, setAddToAllowList] = React.useState(true);
    const [createAlert, setCreateAlert] = React.useState(true);

    return (
        <form
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                onSubmit({ port, addToAllowList, createAlert });
            }}
        >
            <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--os-text-secondary)] uppercase tracking-wider">
                    Assign to port
                </label>
                <select
                    className="w-full h-11 rounded-xl px-4 bg-[var(--os-surface-2)] border border-[var(--os-border)] text-sm text-[var(--os-text-primary)] focus:outline-none focus:border-[#00D97E]/60 focus:ring-1 focus:ring-[#00D97E]/20 transition-colors appearance-none cursor-pointer"
                    value={port}
                    onChange={(e) => setPort(e.target.value as 'BERBERA' | 'ZEILA')}
                >
                    <option value="BERBERA">BERBERA</option>
                    <option value="ZEILA">ZEILA</option>
                </select>
            </div>

            <label className="flex items-center gap-3 text-sm text-[var(--os-text-primary)] cursor-pointer">
                <input
                    type="checkbox"
                    checked={addToAllowList}
                    onChange={(e) => setAddToAllowList(e.target.checked)}
                    className="w-4 h-4 rounded accent-emerald-500"
                />
                Add normalized string to allow-list
            </label>

            <label className="flex items-center gap-3 text-sm text-[var(--os-text-primary)] cursor-pointer">
                <input
                    type="checkbox"
                    checked={createAlert}
                    onChange={(e) => setCreateAlert(e.target.checked)}
                    className="w-4 h-4 rounded accent-emerald-500"
                />
                Create arrival alert (if MMSI eligible)
            </label>

            <div className="flex justify-end gap-2 pt-1">
                <OsButton variant="ghost" type="button" onClick={onCancel} disabled={isPending}>
                    Cancel
                </OsButton>
                <OsButton variant="primary" type="submit" loading={isPending} disabled={isPending}>
                    Approve
                </OsButton>
            </div>
        </form>
    );
}

// ─── Reject form ──────────────────────────────────────────────────────────────

interface RejectFormProps {
    proposal: DestinationProposal;
    isPending: boolean;
    onSubmit: (p: { note: string }) => void;
    onCancel: () => void;
}

function RejectForm({ isPending, onSubmit, onCancel }: RejectFormProps) {
    const [note, setNote] = React.useState('');

    return (
        <form
            className="space-y-4"
            onSubmit={(e) => {
                e.preventDefault();
                onSubmit({ note });
            }}
        >
            <OsInput
                label="Reason (required)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                required
                maxLength={500}
                placeholder="Why is this proposal rejected? (visible in audit trail)"
            />

            <div className="flex justify-end gap-2">
                <OsButton variant="ghost" type="button" onClick={onCancel} disabled={isPending}>
                    Cancel
                </OsButton>
                <OsButton
                    variant="danger"
                    type="submit"
                    loading={isPending}
                    disabled={isPending || note.trim().length < 1}
                >
                    Reject
                </OsButton>
            </div>
        </form>
    );
}
