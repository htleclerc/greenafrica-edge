'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as Dialog from '@radix-ui/react-dialog';
import { OsPageHeader } from '@/components/ui/OsPageHeader';
import { OsFilterTabs } from '@/components/ui/OsFilterTabs';
import { OsUrgencyPill } from '@/components/ui/OsUrgencyPill';
import { OsButton } from '@/components/ui/OsButton';
import { resolveValidationItem } from '@/actions/resolveValidationItem';
import { accentStyle, type OsAccent } from '@/lib/osAccent';
import type { ValidationItem, ValidationKind, ValidationQueue as Queue } from '@/services/validationQueueService';

/** Chaque famille garde sa couleur, du liseré de carte à la pastille de type. */
const KIND_ACCENT: Record<ValidationKind, OsAccent> = {
    'vessel-identity': 'info',
    'agent':           'warning',
    'origin-port':     'info',
};

const KIND_ORDER: ValidationKind[] = ['vessel-identity', 'agent', 'origin-port'];

/**
 * File d'arbitrage unifiée.
 *
 * Le traitement en lot est l'usage normal, l'arbitrage à l'unité l'exception :
 * l'action de page approuve tous les éléments conformes — ceux dont aucune
 * valeur ne diverge — et les cartes ne restent dépliées que pour les écarts.
 */
