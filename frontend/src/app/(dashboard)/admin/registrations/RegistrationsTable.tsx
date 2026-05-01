'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { OsTable } from '@/components/ui/OsTable';
import { OsBadge } from '@/components/ui/OsBadge';
import { ReviewActionsDialog } from './ReviewActionsDialog';

interface Row {
    id: string;
    name: string;
    imo_company_no: string;
    country_code: string;
    official_email: string;
    proof_doc_url: string | null;
    proof_doc_type: string | null;
    account_state: string;
    kyc_level_b_completed_at: string | null;
    created_at: string;
}

export function RegistrationsTable({
    rows,
    status,
    canAction,
}: {
    rows: Row[];
    status: string;
    canAction: boolean;
}) {
    const t = useTranslations('AdminRegistrations');
    const router = useRouter();
    const [active, setActive] = useState<Row | null>(null);

    const ageInHours = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 36e5);

    const columns = [
        {
            key: 'created_at',
            header: t('cols.received'),
            render: (r: Row) => {
                const h = ageInHours(r.created_at);
                return <span className={h > 48 ? 'text-red-400 font-semibold' : ''}>{h}h</span>;
            },
        },
        {
            key: 'name',
            header: t('cols.name'),
            render: (r: Row) => r.name,
        },
        {
            key: 'imo_company_no',
            header: t('cols.imo'),
            render: (r: Row) => r.imo_company_no,
        },
        {
            key: 'country_code',
            header: t('cols.country'),
            render: (r: Row) => r.country_code,
        },
        {
            key: 'official_email',
            header: t('cols.email'),
            render: (r: Row) => r.official_email,
        },
        {
            key: 'proof',
            header: t('cols.proof'),
            render: (r: Row) =>
                r.proof_doc_url ? (
                    <a
                        href={`/api/admin/kyc-doc?path=${encodeURIComponent(r.proof_doc_url)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:no-underline text-[var(--os-highlight)]"
                    >
                        {r.proof_doc_type || 'Document'}
                    </a>
                ) : (
                    '—'
                ),
        },
        {
            key: 'actions',
            header: '',
            render: (r: Row) =>
                status === 'PENDING_REVIEW' && canAction ? (
                    <button
                        onClick={() => setActive(r)}
                        className="px-3 py-1 bg-[var(--os-highlight)] hover:bg-[var(--os-highlight)]/90 text-[var(--os-text-primary)] rounded text-sm font-semibold transition-colors"
                    >
                        {t('actions.review')}
                    </button>
                ) : (
                    <OsBadge label={r.account_state} variant="pending" />
                ),
        },
    ];

    return (
        <>
            <OsTable
                columns={columns}
                rows={rows}
                keyExtractor={(r) => r.id}
                emptyMessage={t('empty')}
            />
            {active && (
                <ReviewActionsDialog
                    shipowner={active}
                    canAction={canAction}
                    onClose={() => setActive(null)}
                    onActionComplete={() => {
                        setActive(null);
                        router.refresh();
                    }}
                />
            )}
        </>
    );
}
