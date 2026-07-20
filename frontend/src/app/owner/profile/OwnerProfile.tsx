'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { OsCard, OsCardHeader } from '@/components/ui/OsCard';
import { OsInput, OsSelect } from '@/components/ui/OsInput';
import { OsButton } from '@/components/ui/OsButton';
import { KycStatus } from '@/components/owner/KycStatus';
import { updateOwnerKycProfile } from '@/actions/updateOwnerKycProfile';
import { kycBEditableSchema, ALLOWED_LANGS } from '@/lib/kyc/kycSchema';
import type { OwnerKycProfile } from '@/services/ownerKycService';

interface IdentityFormState {
    imo_company_no: string;
    aoc_number: string;
    address: string;
    phone_e164: string;
    preferred_language: string;
    ops_email: string;
    finance_email: string;
}

interface BillingFormState {
    billing_legal_name: string;
    billing_address_line1: string;
    billing_address_line2: string;
    billing_city: string;
    billing_postal_code: string;
    billing_country_code: string;
    vat_number: string;
    swift_bic: string;
    bank_name: string;
}

type IdentityDiff = Partial<Record<keyof IdentityFormState, string>>;
type BillingDiff = Partial<Record<keyof BillingFormState, string>> & { iban?: string };

// Miroir client (UX only) du billingEditSchema privé de l'action serveur —
// le serveur reste la seule source de vérité pour la validation.
const billingClientSchema = z.object({
    billing_legal_name: z.string().min(2).max(200).optional(),
    billing_address_line1: z.string().min(2).max(200).optional(),
    billing_address_line2: z.string().max(200).optional(),
    billing_city: z.string().min(2).max(100).optional(),
    billing_postal_code: z.string().min(2).max(20).optional(),
    billing_country_code: z.string().length(2).optional(),
    vat_number: z.string().max(50).optional(),
    iban: z.string().regex(/^[A-Z0-9]{15,34}$/).optional(),
    swift_bic: z.string().regex(/^[A-Z0-9]{8,11}$/).optional(),
    bank_name: z.string().min(2).max(200).optional(),
});

const LANG_OPTIONS = ALLOWED_LANGS.map((lang) => ({ value: lang, label: lang.toUpperCase() }));

function toIdentityForm(profile: OwnerKycProfile): IdentityFormState {
    return {
        imo_company_no: profile.imo_company_no ?? '',
        aoc_number: profile.aoc_number ?? '',
        address: profile.address ?? '',
        phone_e164: profile.phone_e164 ?? '',
        preferred_language: profile.preferred_language ?? '',
        ops_email: profile.ops_email ?? '',
        finance_email: profile.finance_email ?? '',
    };
}

function toBillingForm(profile: OwnerKycProfile): BillingFormState {
    return {
        billing_legal_name: profile.billing_legal_name ?? '',
        billing_address_line1: profile.billing_address_line1 ?? '',
        billing_address_line2: profile.billing_address_line2 ?? '',
        billing_city: profile.billing_city ?? '',
        billing_postal_code: profile.billing_postal_code ?? '',
        billing_country_code: profile.billing_country_code ?? '',
        vat_number: profile.vat_number ?? '',
        swift_bic: profile.swift_bic ?? '',
        bank_name: profile.bank_name ?? '',
    };
}

// N'inclut que les champs qui ont réellement changé vs la valeur initiale.
// Critique pour imo_company_no / aoc_number : les envoyer inchangés déclencherait
// une re-vérification KYC-B inutile côté action (updateOwnerKycProfile reset le
// flag dès que aoc_number est fourni, et si imo_company_no diffère de la valeur
// connue de la session).
function buildIdentityDiff(initial: IdentityFormState, current: IdentityFormState): IdentityDiff {
    const diff: IdentityDiff = {};
    (Object.keys(current) as (keyof IdentityFormState)[]).forEach((key) => {
        if (current[key] !== initial[key]) diff[key] = current[key];
    });
    return diff;
}

function buildBillingDiff(initial: BillingFormState, current: BillingFormState): BillingDiff {
    const diff: BillingDiff = {};
    (Object.keys(current) as (keyof BillingFormState)[]).forEach((key) => {
        if (current[key] !== initial[key]) diff[key] = current[key];
    });
    return diff;
}