export function ValidationQueue({ queue }: { queue: Queue }) {
    const t = useTranslations('AdminValidations');
    const router = useRouter();

    const [tab, setTab] = React.useState<ValidationKind>(
        () => KIND_ORDER.find((k) => queue.counts[k] > 0) ?? 'vessel-identity',
    );
    const visible = queue.items.filter((i) => i.kind === tab);

    const [pendingId, setPendingId] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [rejectTarget, setRejectTarget] = React.useState<ValidationItem | null>(null);
    const [rejectReason, setRejectReason] = React.useState('');
    const [bulkOpen, setBulkOpen] = React.useState(false);
    const [bulkResult, setBulkResult] = React.useState<{ done: number; failed: number } | null>(null);
    const [isPending, startTransition] = React.useTransition();

    function approve(item: ValidationItem) {
        setError(null);
        setPendingId(item.id);
        startTransition(async () => {
            const res = await resolveValidationItem({ kind: item.kind, id: item.id, decision: 'approve' });
            setPendingId(null);
            if (!res.ok) { setError(t('errorOn', { title: item.title, reason: res.reason })); return; }
            router.refresh();
        });
    }

    function confirmReject() {
        if (!rejectTarget) return;
        if (rejectReason.trim().length < 3) { setError(t('reasonRequired')); return; }
        setError(null);
        setPendingId(rejectTarget.id);
        startTransition(async () => {
            const res = await resolveValidationItem({
                kind: rejectTarget.kind, id: rejectTarget.id, decision: 'reject', reason: rejectReason,
            });
            setPendingId(null);
            if (!res.ok) { setError(t('errorOn', { title: rejectTarget.title, reason: res.reason })); return; }
            setRejectTarget(null);
            setRejectReason('');
            router.refresh();
        });
    }

    function confirmBulk() {
        setError(null);
        startTransition(async () => {
            // Séquentiel : chaque approbation écrit dans une table différente et
            // certaines déclenchent un e-mail. Le débit n'est pas le sujet, la
            // traçabilité l'est.
            let done = 0, failed = 0;
            for (const item of queue.items.filter((i) => i.conforming)) {
                const res = await resolveValidationItem({ kind: item.kind, id: item.id, decision: 'approve' });
                if (res.ok) done += 1; else failed += 1;
            }
            setBulkResult({ done, failed });
            router.refresh();
        });
    }

    return (
        <div className="flex flex-col gap-[18px] p-4 sm:p-6">
            <OsPageHeader
                title={t('verdict', { count: queue.items.length })}
                subtitle={t('breakdown', {
                    vessels: queue.counts['vessel-identity'],
                    agents: queue.counts.agent,
                    ports: queue.counts['origin-port'],
                })}
                actions={
                    <OsButton
                        variant="primary"
                        disabled={queue.conformingCount === 0 || isPending}
                        title={queue.conformingCount === 0 ? t('noConforming') : undefined}
                        onClick={() => { setBulkResult(null); setBulkOpen(true); }}
                        className="!h-10 !rounded-[10px] !bg-[var(--os-brand-green)] !text-[var(--os-on-primary)] !shadow-none"
                    >
                        {t('approveConforming', { count: queue.conformingCount })}
                    </OsButton>
                }
            />

            <OsFilterTabs
                label={t('tabsLabel')}
                value={tab}
                onChange={(v) => setTab(v as ValidationKind)}
                tabs={KIND_ORDER.map((kind) => ({
                    value: kind,
                    label: t(`kind.${kind}`),
                    count: queue.counts[kind],
                }))}
            />

            {error && (
                <p
                    role="alert"
                    className="rounded-lg border border-[var(--os-red)]/35 bg-[var(--os-red)]/10 px-3 py-2 text-xs text-[var(--os-red)]"
                >
                    {error}
                </p>
            )}

            {visible.length === 0 ? (
                <p className="os-card px-[18px] py-10 text-center text-[13px] text-[var(--os-text-muted)]">
                    {t('empty')}
                </p>
            ) : (
                <div className="flex flex-col gap-3">
                    {visible.map((item) => (
                        <ValidationCard
                            key={item.id}
                            item={item}
                            busy={isPending && pendingId === item.id}
                            disabled={isPending}
                            onApprove={() => approve(item)}
                            onReject={() => { setRejectReason(''); setRejectTarget(item); }}
                        />
                    ))}
                </div>
            )}

            {/* ── Rejet motivé ─────────────────────────────────────────────── */}
            <Dialog.Root open={rejectTarget !== null} onOpenChange={(o) => !o && setRejectTarget(null)}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-50" style={{ background: 'rgba(0,0,0,0.6)' }} />
                    <Dialog.Content
                        className="fixed left-1/2 top-1/2 z-50 w-[460px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                        style={{ background: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                    >
                        <Dialog.Title className="text-base font-semibold text-[var(--os-text-primary)]">
                            {t('rejectTitle')}
                        </Dialog.Title>
                        <Dialog.Description className="mt-1 mb-3 text-sm text-[var(--os-text-muted)]">
                            {t('rejectBody', { title: rejectTarget?.title ?? '' })}
                        </Dialog.Description>
                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--os-text-secondary)]">
                                {t('rejectReasonLabel')}
                            </span>
                            <textarea
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                rows={3}
                                autoFocus
                                className="w-full resize-none rounded-lg border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm text-[var(--os-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--os-brand-green)]"
                            />
                        </label>
                        <div className="mt-4 flex justify-end gap-2">
                            <OsButton variant="ghost" onClick={() => setRejectTarget(null)} disabled={isPending}>
                                {t('cancel')}
                            </OsButton>
                            <OsButton
                                variant="danger"
                                onClick={confirmReject}
                                loading={isPending}
                                disabled={isPending || rejectReason.trim().length < 3}
                            >
                                {t('reject')}
                            </OsButton>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

            {/* ── Approbation en lot ───────────────────────────────────────── */}
            <Dialog.Root open={bulkOpen} onOpenChange={(o) => { if (!o && !isPending) { setBulkOpen(false); setBulkResult(null); } }}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-50" style={{ background: 'rgba(0,0,0,0.6)' }} />
                    <Dialog.Content
                        className="fixed left-1/2 top-1/2 z-50 w-[460px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                        style={{ background: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                    >
                        <Dialog.Title className="mb-2 text-base font-semibold text-[var(--os-text-primary)]">
                            {t('bulkTitle')}
                        </Dialog.Title>
                        <Dialog.Description className="text-sm text-[var(--os-text-muted)]">
                            {bulkResult
                                ? t('bulkDone', { done: bulkResult.done, failed: bulkResult.failed })
                                : t('bulkBody', { count: queue.conformingCount })}
                        </Dialog.Description>
                        <div className="mt-5 flex justify-end gap-2">
                            <OsButton
                                variant="ghost"
                                onClick={() => { setBulkOpen(false); setBulkResult(null); }}
                                disabled={isPending}
                            >
                                {bulkResult ? t('close') : t('cancel')}
                            </OsButton>
                            {!bulkResult && (
                                <OsButton variant="primary" onClick={confirmBulk} loading={isPending} disabled={isPending}>
                                    {t('approveConforming', { count: queue.conformingCount })}
                                </OsButton>
                            )}
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </div>
    );
}

/**
 * Une carte par élément à arbitrer.
 *
 * Pour un conflit de données, le corps est la grille de comparaison à trois
 * colonnes. Seules les valeurs qui divergent sont colorées — le déclaré en
 * avertissement, la source en vert — pour que l'œil aille droit à l'écart au
 * lieu de relire quatre lignes identiques.
 */
