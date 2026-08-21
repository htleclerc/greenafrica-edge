'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
import { createOwnerAgentMapping } from '@/actions/createOwnerAgentMapping';
import { addOwnerRepresentative } from '@/actions/addOwnerRepresentative';
import { deactivateOwnerAgentMapping } from '@/actions/deactivateOwnerAgentMapping';
import { sendManualReminder } from '@/actions/sendManualReminder';
import { sendConsolidatedRecap } from '@/actions/sendConsolidatedRecap';
import { groupManualReminders } from '@/lib/groupManualReminders';
import { useClientSort } from '@/hooks/useClientSort';
import { ALLOWED_LANGS } from '@/lib/kyc/kycSchema';
import { MAX_CC_EMAILS } from '@/lib/armateurContacts';
import {
    type ArmateurDetail as ArmateurDetailType,
    type ArmateurVesselRow,
    type ArmateurProformaRow,
    type ArmateurPaymentRow,
    type ArmateurRepresentativeRow,
} from '@/services/armateurService';

// Forme exacte de agentsRes.data dans page.tsx (select('id, full_name, email')
// sur profiles filtré role=SHIPPING_AGENT) — même requête que owner-agent-mappings/
// page.tsx, réutilisée telle quelle pour peupler le sélecteur d'agent de
// RepresentativesCard (round de correction 1, Tâche 9).
interface ArmateurAgentOption {
    id: string;
    full_name: string | null;
    email: string;
}

