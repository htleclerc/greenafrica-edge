'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Linkedin, Twitter, Youtube } from 'lucide-react';
import { AfricGreenLogo } from '@/components/ui/AfricGreenLogo';

const PLATFORM_ROUTES: Record<string, string> = {
    overview:       '/',
    carbon_tax:     '/carbon-tax',
    carbon_credits: '/carbon-credits',
    projects:       '/projects',
    reports:        '/reports',
};

const SUPPORT_ROUTES: Record<string, string> = {
    help_center:      '/terms-of-service',
    contact_support:  '/terms-of-service',
    privacy_policy:   '/privacy-policy',
    terms_of_service: '/terms-of-service',
    security_audit:   '/security-audit',
};

export function Footer() {
    const t = useTranslations('Footer');

    return (
        <footer className="pt-16 pb-8 px-6" style={{ backgroundColor: 'var(--ais-footer-bg)', color: 'var(--ais-footer-text)', borderTop: '1px solid var(--ais-footer-border)' }}>
            <div className="max-w-7xl mx-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 mb-12">

                    {/* Brand Column */}
                    <div>
                        <div className="flex items-center gap-2.5 mb-5">
                            <AfricGreenLogo size={32} variant="dark" className="rounded-lg" />
                            <span className="text-lg font-bold tracking-tight" style={{ color: 'var(--ais-footer-text-bright)' }}>Green Gate</span>
                        </div>
                        <p className="text-sm leading-relaxed mb-6 pr-4" style={{ color: 'var(--ais-footer-text)' }}>
                            {t('brand_desc')}
                        </p>
                        <div className="flex gap-3">
                            <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-emerald-500 hover:text-white transition-colors" style={{ backgroundColor: 'var(--ais-social-bg)', color: 'var(--ais-footer-text)' }}>
                                <Linkedin className="w-4 h-4" />
                            </a>
                            <a href="https://x.com" target="_blank" rel="noopener noreferrer" className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-emerald-500 hover:text-white transition-colors" style={{ backgroundColor: 'var(--ais-social-bg)', color: 'var(--ais-footer-text)' }}>
                                <Twitter className="w-4 h-4" />
                            </a>
                            <a href="https://youtube.com" target="_blank" rel="noopener noreferrer" className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-emerald-500 hover:text-white transition-colors" style={{ backgroundColor: 'var(--ais-social-bg)', color: 'var(--ais-footer-text)' }}>
                                <Youtube className="w-4 h-4" />
                            </a>
                        </div>
                    </div>

                    {/* Platform Links */}
                    <div>
                        <h4 className="font-semibold mb-5 text-sm" style={{ color: 'var(--ais-footer-text-bright)' }}>{t('platform')}</h4>
                        <ul className="space-y-1 text-sm">
                            {Object.entries(PLATFORM_ROUTES).map(([key, href]) => (
                                <li key={key}>
                                    <Link href={href} className="hover:text-emerald-400 transition-colors py-2 inline-block" style={{ color: 'var(--ais-footer-text)' }}>
                                        {t(key)}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Support & Legal */}
                    <div>
                        <h4 className="font-semibold mb-5 text-sm" style={{ color: 'var(--ais-footer-text-bright)' }}>{t('support_legal')}</h4>
                        <ul className="space-y-1 text-sm">
                            {Object.entries(SUPPORT_ROUTES).map(([key, href]) => (
                                <li key={key}>
                                    <Link href={href} className="hover:text-emerald-400 transition-colors py-2 inline-block" style={{ color: 'var(--ais-footer-text)' }}>
                                        {t(key)}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                {/* Bottom Bar */}
                <div className="pt-6 flex flex-col md:flex-row justify-between items-center gap-3 text-xs" style={{ borderTop: '1px solid var(--ais-footer-border)', color: 'var(--ais-footer-text)' }}>
                    <p>{t('copyright')}</p>
                    <p className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block"></span>
                        {t('order_status')}
                    </p>
                </div>
            </div>
        </footer>
    );
}
