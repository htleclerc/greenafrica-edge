'use client';

import { useTranslations } from 'next-intl';
import { Shield, FileText, Zap, Link as LinkIcon, Plus, Search } from 'lucide-react';
import { faqItems } from '@/mock/datas';

export function FeaturesSection() {
    const t = useTranslations('Landing');

    const features = [
        { icon: Shield, title: t('feat_sovereignty_title'), desc: t('feat_sovereignty_desc'), color: 'text-emerald-500', bg: 'bg-emerald-50' },
        { icon: FileText, title: t('feat_policy_title'), desc: t('feat_policy_desc'), color: 'text-emerald-600', bg: 'bg-emerald-50' },
        { icon: Zap, title: t('feat_deployment_title'), desc: t('feat_deployment_desc'), color: 'text-emerald-500', bg: 'bg-emerald-50' },
        { icon: LinkIcon, title: t('feat_interop_title'), desc: t('feat_interop_desc'), color: 'text-emerald-600', bg: 'bg-emerald-50' },
    ];

    return (
        <section className="py-24 px-6 bg-slate-50 relative">
            <div className="max-w-7xl mx-auto">
                <div className="text-center mb-16">
                    <h2 className="text-4xl md:text-5xl font-bold text-slate-900 mb-6">
                        {t('design_title')}
                    </h2>
                    <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                        {t('design_subtitle')}
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {features.map((feat, i) => (
                        <div key={i} className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100 hover:border-emerald-200 transition-colors group">
                            <div className={`w-12 h-12 rounded-xl ${feat.bg} flex items-center justify-center mb-6`}>
                                <feat.icon className={`w-5 h-5 ${feat.color}`} />
                            </div>
                            <h3 className="text-xl font-bold text-slate-900 mb-3">{feat.title}</h3>
                            <p className="text-slate-600 leading-relaxed text-sm">{feat.desc}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

export function FaqSection() {
    const t = useTranslations('Landing');

    return (
        <section className="py-24 px-6 bg-emerald-50/50 relative">
            <div className="max-w-3xl mx-auto text-center mb-16">
                <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">{t('faq_title')}</h2>
                <p className="text-slate-600">{t('faq_subtitle')}</p>

                {/* Mock Search Bar */}
                <div className="mt-8 relative max-w-md mx-auto">
                    <input type="text" placeholder="Search for answers..." className="w-full pl-10 pr-4 py-3 rounded-full border border-slate-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
                    <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                </div>
            </div>

            <div className="max-w-3xl mx-auto space-y-4">
                {faqItems.map((item, i) => (
                    <div key={i} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center justify-between cursor-pointer hover:border-emerald-200 transition-colors group">
                        <h4 className="font-semibold text-slate-900 group-hover:text-emerald-700 transition-colors">{item.question}</h4>
                        <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-500 shrink-0">
                            <Plus className="w-4 h-4" />
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}

// Sub-component for search icon to avoid extra lucide imports
function SearchIcon(props: any) {
    return (
        <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" x2="16.65" y1="21" y2="16.65"></line>
        </svg>
    );
}