interface Props {
    detail: ArmateurDetailType;
    canInvite: boolean;
    canAnonymize: boolean;
    agents: ArmateurAgentOption[];
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

// Statuts pour lesquels une créance reste ouverte — reflète exactement
// REMINDABLE_STATUSES (frontend/src/actions/sendManualReminder.ts) et le filtre
// de composeOwnerStatement (statementService.ts) consommé par
// sendConsolidatedRecap. Sert à afficher, côté client, un compte de factures
// concernées cohérent avec ce que le serveur enverra réellement.
const OPEN_PROFORMA_STATUSES = ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'];

// ── Carte contacts : ne renvoyer que ce qui a réellement changé ────────────
// Round de correction 1 (Task 8) : un envoi systématique des 8 champs (même
// initialisés depuis `detail`) neutralisait la protection par présence de
// updateArmateurContacts.ts et ouvrait une mise à jour perdue — un second
// écrivain existe sur ces mêmes colonnes : updateOwnerKycProfile.ts
// (self-service armateur, /owner/profile) écrit address/phone_e164/
// preferred_language/ops_email/finance_email. Scénario concret : le
// gestionnaire ouvre la fiche à 10h00, l'armateur corrige son téléphone à
// 10h05 depuis son portail, le gestionnaire ne corrige que l'e-mail à 10h10 et
// sauvegarde — un envoi inconditionnel de `phoneE164` réexpédierait
// l'instantané de 10h00 et écraserait la correction de l'armateur, sans
// aucune détection de conflit. `buildContactsSubmission` compare l'état
// courant du formulaire à `detail` (l'instantané chargé au montage) et
// n'inclut un champ que s'il diffère — un champ non touché n'apparaît donc
// jamais dans l'appel, exactement comme un champ non fourni n'apparaît jamais
// dans le patch Postgres. `officialEmail` est le seul champ toujours renvoyé
// (seul requis par le schéma).
interface ContactsFormState {
    officialEmail: string;
    ccEmails: string[];
    opsEmail: string;
    financeEmail: string;
    phoneE164: string;
    address: string;
    preferredLanguage: AllowedLang;
    notes: string;
}

interface ContactsBaseline {
    official_email: string | null;
    billing_cc_emails: string[];
    ops_email: string | null;
    finance_email: string | null;
    phone_e164: string | null;
    address: string | null;
    preferred_language: string | null;
    notes: string | null;
}

interface ContactsSubmission {
    officialEmail: string;
    billingCcEmails?: string[];
    opsEmail?: string | null;
    financeEmail?: string | null;
    phoneE164?: string | null;
    address?: string | null;
    preferredLanguage?: AllowedLang;
    notes?: string | null;
}

// Égalité en ensemble (ordre indifférent) : la liste de copies n'a pas d'ordre
// significatif, seul son contenu compte pour décider si elle a changé.
function sameEmailSet(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sa = [...a].sort();
    const sb = [...b].sort();
    return sa.every((v, i) => v === sb[i]);
}

export function buildContactsSubmission(
    state: ContactsFormState,
    baseline: ContactsBaseline,
): ContactsSubmission {
    const submission: ContactsSubmission = { officialEmail: state.officialEmail.trim() };

    if (!sameEmailSet(state.ccEmails, baseline.billing_cc_emails)) {
        submission.billingCcEmails = state.ccEmails;
    }
    const opsEmail = emptyToNull(state.opsEmail);
    if (opsEmail !== baseline.ops_email) submission.opsEmail = opsEmail;

    const financeEmail = emptyToNull(state.financeEmail);
    if (financeEmail !== baseline.finance_email) submission.financeEmail = financeEmail;

    const phoneE164 = emptyToNull(state.phoneE164);
    if (phoneE164 !== baseline.phone_e164) submission.phoneE164 = phoneE164;

    const address = emptyToNull(state.address);
    if (address !== baseline.address) submission.address = address;

    if (state.preferredLanguage !== baseline.preferred_language) {
        submission.preferredLanguage = state.preferredLanguage;
    }

    const notes = emptyToNull(state.notes);
    if (notes !== baseline.notes) submission.notes = notes;

    return submission;
}

// Clé de remontage de <ContactsCard>. Après une sauvegarde réussie,
// router.refresh() fait redescendre un `detail` neuf (même instance de
// composant, nouvelles props) sans jamais démonter <ArmateurDetail> — un
// simple useState ne se resynchroniserait donc jamais avec ce qui est
// réellement en base, et l'écran continuerait d'afficher des valeurs que le
// serveur a refusées (ex : plafond de copies dépassé) ou modifiées entre
// deux écrivains (voir buildContactsSubmission). Un `useEffect` qui
// recopierait `detail` dans le state déclencherait react-hooks/set-state-in-effect
// (sévérité error dans ce dépôt) : la clé est le mécanisme que React
// recommande pour réinitialiser un sous-arbre entier avec un état local frais
// quand les données dont il dérive changent réellement.
function contactsCardKey(detail: ArmateurDetailType): string {
    return JSON.stringify([
        detail.official_email, detail.billing_cc_emails, detail.ops_email,
        detail.finance_email, detail.phone_e164, detail.address,
        detail.preferred_language, detail.notes,
    ]);
}

export function ArmateurDetail({ detail, canInvite, canAnonymize, agents }: Props) {
    const t = useTranslations('AdminArmateurs');
    const router = useRouter();

    const sanctioned = detail.is_ofac_sdn || detail.is_un_prohibited;

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

    // Relance manuelle d'UNE pro-forma (sendManualReminder, Tâche 11), déclenchée
    // depuis une ligne du tableau des pro-formas. `remindTarget` porte la ligne
    // ciblée — sa présence pilote le Dialog de confirmation ci-dessous, jamais un
    // clic isolé du bouton de la ligne.
    const [remindTarget, setRemindTarget] = React.useState<ArmateurProformaRow | null>(null);
    const [remindError, setRemindError] = React.useState<string | null>(null);
    const [reminding, startRemindTransition] = React.useTransition();

    function closeRemind() {
        setRemindTarget(null);
        setRemindError(null);
    }
    function confirmRemind() {
        if (!remindTarget) return;
        setRemindError(null);
        startRemindTransition(async () => {
            const result = await sendManualReminder({ transactionId: remindTarget.id });
            if (!result.ok) {
                setRemindError(result.reason);
                return;
            }
            setRemindTarget(null);
            router.refresh();
        });
    }

    // Récapitulatif consolidé (sendConsolidatedRecap, Tâche 12) — une seule
    // instance de dialogue pour toute la fiche, pas de "cible" à porter puisque
    // l'armateur est déjà `detail`. openProformaCount reflète exactement
    // OPEN_PROFORMA_STATUSES : c'est le même filtre que composeOwnerStatement
    // appliquera côté serveur, donc le compte affiché dans la confirmation ne
    // ment jamais sur ce que l'envoi couvrira.
    const openProformaCount = detail.proformas.filter((p) => OPEN_PROFORMA_STATUSES.includes(p.status)).length;
    const [recapOpen, setRecapOpen] = React.useState(false);
    const [recapError, setRecapError] = React.useState<string | null>(null);
    const [recapPending, startRecapTransition] = React.useTransition();

    function confirmRecap() {
        setRecapError(null);
        startRecapTransition(async () => {
            const result = await sendConsolidatedRecap({ shipownerId: detail.id });
            if (!result.ok) {
                setRecapError(result.reason);
                return;
            }
            setRecapOpen(false);
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
                // Bouton de relance manuelle (Tâche 13, sendManualReminder) — affiché
                // seulement sur une créance encore ouverte (OPEN_PROFORMA_STATUSES),
                // pour ne pas offrir un clic voué à l'échec sur les dizaines de
                // pro-formas déjà payées/exemptées que cette table peut contenir.
                const remindButton = OPEN_PROFORMA_STATUSES.includes(p.status) ? (
                    <OsButton size="sm" variant="secondary" onClick={() => { setRemindError(null); setRemindTarget(p); }}>
                        {t('remind')}
                    </OsButton>
                ) : null;

                if (p.invoice_ref && p.content_hash && p.verify_signature) {
                    const qs = `?h=${encodeURIComponent(p.content_hash)}&s=${encodeURIComponent(p.verify_signature)}`;
                    return (
                        <div className="flex justify-end items-center gap-3" onClick={(e) => e.stopPropagation()}>
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
                            {remindButton}
                        </div>
                    );
                }
                if (remindButton) {
                    return <div className="flex justify-end">{remindButton}</div>;
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

            <ContactsCard key={contactsCardKey(detail)} detail={detail} onSaved={() => router.refresh()} />

            <RepresentativesCard detail={detail} onSaved={() => router.refresh()} agents={agents} />

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
                        {groupManualReminders(detail.reminders).map((r) => r.kind === 'group' ? (
                            <li
                                key={r.id}
                                className="flex flex-wrap items-center gap-3 text-sm border-b border-[var(--os-border)] last:border-0 pb-2 last:pb-0"
                            >
                                <OsBadge variant="info" label="MANUAL" size="sm" />
                                <span className="text-xs text-[var(--os-text-muted)]">{fmtDate(r.sentAt)}</span>
                                <span className="text-xs">{t('detail.manualGroup', { count: r.count })}</span>
                            </li>
                        ) : (
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

            {/* Non gardée par canInvite (SUPERADMIN uniquement) : sendConsolidatedRecap
                autorise les 3 rôles staff de la page (PORT_OFFICER, FINANCE_ADMIN,
                SUPERADMIN — voir STAFF_ROLES dans sendConsolidatedRecap.ts), donc la
                carte doit rester visible pour eux. Seul le bouton d'invitation, lui,
                reste gardé en interne. */}
            <OsCard>
                <OsCardHeader title={t('detail.actionsTitle')} />
                <div className="flex flex-wrap gap-3">
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
                    <OsButton
                        variant="secondary"
                        disabled={openProformaCount === 0}
                        onClick={() => { setRecapError(null); setRecapOpen(true); }}
                    >
                        {t('sendRecap')}
                    </OsButton>
                </div>
            </OsCard>

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

            <Dialog.Root open={remindTarget !== null} onOpenChange={(o) => !o && closeRemind()}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} />
                    <Dialog.Content
                        className="fixed left-1/2 top-1/2 z-50 w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                        style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                    >
                        <Dialog.Title className="text-base font-semibold text-[var(--os-text-primary)] mb-2">
                            {t('remindConfirmTitle')}
                        </Dialog.Title>
                        <Dialog.Description className="text-sm text-[var(--os-text-muted)] mb-4">
                            {t('remindConfirmBody', {
                                name: detail.name,
                                ref: remindTarget?.invoice_ref ?? remindTarget?.id.slice(0, 8) ?? '',
                            })}
                        </Dialog.Description>
                        {remindError && <p className="text-xs text-[#EF4444] mb-3">{remindError}</p>}
                        <div className="mt-1 flex justify-end gap-2">
                            <OsButton variant="ghost" onClick={closeRemind} disabled={reminding}>
                                {t('cancel')}
                            </OsButton>
                            <OsButton variant="primary" onClick={confirmRemind} loading={reminding} disabled={reminding}>
                                {t('remind')}
                            </OsButton>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>

            <Dialog.Root open={recapOpen} onOpenChange={(o) => !o && setRecapOpen(false)}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} />
                    <Dialog.Content
                        className="fixed left-1/2 top-1/2 z-50 w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5"
                        style={{ backgroundColor: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}
                    >
                        <Dialog.Title className="text-base font-semibold text-[var(--os-text-primary)] mb-2">
                            {t('sendRecapConfirmTitle')}
                        </Dialog.Title>
                        <Dialog.Description className="text-sm text-[var(--os-text-muted)] mb-4">
                            {t('sendRecapConfirmBody', { name: detail.name, count: openProformaCount })}
                        </Dialog.Description>
                        {recapError && <p className="text-xs text-[#EF4444] mb-3">{recapError}</p>}
                        <div className="mt-1 flex justify-end gap-2">
                            <OsButton variant="ghost" onClick={() => setRecapOpen(false)} disabled={recapPending}>
                                {t('cancel')}
                            </OsButton>
                            <OsButton variant="primary" onClick={confirmRecap} loading={recapPending} disabled={recapPending}>
                                {t('sendRecap')}
                            </OsButton>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </div>
    );
}

interface ContactsCardProps {
    detail: ArmateurDetailType;
    onSaved: () => void;
}

// Carte contacts éditable (Task 8, extraite au round de correction 1). Montée
// avec une `key` dérivée des champs de contact (voir contactsCardKey
// ci-dessus) : React la démonte/remonte entièrement quand `detail` change
// réellement, ce qui réinitialise tout son état local sur les valeurs
// fraîches — sans effet, sans race, sans jamais mentir sur ce qui est en base.
function ContactsCard({ detail, onSaved }: ContactsCardProps) {
    const t = useTranslations('AdminArmateurs');

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

    const ccAtCap = ccEmails.length >= MAX_CC_EMAILS;

    function addCcEmail() {
        // Filet client : le bouton/l'input sont déjà désactivés au plafond,
        // ce garde couvre aussi la soumission par la touche Entrée. Le refus
        // serveur (schéma Zod, updateArmateurContacts.ts) reste le filet
        // ultime, pas le chemin nominal.
        if (ccAtCap) return;
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
                ...buildContactsSubmission(
                    { officialEmail, ccEmails, opsEmail, financeEmail, phoneE164, address, preferredLanguage, notes },
                    detail,
                ),
            });
            if (!result.ok) {
                setContactsError(result.reason);
                return;
            }
            onSaved();
        });
    }

    return (
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
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-[var(--os-text-secondary)] uppercase tracking-wider">
                            {t('detail.billingCc')}
                        </label>
                        <span className="text-xs text-[var(--os-text-muted)] tabular-nums">
                            {ccEmails.length}/{MAX_CC_EMAILS}
                        </span>
                    </div>
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
                                disabled={ccAtCap}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        addCcEmail();
                                    }
                                }}
                            />
                        </div>
                        <OsButton variant="secondary" onClick={addCcEmail} disabled={ccAtCap}>
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
    );
}

