'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as Dialog from '@radix-ui/react-dialog';
import { OsCard, OsCardHeader } from '@/components/ui/OsCard';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsButton } from '@/components/ui/OsButton';
import { OsBadge, type BadgeVariant } from '@/components/ui/OsBadge';
import { OsInput, OsSelect } from '@/components/ui/OsInput';
import { inviteShipowner } from '@/actions/inviteShipowner';
import { updateArmateurContacts } from '@/actions/updateArmateurContacts';
import { anonymizeOwner } from '@/actions/anonymizeOwner';
import { useClientSort } from '@/hooks/useClientSort';
import { ALLOWED_LANGS } from '@/lib/kyc/kycSchema';
import {
    type ArmateurDetail as ArmateurDetailType,
    type ArmateurVesselRow,
    type ArmateurProformaRow,
    type ArmateurPaymentRow,
} from '@/services/armateurService';

interface Props {
    detail: ArmateurDetailType;
    canInvite: boolean;
    canAnonymize: boolean;
}

type AllowedLang = (typeof ALLOWED_LANGS)[number];

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');
const orDash = (v: string | null | undefined) => (v && v.length > 0 ? v : '—');
// Âge en jours pleins depuis l'émission — purement dérivé de created_at, jamais persisté.
const ageInDays = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
// Un champ texte vidé par l'utilisateur doit s'écrire `null` (colonnes nullable),
// jamais une chaîne vide — sinon on écrit une valeur différente de « pas de valeur ».
const emptyToNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());

function isAllowedLang(v: string | null | undefined): v is AllowedLang {
    return (ALLOWED_LANGS as readonly string[]).includes(v ?? '');
}

// Même pattern que OwnerProfile.tsx (frontend/src/app/owner/profile/OwnerProfile.tsx) :
// code de langue en majuscules comme libellé, pas de table de correspondance à maintenir.
const LANG_OPTIONS = ALLOWED_LANGS.map((lang) => ({ value: lang, label: lang.toUpperCase() }));

const PROFORMA_VARIANT: Record<string, BadgeVariant> = {
    PAID: 'paid',
    PENDING: 'pending',
    OVERDUE: 'overdue',
    EXEMPT: 'exempt',
    DISPUTED: 'disputed',
};

const PAYMENT_VARIANT: Record<string, BadgeVariant> = {
    CONFIRMED: 'paid',
    DECLARED: 'pending',
    REJECTED: 'critical',
};

