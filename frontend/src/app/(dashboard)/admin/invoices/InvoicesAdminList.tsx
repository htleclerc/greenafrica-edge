'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Download, ShieldCheck } from 'lucide-react';
import { OsTable, type OsColumn, type OsSort } from '@/components/ui/OsTable';
import { OsBadge, type BadgeVariant } from '@/components/ui/OsBadge';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput, OsSelect } from '@/components/ui/OsInput';
import type {
    InvoiceAdminRow,
    InvoiceAdminFilters,
    InvoiceFilterOptions,
} from '@/services/invoiceAdminService';

interface Props {
    rows: InvoiceAdminRow[];
    total: number;
    page: number;
    pageSize: number;
    filters: InvoiceAdminFilters;
    options: InvoiceFilterOptions;
    /** id interne -> reference opaque exposee dans l'URL (mig 144). */
    refs: Record<string, string>;
}

const DOC_TYPES = ['PROFORMA', 'FINAL', 'COMPLEMENT', 'REFUND'] as const;
const MODES = ['MARITIME', 'AIR'] as const;
// Valeurs réelles de l'énumération transaction_status. PARTIAL et CANCELLED n'existaient
// pas côté DB : le filtre passait ces valeurs telles quelles à .eq('status', …) et ne
// pouvait donc jamais rien retourner.
const STATUSES = ['PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'DISPUTED', 'VOID'] as const;

function docVariant(d: InvoiceAdminRow['document_type']): BadgeVariant {
    if (d === 'PROFORMA') return 'warning';
    if (d === 'FINAL') return 'active';
    if (d === 'COMPLEMENT') return 'info';
    return 'archived'; // REFUND
}

function statusVariant(s: string): BadgeVariant {
    if (s === 'PAID') return 'active';
    if (s === 'OVERDUE') return 'critical';
    if (s === 'PENDING' || s === 'PARTIALLY_PAID') return 'warning';
    if (s === 'DISPUTED') return 'disputed';
    if (s === 'VOID') return 'archived';
    return 'info';
}

function usd(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

export function InvoicesAdminList({ rows, total, page, pageSize, filters, options, refs }: Props) {
    const t = useTranslations('AdminInvoices');
    const router = useRouter();
    const searchParams = useSearchParams();
    const [search, setSearch] = React.useState(filters.search ?? '');

    // Met a jour un parametre d'URL et reinitialise la page (sauf pour 'page').
    const setParam = React.useCallback(
        (key: string, value: string | null) => {
            const params = new URLSearchParams(searchParams.toString());
            if (value === null || value === '') params.delete(key);
            else params.set(key, value);
            if (key !== 'page') params.delete('page');
            router.push(`?${params.toString()}`);
        },
        [router, searchParams],
    );

    const onSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setParam('search', search.trim() || null);
    };

    // Tri serveur : la clé et la direction vivent dans l'URL, comme les autres filtres.
    const sort: OsSort | null = filters.sortKey ? { key: filters.sortKey, dir: filters.sortDir ?? 'asc' } : null;
    const onSortChange = (next: OsSort) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('sortKey', next.key);
        params.set('sortDir', next.dir);
        params.delete('page'); // un changement de tri renvoie en page 1
        router.push(`?${params.toString()}`);
    };

    // Les `key` triables ci-dessous doivent correspondre exactement à INVOICE_SORT_KEYS
    // (service). 'mode', 'flag', 'due' et 'actions' n'ont pas d'équivalent dans la liste
    // blanche : non triables.
    const columns: OsColumn<InvoiceAdminRow>[] = [
        {
            key: 'invoice_ref',
            header: t('col_ref'),
            sortable: true,
            render: (r) => (
                <span className="font-mono text-xs text-[var(--os-text-primary)]">
                    {r.invoice_ref ?? r.id.slice(0, 8)}
                </span>
            ),
        },
        { key: 'document_type', header: t('col_type'), sortable: true, render: (r) => <OsBadge variant={docVariant(r.document_type)} label={r.document_type} /> },
        { key: 'mode', header: t('col_mode'), render: (r) => <OsBadge variant={r.mode === 'AIR' ? 'info' : 'draft'} label={r.mode} /> },
        { key: 'debtor_name', header: t('col_debtor'), sortable: true, render: (r) => <span className="text-sm">{r.debtor_name ?? '—'}</span> },
        { key: 'flag', header: t('col_flag'), render: (r) => <span className="text-sm tabular-nums">{r.flag_country ?? '—'}</span> },
        { key: 'jurisdiction_name', header: t('col_jurisdiction'), sortable: true, render: (r) => <span className="text-sm">{r.jurisdiction_name ?? '—'}</span> },
        {
            key: 'created_at',
            header: t('col_created'),
            sortable: true,
            render: (r) => <span className="text-xs text-[var(--os-text-muted)] tabular-nums">{new Date(r.created_at).toLocaleDateString()}</span>,
        },
        { key: 'tax_amount_usd', header: t('col_amount'), className: 'text-right', sortable: true, render: (r) => <span className="font-mono text-sm tabular-nums">{usd(r.tax_amount_usd)}</span> },
        {
            key: 'due',
            header: t('col_due'),
            className: 'text-right',
            render: (r) => (
                <span className={`font-mono text-sm tabular-nums ${r.outstanding_usd > 0 ? 'text-[#F59E0B] font-semibold' : 'text-[var(--os-text-muted)]'}`}>
                    {usd(r.outstanding_usd)}
                </span>
            ),
        },
        { key: 'status', header: t('col_status'), sortable: true, render: (r) => <OsBadge variant={statusVariant(r.status)} label={r.status} /> },
        {
            key: 'actions',
            header: '',
            className: 'text-right',
            render: (r) => {
                const canLink = Boolean(r.invoice_ref && r.content_hash && r.verify_signature);
                if (!canLink) return <span className="text-xs text-[var(--os-text-muted)]">—</span>;
                const ref = encodeURIComponent(r.invoice_ref as string);
                const verifyHref = `/verify/${ref}?h=${encodeURIComponent(r.content_hash as string)}&s=${encodeURIComponent(r.verify_signature as string)}`;
                return (
                    <div className="flex justify-end items-center gap-3" onClick={(e) => e.stopPropagation()}>
                        <a href={`/api/invoices/${ref}/download`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:underline">
                            <Download className="w-3.5 h-3.5" /> {t('action_pdf')}
                        </a>
                        <a href={verifyHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-[var(--os-text-muted)] hover:text-[#10B981]">
                            <ShieldCheck className="w-3.5 h-3.5" /> {t('action_verify')}
                        </a>
                    </div>
                );
            },
        },
    ];

    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);
    const hasPrev = page > 1;
    const hasNext = page * pageSize < total;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
                <OsSelect label={t('f_type')} value={filters.documentType ?? ''} onChange={(e) => setParam('documentType', e.target.value || null)}
                    options={[{ value: '', label: t('all') }, ...DOC_TYPES.map((d) => ({ value: d, label: d }))]} />
                <OsSelect label={t('f_mode')} value={filters.mode ?? ''} onChange={(e) => setParam('mode', e.target.value || null)}
                    options={[{ value: '', label: t('all') }, ...MODES.map((m) => ({ value: m, label: m }))]} />
                <OsSelect label={t('f_status')} value={filters.status ?? ''} onChange={(e) => setParam('status', e.target.value || null)}
                    options={[{ value: '', label: t('all') }, ...STATUSES.map((s) => ({ value: s, label: s }))]} />
                <OsSelect label={t('f_jurisdiction')} value={filters.jurisdictionId ?? ''} onChange={(e) => setParam('jurisdictionId', e.target.value || null)}
                    options={[{ value: '', label: t('all') }, ...options.jurisdictions.map((j) => ({ value: j.id, label: j.name }))]} />
                <OsSelect label={t('f_flag')} value={filters.flagCountry ?? ''} onChange={(e) => setParam('flagCountry', e.target.value || null)}
                    options={[{ value: '', label: t('all') }, ...options.flagCountries.map((c) => ({ value: c, label: c }))]} />
                <OsInput label={t('f_date_from')} type="date" value={filters.dateFrom ?? ''} onChange={(e) => setParam('dateFrom', e.target.value || null)} />
                <OsInput label={t('f_date_to')} type="date" value={filters.dateTo ?? ''} onChange={(e) => setParam('dateTo', e.target.value || null)} />
                <label className="flex items-center gap-2 text-sm text-[var(--os-text-muted)] pb-2">
                    <input type="checkbox" checked={filters.dueOnly ?? false} onChange={(e) => setParam('dueOnly', e.target.checked ? '1' : null)} />
                    {t('f_due_only')}
                </label>
                <form onSubmit={onSearchSubmit} className="flex-1 min-w-[200px]">
                    <OsInput label={t('f_search')} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('f_search_ph')} />
                </form>
            </div>

            <OsTable
                columns={columns}
                rows={rows}
                keyExtractor={(r) => r.id}
                onRowClick={(r) => { const ref = r.shipowner_id ? refs[r.shipowner_id] : undefined; if (ref) router.push(`/admin/armateurs/${ref}`); }}
                emptyMessage={t('empty')}
                sort={sort}
                onSortChange={onSortChange}
            />

            <div className="flex items-center justify-between text-sm text-[var(--os-text-muted)]">
                <span className="tabular-nums">{t('pagination', { start, end, total })}</span>
                <div className="flex gap-2">
                    <OsButton size="sm" variant="secondary" disabled={!hasPrev} onClick={() => setParam('page', String(page - 1))}>{t('prev')}</OsButton>
                    <OsButton size="sm" variant="secondary" disabled={!hasNext} onClick={() => setParam('page', String(page + 1))}>{t('next')}</OsButton>
                </div>
            </div>
        </div>
    );
}
