'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { OsInput } from '@/components/ui/OsInput';
import { submitKycC } from '@/actions/submitKycC';

interface FormData {
    billing_legal_name: string;
    billing_address_line1: string;
    billing_address_line2: string;
    billing_city: string;
    billing_postal_code: string;
    billing_country_code: string;
    vat_number: string;
    iban: string;
    swift_bic: string;
    bank_name: string;
}

const EMPTY: FormData = {
    billing_legal_name: '',
    billing_address_line1: '',
    billing_address_line2: '',
    billing_city: '',
    billing_postal_code: '',
    billing_country_code: '',
    vat_number: '',
    iban: '',
    swift_bic: '',
    bank_name: '',
};

export function BillingWizard({ shipownerName }: { shipownerName: string }) {
    const t = useTranslations('OwnerOnboarding');
    const router = useRouter();
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [form, setForm] = useState<FormData>({ ...EMPTY, billing_legal_name: shipownerName });
    const [cgv, setCgv] = useState(false);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    function update<K extends keyof FormData>(k: K, v: string) {
        setForm((p) => ({ ...p, [k]: v }));
    }

    async function submit() {
        setBusy(true);
        setErr(null);
        try {
            const r = await submitKycC({ ...form, cgv_accepted: true });
            if (!r.ok) throw new Error('submit_failed');
            router.push('/owner/dashboard');
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="os-card p-8">
            <div className="flex gap-2 mb-6">
                {[1, 2, 3].map((n) => (
                    <div
                        key={n}
                        className={`flex-1 h-2 rounded ${
                            step >= n ? 'bg-emerald-500' : 'bg-gray-700'
                        }`}
                    />
                ))}
            </div>

            {step === 1 && (
                <div className="space-y-4">
                    <h2 className="text-xl">{t('step1.title')}</h2>
                    <OsInput
                        label={t('legal_name')}
                        value={form.billing_legal_name}
                        onChange={(e) => update('billing_legal_name', e.target.value)}
                        required
                    />
                    <OsInput
                        label={t('address_line1')}
                        value={form.billing_address_line1}
                        onChange={(e) => update('billing_address_line1', e.target.value)}
                        required
                    />
                    <OsInput
                        label={t('address_line2')}
                        value={form.billing_address_line2}
                        onChange={(e) => update('billing_address_line2', e.target.value)}
                    />
                    <div className="grid grid-cols-2 gap-2">
                        <OsInput
                            label={t('city')}
                            value={form.billing_city}
                            onChange={(e) => update('billing_city', e.target.value)}
                            required
                        />
                        <OsInput
                            label={t('postal_code')}
                            value={form.billing_postal_code}
                            onChange={(e) => update('billing_postal_code', e.target.value)}
                            required
                        />
                    </div>
                    <OsInput
                        label={t('country_code')}
                        value={form.billing_country_code}
                        onChange={(e) => update('billing_country_code', e.target.value.toUpperCase())}
                        maxLength={2}
                        required
                    />
                    <OsInput
                        label={t('vat_optional')}
                        value={form.vat_number}
                        onChange={(e) => update('vat_number', e.target.value)}
                    />
                    <button
                        onClick={() => setStep(2)}
                        className="os-button"
                        disabled={
                            !form.billing_legal_name ||
                            !form.billing_address_line1 ||
                            !form.billing_city ||
                            !form.billing_country_code
                        }
                    >
                        {t('next')}
                    </button>
                </div>
            )}

            {step === 2 && (
                <div className="space-y-4">
                    <h2 className="text-xl">{t('step2.title')}</h2>
                    <p className="opacity-70 text-sm">{t('step2.disclaimer')}</p>
                    <OsInput
                        label="IBAN"
                        value={form.iban}
                        onChange={(e) => update('iban', e.target.value.toUpperCase())}
                        pattern="[A-Z0-9]{15,34}"
                        required
                    />
                    <OsInput
                        label="SWIFT/BIC"
                        value={form.swift_bic}
                        onChange={(e) => update('swift_bic', e.target.value.toUpperCase())}
                        pattern="[A-Z0-9]{8,11}"
                        required
                    />
                    <OsInput
                        label={t('bank_name')}
                        value={form.bank_name}
                        onChange={(e) => update('bank_name', e.target.value)}
                        required
                    />
                    <div className="flex gap-2">
                        <button onClick={() => setStep(1)} className="os-button-secondary">
                            {t('back')}
                        </button>
                        <button
                            onClick={() => setStep(3)}
                            className="os-button"
                            disabled={!form.iban || !form.swift_bic || !form.bank_name}
                        >
                            {t('next')}
                        </button>
                    </div>
                </div>
            )}

            {step === 3 && (
                <div className="space-y-4">
                    <h2 className="text-xl">{t('step3.title')}</h2>
                    <div className="os-card-secondary p-4 text-sm space-y-1">
                        <div>
                            <strong>{t('legal_name')}:</strong> {form.billing_legal_name}
                        </div>
                        <div>
                            <strong>{t('address_line1')}:</strong> {form.billing_address_line1}
                        </div>
                        <div>
                            <strong>{t('city')}:</strong> {form.billing_city}, {form.billing_country_code}
                        </div>
                        <div>
                            <strong>IBAN:</strong> {form.iban.replace(/(.{4})/g, '$1 ').trim()}
                        </div>
                        <div>
                            <strong>SWIFT:</strong> {form.swift_bic}
                        </div>
                    </div>
                    <label className="flex items-start gap-2">
                        <input
                            type="checkbox"
                            checked={cgv}
                            onChange={(e) => setCgv(e.target.checked)}
                        />
                        <span>
                            {t('cgv_label_prefix')}{' '}
                            <Link href="/cgv" target="_blank" className="underline">
                                {t('cgv_link')}
                            </Link>
                        </span>
                    </label>
                    {err && <div className="text-red-400">{err}</div>}
                    <div className="flex gap-2">
                        <button onClick={() => setStep(2)} className="os-button-secondary">
                            {t('back')}
                        </button>
                        <button onClick={submit} className="os-button" disabled={!cgv || busy}>
                            {busy ? t('submitting') : t('submit')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
