'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { OsGridTable, type OsGridColumn } from '@/components/ui/OsGridTable';
import { OsFilterTabs } from '@/components/ui/OsFilterTabs';
import { usdGrouped, usdSigned } from '@/lib/osMoney';
import { withRunningBalances, type Movement } from '@/services/walletProvision';
import type { LedgerRow, LedgerKind } from '@/services/walletService';

/** Sens du mouvement — c'est ce que l'armateur filtre, pas la nature comptable. */
type Direction = 'all' | 'in' | 'out';

interface Props {
    rows: LedgerRow[];
    /** Solde actuel, en centimes — origine du calcul des soldes courants. */
    currentBalanceUsdMinor: number;
    onFilterChange: (kinds: LedgerKind[]) => void;
    activeFilters: LedgerKind[];
}

/**
 * Mouvements du portefeuille.
 *
 * Chaque ligne porte le solde qu'elle laisse derrière elle : c'est ce qui rend
 * le relevé vérifiable, là où une colonne de deltas seule demande de faire
 * confiance. Le filtre est par sens (entrées / sorties) parce que c'est la
 * question qu'on se pose ; la nature comptable reste sur la ligne.
 */
export function LedgerTable({ rows, currentBalanceUsdMinor, onFilterChange, activeFilters }: Props) {
    const t = useTranslations('OwnerPortal.wallet.ledger');
    const [direction, setDirection] = React.useState<Direction>('all');

    // Les soldes courants se calculent sur la liste **complète** : les filtrer
    // d'abord donnerait des soldes qui ne s'enchaînent pas.
    const movements = React.useMemo(
        () => withRunningBalances(rows, currentBalanceUsdMinor),
        [rows, currentBalanceUsdMinor],
    );

    const visible = movements.filter((m) => {
        if (direction === 'in') return m.amountUsd > 0;
        if (direction === 'out') return m.amountUsd < 0;
        return true;
    });

    // Le filtre par nature reste piloté par le parent (il borne la requête) ;
    // on le remet à zéro quand l'utilisateur change de sens, pour éviter deux
    // filtres qui se contredisent en silence.
    React.useEffect(() => {
        if (direction !== 'all' && activeFilters.length > 0) onFilterChange([]);
    }, [direction, activeFilters.length, onFilterChange]);

    const columns: OsGridColumn<Movement>[] = [
        {
            key: 'date', header: t('col.date'), width: '1fr',
            render: (m) => (
                <span className="text-[12.5px] tabular-nums text-[var(--os-text-secondary)]">
                    {new Date(m.createdAt).toLocaleDateString()}
                </span>
            ),
        },
        {
            key: 'label', header: t('col.kind'), width: '1.4fr', primary: true,
            render: (m) => (
                <span className="flex min-w-0 flex-col gap-px">
                    <span className="truncate text-[13px] text-[var(--os-text-primary)]">{t(`kind.${m.kind}`)}</span>
                    {m.justification && (
                        <span className="truncate text-[11px] text-[var(--os-text-muted)]">{m.justification}</span>
                    )}
                </span>
            ),
        },
        {
            key: 'reference', header: t('col.reference'), width: '1fr', secondary: true,
            render: (m) => (
                <span className="truncate font-mono text-xs text-[var(--os-text-muted)]">
                    {reference(m) ?? '—'}
                </span>
            ),
        },
        {
            key: 'amount', header: t('col.amount'), width: '0.8fr', align: 'end',
            render: (m) => (
                <span
                    className="font-mono text-[13px] tabular-nums"
                    style={{ color: m.amountUsd >= 0 ? 'var(--os-green)' : 'var(--os-red)' }}
                >
                    {usdSigned(m.amountUsd)}
                </span>
            ),
        },
        {
            key: 'balance', header: t('col.balance'), width: '0.8fr', align: 'end',
            render: (m) => (
                <span className="font-mono text-[13px] tabular-nums text-[var(--os-text-secondary)]">
                    {usdGrouped(m.balanceAfterUsd)}
                </span>
            ),
        },
    ];

    return (
        <section className="os-card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--os-border)] px-[18px] py-3.5">
                <h2 className="text-sm font-semibold text-[var(--os-text-primary)]">{t('title')}</h2>
                <OsFilterTabs
                    label={t('filterLabel')}
                    value={direction}
                    onChange={(v) => setDirection(v as Direction)}
                    tabs={[
                        { value: 'all', label: t('direction.all') },
                        { value: 'in', label: t('direction.in') },
                        { value: 'out', label: t('direction.out') },
                    ]}
                />
            </header>
            <OsGridTable
                columns={columns}
                rows={visible}
                keyExtractor={(m) => m.id}
                emptyMessage={t('empty')}
                className="!rounded-none !border-0"
            />
        </section>
    );
}

/** Référence lisible du mouvement : la facture, le paiement, ou le remboursement. */
function reference(m: Movement): string | null {
    const id = m.transactionId ?? m.paymentId ?? m.refundId;
    return id ? id.slice(0, 8).toUpperCase() : null;
}
