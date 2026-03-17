'use client';

import { useTranslations } from 'next-intl';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import Image from 'next/image';

export function AdminWorkflowSection() {
    const t = useTranslations('Landing');
    const c = useTranslations('Common');

    return (
        <section className="pt-20 pb-16 sm:py-24 px-4 sm:px-6 relative overflow-hidden" style={{ backgroundColor: 'var(--ais-page-bg-alt)' }}>
            <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 sm:gap-12 lg:gap-16 items-center">

                {/* Left Interactive Image Mockup */}
                <div className="relative">
                    {/* Main Image bg */}
                    <div className="relative h-64 sm:h-80 md:h-[400px] w-full rounded-3xl overflow-hidden shadow-2xl">
                        {/* Fallback pattern if image is not ready yet */}
                        <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: 'var(--ais-page-surface)' }}>
                            <span className="text-emerald-500 font-bold opacity-50 text-xl">Hands holding plant (Placeholder)</span>
                        </div>
                    </div>

                    {/* Floating Alert Card matching mockup */}
                    <div className="absolute -bottom-6 -right-4 sm:-bottom-8 sm:-right-8 md:-bottom-10 md:left-10 p-4 sm:p-5 rounded-2xl shadow-xl w-64 sm:w-72 md:w-80" style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}>
                        <div className="flex justify-between items-center mb-4">
                            <span className="text-xs font-bold uppercase" style={{ color: 'var(--ais-page-text-dim)' }}>Deforestation Alert</span>
                            <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Critical</span>
                        </div>

                        {/* Progress bar */}
                        <div className="w-full rounded-full h-2 mb-2" style={{ backgroundColor: 'var(--ais-page-surface)' }}>
                            <div className="bg-red-500 h-2 rounded-full" style={{ width: '85%' }}></div>
                        </div>

                        <div className="flex justify-between text-xs font-medium" style={{ color: 'var(--ais-page-text-dim)' }}>
                            <span>Target: 0%</span>
                            <span>Current: 2.4%</span>
                        </div>
                    </div>
                </div>

                {/* Right Text Content */}
                <div>
                    <h2 className="text-xs font-bold tracking-widest text-emerald-600 uppercase mb-4">
                        {t('admin_badge')}
                    </h2>
                    <h3 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold mb-4 sm:mb-6 leading-tight" style={{ color: 'var(--ais-page-text)' }}>
                        {t('admin_title')}
                    </h3>
                    <p className="text-sm sm:text-base md:text-lg mb-6 sm:mb-10 leading-relaxed" style={{ color: 'var(--ais-page-text-dim)' }}>
                        {t('admin_desc')}
                    </p>

                    <div className="space-y-3 sm:space-y-4 mb-6 sm:mb-10">
                        {[
                            "Role-based access control for multiple government levels",
                            "Automated audit trails for transparency and accountability",
                            "Secure document repository for environmental impact assessments"
                        ].map((item, i) => (
                            <div key={i} className="flex items-start gap-2 sm:gap-3">
                                <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-500 shrink-0 mt-0.5" />
                                <span className="text-sm sm:text-base font-medium" style={{ color: 'var(--ais-page-text-secondary)' }}>{item}</span>
                            </div>
                        ))}
                    </div>

                    <button className="flex items-center gap-2 text-emerald-600 font-semibold hover:text-emerald-700 transition-colors group">
                        {c('view_admin_tools')}
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </button>
                </div>

            </div>
        </section>
    );
}
