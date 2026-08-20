'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as Dialog from '@radix-ui/react-dialog';
import { OsTable, type OsColumn, type OsSort } from '@/components/ui/OsTable';
import { OsBadge } from '@/components/ui/OsBadge';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput, OsSelect } from '@/components/ui/OsInput';
import { createClient } from '@/lib/supabase/client';
import { recordDebtorResponse } from '@/actions/recordDebtorResponse';
import { escalateCollection } from '@/actions/escalateCollection';
import {
    tierVariant, responseVariant, type CollectionAdminRow, type CollectionAdminFilters,
} from '@/services/collectionAdminService';

const RESPONSE_TYPES = ['ACKNOWLEDGE', 'DISPUTE', 'PAYMENT_PROMISE', 'PARTIAL_PAYMENT', 'PAID', 'REFUSED'] as const;
const TIERS = ['J3', 'J7', 'J15', 'J30', 'J45', 'BAILIFF', 'JUDICIAL'];
const STATUSES = ['PENDING', 'OVERDUE', 'PAID', 'DISPUTED'];

interface ReminderRow {
    id: string; tier: string; sent_at: string; sent_email: string; cc_emails: string[] | null;
    template_used: string; debtor_response_type: string; debtor_response_at: string | null;
    escalated_bailiff: boolean;
}

interface Props {
    rows: CollectionAdminRow[];
    total: number;
    page: number;
    pageSize: number;
    filters: CollectionAdminFilters;
    jurisdictions: { id: string; name: string }[];
}

export function CollectionsAdminList({ rows, total, page, pageSize, filters, jurisdictions }: Props) {
    const t = useTranslations('AdminCollections');
    const router = useRouter();
    const searchParams = useSearchParams();
    const [selected, setSelected] = React.useState<CollectionAdminRow | null>(null);

    function setParam(key: string, value: string) {
        const params = new URLSearchParams(searchParams.toString());
        if (value) params.set(key, value); else params.delete(key);
        if (key !== 'page') params.delete('page');
        router.push(`?${params.toString()}`);
    }

    // Tri serveur : la clé et la direction vivent dans l'URL, comme les autres filtres.
    const sort: OsSort | null = filters.sortKey ? { key: filters.sortKey, dir: filters.sortDir ?? 'asc' } : null;
    const onSortChange = (next: OsSort) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('sortKey', next.key);
        params.set('sortDir', next.dir);
        params.delete('page'); // un changement de tri renvoie en page 1
        router.push(`?${params.toString()}`);
    };

    // Les `key` triables ci-dessous doivent correspondre exactement à COLLECTION_SORT_KEYS
    // (service). 'response' n'a pas d'équivalent dans la liste blanche : non triable.
    const columns: OsColumn<CollectionAdminRow>[] = [
        { key: 'debtor_name', header: t('col_debtor'), sortable: true, render: (r) => <span className="text-sm">{r.debtor_name ?? '—'}</span> },
        { key: 'invoice_ref', header: t('col_invoice'), sortable: true, render: (r) => <span className="font-mono text-xs">{r.invoice_ref ?? r.transaction_id.slice(0, 8)}</span> },
        { key: 'outstanding_usd', header: t('col_outstanding'), className: 'text-right', sortable: true, render: (r) => <span className="font-mono text-sm tabular-nums">${r.outstanding_usd.toLocaleString()}</span> },
        { key: 'status', header: t('col_status'), sortable: true, render: (r) => <OsBadge variant={r.status === 'PAID' ? 'paid' : r.status === 'OVERDUE' ? 'overdue' : r.status === 'DISPUTED' ? 'disputed' : 'pending'} label={r.status} /> },
        { key: 'latest_tier', header: t('col_tier'), sortable: true, render: (r) => <OsBadge variant={tierVariant(r.latest_tier)} label={r.latest_tier ?? '—'} /> },
        { key: 'response', header: t('col_response'), render: (r) => <OsBadge variant={responseVariant(r.latest_response_type)} label={r.latest_response_type ?? 'SILENT'} /> },
        { key: 'reminder_count', header: t('col_count'), className: 'text-right', sortable: true, render: (r) => <span className="text-xs tabular-nums">{r.reminder_count}</span> },
    ];

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return (
        <>
            <div className="flex flex-wrap gap-2 mb-3">
                <OsInput placeholder={t('search')} defaultValue={filters.q ?? ''}
                    onKeyDown={(e) => { if (e.key === 'Enter') setParam('q', (e.target as HTMLInputElement).value); }} />
                <OsSelect placeholder={t('f_jurisdiction')} value={filters.jurisdictionId ?? ''}
                    onChange={(e) => setParam('jurisdictionId', e.target.value)}
                    options={jurisdictions.map((j) => ({ value: j.id, label: j.name }))} />
                <OsSelect placeholder={t('f_status')} value={filters.status ?? ''}
                    onChange={(e) => setParam('status', e.target.value)}
                    options={STATUSES.map((s) => ({ value: s, label: s }))} />
                <OsSelect placeholder={t('f_tier')} value={filters.latestTier ?? ''}
                    onChange={(e) => setParam('latestTier', e.target.value)}
                    options={TIERS.map((s) => ({ value: s, label: s }))} />
                <OsSelect placeholder={t('f_response')} value={filters.latestResponse ?? ''}
                    onChange={(e) => setParam('latestResponse', e.target.value)}
                    options={RESPONSE_TYPES.map((s) => ({ value: s, label: s }))} />
            </div>

            <OsTable columns={columns} rows={rows} keyExtractor={(r) => r.transaction_id}
                onRowClick={(r) => setSelected(r)} emptyMessage={t('empty')}
                sort={sort} onSortChange={onSortChange} />

            <div className="flex items-center justify-between mt-3 text-xs text-[var(--os-text-muted)]">
                <span>{t('pagination', { start: (page - 1) * pageSize + 1, end: Math.min(page * pageSize, total), total })}</span>
                <div className="flex gap-2">
                    <OsButton size="sm" variant="secondary" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>{t('prev')}</OsButton>
                    <OsButton size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setParam('page', String(page + 1))}>{t('next')}</OsButton>
                </div>
            </div>

            {selected && <DetailPanel row={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); router.refresh(); }} />}
        </>
    );
}

