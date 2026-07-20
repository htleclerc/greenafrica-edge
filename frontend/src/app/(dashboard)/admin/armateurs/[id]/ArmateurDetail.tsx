'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as Dialog from '@radix-ui/react-dialog';
import { OsCard, OsCardHeader } from '@/components/ui/OsCard';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsButton } from '@/components/ui/OsButton';
import { OsBadge, type BadgeVariant } from '@/components/ui/OsBadge';
import { OsInput } from '@/components/ui/OsInput';
import { inviteShipowner } from '@/actions/inviteShipowner';
import { updateArmateurEmail } from '@/actions/updateArmateurEmail';
import {
    type ArmateurDetail as ArmateurDetailType,
    type ArmateurVesselRow,
    type ArmateurProformaRow,
    type ArmateurPaymentRow,
} from '@/services/armateurService';

interface Props {
    detail: ArmateurDetailType;
    canInvite: boolean;
}

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');
const orDash = (v: string | null | undefined) => (v && v.length > 0 ? v : '—');

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

export function ArmateurDetail({ detail, canInvite }: Props) {
    const t = useTranslations('AdminArmateurs');
    const router = useRouter();

    const sanctioned = detail.is_ofac_sdn || detail.is_un_prohibited;

    const [editEmailOpen, setEditEmailOpen] = React.useState(false);
    const [emailValue, setEmailValue] = React.useState(detail.official_email ?? '');
    const [emailError, setEmailError] = React.useState<string | null>(null);
    const [emailPending, startEmailTransition] = React.useTransition();

    const [inviteOpen, setInviteOpen] = React.useState(false);
    const [inviteEmail, setInviteEmail] = React.useState(detail.official_email ?? '');
    const [inviteError, setInviteError] = React.useState<string | null>(null);
    const [invitePending, startInviteTransition] = React.useTransition();

    function openEditEmail() {
        setEmailValue(detail.official_email ?? '');
        setEmailError(null);
        setEditEmailOpen(true);
    }
    function closeEditEmail() {
        setEditEmailOpen(false);
        setEmailError(null);
    }
    function submitEditEmail() {
        setEmailError(null);
        startEmailTransition(async () => {
            const result = await updateArmateurEmail({ shipownerId: detail.id, email: emailValue });
            if (!result.ok) {
                setEmailError(result.reason);
                return;
            }
            closeEditEmail();
            router.refresh();
        });
    }

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

    const stateBadge = (state: string) => {
        if (state === 'ACTIVE') return <OsBadge variant="active" label={t('state.active')} />;
        if (state === 'INVITED') return <OsBadge variant="warning" label={t('state.invited')} />;
        return <OsBadge variant="archived" label={t('state.ghost')} />;
    };

    const vesselColumns: OsColumn<ArmateurVesselRow>[] = [
        { key: 'imo', header: t('col.imo'), render: (v) => <span className="tabular-nums">{v.imo_number}</span> },
        { key: 'name', header: t('col.name'), render: (v) => <span className="font-medium text-[var(--os-text-primary)]">{v.name}</span> },
        { key: 'category', header: t('col.category'), render: (v) => <span className="text-xs">{v.category}</span> },
        {
            key: 'gt',
            header: t('col.grossTonnage'),
            className: 'text-right',
            render: (v) => <span className="text-xs tabular-nums">{v.gross_tonnage_dwt}</span>,
        },
        { key: 'flag', header: t('col.flag'), render: (v) => <span className="text-xs">{orDash(v.flag_code)}</span> },
    ];

    const proformaColumns: OsColumn<ArmateurProformaRow>[] = [
        {
            key: 'ref',
            header: t('col.invoiceRef'),
            render: (p) => <span className="font-medium text-[var(--os-text-primary)]">{orDash(p.invoice_ref)}</span>,
        },
        { key: 'date', header: t('col.date'), render: (p) => <span className="text-xs">{fmtDate(p.created_at)}</span> },
        {
            key: 'amount',
            header: t('col.amount'),
            className: 'text-right',
            render: (p) => <span className="text-xs tabular-nums">{usd(p.tax_amount_usd)}</span>,
        },
        {
            key: 'due',
            header: t('col.due'),
            className: 'text-right',
            render: (p) => (
                <span className="text-xs tabular-nums font-semibold text-[var(--os-text-primary)]">
                    {usd(p.tax_amount_usd - p.partial_paid_usd)}
                </span>
            ),
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
    ];

    const paymentColumns: OsColumn<ArmateurPaymentRow>[] = [
        {
            key: 'amount',
            header: t('col.amount'),
            className: 'text-right',
            render: (p) => <span className="text-xs tabular-nums">{usd(p.amount_usd_minor / 100)}</span>,
        },
        { key: 'date', header: t('col.date'), render: (p) => <span className="text-xs">{fmtDate(p.created_at)}</span> },
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
    ];

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
                <OsCardHeader title={t('detail.identityTitle')} />
                <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 text-sm">
                    <Field label={t('detail.officialEmail')} value={orDash(detail.official_email)} hint={orDash(detail.official_email_source)} />
                    <Field label={t('detail.opsEmail')} value={orDash(detail.ops_email)} />
                    <Field label={t('detail.financeEmail')} value={orDash(detail.finance_email)} />
                    <Field label={t('detail.country')} value={orDash(detail.country_code)} />
                    <Field label={t('detail.address')} value={orDash(detail.address)} />
                    <Field label={t('detail.imoCompanyNo')} value={orDash(detail.imo_company_no)} />
                    <Field label={t('detail.equasisId')} value={orDash(detail.equasis_id)} />
                    <Field label={t('detail.aliases')} value={detail.aliases.length > 0 ? detail.aliases.join(', ') : '—'} />
                    <Field label={t('detail.phone')} value={orDash(detail.phone_e164)} />
                    <Field label={t('detail.language')} value={orDash(detail.preferred_language)} />
                    <Field label={t('detail.notes')} value={orDash(detail.notes)} />
                </dl>
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
                <OsTable columns={vesselColumns} rows={detail.vessels} keyExtractor={(v) => v.id} emptyMessage={t('detail.noVessels')} />
            </OsCard>

            <OsCard>
                <OsCardHeader title={t('detail.proformasTitle')} />
                <OsTable columns={proformaColumns} rows={detail.proformas} keyExtractor={(p) => p.id} emptyMessage={t('detail.noProformas')} />
            </OsCard>

            <OsCard>
                <OsCardHeader title={t('detail.paymentsTitle')} />
                <OsTable columns={paymentColumns} rows={detail.payments} keyExtractor={(p) => p.id} emptyMessage={t('detail.noPayments')} />
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

            <OsCard>
                <OsCardHeader title={t('detail.actionsTitle')} />
                <div className="flex flex-wrap gap-3">
                    <OsButton variant="secondary" onClick={openEditEmail}>
                        {t('editEmail')}
                    </OsButton>
                    {canInvite && (
                        <span title={inviteDisabledReason}>
                            <OsButton
                                variant="primary"
                                disabled={sanctioned || detail.account_state === 'ACTIVE'}
                                onClick={openInvite}
                            >
                                {detail.account_state === 'INVITED' ? t('reinvite') : t('invite')}
                            </OsButton>
                        </span>
                    )}
                </div>
            </OsCard>

            <Dialog.Root open={editEmailOpen} onOpenChange={(o) => !o && closeEditEmail()}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} />
                    <Dialog.Content
                        className="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                        style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                    >
                        <Dialog.Title className="text-base font-semibold text-[var(--os-text-primary)] mb-2">
                            {t('editEmailDialogTitle')}
                        </Dialog.Title>
                        <Dialog.Description className="text-sm text-[var(--os-text-muted)] mb-4">
                            {t('editEmailDialogSubtitle', { name: detail.name })}
                        </Dialog.Description>

                        <OsInput
                            label={t('col.email')}
                            type="email"
                            value={emailValue}
                            onChange={(e) => setEmailValue(e.target.value)}
                            placeholder="owner@example.com"
                            autoFocus
                            error={emailError ?? undefined}
                        />

                        <div className="mt-5 flex justify-end gap-2">
                            <OsButton variant="ghost" onClick={closeEditEmail} disabled={emailPending}>
                                {t('cancel')}
                            </OsButton>
                            <OsButton
                                variant="primary"
                                onClick={submitEditEmail}
                                loading={emailPending}
                                disabled={emailPending || !emailValue}
                            >
                                {emailPending ? t('saving') : t('save')}
                            </OsButton>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

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
