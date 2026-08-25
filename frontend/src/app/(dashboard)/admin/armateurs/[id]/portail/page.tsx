import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getArmateurDetail } from '@/services/armateurService';
import { ownerAccessBlockers } from '@/lib/ownerAccessBlockers';
import { OsCard, OsCardHeader } from '@/components/ui/OsCard';
import { OsBadge } from '@/components/ui/OsBadge';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];
const OPEN_STATUSES = ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'];

const usd = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

/**
 * « Ce que voit l'armateur » — rendu LECTURE SEULE, côté serveur.
 *
 * Aucune session n'est ouverte au nom du débiteur et aucune action n'est
 * offerte : ce n'est pas une impersonation. Le portail armateur sert à payer,
 * déposer un KYC et déclarer un IBAN ; y agir à la place de quelqu'un est une
 * capacité d'un tout autre ordre, délibérément non construite ici.
 *
 * Les données proviennent de `getArmateurDetail`, déjà bornée à cet armateur
 * et à la juridiction de l'appelant. On ne réutilise SURTOUT PAS
 * `getOwnerCounters`, qui s'appuie sur la RLS de l'armateur connecté : avec un
 * client staff, elle rendrait les chiffres de toute la plateforme sous le nom
 * d'un seul débiteur.
 */
export default async function PortailArmateurPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    if (!profile || !ALLOWED_ROLES.includes(profile.role)) redirect('/dashboard');

    const canViewBilling = ['SUPERADMIN', 'FINANCE_ADMIN'].includes(profile.role);
    const detail = await getArmateurDetail(supabase, id, canViewBilling);
    if (!detail) notFound();

    const t = await getTranslations('AdminOwnerView');
    const open = detail.proformas.filter((p) => OPEN_STATUSES.includes(p.status));
    const blockers = ownerAccessBlockers({
        officialEmail: detail.official_email,
        accountState: detail.account_state,
        isOfacSdn: detail.is_ofac_sdn,
        isUnProhibited: detail.is_un_prohibited,
    });
    const now = Date.now();

    return (
        <div className="px-6 py-4 flex flex-col gap-4">
            <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-semibold text-[var(--os-text-primary)]">{detail.name}</h1>
                <OsBadge variant="info" label={t('readOnly')} />
                <Link href={`/admin/armateurs/${id}`} className="text-xs text-[#00D97E] hover:underline">
                    {t('backToFile')}
                </Link>
            </div>
            <p className="text-sm text-[var(--os-text-muted)] max-w-2xl">{t('intro')}</p>

            {blockers.length > 0 && (
                <OsCard>
                    <OsCardHeader title={t('blockersTitle')} />
                    <p className="text-xs text-[var(--os-text-muted)] mb-3">{t('blockersHint')}</p>
                    <ul className="flex flex-col gap-2">
                        {blockers.map((b) => (
                            <li key={b} className="flex items-start gap-2.5 text-sm">
                                <OsBadge variant={b === 'SANCTIONED' ? 'critical' : 'warning'} label={t(`blocker.${b}.label`)} size="sm" />
                                <span className="text-[var(--os-text-secondary)]">{t(`blocker.${b}.detail`)}</span>
                            </li>
                        ))}
                    </ul>
                </OsCard>
            )}

            <OsCard>
                <OsCardHeader title={t('owedTitle')} />
                <div className="flex flex-wrap gap-8 mb-4">
                    <Figure label={t('owedTotal')} value={usd(detail.totals.outstandingUsd)} strong />
                    <Figure label={t('owedCount')} value={String(open.length)} />
                    <Figure label={t('paidTotal')} value={usd(detail.totals.paidUsd)} />
                </div>
                {open.length === 0 ? (
                    <p className="text-sm text-[var(--os-text-muted)]">{t('nothingOwed')}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-[var(--os-border)]">
                                    {['invoice', 'issued', 'due', 'amount', 'outstanding'].map((k) => (
                                        <th key={k} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
                                            {t(`col.${k}`)}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {open.map((p) => {
                                    const late = p.due_date ? new Date(p.due_date).getTime() < now : false;
                                    return (
                                        <tr key={p.id} className="border-b border-[var(--os-border)] last:border-0">
                                            <td className="px-3 py-2 font-mono text-xs">{p.invoice_ref ?? '—'}</td>
                                            <td className="px-3 py-2 text-xs text-[var(--os-text-muted)]">
                                                {new Date(p.created_at).toLocaleDateString()}
                                            </td>
                                            <td className="px-3 py-2 text-xs">
                                                {p.due_date ? new Date(p.due_date).toLocaleDateString() : '—'}
                                                {late && <OsBadge variant="overdue" label={t('late')} size="sm" className="ml-2" />}
                                            </td>
                                            <td className="px-3 py-2 text-right text-xs tabular-nums">{usd(p.tax_amount_usd)}</td>
                                            <td className="px-3 py-2 text-right text-xs tabular-nums font-semibold">
                                                {usd(p.outstanding_usd)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </OsCard>

            <OsCard>
                <OsCardHeader title={t('accountTitle')} />
                <div className="flex flex-wrap gap-8">
                    <Figure label={t('accountState')} value={detail.account_state} />
                    <Figure label={t('billingEmail')} value={detail.official_email ?? t('none')} />
                    <Figure
                        label={t('kycB')}
                        value={detail.kyc_level_b_completed_at ? new Date(detail.kyc_level_b_completed_at).toLocaleDateString() : t('none')}
                    />
                    <Figure
                        label={t('kycC')}
                        value={detail.kyc_level_c_completed_at ? new Date(detail.kyc_level_c_completed_at).toLocaleDateString() : t('none')}
                    />
                </div>
            </OsCard>
        </div>
    );
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
    return (
        <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">{label}</span>
            <span className={`tabular-nums ${strong ? 'text-xl font-bold text-[var(--os-text-primary)]' : 'text-sm text-[var(--os-text-primary)]'}`}>
                {value}
            </span>
        </div>
    );
}
