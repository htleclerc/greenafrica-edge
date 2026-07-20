'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { z } from 'zod';
import { OsInput, OsSelect } from '@/components/ui/OsInput';
import { OsButton } from '@/components/ui/OsButton';
import { createClient } from '@/lib/supabase/client';
import { submitKycC } from '@/actions/submitKycC';
import { kycCSchema, ALLOWED_DOC_TYPES, type KycCInput } from '@/lib/kyc/kycSchema';

type DocType = (typeof ALLOWED_DOC_TYPES)[number];

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
    billing_proof_doc_storage_path: string;
    billing_proof_doc_type: DocType | '';
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
    billing_proof_doc_storage_path: '',
    billing_proof_doc_type: '',
};

const step1Schema = kycCSchema.pick({
    billing_legal_name: true,
    billing_address_line1: true,
    billing_address_line2: true,
    billing_city: true,
    billing_postal_code: true,
    billing_country_code: true,
    vat_number: true,
});

const step2Schema = kycCSchema.pick({
    iban: true,
    swift_bic: true,
    bank_name: true,
});

function toFieldErrors(issues: z.ZodError['issues']): Record<string, string> {
    const errors: Record<string, string> = {};
    issues.forEach((issue) => {
        const field = issue.path[0];
        if (typeof field === 'string') errors[field] = issue.message;
    });
    return errors;
}

