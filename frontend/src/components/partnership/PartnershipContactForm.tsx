'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { ArrowLeft, Send, Building2, Globe2, Landmark, Ship, Leaf } from 'lucide-react';

const PARTNERSHIP_TYPES = [
    { key: 'sovereign_deployment', icon: Landmark },
    { key: 'port_authority', icon: Ship },
    { key: 'carbon_credits', icon: Leaf },
    { key: 'technology', icon: Globe2 },
    { key: 'institutional', icon: Building2 },
] as const;

export function PartnershipContactForm() {
    const t = useTranslations('PartnershipContact');

    const [form, setForm] = useState({
        partnershipType: '',
        orgName: '',
        country: '',
        contactName: '',
        contactEmail: '',
        contactRole: '',
        message: '',
    });
    const [submitted, setSubmitted] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);

        // For now, send to a Supabase table or an email endpoint
        // In production, wire this to /api/partnership-request
        try {
            const res = await fetch('/api/partnership-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });
            if (res.ok) {
                setSubmitted(true);
            }
        } catch {
            // Fallback: mark as submitted anyway for demo
            setSubmitted(true);
        } finally {
            setSubmitting(false);
        }
    };

    const updateField = (field: string, value: string) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    };

    if (submitted) {
        return (
            <main className="min-h-screen" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
                <Navbar activePage="partnership" />
                <section className="py-20 px-4 sm:px-6 min-h-[70vh] flex items-center justify-center">
                    <div className="max-w-lg mx-auto text-center">
                        <div className="w-20 h-20 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-8">
                            <Send className="w-10 h-10 text-emerald-400" />
                        </div>
                        <h1 className="text-3xl font-bold mb-4" style={{ color: 'var(--ais-page-text)' }}>
                            {t('success_title')}
                        </h1>
                        <p className="text-base leading-relaxed mb-8" style={{ color: 'var(--ais-page-text-muted)' }}>
                            {t('success_desc')}
                        </p>
                        <Link
                            href="/partnership"
                            className="inline-flex items-center gap-2 text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            {t('back_to_partnership')}
                        </Link>
                    </div>
                </section>
                <Footer />
            </main>
        );
    }

    return (
        <main className="min-h-screen" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <Navbar activePage="partnership" />

            <section className="py-16 sm:py-20 px-4 sm:px-6">
                <div className="max-w-3xl mx-auto">
                    {/* Back link */}
                    <Link
                        href="/partnership"
                        className="inline-flex items-center gap-2 text-sm mb-8 transition-colors"
                        style={{ color: 'var(--ais-page-text-muted)' }}
                    >
                        <ArrowLeft className="w-4 h-4" />
                        {t('back_to_partnership')}
                    </Link>

                    {/* Header */}
                    <h1 className="text-3xl sm:text-4xl font-bold mb-3" style={{ color: 'var(--ais-page-text)' }}>
                        {t('title')}
                    </h1>
                    <p className="text-base leading-relaxed mb-10" style={{ color: 'var(--ais-page-text-muted)' }}>
                        {t('subtitle')}
                    </p>

                    <form onSubmit={handleSubmit} className="space-y-8">
                        {/* Partnership Type Selection */}
                        <div>
                            <label className="block text-sm font-semibold mb-4" style={{ color: 'var(--ais-page-text)' }}>
                                {t('type_label')}
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {PARTNERSHIP_TYPES.map(({ key, icon: Icon }) => (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={() => updateField('partnershipType', key)}
                                        className={`p-4 rounded-xl border text-left transition-all ${
                                            form.partnershipType === key
                                                ? 'border-emerald-500 bg-emerald-500/10'
                                                : 'border-white/10 bg-white/5 hover:border-white/20'
                                        }`}
                                    >
                                        <Icon className={`w-5 h-5 mb-2 ${form.partnershipType === key ? 'text-emerald-400' : 'text-gray-500'}`} />
                                        <p className="text-sm font-medium" style={{ color: 'var(--ais-page-text)' }}>
                                            {t(`type_${key}`)}
                                        </p>
                                        <p className="text-xs mt-1" style={{ color: 'var(--ais-page-text-muted)' }}>
                                            {t(`type_${key}_desc`)}
                                        </p>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Organization Info */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--ais-page-text)' }}>
                                    {t('org_name')}
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={form.orgName}
                                    onChange={(e) => updateField('orgName', e.target.value)}
                                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm focus:border-emerald-500 focus:outline-none transition-colors"
                                    style={{ color: 'var(--ais-page-text)' }}
                                    placeholder={t('org_name_placeholder')}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--ais-page-text)' }}>
                                    {t('country')}
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={form.country}
                                    onChange={(e) => updateField('country', e.target.value)}
                                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm focus:border-emerald-500 focus:outline-none transition-colors"
                                    style={{ color: 'var(--ais-page-text)' }}
                                    placeholder={t('country_placeholder')}
                                />
                            </div>
                        </div>

                        {/* Contact Info */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--ais-page-text)' }}>
                                    {t('contact_name')}
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={form.contactName}
                                    onChange={(e) => updateField('contactName', e.target.value)}
                                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm focus:border-emerald-500 focus:outline-none transition-colors"
                                    style={{ color: 'var(--ais-page-text)' }}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--ais-page-text)' }}>
                                    {t('contact_email')}
                                </label>
                                <input
                                    type="email"
                                    required
                                    value={form.contactEmail}
                                    onChange={(e) => updateField('contactEmail', e.target.value)}
                                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm focus:border-emerald-500 focus:outline-none transition-colors"
                                    style={{ color: 'var(--ais-page-text)' }}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--ais-page-text)' }}>
                                    {t('contact_role')}
                                </label>
                                <input
                                    type="text"
                                    value={form.contactRole}
                                    onChange={(e) => updateField('contactRole', e.target.value)}
                                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm focus:border-emerald-500 focus:outline-none transition-colors"
                                    style={{ color: 'var(--ais-page-text)' }}
                                    placeholder={t('contact_role_placeholder')}
                                />
                            </div>
                        </div>

                        {/* Message */}
                        <div>
                            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--ais-page-text)' }}>
                                {t('message_label')}
                            </label>
                            <textarea
                                required
                                rows={5}
                                value={form.message}
                                onChange={(e) => updateField('message', e.target.value)}
                                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm focus:border-emerald-500 focus:outline-none transition-colors resize-none"
                                style={{ color: 'var(--ais-page-text)' }}
                                placeholder={t('message_placeholder')}
                            />
                        </div>

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={submitting || !form.partnershipType}
                            className="inline-flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold px-8 py-3 rounded-xl transition-all hover:shadow-[0_0_20px_rgba(234,179,8,0.3)]"
                        >
                            {submitting ? t('submitting') : t('submit')}
                            <Send className="w-4 h-4" />
                        </button>
                    </form>
                </div>
            </section>

            <Footer />
        </main>
    );
}