export function OwnerProfile({ profile }: { profile: OwnerKycProfile }) {
    const t = useTranslations('OwnerProfile');
    const router = useRouter();

    const [identityBaseline, setIdentityBaseline] = useState<IdentityFormState>(() => toIdentityForm(profile));
    const [identityForm, setIdentityForm] = useState<IdentityFormState>(() => toIdentityForm(profile));
    const [identityErrors, setIdentityErrors] = useState<Partial<Record<keyof IdentityFormState, string>>>({});
    const [identityBusy, setIdentityBusy] = useState(false);
    const [identitySubmitError, setIdentitySubmitError] = useState<string | null>(null);

    const [billingBaseline, setBillingBaseline] = useState<BillingFormState>(() => toBillingForm(profile));
    const [billingForm, setBillingForm] = useState<BillingFormState>(() => toBillingForm(profile));
    const [newIban, setNewIban] = useState('');
    const [billingErrors, setBillingErrors] = useState<Partial<Record<keyof BillingFormState | 'iban', string>>>({});
    const [billingBusy, setBillingBusy] = useState(false);
    const [billingSubmitError, setBillingSubmitError] = useState<string | null>(null);

    function updateIdentity<K extends keyof IdentityFormState>(key: K, value: string) {
        setIdentityForm((prev) => ({ ...prev, [key]: value }));
    }

    function updateBilling<K extends keyof BillingFormState>(key: K, value: string) {
        setBillingForm((prev) => ({ ...prev, [key]: value }));
    }

    async function submitIdentity() {
        setIdentitySubmitError(null);
        const diff = buildIdentityDiff(identityBaseline, identityForm);
        if (Object.keys(diff).length === 0) {
            setIdentityErrors({});
            return;
        }

        const parsed = kycBEditableSchema.safeParse(diff);
        if (!parsed.success) {
            const errors: Partial<Record<keyof IdentityFormState, string>> = {};
            parsed.error.issues.forEach((issue) => {
                const field = issue.path[0];
                if (typeof field === 'string' && field in identityForm) {
                    errors[field as keyof IdentityFormState] = issue.message;
                }
            });
            setIdentityErrors(errors);
            return;
        }
        setIdentityErrors({});

        setIdentityBusy(true);
        try {
            await updateOwnerKycProfile({ identity: parsed.data });
            setIdentityBaseline(identityForm);
            router.refresh();
        } catch {
            setIdentitySubmitError(t('identity.saveError'));
        } finally {
            setIdentityBusy(false);
        }
    }

    async function submitBilling() {
        setBillingSubmitError(null);
        const diff = buildBillingDiff(billingBaseline, billingForm);
        const trimmedIban = newIban.trim().toUpperCase();
        if (trimmedIban) diff.iban = trimmedIban;

        if (Object.keys(diff).length === 0) {
            setBillingErrors({});
            return;
        }

        const parsed = billingClientSchema.safeParse(diff);
        if (!parsed.success) {
            const errors: Partial<Record<keyof BillingFormState | 'iban', string>> = {};
            parsed.error.issues.forEach((issue) => {
                const field = issue.path[0];
                if (typeof field === 'string' && (field in billingForm || field === 'iban')) {
                    errors[field as keyof BillingFormState | 'iban'] = issue.message;
                }
            });
            setBillingErrors(errors);
            return;
        }
        setBillingErrors({});

        setBillingBusy(true);
        try {
            await updateOwnerKycProfile({ billing: parsed.data });
            setBillingBaseline(billingForm);
            setNewIban('');
            router.refresh();
        } catch {
            setBillingSubmitError(t('billing.saveError'));
        } finally {
            setBillingBusy(false);
        }
    }

    const bPendingReverif = !profile.bDone && !!profile.imo_company_no;

    return (
        <div className="flex flex-col gap-6">
            <OsCard>
                <OsCardHeader title={t('identity.title')} subtitle={t('identity.subtitle')} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <OsInput
                        label={t('identity.imoCompanyNo')}
                        value={identityForm.imo_company_no}
                        onChange={(e) => updateIdentity('imo_company_no', e.target.value)}
                        error={identityErrors.imo_company_no}
                        hint={identityErrors.imo_company_no ? undefined : t('identity.reverifWarning')}
                    />
                    <OsInput
                        label={t('identity.aocNumber')}
                        value={identityForm.aoc_number}
                        onChange={(e) => updateIdentity('aoc_number', e.target.value)}
                        error={identityErrors.aoc_number}
                        hint={identityErrors.aoc_number ? undefined : t('identity.reverifWarning')}
                    />
                    <OsInput
                        label={t('identity.address')}
                        value={identityForm.address}
                        onChange={(e) => updateIdentity('address', e.target.value)}
                        error={identityErrors.address}
                        className="sm:col-span-2"
                    />
                    <OsInput
                        label={t('identity.phone')}
                        value={identityForm.phone_e164}
                        onChange={(e) => updateIdentity('phone_e164', e.target.value)}
                        error={identityErrors.phone_e164}
                    />
                    <OsSelect
                        label={t('identity.preferredLanguage')}
                        value={identityForm.preferred_language}
                        onChange={(e) => updateIdentity('preferred_language', e.target.value)}
                        options={LANG_OPTIONS}
                        placeholder="—"
                        error={identityErrors.preferred_language}
                    />
                    <OsInput
                        label={t('identity.opsEmail')}
                        value={identityForm.ops_email}
                        onChange={(e) => updateIdentity('ops_email', e.target.value)}
                        error={identityErrors.ops_email}
                    />
                    <OsInput
                        label={t('identity.financeEmail')}
                        value={identityForm.finance_email}
                        onChange={(e) => updateIdentity('finance_email', e.target.value)}
                        error={identityErrors.finance_email}
                    />
                </div>
                {identitySubmitError && <p className="text-xs text-[#EF4444] mt-3">{identitySubmitError}</p>}
                <div className="mt-4">
                    <OsButton onClick={submitIdentity} loading={identityBusy}>
                        {t('save')}
                    </OsButton>
                </div>
            </OsCard>

            <OsCard>
                <OsCardHeader title={t('billing.title')} subtitle={t('billing.subtitle')} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <OsInput
                        label={t('billing.legalName')}
                        value={billingForm.billing_legal_name}
                        onChange={(e) => updateBilling('billing_legal_name', e.target.value)}
                        error={billingErrors.billing_legal_name}
                        className="sm:col-span-2"
                    />
                    <OsInput
                        label={t('billing.addressLine1')}
                        value={billingForm.billing_address_line1}
                        onChange={(e) => updateBilling('billing_address_line1', e.target.value)}
                        error={billingErrors.billing_address_line1}
                        className="sm:col-span-2"
                    />
                    <OsInput
                        label={t('billing.addressLine2')}
                        value={billingForm.billing_address_line2}
                        onChange={(e) => updateBilling('billing_address_line2', e.target.value)}
                        error={billingErrors.billing_address_line2}
                        className="sm:col-span-2"
                    />
                    <OsInput
                        label={t('billing.city')}
                        value={billingForm.billing_city}
                        onChange={(e) => updateBilling('billing_city', e.target.value)}
                        error={billingErrors.billing_city}
                    />
                    <OsInput
                        label={t('billing.postalCode')}
                        value={billingForm.billing_postal_code}
                        onChange={(e) => updateBilling('billing_postal_code', e.target.value)}
                        error={billingErrors.billing_postal_code}
                    />
                    <OsInput
                        label={t('billing.countryCode')}
                        value={billingForm.billing_country_code}
                        onChange={(e) => updateBilling('billing_country_code', e.target.value.toUpperCase())}
                        error={billingErrors.billing_country_code}
                        maxLength={2}
                    />
                    <OsInput
                        label={t('billing.vatNumber')}
                        value={billingForm.vat_number}
                        onChange={(e) => updateBilling('vat_number', e.target.value)}
                        error={billingErrors.vat_number}
                    />

                    <OsInput
                        label={t('billing.currentIban')}
                        value={profile.iban_masked ?? t('billing.noIban')}
                        disabled
                    />
                    <OsInput
                        label={t('billing.newIban')}
                        value={newIban}
                        onChange={(e) => setNewIban(e.target.value.toUpperCase())}
                        error={billingErrors.iban}
                        hint={t('billing.newIbanHint')}
                    />
                    <OsInput
                        label={t('billing.swiftBic')}
                        value={billingForm.swift_bic}
                        onChange={(e) => updateBilling('swift_bic', e.target.value.toUpperCase())}
                        error={billingErrors.swift_bic}
                    />
                    <OsInput
                        label={t('billing.bankName')}
                        value={billingForm.bank_name}
                        onChange={(e) => updateBilling('bank_name', e.target.value)}
                        error={billingErrors.bank_name}
                    />
                </div>
                {billingSubmitError && <p className="text-xs text-[#EF4444] mt-3">{billingSubmitError}</p>}
                <div className="mt-4">
                    <OsButton onClick={submitBilling} loading={billingBusy}>
                        {t('save')}
                    </OsButton>
                </div>
            </OsCard>

            <OsCard>
                <OsCardHeader title={t('status.title')} />
                <KycStatus bDone={profile.bDone} cDone={profile.cDone} bPendingReverif={bPendingReverif} />
            </OsCard>

            <OsCard>
                <OsCardHeader title={t('documents.title')} />
                <div className="flex flex-col gap-2 text-sm">
                    {profile.proof_doc_url ? (
                        <a
                            href={`/api/admin/kyc-doc?path=${encodeURIComponent(profile.proof_doc_url)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:no-underline text-[var(--os-highlight)]"
                        >
                            {t('documents.proofB')}
                        </a>
                    ) : (
                        <span className="text-[var(--os-text-muted)]">{t('documents.noProofB')}</span>
                    )}
                    {profile.billing_proof_doc_url ? (
                        <a
                            href={`/api/admin/kyc-doc?path=${encodeURIComponent(profile.billing_proof_doc_url)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:no-underline text-[var(--os-highlight)]"
                        >
                            {t('documents.proofC')}
                        </a>
                    ) : (
                        <span className="text-[var(--os-text-muted)]">{t('documents.noProofC')}</span>
                    )}
                </div>
            </OsCard>
        </div>
    );
}