export function BillingWizard({ shipownerName, shipownerId }: { shipownerName: string; shipownerId: string }) {
    const t = useTranslations('OwnerOnboarding');
    const router = useRouter();
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [form, setForm] = useState<FormData>({ ...EMPTY, billing_legal_name: shipownerName });
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [cgv, setCgv] = useState(false);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);

    function update<K extends keyof FormData>(k: K, v: FormData[K]) {
        setForm((p) => ({ ...p, [k]: v }));
    }

    function goToStep2() {
        const parsed = step1Schema.safeParse(form);
        if (!parsed.success) {
            setErrors(toFieldErrors(parsed.error.issues));
            return;
        }
        setErrors({});
        setStep(2);
    }

    function goToStep3() {
        const parsed = step2Schema.safeParse(form);
        if (!parsed.success) {
            setErrors(toFieldErrors(parsed.error.issues));
            return;
        }
        setErrors({});
        setStep(3);
    }

    async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        setUploadError(null);
        try {
            const supabase = createClient();
            const path = `kyc-c/${shipownerId}/${Date.now()}-${file.name}`;
            const { error } = await supabase.storage.from('shipowner-kyc').upload(path, file);
            if (error) throw error;
            update('billing_proof_doc_storage_path', path);
        } catch {
            setUploadError(t('proof_upload_error'));
        } finally {
            setUploading(false);
        }
    }

    function buildPayload(): KycCInput {
        return {
            billing_legal_name: form.billing_legal_name,
            billing_address_line1: form.billing_address_line1,
            billing_address_line2: form.billing_address_line2,
            billing_city: form.billing_city,
            billing_postal_code: form.billing_postal_code,
            billing_country_code: form.billing_country_code,
            vat_number: form.vat_number,
            iban: form.iban,
            swift_bic: form.swift_bic,
            bank_name: form.bank_name,
            cgv_accepted: true,
            billing_proof_doc_storage_path: form.billing_proof_doc_storage_path || undefined,
            billing_proof_doc_type: form.billing_proof_doc_type || undefined,
        };
    }

    async function submit() {
        const payload = buildPayload();
        const parsed = kycCSchema.safeParse(payload);
        if (!parsed.success) {
            setErrors(toFieldErrors(parsed.error.issues));
            setErr(null);
            return;
        }
        setErrors({});
        setBusy(true);
        setErr(null);
        try {
            const r = await submitKycC(parsed.data);
            if (!r.ok) throw new Error('submit_failed');
            router.push('/owner/dashboard');
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setBusy(false);
        }
    }

    const docTypeOptions = ALLOWED_DOC_TYPES.map((d) => ({ value: d, label: t(`proof_doc_types.${d}`) }));

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
                        error={errors.billing_legal_name}
                        required
                    />
                    <OsInput
                        label={t('address_line1')}
                        value={form.billing_address_line1}
                        onChange={(e) => update('billing_address_line1', e.target.value)}
                        error={errors.billing_address_line1}
                        required
                    />
                    <OsInput
                        label={t('address_line2')}
                        value={form.billing_address_line2}
                        onChange={(e) => update('billing_address_line2', e.target.value)}
                        error={errors.billing_address_line2}
                    />
                    <div className="grid grid-cols-2 gap-2">
                        <OsInput
                            label={t('city')}
                            value={form.billing_city}
                            onChange={(e) => update('billing_city', e.target.value)}
                            error={errors.billing_city}
                            required
                        />
                        <OsInput
                            label={t('postal_code')}
                            value={form.billing_postal_code}
                            onChange={(e) => update('billing_postal_code', e.target.value)}
                            error={errors.billing_postal_code}
                            required
                        />
                    </div>
                    <OsInput
                        label={t('country_code')}
                        value={form.billing_country_code}
                        onChange={(e) => update('billing_country_code', e.target.value.toUpperCase())}
                        error={errors.billing_country_code}
                        maxLength={2}
                        required
                    />
                    <OsInput
                        label={t('vat_optional')}
                        value={form.vat_number}
                        onChange={(e) => update('vat_number', e.target.value)}
                        error={errors.vat_number}
                    />
                    <OsButton onClick={goToStep2} disabled={!step1Schema.safeParse(form).success}>
                        {t('next')}
                    </OsButton>
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
                        error={errors.iban}
                        required
                    />
                    <OsInput
                        label="SWIFT/BIC"
                        value={form.swift_bic}
                        onChange={(e) => update('swift_bic', e.target.value.toUpperCase())}
                        error={errors.swift_bic}
                        required
                    />
                    <OsInput
                        label={t('bank_name')}
                        value={form.bank_name}
                        onChange={(e) => update('bank_name', e.target.value)}
                        error={errors.bank_name}
                        required
                    />

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-[var(--os-text-secondary)] uppercase tracking-wider">
                            {t('proof_document')}
                        </label>
                        <input
                            type="file"
                            accept="application/pdf,image/*"
                            onChange={handleFileChange}
                            disabled={uploading}
                            className="block w-full h-11 rounded-xl px-4 bg-[var(--os-surface-2)] border border-[var(--os-border)] text-sm text-[var(--os-text-primary)] focus:outline-none focus:border-[#00D97E]/60 focus:ring-1 focus:ring-[#00D97E]/20 transition-colors"
                        />
                        {uploading && <p className="text-xs text-[var(--os-text-muted)]">{t('proof_uploading')}</p>}
                        {!uploading && form.billing_proof_doc_storage_path && (
                            <p className="text-xs text-emerald-500">{t('proof_uploaded')}</p>
                        )}
                        {uploadError && <p className="text-xs text-[#EF4444]">{uploadError}</p>}
                        {!uploading && !uploadError && (
                            <p className="text-xs text-[var(--os-text-muted)]">{t('proof_document_hint')}</p>
                        )}
                    </div>
                    {form.billing_proof_doc_storage_path && (
                        <OsSelect
                            label={t('proof_doc_type')}
                            value={form.billing_proof_doc_type}
                            onChange={(e) => update('billing_proof_doc_type', e.target.value as DocType)}
                            options={docTypeOptions}
                            placeholder="—"
                            error={errors.billing_proof_doc_type}
                        />
                    )}

                    <div className="flex gap-2">
                        <OsButton variant="secondary" onClick={() => setStep(1)}>
                            {t('back')}
                        </OsButton>
                        <OsButton onClick={goToStep3} disabled={!step2Schema.safeParse(form).success}>
                            {t('next')}
                        </OsButton>
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
                        <OsButton variant="secondary" onClick={() => setStep(2)}>
                            {t('back')}
                        </OsButton>
                        <OsButton onClick={submit} disabled={!cgv} loading={busy}>
                            {t('submit')}
                        </OsButton>
                    </div>
                </div>
            )}
        </div>
    );
}
