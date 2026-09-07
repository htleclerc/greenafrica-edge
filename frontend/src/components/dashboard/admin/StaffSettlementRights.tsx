'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { OsBadge } from '@/components/ui/OsBadge';
import { setSettlementRights } from '@/actions/setSettlementRights';
import { setPaymentsOnly } from '@/actions/setPaymentsOnly';

export interface StaffRow {
    id: string;
    full_name: string | null;
    email: string | null;
    role: string;
    is_active: boolean;
    can_settle_payments: boolean;
    /** Mig 154 : ne voit que les encaissements, jamais une créance. */
    payments_only?: boolean;
}

/** Rôles qui ouvrent le rail monétaire d'office : la case n'y change rien. */
const SETTLES_BY_ROLE = new Set(['SUPERADMIN', 'FINANCE_ADMIN']);

/**
 * Délégation de la sous-permission « valider les encaissements » (mig 130).
 *
 * Un compte ne porte qu'un rôle : promouvoir un MANAGER en FINANCE_ADMIN pour
 * qu'il valide les virements lui ferait perdre son vision board. La case
 * ouvre le rail monétaire sans toucher au rôle.
 */
export function StaffSettlementRights({ staff }: { staff: StaffRow[] }) {
    const router = useRouter();
    const [pendingId, setPendingId] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    async function toggle(row: StaffRow, next: boolean) {
        setPendingId(row.id);
        setError(null);
        try {
            await setSettlementRights({ profileId: row.id, enabled: next });
            router.refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Update failed');
        } finally {
            setPendingId(null);
        }
    }

    async function toggleCashOnly(row: StaffRow, next: boolean) {
        setPendingId(row.id);
        setError(null);
        try {
            await setPaymentsOnly({ profileId: row.id, enabled: next });
            router.refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Update failed');
        } finally {
            setPendingId(null);
        }
    }

    return (
        <section className="mt-8">
            <h2 className="text-sm font-semibold text-[var(--os-text-primary)]">
                Payment settlement rights
            </h2>
            <p className="text-xs text-[var(--os-text-muted)] mt-1 mb-3 max-w-2xl leading-relaxed">
                Who may confirm or reject a payment once the shipowner has uploaded proof.
                Superadmins and finance admins hold this by role. Tick the box to grant it to
                another staff member — a manager, typically — without changing their role.
                “Cash only” keeps a person away from receivables: confirmed and refunded payments,
                wallets, the directory, vessels without their outstanding, settings, and only the
                pro-formas issued this week — never the outstanding book nor an unconfirmed declaration.
            </p>

            {error && <p className="text-xs text-[#EF4444] mb-2">{error}</p>}

            <div className="rounded-xl border border-[var(--os-border)] overflow-hidden">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-[var(--os-surface-2)] text-[10px] uppercase tracking-widest text-[var(--os-text-muted)]">
                            <th className="text-left font-semibold px-3 py-2">Staff</th>
                            <th className="text-left font-semibold px-3 py-2">Role</th>
                            <th className="text-left font-semibold px-3 py-2">May settle</th>
                            <th className="text-left font-semibold px-3 py-2">Cash only</th>
                        </tr>
                    </thead>
                    <tbody>
                        {staff.map((row) => {
                            const byRole = SETTLES_BY_ROLE.has(row.role);
                            return (
                                <tr key={row.id} className="border-t border-[var(--os-border)]">
                                    <td className="px-3 py-2">
                                        <span className="text-[var(--os-text-primary)]">
                                            {row.full_name ?? '—'}
                                        </span>
                                        <span className="block text-[11px] text-[var(--os-text-muted)]">
                                            {row.email ?? '—'}
                                            {!row.is_active && ' · inactive'}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2">
                                        <OsBadge variant="info" label={row.role} />
                                    </td>
                                    <td className="px-3 py-2">
                                        {byRole ? (
                                            <span className="text-[11px] text-[var(--os-text-muted)]">
                                                By role
                                            </span>
                                        ) : (
                                            <label className="inline-flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    className="accent-[#10B981]"
                                                    checked={row.can_settle_payments}
                                                    disabled={pendingId === row.id || !row.is_active}
                                                    onChange={(e) => toggle(row, e.target.checked)}
                                                    aria-label={`Allow ${row.full_name ?? row.email ?? row.id} to settle payments`}
                                                />
                                                <span className="text-[11px] text-[var(--os-text-muted)]">
                                                    {row.can_settle_payments ? 'Granted' : 'Not granted'}
                                                </span>
                                            </label>
                                        )}
                                    </td>
                                    <td className="px-3 py-2">
                                        <label className="inline-flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="accent-[#EAB308]"
                                                checked={row.payments_only === true}
                                                disabled={pendingId === row.id || !row.is_active}
                                                onChange={(e) => toggleCashOnly(row, e.target.checked)}
                                                aria-label={`Restrict ${row.full_name ?? row.email ?? row.id} to confirmed payments only`}
                                            />
                                            <span className="text-[11px] text-[var(--os-text-muted)]">
                                                {row.payments_only ? 'Confirmed payments only' : 'Sees everything of their role'}
                                            </span>
                                        </label>
                                    </td>
                                </tr>
                            );
                        })}
                        {staff.length === 0 && (
                            <tr>
                                <td colSpan={4} className="px-3 py-4 text-xs text-[var(--os-text-muted)]">
                                    No staff accounts yet.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