function DetailPanel({ row, onClose, onSaved }: { row: CollectionAdminRow; onClose: () => void; onSaved: () => void }) {
    const t = useTranslations('AdminCollections');
    const [reminders, setReminders] = React.useState<ReminderRow[] | null>(null);
    const [dialogOpen, setDialogOpen] = React.useState(false);
    const [responseType, setResponseType] = React.useState<string>('ACKNOWLEDGE');
    const [error, setError] = React.useState<string | null>(null);
    const [pending, startTransition] = React.useTransition();

    React.useEffect(() => {
        let cancelled = false;
        const supabase = createClient();
        supabase.from('collection_reminders')
            .select('id, tier, sent_at, sent_email, cc_emails, template_used, debtor_response_type, debtor_response_at, escalated_bailiff')
            .eq('transaction_id', row.transaction_id)
            .order('sent_at', { ascending: true })
            .then(({ data }) => { if (!cancelled) setReminders((data ?? []) as ReminderRow[]); });
        return () => { cancelled = true; };
    }, [row.transaction_id]);

    const tiers = (reminders ?? []).map((r) => r.tier);
    const canBailiff = tiers.includes('J45') && !tiers.includes('BAILIFF');
    const canJudicial = tiers.includes('BAILIFF') && !tiers.includes('JUDICIAL');
    const [escalateTier, setEscalateTier] = React.useState<'BAILIFF' | 'JUDICIAL' | null>(null);
    const [escalateError, setEscalateError] = React.useState<string | null>(null);
    const [escalating, startEscalate] = React.useTransition();

    function confirmEscalate() {
        if (!escalateTier) return;
        setEscalateError(null);
        startEscalate(async () => {
            const res = await escalateCollection({ transactionId: row.transaction_id, tier: escalateTier });
            if (!res.ok) { setEscalateError(res.reason); return; }
            setEscalateTier(null);
            onSaved();
        });
    }

    function submit() {
        setError(null);
        startTransition(async () => {
            const res = await recordDebtorResponse({ transactionId: row.transaction_id, responseType });
            if (!res.ok) { setError(res.reason); return; }
            setDialogOpen(false);
            onSaved();
        });
    }

    return (
        <div className="mt-4 os-card p-4">
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-[var(--os-text-primary)]">
                    {t('timeline_title', { debtor: row.debtor_name ?? '—', ref: row.invoice_ref ?? row.transaction_id.slice(0, 8) })}
                </h2>
                <div className="flex gap-2">
                    <OsButton size="sm" variant="secondary" onClick={() => setDialogOpen(true)}>{t('record_response')}</OsButton>
                    <OsButton size="sm" variant="danger" disabled={!canBailiff}
                        title={canBailiff ? undefined : t('escalate_ramp_bailiff')}
                        onClick={() => { setEscalateError(null); setEscalateTier('BAILIFF'); }}>
                        {t('escalate_bailiff')}
                    </OsButton>
                    <OsButton size="sm" variant="danger" disabled={!canJudicial}
                        title={canJudicial ? undefined : t('escalate_ramp_judicial')}
                        onClick={() => { setEscalateError(null); setEscalateTier('JUDICIAL'); }}>
                        {t('escalate_judicial')}
                    </OsButton>
                    <OsButton size="sm" variant="ghost" onClick={onClose}>{t('close')}</OsButton>
                </div>
            </div>

            {reminders === null ? (
                <p className="text-xs text-[var(--os-text-muted)]">{t('loading')}</p>
            ) : reminders.length === 0 ? (
                <p className="text-xs text-[var(--os-text-muted)]">{t('no_reminders')}</p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {reminders.map((r) => (
                        <li key={r.id} className="flex items-center gap-3 text-xs border-b border-[var(--os-border)] pb-2">
                            <OsBadge variant={tierVariant(r.tier)} label={r.tier} />
                            <span className="text-[var(--os-text-muted)]">{new Date(r.sent_at).toLocaleDateString()}</span>
                            <span className="text-[var(--os-text-secondary)] truncate">{r.sent_email}{r.cc_emails?.length ? ` +${r.cc_emails.length} cc` : ''}</span>
                            {(r.escalated_bailiff || r.tier === 'BAILIFF' || r.tier === 'JUDICIAL') && (
                                <OsBadge variant="critical" label={t('escalated_badge')} />
                            )}
                            <span className="ml-auto"><OsBadge variant={responseVariant(r.debtor_response_type)} label={r.debtor_response_type} /></span>
                        </li>
                    ))}
                </ul>
            )}

            <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0" style={{ background: 'rgba(0,0,0,0.6)' }} />
                    <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] max-w-[92vw] rounded-2xl p-5"
                        style={{ background: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}>
                        <Dialog.Title className="text-sm font-bold text-[var(--os-text-primary)]">{t('dialog_title')}</Dialog.Title>
                        <Dialog.Description className="text-xs text-[var(--os-text-muted)] mb-3">{t('dialog_subtitle')}</Dialog.Description>
                        <OsSelect label={t('response_label')} value={responseType} onChange={(e) => setResponseType(e.target.value)}
                            options={RESPONSE_TYPES.map((s) => ({ value: s, label: s }))} />
                        {error && <p className="text-xs text-[#EF4444] mt-2">{error}</p>}
                        <div className="flex justify-end gap-2 mt-4">
                            <OsButton size="sm" variant="ghost" onClick={() => setDialogOpen(false)}>{t('cancel')}</OsButton>
                            <OsButton size="sm" variant="primary" loading={pending} onClick={submit}>{t('save')}</OsButton>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

            <Dialog.Root open={escalateTier !== null} onOpenChange={(o) => !o && setEscalateTier(null)}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0" style={{ background: 'rgba(0,0,0,0.6)' }} />
                    <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[440px] max-w-[92vw] rounded-2xl p-5"
                        style={{ background: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}>
                        <Dialog.Title className="text-sm font-bold text-[var(--os-text-primary)]">{t('escalate_dialog_title')}</Dialog.Title>
                        <Dialog.Description className="text-xs text-[var(--os-text-muted)] mb-3">
                            {t('escalate_dialog_subtitle', { tier: escalateTier ?? '', ref: row.invoice_ref ?? row.transaction_id.slice(0, 8) })}
                        </Dialog.Description>
                        {escalateError && <p className="text-xs text-[#EF4444] mt-2">{escalateError}</p>}
                        <div className="flex justify-end gap-2 mt-4">
                            <OsButton size="sm" variant="ghost" onClick={() => setEscalateTier(null)}>{t('cancel')}</OsButton>
                            <OsButton size="sm" variant="danger" loading={escalating} onClick={confirmEscalate}>{t('escalate_confirm')}</OsButton>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </div>
    );
}
