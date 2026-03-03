'use client';

import { useTranslations } from 'next-intl';
import { Linkedin, Twitter, Youtube } from 'lucide-react';

export function Footer() {
    const t = useTranslations('Footer');

    return (
        <footer className="bg-[#070D0B] text-slate-400 pt-16 pb-8 px-6 border-t border-white/5">
            <div className="max-w-7xl mx-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 mb-12">

                    {/* Brand Column */}
                    <div>
                        <div className="flex items-center gap-2.5 mb-5">
                            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center">
                                <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
                                    <path d="M12 22C12 22 20 18 20 12C20 6 12 2 12 2C12 2 4 6 4 12C4 18 12 22 12 22Z"></path>
                                </svg>
                            </div>
                            <span className="text-lg font-bold tracking-tight text-white">AIS Portal</span>
                        </div>
                        <p className="text-sm leading-relaxed mb-6 pr-4 text-slate-500">
                            {t('brand_desc')}
                        </p>
                        <div className="flex gap-3">
                            <button className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center hover:bg-emerald-500 hover:text-white transition-colors text-slate-500">
                                <Linkedin className="w-4 h-4" />
                            </button>
                            <button className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center hover:bg-emerald-500 hover:text-white transition-colors text-slate-500">
                                <Twitter className="w-4 h-4" />
                            </button>
                            <button className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center hover:bg-emerald-500 hover:text-white transition-colors text-slate-500">
                                <Youtube className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Platform Links */}
                    <div>
                        <h4 className="text-white font-semibold mb-5 text-sm">{t('platform')}</h4>
                        <ul className="space-y-3 text-sm">
                            {['overview', 'carbon_tax', 'carbon_credits', 'projects', 'reports', 'settings'].map((key) => (
                                <li key={key}>
                                    <a href="#" className="hover:text-emerald-400 transition-colors text-slate-500">
                                        {t(key)}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Support & Legal */}
                    <div>
                        <h4 className="text-white font-semibold mb-5 text-sm">{t('support_legal')}</h4>
                        <ul className="space-y-3 text-sm">
                            {['help_center', 'contact_support', 'privacy_policy', 'terms_of_service'].map((key) => (
                                <li key={key}>
                                    <a href="#" className="hover:text-emerald-400 transition-colors text-slate-500">
                                        {t(key)}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                {/* Bottom Bar */}
                <div className="pt-6 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-3 text-xs text-slate-600">
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
