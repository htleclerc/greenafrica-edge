'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { ShieldCheck, ArrowRight, Globe, Landmark, FileCheck, Link2 } from 'lucide-react';

const COLOR_MAP: Record<string, { bg: string; text: string }> = {
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
    yellow:  { bg: 'bg-yellow-500/10',  text: 'text-yellow-400' },
    blue:    { bg: 'bg-blue-500/10',    text: 'text-blue-400' },
    purple:  { bg: 'bg-purple-500/10',  text: 'text-purple-400' },
};

const INTEGRATION_POINTS = [
    { icon: Landmark, key: 'int_policy', color: 'emerald' },
    { icon: ShieldCheck, key: 'int_registry', color: 'yellow' },
    { icon: FileCheck, key: 'int_compliance', color: 'blue' },
    { icon: Link2, key: 'int_interop', color: 'purple' },
];

export function AscrPage() {
    const t = useTranslations('Ascr');

    return (
        <main className="min-h-screen" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <Navbar activePage="about" />

            {/* Hero */}
            <section className="relative pt-24 sm:pt-28 md:pt-32 pb-12 sm:pb-16 md:pb-24 px-3 sm:px-4 md:px-6 overflow-hidden" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
                <div className="absolute top-0 left-1/4 w-[500px] h-[400px] bg-emerald-900/15 rounded-full blur-[150px]" />
                <div className="absolute bottom-0 right-1/4 w-[400px] h-[300px] bg-yellow-900/10 rounded-full blur-[120px]" />
                <div
                    className="absolute inset-0 opacity-[0.025]"
                    style={{
                        backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
                        backgroundSize: '60px 60px',
                    }}
                />

                <div className="max-w-7xl mx-auto relative z-10">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold tracking-[0.2em] uppercase mb-6">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </span>
                        {t('hero_badge')}
                    </div>

                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 leading-tight" style={{ color: 'var(--ais-page-text)' }}>
                        {t('hero_title_line1')}{' '}
                        <span className="bg-gradient-to-r from-emerald-400 via-emerald-300 to-yellow-400 bg-clip-text text-transparent">
                            {t('hero_title_line2')}
                        </span>
                    </h1>
                    <p className="text-sm sm:text-base max-w-3xl leading-relaxed" style={{ color: 'var(--ais-page-text-muted)' }}>
                        {t('hero_subtitle')}
                    </p>
                </div>
            </section>

            {/* How it works — complementary positioning */}
            <section className="py-16 sm:py-20 md:py-24 px-3 sm:px-4 md:px-6" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
                <div className="max-w-7xl mx-auto">
                    {/* Architecture diagram */}
                    <div className="mb-12 max-w-3xl">
                        <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-emerald-400 mb-3">{t('arch_badge')}</p>
                        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4" style={{ color: 'var(--ais-page-text)' }}>
                            {t('arch_title')}
                        </h2>
                        <p className="text-sm sm:text-base leading-relaxed" style={{ color: 'var(--ais-page-text-muted)' }}>
                            {t('arch_desc')}
                        </p>
                    </div>

                    {/* Visual pipeline */}
                    <div
                        className="rounded-2xl p-6 sm:p-8 mb-12 font-mono text-xs sm:text-sm overflow-x-auto"
                        style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)', color: 'var(--ais-page-text-muted)' }}
                    >
                        <pre className="whitespace-pre leading-relaxed">
{`  ASCR                          GREEN GATE
  (Policy & Registry)           (Operations & Collection)
  ┌─────────────────┐           ┌─────────────────────────┐
  │ Polluter Pays   │           │ AIS Vessel Tracking     │
  │ Framework       │◄─────────►│ EEZ Boundary Detection  │
  │                 │  aligned   │ Emission Calculation    │
  │ Carbon Registry │           │ Invoice Generation      │
  │ (AU-endorsed)   │◄─────────►│ Payment Processing      │
  │                 │  reports   │ Audit Trail             │
  │ Verification &  │           │                         │
  │ Certification   │◄─────────►│ Hash-Chained Records    │
  └─────────────────┘  verifies └─────────────────────────┘
        │                               │
        └───────────┬───────────────────┘
                    ▼
        ┌───────────────────────┐
        │ Sovereign Revenue     │
        │ for African States    │
        └───────────────────────┘`}
                        </pre>
                    </div>

                    {/* Integration points */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        {INTEGRATION_POINTS.map(({ icon: Icon, key, color }) => (
                            <div
                                key={key}
                                className="rounded-2xl p-8 hover:border-emerald-500/20 transition-all duration-300 flex gap-5"
                                style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
                            >
                                <div className={`w-12 h-12 rounded-xl ${COLOR_MAP[color].bg} flex items-center justify-center flex-shrink-0`}>
                                    <Icon className={`w-6 h-6 ${COLOR_MAP[color].text}`} />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold mb-2" style={{ color: 'var(--ais-page-text)' }}>
                                        {t(`${key}_title`)}
                                    </h3>
                                    <p className="text-sm leading-relaxed" style={{ color: 'var(--ais-page-text-muted)' }}>
                                        {t(`${key}_desc`)}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* CTA */}
            <section className="relative py-16 sm:py-20 md:py-24 px-3 sm:px-4 md:px-6 overflow-hidden" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-emerald-900/10 rounded-full blur-[180px]" />
                <div className="max-w-4xl mx-auto relative z-10 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-8">
                        <Globe className="w-8 h-8 text-emerald-400" />
                    </div>
                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-6" style={{ color: 'var(--ais-page-text)' }}>
                        {t('cta_title')}
                    </h2>
                    <p className="text-sm sm:text-base leading-relaxed mb-10 max-w-2xl mx-auto" style={{ color: 'var(--ais-page-text-muted)' }}>
                        {t('cta_desc')}
                    </p>
                    <Link
                        href="/partnership/contact"
                        className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-8 py-3 rounded-xl transition-all hover:shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                    >
                        {t('cta_btn')}
                        <ArrowRight className="w-4 h-4" />
                    </Link>
                </div>
            </section>

            <Footer />
        </main>
    );
}
