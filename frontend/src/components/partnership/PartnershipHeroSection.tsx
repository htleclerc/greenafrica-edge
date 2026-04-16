'use client';

import { useTranslations } from 'next-intl';
import { Landmark, Handshake, Globe, Zap } from 'lucide-react';

const COLOR_MAP: Record<string, { bg: string; text: string }> = {
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
    yellow:  { bg: 'bg-yellow-500/10',  text: 'text-yellow-400' },
    blue:    { bg: 'bg-blue-500/10',    text: 'text-blue-400' },
    purple:  { bg: 'bg-purple-500/10',  text: 'text-purple-400' },
};

const STATS = [
    { icon: Landmark, color: 'emerald', key: 'stat_partner' },
    { icon: Handshake, color: 'yellow', key: 'stat_agreement' },
    { icon: Globe, color: 'blue', key: 'stat_scope' },
    { icon: Zap, color: 'purple', key: 'stat_system' },
];

export function PartnershipHeroSection() {
    const t = useTranslations('Partnership');

    return (
        <section className="relative pt-24 sm:pt-28 md:pt-32 pb-12 sm:pb-16 md:pb-24 px-3 sm:px-4 md:px-6 overflow-hidden" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            {/* Background gradients */}
            <div className="absolute top-0 left-1/4 w-[300px] sm:w-[500px] lg:w-[600px] h-[400px] bg-emerald-900/15 rounded-full blur-[150px]" />
            <div className="absolute bottom-0 right-1/4 w-[300px] sm:w-[400px] h-[300px] bg-yellow-900/10 rounded-full blur-[120px]" />
            <div
                className="absolute inset-0 opacity-[0.025]"
                style={{
                    backgroundImage:
                        'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
                    backgroundSize: '60px 60px',
                }}
            />

            <div className="max-w-7xl mx-auto relative z-10">
                {/* Badge */}
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-[10px] font-bold tracking-[0.2em] uppercase mb-6">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500" />
                    </span>
                    {t('hero_badge')}
                </div>

                <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 leading-tight" style={{ color: 'var(--ais-page-text)' }}>
                    {t('hero_title_line1')}{' '}
                    <span className="bg-gradient-to-r from-yellow-400 via-emerald-300 to-emerald-400 bg-clip-text text-transparent">
                        {t('hero_title_line2')}
                    </span>
                </h1>
                <p className="text-sm sm:text-base max-w-3xl leading-relaxed mb-12" style={{ color: 'var(--ais-page-text-muted)' }}>
                    {t('hero_subtitle')}
                </p>

                {/* Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {STATS.map(({ icon: Icon, color, key }) => (
                        <div
                            key={key}
                            className="rounded-2xl p-6 hover:border-emerald-500/20 transition-all duration-300"
                            style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}
                        >
                            <div className={`w-10 h-10 rounded-xl ${COLOR_MAP[color].bg} flex items-center justify-center mb-4`}>
                                <Icon className={`w-5 h-5 ${COLOR_MAP[color].text}`} />
                            </div>
                            <p className="text-lg font-bold mb-1" style={{ color: 'var(--ais-page-text)' }}>{t(`${key}_value`)}</p>
                            <p className="text-xs font-medium" style={{ color: 'var(--ais-page-text-dim)' }}>{t(`${key}_label`)}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
