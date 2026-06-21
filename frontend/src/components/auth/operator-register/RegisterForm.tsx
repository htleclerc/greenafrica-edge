'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { OsInput } from '@/components/ui/OsInput';
import { createClient } from '@/lib/supabase/client';

interface Props {
    recaptchaSiteKey: string;
}

const LANGS = ['en', 'fr', 'ar', 'pt', 'sw', 'so'] as const;
const DOC_TYPES = ['TRADE_REGISTER', 'CERT_INCORPORATION', 'MOA', 'OTHER'] as const;

declare global {
    interface Window {
        grecaptcha?: {
            execute: (key: string, opts: { action: string }) => Promise<string>;
        };
    }
}

export function RegisterForm({ recaptchaSiteKey }: Props) {
    const t = useTranslations('OwnerRegister');
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setSubmitting(true);
        setResult(null);

        const formData = new FormData(e.currentTarget);
        const file = formData.get('proof_doc') as File | null;
        if (!file) {
            setSubmitting(false);
            setResult({ ok: false, message: t('errors.no_file') });
            return;
        }

        const supabase = createClient();
        const path = `pending/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage
            .from('shipowner-kyc')
            .upload(path, file);
        if (upErr) {
            setSubmitting(false);
            setResult({ ok: false, message: t('errors.upload_failed') });
            return;
        }

        const token =
            recaptchaSiteKey && window.grecaptcha
                ? await window.grecaptcha.execute(recaptchaSiteKey, {
                    action: 'register_shipowner',
                })
                : 'dev-skip';

        const body = {
            email: formData.get('email'),
            name: formData.get('name'),
            imo_company_no: formData.get('imo_company_no'),
            country_code: formData.get('country_code'),
            address: formData.get('address'),
            proof_imo_vessel_imo: formData.get('proof_imo_vessel_imo'),
            proof_doc_storage_path: path,
            proof_doc_type: formData.get('proof_doc_type'),
            phone_e164: formData.get('phone_e164') || undefined,
            preferred_language: formData.get('preferred_language'),
            recaptcha_token: token,
        };
        const res = await fetch('/api/auth/register-shipowner', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        setSubmitting(false);
        setResult({ ok: data.ok, message: data.message });
    }

    if (result?.ok) {
        return (
            <div className="os-card p-6 text-center">
                <h2 className="text-xl mb-2">{t('thanks_title')}</h2>
                <p>{result.message}</p>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <OsInput
                name="email"
                label={t('email')}
                type="email"
                required
            />
            <OsInput
                name="name"
                label={t('company_name')}
                required
            />
            <OsInput
                name="imo_company_no"
                label={t('imo_company')}
                pattern="\d{7}"
                required
            />
            <OsInput
                name="country_code"
                label={t('country')}
                maxLength={2}
                required
            />
            <OsInput
                name="address"
                label={t('address')}
                required
            />
            <OsInput
                name="proof_imo_vessel_imo"
                label={t('vessel_imo')}
                pattern="\d{7}"
                required
            />
            <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--os-text-secondary)] uppercase tracking-wider">
                    {t('proof_document')}
                </label>
                <input
                    name="proof_doc"
                    type="file"
                    accept="application/pdf,image/*"
                    required
                    className="block w-full h-11 rounded-xl px-4 bg-[var(--os-surface-2)] border border-[var(--os-border)] text-sm text-[var(--os-text-primary)] focus:outline-none focus:border-[#00D97E]/60 focus:ring-1 focus:ring-[#00D97E]/20 transition-colors"
                />
            </div>
            <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--os-text-secondary)] uppercase tracking-wider">
                    {t('doc_type')}
                </label>
                <select
                    name="proof_doc_type"
                    required
                    defaultValue="TRADE_REGISTER"
                    className="w-full h-11 rounded-xl px-4 bg-[var(--os-surface-2)] border border-[var(--os-border)] text-sm text-[var(--os-text-primary)] focus:outline-none focus:border-[#00D97E]/60 focus:ring-1 focus:ring-[#00D97E]/20 transition-colors appearance-none cursor-pointer"
                >
                    {DOC_TYPES.map((d) => (
                        <option key={d} value={d}>
                            {t(`doc_types.${d}`)}
                        </option>
                    ))}
                </select>
            </div>
            <OsInput
                name="phone_e164"
                label={t('phone_optional')}
                placeholder="+2526..."
            />
            <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[var(--os-text-secondary)] uppercase tracking-wider">
                    {t('preferred_language')}
                </label>
                <select
                    name="preferred_language"
                    required
                    defaultValue="en"
                    className="w-full h-11 rounded-xl px-4 bg-[var(--os-surface-2)] border border-[var(--os-border)] text-sm text-[var(--os-text-primary)] focus:outline-none focus:border-[#00D97E]/60 focus:ring-1 focus:ring-[#00D97E]/20 transition-colors appearance-none cursor-pointer"
                >
                    {LANGS.map((l) => (
                        <option key={l} value={l}>
                            {t(`langs.${l}`)}
                        </option>
                    ))}
                </select>
            </div>
            {result && !result.ok && (
                <div className="text-red-400 text-sm">{result.message}</div>
            )}
            <button
                type="submit"
                disabled={submitting}
                className="os-button w-full disabled:opacity-50"
            >
                {submitting ? t('submitting') : t('submit')}
            </button>
        </form>
    );
}