interface RepresentativesCardProps {
    detail: ArmateurDetailType;
    onSaved: () => void;
    agents: ArmateurAgentOption[];
}

// Carte représentants (Task 9). Contrairement à ContactsCard, aucun état local
// ne dérive d'un instantané de `detail` : la liste est relue directement depuis
// les props à chaque rendu (comme sortedVessels/sortedProformas/sortedPayments
// dans le composant parent), et le mini-formulaire d'attache part toujours de
// champs vides. Pas de remontage par `key` nécessaire ici — voir la note sur
// contactsCardKey pour le problème que ContactsCard résout et que celui-ci
// n'a pas.
//
// Table volontairement non triable (pas de useClientSort) : un armateur a
// typiquement 1 à 3 représentants, l'ordre par priorité déjà appliqué par
// getArmateurDetail suffit. useClientSort mémoïse sur la RÉFÉRENCE de columns
// (frontend/src/hooks/useClientSort.ts) — l'utiliser ici aurait forcé soit un
// useMemo sur columns avec des gestionnaires eux-mêmes stabilisés par
// useCallback (pending/erreur par ligne inclus), soit une dépendance manquante
// signalée par react-hooks/preserve-manual-memoization (sévérité error dans ce
// dépôt) ; complexité non justifiée pour une liste aussi courte. Même parti
// pris que OwnerAgentMappingList.tsx (frontend/src/app/(dashboard)/admin/
// owner-agent-mappings/OwnerAgentMappingList.tsx), qui gère cette même donnée
// sans useClientSort non plus.
function RepresentativesCard({ detail, onSaved, agents }: RepresentativesCardProps) {
    const t = useTranslations('AdminArmateurs');

    const [attachOpen, setAttachOpen] = React.useState(false);
    const [agentProfileId, setAgentProfileId] = React.useState('');
    const [priority, setPriority] = React.useState(100);
    const [attachError, setAttachError] = React.useState<string | null>(null);
    const [attachPending, startAttachTransition] = React.useTransition();

    // Second chemin de rattachement : par ADRESSE, pour un representant qui
    // n'a pas encore de compte. Le selecteur ci-dessus ne propose que des
    // profils existants, or agent_profile_id est NOT NULL — il fallait donc
    // deja avoir un compte pour pouvoir en obtenir un. C'est le cas d'une
    // reponse a la campagne venant d'une adresse absente du referentiel.
    const [inviteOpen, setInviteOpen] = React.useState(false);
    const [inviteEmail, setInviteEmail] = React.useState('');
    const [inviteName, setInviteName] = React.useState('');
    const [inviteError, setInviteError] = React.useState<string | null>(null);
    const [invitePending, startInviteTransition] = React.useTransition();

    function submitInvite() {
        setInviteError(null);
        startInviteTransition(async () => {
            const result = await addOwnerRepresentative({
                shipownerId: detail.id,
                email: inviteEmail.trim(),
                fullName: inviteName.trim(),
            });
            if (!result.ok) {
                setInviteError(result.reason);
                return;
            }
            setInviteOpen(false);
            setInviteEmail('');
            setInviteName('');
            onSaved();
        });
    }

    const [revokingId, setRevokingId] = React.useState<string | null>(null);
    const [revokeError, setRevokeError] = React.useState<string | null>(null);
    const [revokePending, startRevokeTransition] = React.useTransition();

    function openAttach() {
        setAgentProfileId('');
        setPriority(100);
        setAttachError(null);
        setAttachOpen(true);
    }
    function closeAttach() {
        setAttachOpen(false);
        setAttachError(null);
    }
    function submitAttach() {
        setAttachError(null);
        startAttachTransition(async () => {
            const result = await createOwnerAgentMapping({
                shipownerId: detail.id,
                agentProfileId: agentProfileId.trim(),
                priority,
            });
            if (!result.ok) {
                setAttachError(result.reason);
                return;
            }
            closeAttach();
            onSaved();
        });
    }

    function submitRevoke(mappingId: string) {
        setRevokeError(null);
        setRevokingId(mappingId);
        startRevokeTransition(async () => {
            const result = await deactivateOwnerAgentMapping({ mappingId });
            if (!result.ok) {
                setRevokingId(null);
                setRevokeError(result.reason);
                return;
            }
            onSaved();
        });
    }

    // Représentant "principal" au sens du rapprochement automatique (cascade A,
    // match_pending_alerts — migrations 034/046) : actif, dans sa fenêtre de
    // validité, priorité la plus basse. C'est UNIQUEMENT ce qu'une NOUVELLE
    // alerte d'arrivée traitée automatiquement retiendrait aujourd'hui — PAS une
    // garantie sur les pro-formas déjà émises (transactions.agent_profile_id y
    // est figé au moment de l'émission, cf getArmateurDetail et
    // proformaPipelineService.ts) ni sur une alerte revendiquée manuellement
    // (claimAlert dans arrivalAlertService.ts, qui ignore ce mapping et peut
    // désigner n'importe quel agent). D'où le libellé de repPrimary,
    // volontairement au futur et borné aux "nouvelles" factures plutôt qu'une
    // affirmation générale — voir le rapport de la Tâche 9 pour le détail de cet
    // écart avec le brief initial.
    const todayIso = new Date().toISOString().slice(0, 10);
    const eligible = detail.representatives
        .filter((r) => r.active && r.valid_from <= todayIso && (r.valid_until === null || r.valid_until >= todayIso))
        .sort((a, b) => a.priority - b.priority);
    const primaryId = eligible[0]?.id ?? null;

    // Même patron que AddMappingForm.tsx (frontend/src/app/(dashboard)/admin/
    // owner-agent-mappings/AddMappingForm.tsx) pour la même liste d'agents.
    const agentOptions = agents.map((a) => ({ value: a.id, label: a.full_name ?? a.email }));

    const columns: OsColumn<ArmateurRepresentativeRow>[] = [
        {
            key: 'name',
            // col.agent, PAS col.name : col.name résout vers "Armateur"/"Shipowner"
            // (usage canonique dans ArmateursCockpit.tsx, le nom de l'armateur
            // lui-même) — un en-tête trompeur ici, puisque cette colonne montre le
            // nom d'un AGENT rattaché, pas celui de l'armateur. Corrigé au round de
            // correction 1 (Tâche 9), trouvé en revue.
            header: t('col.agent'),
            render: (r) => (
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium text-[var(--os-text-primary)]">{r.full_name}</span>
                    {r.id === primaryId && <OsBadge variant="info" label={t('detail.repPrimary')} size="sm" />}
                </div>
            ),
        },
        {
            key: 'email',
            header: t('col.email'),
            render: (r) => <span className="text-xs text-[var(--os-text-muted)]">{r.email}</span>,
        },
        {
            key: 'priority',
            header: t('col.priority'),
            className: 'text-right',
            render: (r) => <span className="text-xs tabular-nums font-mono">{r.priority}</span>,
        },
        {
            key: 'validity',
            header: t('col.validity'),
            // Dates au format DATE (pas de composante horaire) : affichées telles
            // quelles, jamais via `new Date(...).toLocaleDateString()` — ce
            // parsing réintroduirait un décalage de fuseau horaire pour les
            // lecteurs en UTC négatif (même écueil déjà évité par
            // OwnerAgentMappingList.tsx pour ces mêmes colonnes).
            render: (r) => (
                <span className="text-xs tabular-nums">{r.valid_from} → {r.valid_until ?? '—'}</span>
            ),
        },
        {
            key: 'status',
            header: t('col.status'),
            render: (r) => (r.active
                ? <OsBadge variant="active" label={t('state.active')} size="sm" />
                : <OsBadge variant="archived" label={t('detail.repRevoked')} size="sm" />),
        },
        {
            key: 'actions',
            header: t('col.actions'),
            className: 'text-right',
            render: (r) => (r.active ? (
                <div className="flex justify-end">
                    <OsButton
                        size="sm"
                        variant="danger"
                        onClick={() => submitRevoke(r.id)}
                        loading={revokePending && revokingId === r.id}
                        disabled={revokePending && revokingId === r.id}
                    >
                        {t('detail.repRevoke')}
                    </OsButton>
                </div>
            ) : null),
        },
    ];

    return (
        <OsCard>
            <OsCardHeader title={t('detail.representativesTitle')} />
            <div className="flex flex-col gap-3">
                <OsTable
                    columns={columns}
                    rows={detail.representatives}
                    keyExtractor={(r) => r.id}
                    emptyMessage={t('detail.noRepresentatives')}
                />
                {revokeError && <p className="text-xs text-[#EF4444]">{revokeError}</p>}

                {attachOpen && (
                    <div className="flex flex-wrap items-end gap-3 p-3 rounded-xl border border-[var(--os-border)] bg-[var(--os-surface-2)]">
                        <div className="flex-1 min-w-[220px]">
                            <OsSelect
                                label={t('col.agent')}
                                placeholder="—"
                                options={agentOptions}
                                value={agentProfileId}
                                onChange={(e) => setAgentProfileId(e.target.value)}
                                disabled={attachPending}
                            />
                        </div>
                        <div className="w-28">
                            <OsInput
                                type="number"
                                min={1}
                                max={1000}
                                label={t('col.priority')}
                                value={priority}
                                onChange={(e) => setPriority(Number(e.target.value))}
                                disabled={attachPending}
                            />
                        </div>
                        <OsButton
                            variant="primary"
                            onClick={submitAttach}
                            loading={attachPending}
                            disabled={attachPending || !agentProfileId.trim()}
                        >
                            {t('detail.repAttach')}
                        </OsButton>
                        <OsButton variant="ghost" onClick={closeAttach} disabled={attachPending}>
                            {t('cancel')}
                        </OsButton>
                        {attachError && <p className="text-xs text-[#EF4444] w-full">{attachError}</p>}
                    </div>
                )}

                {inviteOpen && (
                    <div className="flex flex-wrap items-end gap-3 p-3 rounded-xl border border-[var(--os-border)] bg-[var(--os-surface-2)]">
                        <div className="flex-1 min-w-[220px]">
                            <OsInput
                                type="email"
                                label={t('detail.repInviteEmail')}
                                placeholder="contact@armateur.com"
                                value={inviteEmail}
                                onChange={(e) => setInviteEmail(e.target.value)}
                                disabled={invitePending}
                            />
                        </div>
                        <div className="flex-1 min-w-[180px]">
                            <OsInput
                                label={t('detail.repInviteName')}
                                value={inviteName}
                                onChange={(e) => setInviteName(e.target.value)}
                                disabled={invitePending}
                            />
                        </div>
                        <OsButton
                            variant="primary"
                            onClick={submitInvite}
                            loading={invitePending}
                            disabled={invitePending || !inviteEmail.trim() || inviteName.trim().length < 2}
                        >
                            {t('detail.repInviteSubmit')}
                        </OsButton>
                        <OsButton variant="ghost" onClick={() => setInviteOpen(false)} disabled={invitePending}>
                            {t('cancel')}
                        </OsButton>
                        <p className="text-[11px] w-full text-[var(--os-text-muted)]">{t('detail.repInviteHint')}</p>
                        {inviteError && <p className="text-xs text-[#EF4444] w-full">{inviteError}</p>}
                    </div>
                )}

                <div className="flex items-center gap-3">
                    {!attachOpen && (
                        <OsButton variant="secondary" size="sm" onClick={openAttach}>
                            {t('detail.repAttach')}
                        </OsButton>
                    )}
                    {!inviteOpen && (
                        <OsButton
                            variant="secondary"
                            size="sm"
                            onClick={() => { setInviteError(null); setInviteOpen(true); }}
                        >
                            {t('detail.repInvite')}
                        </OsButton>
                    )}
                    <Link href="/admin/owner-agent-mappings" className="text-xs text-[#00D97E] hover:underline ml-auto">
                        {t('detail.repManageAll')}
                    </Link>
                </div>
            </div>
        </OsCard>
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
