'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Linkedin, Twitter, Youtube } from 'lucide-react';

const PLATFORM_ROUTES: Record<string, string> = {
    overview:       '/',
    carbon_tax:     '/carbon-tax',
    carbon_credits: '/carbon-credits',
    projects:       '/projects',
    reports:        '/reports',
};

const COMPANY_ROUTES: Record<string, string> = {
    about:       '/about',
    partnership: '/partnership',
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 mb-12">

                    {/* Brand Column */}
                    <div>
                        <div className="flex items-center gap-2.5 mb-5">
                            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center">
                                <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
                                    <path d="M12 22C12 22 20 18 20 12C20 6 12 2 12 2C12 2 4 6 4 12C4 18 12 22 12 22Z"></path>
                                </svg>
                            </div>
                            <div className="flex flex-col">
                            <span className="text-lg font-bold tracking-tight" style={{ color: 'var(--ais-footer-text-bright)' }}>Africgreen</span>
                            <span className="text-[9px] font-medium tracking-widest uppercase text-emerald-500/60">by Solide Technology</span>
                        </div>
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
                        <ul className="space-y-3 text-sm">
                            {Object.entries(PLATFORM_ROUTES).map(([key, href]) => (
                                <li key={key}>
                                    <Link href={href} className="hover:text-emerald-400 transition-colors" style={{ color: 'var(--ais-footer-text)' }}>
                                        {t(key)}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Company */}
                    <div>
                        <h4 className="font-semibold mb-5 text-sm" style={{ color: 'var(--ais-footer-text-bright)' }}>{t('company')}</h4>
                        <ul className="space-y-3 text-sm">
                            {Object.entries(COMPANY_ROUTES).map(([key, href]) => (
                                <li key={key}>
                                    <Link href={href} className="hover:text-emerald-400 transition-colors" style={{ color: 'var(--ais-footer-text)' }}>
                                        {t(key)}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Support & Legal */}
                    <div>
                        <h4 className="font-semibold mb-5 text-sm" style={{ color: 'var(--ais-footer-text-bright)' }}>{t('support_legal')}</h4>
                        <ul className="space-y-3 text-sm">
                            {Object.entries(SUPPORT_ROUTES).map(([key, href]) => (
                                <li key={key}>
                                    <Link href={href} className="hover:text-emerald-400 transition-colors" style={{ color: 'var(--ais-footer-text)' }}>
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