function ValidationCard({
    item, busy, disabled, onApprove, onReject,
}: {
    item: ValidationItem;
    busy: boolean;
    disabled: boolean;
    onApprove: () => void;
    onReject: () => void;
}) {
    const t = useTranslations('AdminValidations');
    const accent = KIND_ACCENT[item.kind];
    const divergences = item.comparison?.filter((r) => r.diverges).length ?? 0;

    return (
        <article
            style={accentStyle(accent)}
            className="os-accent-border-l os-accent-edge overflow-hidden rounded-xl border bg-[var(--os-surface)]"
        >
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--os-border)] px-[18px] py-3.5">
                <div className="flex min-w-0 flex-wrap items-center gap-3.5">
                    <OsUrgencyPill accent={accent}>{t(`kind.${item.kind}`)}</OsUrgencyPill>
                    <h2 className="truncate text-[15px] font-semibold text-[var(--os-text-primary)]">{item.title}</h2>
                    <p className="text-[12.5px] text-[var(--os-text-muted)]">
                        {t('submitted', {
                            by: item.submittedBy ?? '—',
                            date: new Date(item.submittedAt).toLocaleDateString(),
                        })}
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                    <button
                        type="button"
                        onClick={onReject}
                        disabled={disabled}
                        className="flex h-[38px] items-center whitespace-nowrap rounded-[9px] border border-[var(--os-red)]/35 px-4 text-[13px] font-semibold text-[var(--os-red)] transition-colors duration-150 hover:bg-[var(--os-red)]/10 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-red)]"
                    >
                        {t('reject')}
                    </button>
                    <button
                        type="button"
                        onClick={onApprove}
                        disabled={disabled}
                        className="flex h-[38px] items-center whitespace-nowrap rounded-[9px] bg-[var(--os-brand-green)] px-[18px] text-[13px] font-semibold text-[var(--os-on-primary)] transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]"
                    >
                        {busy ? t('working') : t('approve')}
                    </button>
                </div>
            </header>

            {item.comparison ? (
                <div className="os-compare-grid">
                    <div className="flex flex-col gap-3 border-b border-[var(--os-border)] px-[18px] py-3.5 lg:border-b-0 lg:border-r">
                        <ColumnLabel>{t('colField')}</ColumnLabel>
                        {item.comparison.map((r) => (
                            <span key={r.field} className="text-[12.5px] text-[var(--os-text-secondary)]">
                                {t(`field.${r.field}`)}
                            </span>
                        ))}
                    </div>
                    <div className="flex flex-col gap-3 border-b border-[var(--os-border)] px-[18px] py-3.5 lg:border-b-0 lg:border-r">
                        <ColumnLabel>{t('colDeclared')}</ColumnLabel>
                        {item.comparison.map((r) => (
                            <span
                                key={r.field}
                                className={`truncate text-[13px] ${r.mono ? 'font-mono' : ''} ${r.diverges ? 'text-[var(--os-yellow)]' : 'text-[var(--os-text-secondary)]'}`}
                            >
                                {r.declared}
                            </span>
                        ))}
                    </div>
                    <div className="flex flex-col gap-3 px-[18px] py-3.5">
                        <ColumnLabel>{t('colSource')}</ColumnLabel>
                        {item.comparison.map((r) => (
                            <span
                                key={r.field}
                                className={`truncate text-[13px] ${r.mono ? 'font-mono' : ''} ${r.diverges ? 'text-[var(--os-green)]' : 'text-[var(--os-text-secondary)]'}`}
                            >
                                {r.source}
                            </span>
                        ))}
                    </div>
                </div>
            ) : (
                <p className="px-[18px] py-3.5 text-[12.5px] text-[var(--os-text-secondary)]">{item.summary}</p>
            )}

            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--os-border)] bg-[var(--os-surface-sunken)] px-[18px] py-3 text-[12.5px] text-[var(--os-text-secondary)]">
                <span>
                    {divergences > 0 ? t('divergences', { count: divergences }) : t('conforming')}
                </span>
                <Link
                    href={item.href}
                    className="font-semibold text-[var(--os-brand-cyan)] transition-opacity duration-150 hover:opacity-80"
                >
                    {t('openSpecialised')} →
                </Link>
            </footer>
        </article>
    );
}

function ColumnLabel({ children }: { children: React.ReactNode }) {
    return (
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--os-text-muted)]">
            {children}
        </span>
    );
}
