'use client';

import { useTranslations } from 'next-intl';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import type { CoverageCountry } from '@/components/landing/coverage';
import { actionsFor } from '@/components/jurisdictions/actions';

export function JurisdictionPage({ country }: Readonly<{ country: CoverageCountry }>) {
    const t = useTranslations('Jurisdiction');
    const l = useTranslations('Landing');

    const name = l(`coverage_country_${country.key}`);
    const modes = country.modes.map((m) => l(`coverage_mode_${m.toLowerCase()}`)).join(' + ');
    const isLive = country.status === 'live';
    const flagWidth = Math.round(44 * country.ratio);

    return (
        <main className="min-h-screen" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <Navbar activePage="overview" />

            <section className="pt-24 sm:pt-28 pb-10 sm:pb-14 px-3 sm:px-6 relative overflow-hidden" style={{ backgroundColor: 'var(--ais-page-bg-alt)' }}>
                <div className="absolute top-0 right-1/4 w-[300px] sm:w-[480px] h-[300px] sm:h-[480px] bg-emerald-900/15 rounded-full blur-[140px] translate-x-1/2 -translate-y-1/3" />

                <div className="max-w-4xl mx-auto relative z-10">
                    <Link
                        href="/"
                        className="inline-flex items-center gap-1.5 text-[11px] mb-6 hover:underline"
                        style={{ color: 'var(--ais-page-text-muted)' }}
                    >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        {t('back_to_coverage')}
                    </Link>

                    <div className="flex items-center gap-4 mb-4">
                        <span
                            className="shrink-0 overflow-hidden rounded-[4px]"
                            style={{ width: flagWidth, height: 44, border: '1px solid var(--ais-page-border)' }}
                        >
                            <Image src={country.flag} alt="" width={flagWidth} height={44} unoptimized />
                        </span>
                        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight" style={{ color: 'var(--ais-page-text)' }}>
                            {name}
                        </h1>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mb-5">
                        {isLive ? (
                            <span className="coverage-live coverage-track inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em]">
                                <span className="relative flex h-1.5 w-1.5">
                                    <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                </span>
                                {l('coverage_status_live')}
                            </span>
                        ) : (
                            <span className="coverage-pending coverage-track inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em]" style={{ border: '1px dashed var(--ais-page-border)' }}>
                                {l('coverage_status_pipeline')}
                            </span>
                        )}
                        <span className="coverage-track inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--ais-page-text-muted)', border: '1px solid var(--ais-page-border)' }}>
                            {modes}
                        </span>
                        {isLive && (
                            <span className="text-[11px]" style={{ color: 'var(--ais-page-text-muted)' }}>
                                {l(`coverage_site_${country.key}`)}
                            </span>
                        )}
                    </div>

                    <p className="text-sm sm:text-base leading-relaxed max-w-2xl" style={{ color: 'var(--ais-page-text-muted)' }}>
                        {isLive ? t('intro_live', { name }) : t('intro_pipeline', { name })}
                    </p>
                </div>
            </section>

            <section className="py-12 sm:py-16 px-3 sm:px-6" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
                <div className="max-w-4xl mx-auto">
                    <h2 className="text-xl sm:text-2xl font-bold mb-6" style={{ color: 'var(--ais-page-text)' }}>
                        {t('actions_title')}
                    </h2>

                    <ul role="list" className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 list-none">
                        {actionsFor(country).map((action) => (
                            <li key={action.key}>
                                <Link
                                    href={action.href}
                                    className="group flex h-full items-start gap-4 rounded-2xl p-5 transition-colors hover:bg-emerald-500/5"
                                    style={{
                                        backgroundColor: 'var(--ais-page-card)',
                                        border: action.primary
                                            ? '1px solid rgba(16, 185, 129, 0.25)'
                                            : '1px solid var(--ais-page-border)',
                                    }}
                                >
                                    <span className="w-10 h-10 shrink-0 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                                        <action.icon className="w-5 h-5 text-emerald-400" />
                                    </span>
                                    <span className="min-w-0">
                                        <span className="flex items-center gap-1.5 text-sm font-bold" style={{ color: 'var(--ais-page-text)' }}>
                                            {t(`action_${action.key}_title`)}
                                            <ArrowRight className="w-3.5 h-3.5 opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0 text-emerald-400" />
                                        </span>
                                        <span className="block text-[13px] leading-relaxed mt-1" style={{ color: 'var(--ais-page-text-muted)' }}>
                                            {t(`action_${action.key}_desc`)}
                                        </span>
                                    </span>
                                </Link>
                            </li>
                        ))}
                    </ul>

                    {/* Dire noir sur blanc qu'on n'encaisse rien ici : une page
                        dédiée par pays laisse autrement croire le contraire. */}
                    {!isLive && (
                        <p className="text-[12px] leading-relaxed mt-6 rounded-xl p-4" style={{ color: 'var(--ais-page-text-muted)', border: '1px dashed var(--ais-page-border)' }}>
                            {t('pipeline_notice', { name })}
                        </p>
                    )}
                </div>
            </section>

            <Footer />
        </main>
    );
}