export function ArmateurDetail({ detail, canInvite, canAnonymize }: Props) {
    const t = useTranslations('AdminArmateurs');
    const router = useRouter();

    const sanctioned = detail.is_ofac_sdn || detail.is_un_prohibited;

    // ── Carte contacts éditable ─────────────────────────────────────────────
    // Formulaire complet (Task 8) : contrairement à l'ancienne boîte de dialogue
    // « modifier l'email » (qui n'envoyait que officialEmail + billingCcEmails:[],
    // écrasant silencieusement les autres coordonnées — voir le commentaire de
    // buildContactsPatch dans updateArmateurContacts.ts), CE formulaire affiche et
    // édite TOUS les champs optionnels de l'action. Chaque soumission les envoie
    // donc tous : un champ non touché renvoie simplement sa valeur actuelle (déjà
    // pré-remplie ci-dessous), ce n'est jamais une valeur vide inventée. Les champs
    // nullable vidés par l'utilisateur sont convertis en `null` via emptyToNull —
    // jamais laissés en chaîne vide, jamais omis (`undefined` figerait la valeur
    // existante côté serveur au lieu de l'effacer).
    const [officialEmail, setOfficialEmail] = React.useState(detail.official_email ?? '');
    const [ccEmails, setCcEmails] = React.useState<string[]>(detail.billing_cc_emails);
    const [ccInput, setCcInput] = React.useState('');
    const [opsEmail, setOpsEmail] = React.useState(detail.ops_email ?? '');
    const [financeEmail, setFinanceEmail] = React.useState(detail.finance_email ?? '');
    const [phoneE164, setPhoneE164] = React.useState(detail.phone_e164 ?? '');
    const [address, setAddress] = React.useState(detail.address ?? '');
    const [preferredLanguage, setPreferredLanguage] = React.useState<AllowedLang>(
        isAllowedLang(detail.preferred_language) ? detail.preferred_language : 'en',
    );
    const [notes, setNotes] = React.useState(detail.notes ?? '');
    const [contactsError, setContactsError] = React.useState<string | null>(null);
    const [contactsPending, startContactsTransition] = React.useTransition();

    function addCcEmail() {
        const email = ccInput.trim().toLowerCase();
        if (!email || !email.includes('@')) return;
        setCcEmails((list) => (list.includes(email) ? list : [...list, email]));
        setCcInput('');
    }
    function removeCcEmail(email: string) {
        setCcEmails((list) => list.filter((e) => e !== email));
    }
    function submitContacts() {
        setContactsError(null);
        startContactsTransition(async () => {
            const result = await updateArmateurContacts({
                shipownerId: detail.id,
                officialEmail: officialEmail.trim(),
                billingCcEmails: ccEmails,
                opsEmail: emptyToNull(opsEmail),
                financeEmail: emptyToNull(financeEmail),
                phoneE164: emptyToNull(phoneE164),
                address: emptyToNull(address),
                preferredLanguage,
                notes: emptyToNull(notes),
            });
            if (!result.ok) {
                setContactsError(result.reason);
                return;
            }
            router.refresh();
        });
    }

    const [inviteOpen, setInviteOpen] = React.useState(false);
    const [inviteEmail, setInviteEmail] = React.useState(detail.official_email ?? '');
    const [inviteError, setInviteError] = React.useState<string | null>(null);
    const [invitePending, startInviteTransition] = React.useTransition();

    const [anonymizeOpen, setAnonymizeOpen] = React.useState(false);
    const [anonymizeKeywordInput, setAnonymizeKeywordInput] = React.useState('');
    const [anonymizeError, setAnonymizeError] = React.useState<string | null>(null);
    const [anonymizePending, startAnonymizeTransition] = React.useTransition();

    function openInvite() {
        setInviteEmail(detail.official_email ?? '');
        setInviteError(null);
        setInviteOpen(true);
    }
    function closeInvite() {
        setInviteOpen(false);
        setInviteError(null);
    }
    function submitInvite() {
        setInviteError(null);
        startInviteTransition(async () => {
            const result = await inviteShipowner({ shipownerId: detail.id, email: inviteEmail });
            if (!result.ok) {
                setInviteError(result.reason);
                return;
            }
            closeInvite();
            router.refresh();
        });
    }

    const anonymizeKeyword = t('detail.anonymizeConfirmKeyword');

    function openAnonymize() {
        setAnonymizeKeywordInput('');
        setAnonymizeError(null);
        setAnonymizeOpen(true);
    }
    function closeAnonymize() {
        setAnonymizeOpen(false);
        setAnonymizeError(null);
    }
    function submitAnonymize() {
        setAnonymizeError(null);
        startAnonymizeTransition(async () => {
            const result = await anonymizeOwner({ shipownerId: detail.id });
            if (!result.ok) {
                setAnonymizeError(result.error);
                return;
            }
            closeAnonymize();
            router.refresh();
        });
    }

    const stateBadge = (state: string) => {
        if (state === 'ACTIVE') return <OsBadge variant="active" label={t('state.active')} />;
        if (state === 'INVITED') return <OsBadge variant="warning" label={t('state.invited')} />;
        return <OsBadge variant="archived" label={t('state.ghost')} />;
    };

    // Colonnes mémoïsées : useClientSort mémoïse sortedRows sur la RÉFÉRENCE de
    // `columns` (frontend/src/hooks/useClientSort.ts) — un tableau reconstruit à
    // chaque rendu invaliderait ce cache à chaque fois. Seule dépendance réelle :
    // `t` (tous les autres identifiants référencés — usd/fmtDate/orDash/ageInDays/
    // PROFORMA_VARIANT/PAYMENT_VARIANT — sont des constantes de module, stables).
    const vesselColumns: OsColumn<ArmateurVesselRow>[] = React.useMemo(() => [
        { key: 'imo', header: t('col.imo'), render: (v) => <span className="tabular-nums">{v.imo_number}</span> },
        { key: 'name', header: t('col.name'), render: (v) => <span className="font-medium text-[var(--os-text-primary)]">{v.name}</span> },
        { key: 'category', header: t('col.category'), render: (v) => <span className="text-xs">{v.category}</span> },
        {
            key: 'gt',
            header: t('col.grossTonnage'),
            className: 'text-right',
            sortable: true,
            sortValue: (v) => v.gross_tonnage_dwt,
            render: (v) => <span className="text-xs tabular-nums">{v.gross_tonnage_dwt}</span>,
        },
        { key: 'flag', header: t('col.flag'), render: (v) => <span className="text-xs">{orDash(v.flag_code)}</span> },
    ], [t]);

    const proformaColumns: OsColumn<ArmateurProformaRow>[] = React.useMemo(() => [
        {
            key: 'ref',
            header: t('col.invoiceRef'),
            render: (p) => <span className="font-medium text-[var(--os-text-primary)]">{orDash(p.invoice_ref)}</span>,
        },
        {
            key: 'date',
            header: t('col.date'),
            sortable: true,
            sortValue: (p) => p.created_at,
            render: (p) => <span className="text-xs">{fmtDate(p.created_at)}</span>,
        },
        {
            key: 'amount',
            header: t('col.amount'),
            className: 'text-right',
            sortable: true,
            sortValue: (p) => p.tax_amount_usd,
            render: (p) => <span className="text-xs tabular-nums">{usd(p.tax_amount_usd)}</span>,
        },
        {
            key: 'due',
            header: t('col.due'),
            className: 'text-right',
            sortable: true,
            sortValue: (p) => p.tax_amount_usd - p.partial_paid_usd,
            render: (p) => (
                <span className="text-xs tabular-nums font-semibold text-[var(--os-text-primary)]">
                    {usd(p.tax_amount_usd - p.partial_paid_usd)}
                </span>
            ),
        },
        {
            key: 'dueDate',
            header: t('col.dueDate'),
            sortable: true,
            sortValue: (p) => p.due_date,
            render: (p) => (
                <div className="flex items-center gap-1.5">
                    <span className="text-xs tabular-nums">{fmtDate(p.due_date)}</span>
                    {p.collections_status === 'OVERDUE' && <OsBadge variant="overdue" label={t('col.overdue')} size="sm" />}
                </div>
            ),
        },
        {
            key: 'age',
            header: t('col.age'),
            className: 'text-right',
            render: (p) => <span className="text-xs tabular-nums">{ageInDays(p.created_at)}</span>,
        },
        {
            key: 'status',
            header: t('col.status'),
            render: (p) => <OsBadge variant={PROFORMA_VARIANT[p.status] ?? 'info'} label={p.status} />,
        },
        {
            key: 'links',
            header: t('col.actions'),
            className: 'text-right',
            render: (p) => {
                if (p.invoice_ref && p.content_hash && p.verify_signature) {
                    const qs = `?h=${encodeURIComponent(p.content_hash)}&s=${encodeURIComponent(p.verify_signature)}`;
                    return (
                        <div className="flex justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                            <a
                                href={`/verify/${encodeURIComponent(p.invoice_ref)}${qs}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-[#00D97E] hover:underline"
                            >
                                {t('verify')}
                            </a>
                            <a
                                href={`/api/invoices/${encodeURIComponent(p.invoice_ref)}/download${qs}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-[#00D97E] hover:underline"
                            >
                                {t('download')}
                            </a>
                        </div>
                    );
                }
                return <span className="text-xs text-[var(--os-text-muted)]">{orDash(p.invoice_ref)}</span>;
            },
        },
    ], [t]);

    const paymentColumns: OsColumn<ArmateurPaymentRow>[] = React.useMemo(() => [
        {
            key: 'amount',
            header: t('col.amount'),
            className: 'text-right',
            sortable: true,
            sortValue: (p) => p.amount_usd_minor / 100,
            render: (p) => <span className="text-xs tabular-nums">{usd(p.amount_usd_minor / 100)}</span>,
        },
        {
            key: 'date',
            header: t('col.date'),
            sortable: true,
            sortValue: (p) => p.created_at,
            render: (p) => <span className="text-xs">{fmtDate(p.created_at)}</span>,
        },
        { key: 'rail', header: t('col.rail'), render: (p) => <span className="text-xs">{p.rail}</span> },
        {
            key: 'ref',
            header: t('col.reference'),
            render: (p) => <span className="text-xs">{orDash(p.external_reference)}</span>,
        },
        {
            key: 'status',
            header: t('col.status'),
            render: (p) => <OsBadge variant={PAYMENT_VARIANT[p.status] ?? 'info'} label={p.status} />,
        },
    ], [t]);

    const { sort: vesselSort, onSortChange: onVesselSortChange, sortedRows: sortedVessels } = useClientSort(detail.vessels, vesselColumns);
    const { sort: proformaSort, onSortChange: onProformaSortChange, sortedRows: sortedProformas } = useClientSort(detail.proformas, proformaColumns);
    const { sort: paymentSort, onSortChange: onPaymentSortChange, sortedRows: sortedPayments } = useClientSort(detail.payments, paymentColumns);

    const inviteDisabledReason = sanctioned
        ? t('sanctionedTooltip')
        : detail.account_state === 'ACTIVE'
          ? t('alreadyActiveTooltip')
          : undefined;

    return (
        <div className="px-6 py-4 flex flex-col gap-4">
            <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-semibold text-[var(--os-text-primary)]">{detail.name}</h1>
                {stateBadge(detail.account_state)}
                {detail.is_ofac_sdn && <OsBadge variant="critical" label="OFAC" />}
                {detail.is_un_prohibited && <OsBadge variant="critical" label="UN" />}
            </div>

            {sanctioned && (
                <div className="rounded-xl border border-[#EF4444]/30 bg-[#EF4444]/10 px-4 py-3 text-sm text-[#EF4444]">
                    {t('sanctionBanner', {
                        kind: [detail.is_ofac_sdn ? 'OFAC' : null, detail.is_un_prohibited ? 'UN' : null]
                            .filter(Boolean)
                            .join(' + '),
                    })}
                </div>
            )}

            <OsCard>
                <OsCardHeader title={t('detail.totalsTitle')} />
                <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-3 text-sm">
                    <Field label={t('detail.invoiced')} value={usd(detail.totals.invoicedUsd)} />
                    <Field label={t('detail.paid')} value={usd(detail.totals.paidUsd)} />
                    <Field label={t('detail.outstanding')} value={usd(detail.totals.outstandingUsd)} />
                    <Field label={t('detail.overdueCount')} value={String(detail.totals.overdueCount)} />
                    <Field label={t('detail.nextDueDate')} value={fmtDate(detail.totals.nextDueDate)} />
                </dl>
            </OsCard>

            <OsCard>
                <OsCardHeader title={t('detail.identityTitle')} />
                <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm">
                    <Field label={t('detail.country')} value={orDash(detail.country_code)} />
                    <Field label={t('detail.imoCompanyNo')} value={orDash(detail.imo_company_no)} />
                    <Field label={t('detail.equasisId')} value={orDash(detail.equasis_id)} />
                    <Field label={t('detail.aliases')} value={detail.aliases.length > 0 ? detail.aliases.join(', ') : '—'} />
                </dl>
            </OsCard>

            <OsCard>
                <OsCardHeader title={t('detail.contactsTitle')} />
                <div className="flex flex-col gap-4">
                    <OsInput
                        label={t('detail.officialEmail')}
                        type="email"
                        value={officialEmail}
                        onChange={(e) => setOfficialEmail(e.target.value)}
                        hint={
                            detail.official_email_source
                                ? `${t('detail.officialEmailHint')} (${detail.official_email_source})`
                                : t('detail.officialEmailHint')
                        }
                        placeholder="owner@example.com"
                    />

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-[var(--os-text-secondary)] uppercase tracking-wider">
                            {t('detail.billingCc')}
                        </label>
                        <p className="text-xs text-[var(--os-text-muted)]">{t('detail.billingCcHint')}</p>
                        {ccEmails.length > 0 && (
                            <ul className="flex flex-wrap gap-1.5 mt-1">
                                {ccEmails.map((email) => (
                                    <li
                                        key={email}
                                        className="inline-flex items-center gap-1.5 rounded-full bg-[var(--os-surface-2)] border border-[var(--os-border)] px-2.5 py-1 text-xs text-[var(--os-text-primary)]"
                                    >
                                        {email}
                                        <button
                                            type="button"
                                            onClick={() => removeCcEmail(email)}
                                            aria-label={t('detail.removeCc', { email })}
                                            className="text-[var(--os-text-muted)] hover:text-[#EF4444] leading-none"
                                        >
                                            ×
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div className="flex gap-2 mt-1">
                            <div className="flex-1">
                                <OsInput
                                    type="email"
                                    value={ccInput}
                                    onChange={(e) => setCcInput(e.target.value)}
                                    placeholder="cc@example.com"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            addCcEmail();
                                        }
                                    }}
                                />
                            </div>
                            <OsButton variant="secondary" onClick={addCcEmail}>
                                {t('detail.addCc')}
                            </OsButton>
                        </div>
                    </div>

                    <p className="text-xs text-[var(--os-text-muted)] -mb-2">{t('detail.infoOnlyHint')}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <OsInput
                            label={t('detail.opsEmail')}
                            type="email"
                            value={opsEmail}
                            onChange={(e) => setOpsEmail(e.target.value)}
                        />
                        <OsInput
                            label={t('detail.financeEmail')}
                            type="email"
                            value={financeEmail}
                            onChange={(e) => setFinanceEmail(e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <OsInput
                            label={t('detail.phone')}
                            type="text"
                            value={phoneE164}
                            onChange={(e) => setPhoneE164(e.target.value)}
                            placeholder="+252..."
                        />
                        <OsSelect
                            label={t('detail.language')}
                            value={preferredLanguage}
                            onChange={(e) => {
                                if (isAllowedLang(e.target.value)) setPreferredLanguage(e.target.value);
                            }}
                            options={LANG_OPTIONS}
                        />
                    </div>

                    <OsInput
                        label={t('detail.address')}
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                    />

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-[var(--os-text-secondary)] uppercase tracking-wider">
                            {t('detail.notes')}
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={3}
                            className="w-full rounded-xl px-4 py-2.5 bg-[var(--os-surface-2)] border border-[var(--os-border)] text-sm text-[var(--os-text-primary)] placeholder:text-[var(--os-text-muted)] focus:outline-none focus:border-[#00D97E]/60 focus:ring-1 focus:ring-[#00D97E]/20 transition-colors resize-none"
                        />
                    </div>

                    <div className="flex items-center justify-end gap-3">
                        {contactsError && <span className="text-xs text-[#EF4444]">{contactsError}</span>}
                        <OsButton
                            variant="primary"
                            onClick={submitContacts}
                            loading={contactsPending}
                            disabled={contactsPending || !officialEmail.trim()}
                        >
                            {contactsPending ? t('saving') : t('save')}
                        </OsButton>
                    </div>
                </div>
            </OsCard>

            <OsCard>
                <OsCardHeader title={t('detail.kycTitle')} />
                <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm">
                    <Field label={t('detail.accountState')} value={detail.account_state} />
                    <Field label={t('detail.kycB')} value={fmtDate(detail.kyc_level_b_completed_at)} />
                    <Field label={t('detail.kycC')} value={fmtDate(detail.kyc_level_c_completed_at)} />
                    <Field label={t('detail.billingLegalName')} value={orDash(detail.billing_legal_name)} />
                    <Field label={t('detail.billingCity')} value={orDash(detail.billing_city)} />
                    <Field label={t('detail.billingCountry')} value={orDash(detail.billing_country_code)} />
                    <Field label={t('detail.vatNumber')} value={orDash(detail.vat_number)} />
                    {detail.iban_masked && <Field label={t('detail.iban')} value={detail.iban_masked} />}
                    <Field label={t('detail.swiftBic')} value={orDash(detail.swift_bic)} />
                    <Field label={t('detail.bankName')} value={orDash(detail.bank_name)} />
                </dl>
            </OsCard>

            <OsCard>
                <OsCardHeader title={t('detail.vesselsTitle')} />
                <OsTable
                    columns={vesselColumns}
                    rows={sortedVessels}
                    keyExtractor={(v) => v.id}
                    emptyMessage={t('detail.noVessels')}
                    sort={vesselSort}
                    onSortChange={onVesselSortChange}
                />
            </OsCard>

            <OsCard>
                <OsCardHeader title={t('detail.proformasTitle')} />
                <OsTable
                    columns={proformaColumns}
                    rows={sortedProformas}
                    keyExtractor={(p) => p.id}
                    emptyMessage={t('detail.noProformas')}
                    sort={proformaSort}
                    onSortChange={onProformaSortChange}
                />
            </OsCard>

            <OsCard>
                <OsCardHeader title={t('detail.paymentsTitle')} />
                <OsTable
                    columns={paymentColumns}
                    rows={sortedPayments}
                    keyExtractor={(p) => p.id}
                    emptyMessage={t('detail.noPayments')}
                    sort={paymentSort}
                    onSortChange={onPaymentSortChange}
                />
            </OsCard>

            <OsCard>
                <OsCardHeader title={t('detail.remindersTitle')} />
                {detail.reminders.length === 0 ? (
                    <p className="text-xs text-[var(--os-text-muted)]">{t('detail.noReminders')}</p>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {detail.reminders.map((r) => (
                            <li
                                key={r.id}
                                className="flex flex-wrap items-center gap-3 text-sm border-b border-[var(--os-border)] last:border-0 pb-2 last:pb-0"
                            >
                                <OsBadge variant="warning" label={r.tier} size="sm" />
                                <span className="text-xs text-[var(--os-text-muted)]">{fmtDate(r.sent_at)}</span>
                                <span className="text-xs">{r.debtor_response_type}</span>
                                {r.escalated_bailiff && <OsBadge variant="critical" label={t('detail.escalatedBailiff')} size="sm" />}
                            </li>
                        ))}
                    </ul>
                )}
            </OsCard>

            {canInvite && (
                <OsCard>
                    <OsCardHeader title={t('detail.actionsTitle')} />
                    <div className="flex flex-wrap gap-3">
                        <span title={inviteDisabledReason}>
                            <OsButton
                                variant="primary"
                                disabled={sanctioned || detail.account_state === 'ACTIVE'}
                                onClick={openInvite}
                            >
                                {detail.account_state === 'INVITED' ? t('reinvite') : t('invite')}
                            </OsButton>
                        </span>
                    </div>
                </OsCard>
            )}

            {canAnonymize && (
                <OsCard>
                    <OsCardHeader title={t('detail.anonymizeTitle')} />
                    {detail.anonymized_at ? (
                        <p className="text-sm text-[var(--os-text-muted)]">
                            {t('detail.anonymizedAt', { date: fmtDate(detail.anonymized_at) })}
                        </p>
                    ) : (
                        <OsButton variant="danger" onClick={openAnonymize}>
                            {t('detail.anonymizeButton')}
                        </OsButton>
                    )}
                </OsCard>
            )}

            <Dialog.Root open={inviteOpen} onOpenChange={(o) => !o && closeInvite()}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} />
                    <Dialog.Content
                        className="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                        style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                    >
                        <Dialog.Title className="text-base font-semibold text-[var(--os-text-primary)] mb-2">
                            {t('inviteDialogTitle')}
                        </Dialog.Title>
                        <Dialog.Description className="text-sm text-[var(--os-text-muted)] mb-4">
                            {t('inviteDialogSubtitle', { name: detail.name })}
                        </Dialog.Description>

                        <OsInput
                            label={t('col.email')}
                            type="email"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            placeholder="owner@example.com"
                            autoFocus
                            error={inviteError ?? undefined}
                        />

                        <div className="mt-5 flex justify-end gap-2">
                            <OsButton variant="ghost" onClick={closeInvite} disabled={invitePending}>
                                {t('cancel')}
                            </OsButton>
                            <OsButton
                                variant="primary"
                                onClick={submitInvite}
                                loading={invitePending}
                                disabled={invitePending || !inviteEmail}
                            >
                                {invitePending ? t('sending') : t('sendInvite')}
                            </OsButton>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

            <Dialog.Root open={anonymizeOpen} onOpenChange={(o) => !o && closeAnonymize()}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} />
                    <Dialog.Content
                        className="fixed left-1/2 top-1/2 z-50 w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                        style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                    >
                        <Dialog.Title className="text-base font-semibold text-[var(--os-text-primary)] mb-2">
                            {t('detail.anonymizeTitle')}
                        </Dialog.Title>
                        <Dialog.Description className="text-sm text-[var(--os-text-muted)] mb-4">
                            {t('detail.anonymizeWarning')}
                        </Dialog.Description>

                        <OsInput
                            label={t('detail.anonymizeConfirmLabel', { keyword: anonymizeKeyword })}
                            type="text"
                            value={anonymizeKeywordInput}
                            onChange={(e) => setAnonymizeKeywordInput(e.target.value)}
                            placeholder={anonymizeKeyword}
                            autoFocus
                            error={anonymizeError ?? undefined}
                        />

                        <div className="mt-5 flex justify-end gap-2">
                            <OsButton variant="ghost" onClick={closeAnonymize} disabled={anonymizePending}>
                                {t('cancel')}
                            </OsButton>
                            <OsButton
                                variant="danger"
                                onClick={submitAnonymize}
                                loading={anonymizePending}
                                disabled={anonymizePending || anonymizeKeywordInput !== anonymizeKeyword}
                            >
                                {t('detail.anonymizeCta')}
                            </OsButton>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </div>
    );
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="flex flex-col gap-0.5">
            <dt className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">{label}</dt>
            <dd className="text-sm text-[var(--os-text-primary)] break-words">
                {value}
                {hint && hint !== '—' && <span className="ml-1.5 text-xs text-[var(--os-text-muted)]">({hint})</span>}
            </dd>
        </div>
    );
}
