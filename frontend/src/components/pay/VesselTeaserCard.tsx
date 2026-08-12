import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Ship, AlertTriangle, CheckCircle2, Lock, HelpCircle } from 'lucide-react';
import type { TeaserState } from '@/services/vesselTeaserService';

function formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'long', year: 'numeric',
    });
}

/**
 * Rendu des quatre états de la consultation.
 *
 * Le montant n'apparaît pas ici parce qu'il n'existe pas dans `TeaserState` —
 * il n'est pas masqué en CSS, il n'a jamais quitté la base. Ne pas « enrichir »
 * ce composant avec une requête complémentaire.
 */
export async function VesselTeaserCard({ result, query }: { result: TeaserState; query: string }) {
    const t = await getTranslations('VesselLookup');

    if (result.state === 'UNKNOWN') {
        return (
            <section className="os-card p-8 text-center max-w-lg mx-auto">
                <HelpCircle className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--ais-page-text-dim)' }} aria-hidden="true" />
                <h1 className="text-xl font-semibold mb-2" style={{ color: 'var(--ais-page-text)' }}>
                    {t('unknown_heading')}
                </h1>
                <p className="text-sm mb-6" style={{ color: 'var(--ais-page-text-muted)' }}>
                    {t('unknown_body')}
                </p>
                <Link href="/partnership/contact" className="text-emerald-400 hover:underline text-sm font-medium">
                    {t('unknown_cta')}
                </Link>
            </section>
        );
    }

    const { teaser } = result;

    return (
        <section className="os-card p-8 max-w-lg mx-auto">
            <header className="flex items-start gap-3 mb-6">
                <Ship className="w-6 h-6 text-emerald-400 mt-1 shrink-0" aria-hidden="true" />
                <div>
                    <h1 className="text-xl font-semibold" style={{ color: 'var(--ais-page-text)' }}>
                        {teaser.vesselName}
                    </h1>
                    <p className="text-xs font-mono mt-1" style={{ color: 'var(--ais-page-text-dim)' }}>
                        {t('imo_label')} {teaser.imoNumber}
                        {teaser.portCall ? ` · ${teaser.portCall}` : ''}
                    </p>
                </div>
            </header>

            {result.state === 'CLEAR' ? (
                <>
                    <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" aria-hidden="true" />
                        <h2 className="text-base font-semibold text-emerald-400">{t('clear_heading')}</h2>
                    </div>
                    <p className="text-sm mb-6" style={{ color: 'var(--ais-page-text-muted)' }}>
                        {t('clear_body')}
                    </p>
                    <Link
                        href="/signup"
                        className="block text-center px-6 py-3 rounded-xl font-semibold bg-emerald-600
                                   hover:bg-emerald-500 transition-colors"
                        style={{ color: '#FFFFFF' }}
                    >
                        {t('clear_cta')}
                    </Link>
                </>
            ) : (
                <>
                    <div className="flex items-center gap-2 mb-3">
                        <AlertTriangle className="w-5 h-5 text-yellow-400" aria-hidden="true" />
                        <h2 className="text-base font-semibold text-yellow-400">
                            {t('outstanding_count', { count: teaser.outstandingCount })}
                        </h2>
                    </div>

                    <dl className="text-sm space-y-1 mb-4" style={{ color: 'var(--ais-page-text-muted)' }}>
                        <div>{t('outstanding_due', { date: formatDate(teaser.earliestDueDate) })}</div>
                        {teaser.hasOverdue && (
                            <div className="text-red-400 font-medium">{t('outstanding_overdue')}</div>
                        )}
                    </dl>

                    <div
                        className="flex items-center gap-2 px-4 py-3 rounded-lg mb-6 text-sm"
                        style={{ backgroundColor: 'var(--ais-page-surface)', color: 'var(--ais-page-text-dim)' }}
                    >
                        <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
                        {t('outstanding_amount_locked')}
                    </div>

                    <Link
                        href={`/pay/claim?q=${encodeURIComponent(query)}`}
                        className="block text-center px-6 py-3 rounded-xl font-semibold bg-emerald-600
                                   hover:bg-emerald-500 transition-colors"
                        style={{ color: '#FFFFFF' }}
                    >
                        {t('outstanding_cta')}
                    </Link>
                    <p className="text-xs text-center mt-2" style={{ color: 'var(--ais-page-text-dim)' }}>
                        {t('outstanding_cta_sub')}
                    </p>
                </>
            )}
        </section>
    );
}
