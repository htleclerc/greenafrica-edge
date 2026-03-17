'use client';

import { useTranslations } from 'next-intl';
import { CheckCircle2 } from 'lucide-react';
import { sovereignStats } from '@/mock/datas';

export function SovereignSection() {
    const t = useTranslations('Landing');

    return (
        <section className="pt-20 pb-16 sm:py-20 px-4 sm:px-6 relative overflow-hidden" style={{ backgroundColor: 'var(--ais-page-bg-alt)' }}>
            {/* Decorative gradient */}
            <div className="absolute top-0 right-0 w-[300px] sm:w-[500px] h-[300px] sm:h-[500px] bg-emerald-900/20 rounded-full blur-[120px] translate-x-1/3 -translate-y-1/3" />

            <div className="max-w-7xl mx-auto relative z-10">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 sm:gap-10 lg:gap-12 items-center">

                    {/* Left: Text Content */}
                    <div>
                        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4 sm:mb-6 leading-tight" style={{ color: 'var(--ais-page-text)' }}>
                            {t('sovereign_title')}
                        </h2>
                        <p className="text-sm sm:text-base leading-relaxed mb-6 sm:mb-8" style={{ color: 'var(--ais-page-text-muted)' }}>
                            {t('sovereign_desc')}
                        </p>

                        <div className="space-y-4 mb-8">
                            {['sovereign_feat1', 'sovereign_feat2', 'sovereign_feat3'].map((key) => (
                                <div key={key} className="flex items-start gap-3">
                                    <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                                    <span className="text-sm font-medium" style={{ color: 'var(--ais-page-text-secondary)' }}>{t(key)}</span>
                                </div>
                            ))}
                        </div>

                        {/* Stats */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                            <div className="rounded-xl p-4 sm:p-5" style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}>
                                <p className="text-xs font-medium mb-1" style={{ color: 'var(--ais-page-text-dim)' }}>{t('sovereign_carbon_revenue')}</p>
                                <p className="text-2xl font-bold" style={{ color: 'var(--ais-page-text)' }}>{sovereignStats.carbonRevenue}</p>
                                <p className="text-[10px] text-emerald-500 mt-1">{sovereignStats.carbonRevenueSubtitle}</p>
                            </div>
                            <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}>
                                <p className="text-xs font-medium mb-1" style={{ color: 'var(--ais-page-text-dim)' }}>{t('sovereign_active_vessels')}</p>
                                <p className="text-2xl font-bold" style={{ color: 'var(--ais-page-text)' }}>{sovereignStats.activeVessels}</p>
                                <p className="text-[10px] mt-1" style={{ color: 'var(--ais-page-text-muted)' }}>{sovereignStats.activeVesselsSubtitle}</p>
                            </div>
                        </div>
                    </div>

                    {/* Right: AIS Tracking Preview */}
                    <div className="relative">
                        <div className="rounded-2xl p-4 sm:p-6 overflow-hidden" style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}>
                            {/* Map mockup header */}
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h4 className="text-sm font-bold" style={{ color: 'var(--ais-page-text)' }}>{t('sovereign_tracking_title')}</h4>
                                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--ais-page-text-dim)' }}>Berbera Maritime Zone</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                    </span>
                                    <span className="text-[10px] text-emerald-400 font-medium">LIVE</span>
                                </div>
                            </div>

                            {/* Map mockup - dark ocean with grid */}
                            <div
                                className="relative h-48 sm:h-56 md:h-64 rounded-xl overflow-hidden"
                                style={{
                                    backgroundColor: 'var(--ais-page-bg)',
                                    backgroundImage: 'radial-gradient(circle at 60% 40%, rgba(16,185,129,0.08) 0%, transparent 60%), linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
                                    backgroundSize: '100% 100%, 30px 30px, 30px 30px',
                                }}
                            >
                                {/* Simulated coastline */}
                                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 260" fill="none">
                                    <path d="M380 0 C350 40, 340 80, 360 120 C380 160, 340 200, 380 260" stroke="rgba(255,255,255,0.1)" strokeWidth="2" fill="rgba(255,255,255,0.02)" />

                                    {/* ZEE boundary dotted line */}
                                    <path d="M300 0 C270 40, 260 100, 280 160 C300 220, 270 240, 300 260" stroke="rgba(234,179,8,0.3)" strokeWidth="1" strokeDasharray="4 4" fill="none" />

                                    {/* Ship dots - green (paid) */}
                                    <circle cx="180" cy="80" r="4" fill="#10B981" opacity="0.9" />
                                    <circle cx="220" cy="130" r="3" fill="#10B981" opacity="0.7" />
                                    <circle cx="150" cy="160" r="4" fill="#10B981" opacity="0.9" />
                                    <circle cx="250" cy="60" r="3" fill="#10B981" opacity="0.6" />

                                    {/* Ship dots - red/orange (approaching/unpaid) */}
                                    <circle cx="100" cy="100" r="4" fill="#F59E0B" opacity="0.9" />
                                    <circle cx="120" cy="200" r="3" fill="#EF4444" opacity="0.8" />

                                    {/* Emission ring animations */}
                                    <circle cx="180" cy="80" r="12" fill="none" stroke="#10B981" strokeWidth="0.5" opacity="0.3" />
                                    <circle cx="100" cy="100" r="15" fill="none" stroke="#F59E0B" strokeWidth="0.5" opacity="0.3" />
                                </svg>

                                {/* Legend */}
                                <div className="absolute bottom-3 left-3 flex items-center gap-4 text-[9px]" style={{ color: 'var(--ais-page-text-dim)' }}>
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                        <span>Paid</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-2 h-2 rounded-full bg-yellow-500" />
                                        <span>Approaching</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-2 h-2 rounded-full bg-red-500" />
                                        <span>Unpaid</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
