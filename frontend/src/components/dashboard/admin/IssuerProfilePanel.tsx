'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput } from '@/components/ui/OsInput';
import { updateIssuerProfile } from '@/actions/updateIssuerProfile';

export interface IssuerProfileRow {
    jurisdiction_id: string | null;
    issuer_name: string | null;
    issuer_legal_name: string | null;
    issuer_address: string | null;
    sovereign_line: string | null;
    supervising_ministry: string | null;
    authority_line: string | null;
    decree_reference: string | null;
    director_name: string | null;
    director_title: string | null;
    director_email: string | null;
    director_phone: string | null;
    operations_email: string | null;
    billing_email: string | null;
    payment_terms_days: number | null;
    late_penalty_usd: number | string | null;
    dispute_period_days: number | null;
    escalation_line: string | null;
    bailiff_name: string | null;
    legal_basis_url: string | null;
    bank_accounts: unknown;
}

interface Props {
    jurisdictions: Array<{ id: string; code: string; name: string }>;
    profiles: IssuerProfileRow[];
    viewerRole: string;
    /** Pays que la personne administre (mig 174) : elle y modifie le profil, jamais les comptes. */
    administeredJurisdictionIds?: string[];
}

const TEXT_FIELDS: Array<{ key: keyof Draft; label: string; hint?: string; wide?: boolean }> = [
    { key: 'issuerName', label: 'Issuer name', hint: 'Header — “SOLIDE TECHNOLOGY (Concessionaire)”' },
    { key: 'issuerLegalName', label: 'Legal name', hint: 'Beneficiary printed on the transfer' },
    { key: 'issuerAddress', label: 'Issuer address', wide: true },
    { key: 'sovereignLine', label: 'Sovereign state' },
    { key: 'authorityLine', label: 'Authority line', hint: 'Maritime / Aviation Carbon Tax Authority' },
    { key: 'supervisingMinistry', label: 'Supervising ministry', wide: true },
    { key: 'decreeReference', label: 'Decree reference', wide: true },
    { key: 'directorName', label: 'Director' },
    { key: 'directorTitle', label: 'Director title', hint: 'Signature block on page 1' },
    { key: 'directorEmail', label: 'Director email' },
    { key: 'directorPhone', label: 'Director phone' },
    { key: 'operationsEmail', label: 'Operations email', hint: 'Proof of payment, disputes' },
    { key: 'billingEmail', label: 'Billing email' },
    { key: 'escalationLine', label: 'Escalation J+15/30/45', wide: true },
    { key: 'bailiffName', label: 'Bailiff' },
    { key: 'legalBasisUrl', label: 'Legal basis URL', wide: true },
];

interface Draft {
    issuerName: string; issuerLegalName: string; issuerAddress: string;
    sovereignLine: string; supervisingMinistry: string; authorityLine: string;
    decreeReference: string; directorName: string; directorTitle: string;
    directorEmail: string; directorPhone: string; operationsEmail: string;
    billingEmail: string; escalationLine: string; bailiffName: string;
    legalBasisUrl: string;
    paymentTermsDays: string; latePenaltyUsd: string; disputePeriodDays: string;
    bankAccountsJson: string;
}

function toDraft(row: IssuerProfileRow | undefined): Draft {
    const s = (v: string | null | undefined) => v ?? '';
    return {
        issuerName: s(row?.issuer_name), issuerLegalName: s(row?.issuer_legal_name),
        issuerAddress: s(row?.issuer_address), sovereignLine: s(row?.sovereign_line),
        supervisingMinistry: s(row?.supervising_ministry), authorityLine: s(row?.authority_line),
        decreeReference: s(row?.decree_reference), directorName: s(row?.director_name),
        directorTitle: s(row?.director_title), directorEmail: s(row?.director_email),
        directorPhone: s(row?.director_phone), operationsEmail: s(row?.operations_email),
        billingEmail: s(row?.billing_email), escalationLine: s(row?.escalation_line),
        bailiffName: s(row?.bailiff_name), legalBasisUrl: s(row?.legal_basis_url),
        paymentTermsDays: row?.payment_terms_days != null ? String(row.payment_terms_days) : '',
        disputePeriodDays: row?.dispute_period_days != null ? String(row.dispute_period_days) : '',
        latePenaltyUsd: row?.late_penalty_usd != null ? String(Number(row.late_penalty_usd)) : '',
        bankAccountsJson: JSON.stringify(row?.bank_accounts ?? [], null, 2),
    };
}

/**
 * Édition du profil émetteur (mig 131) : ce qu'un pro-forma imprime en dehors
 * des chiffres. La ligne « Platform default » s'applique à toutes les
 * juridictions ; une juridiction sélectionnée la surcharge.
 *
 * Les comptes bancaires s'éditent en JSON. C'est assumé : le tableau est
 * structuré, rarement touché, et un éditeur à répétitions coûterait bien plus
 * de surface qu'il n'en fait gagner. La validité n'en dépend pas — l'action
 * revalide chaque champ côté serveur, un collage malformé est refusé avant
 * d'atteindre la base.
 */
export function IssuerProfilePanel({ jurisdictions, profiles, viewerRole, administeredJurisdictionIds = [] }: Props) {
    const router = useRouter();
    const [target, setTarget] = React.useState<string>('__default__');
    const jurisdictionId = target === '__default__' ? null : target;

    const row = React.useMemo(
        () => profiles.find((p) => p.jurisdiction_id === jurisdictionId),
        [profiles, jurisdictionId],
    );
    const [draft, setDraft] = React.useState<Draft>(() => toDraft(row));
    const [saving, setSaving] = React.useState(false);
    const [feedback, setFeedback] = React.useState<{ ok: boolean; text: string } | null>(null);

    // Changer de cible recharge le formulaire : sans ça, on sauvegarderait les
    // valeurs d'une juridiction sur une autre.
    React.useEffect(() => {
        setDraft(toDraft(row));
        setFeedback(null);
    }, [row]);

    const canEditDefault = viewerRole === 'SUPERADMIN';
    // Les comptes de paiement suivent le role (finances, administrateur general).
    // Le reste du profil s ouvre aussi a l administrateur du pays choisi.
    const canEditAccounts = viewerRole === 'SUPERADMIN' || viewerRole === 'FINANCE_ADMIN';
    const administersTarget = jurisdictionId !== null && administeredJurisdictionIds.includes(jurisdictionId);
    const canEdit = canEditAccounts || administersTarget;
    const blocked = !canEdit || (jurisdictionId === null && !canEditDefault);
    const accountsBlocked = blocked || !canEditAccounts;

    function set<K extends keyof Draft>(key: K, value: string) {
        setDraft((d) => ({ ...d, [key]: value }));
    }

    async function save() {
        setSaving(true);
        setFeedback(null);
        let bankAccounts: unknown;
        try {
            bankAccounts = JSON.parse(draft.bankAccountsJson);
        } catch {
            setSaving(false);
            setFeedback({ ok: false, text: 'Bank accounts: invalid JSON' });
            return;
        }
        const res = await updateIssuerProfile({
            jurisdictionId,
            issuerName: draft.issuerName,
            issuerLegalName: draft.issuerLegalName,
            issuerAddress: draft.issuerAddress,
            sovereignLine: draft.sovereignLine,
            supervisingMinistry: draft.supervisingMinistry,
            authorityLine: draft.authorityLine,
            decreeReference: draft.decreeReference,
            directorName: draft.directorName,
            directorTitle: draft.directorTitle,
            directorEmail: draft.directorEmail,
            directorPhone: draft.directorPhone,
            operationsEmail: draft.operationsEmail,
            billingEmail: draft.billingEmail,
            paymentTermsDays: Number(draft.paymentTermsDays),
            latePenaltyUsd: Number(draft.latePenaltyUsd),
            disputePeriodDays: Number(draft.disputePeriodDays),
            escalationLine: draft.escalationLine,
            bailiffName: draft.bailiffName,
            legalBasisUrl: draft.legalBasisUrl,
            bankAccounts,
        });
        setSaving(false);
        setFeedback(res.ok ? { ok: true, text: 'Saved' } : { ok: false, text: res.reason });
        if (res.ok) router.refresh();
    }

    return (
        <section className="mt-8">
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
                <h2 className="text-sm font-semibold text-[var(--os-text-primary)]">
                    Issuer profile — invoice contacts & collection account
                </h2>
                <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    className="text-xs rounded-md border px-2 py-1 bg-[var(--os-surface-2)] text-[var(--os-text-primary)]"
                    style={{ borderColor: 'var(--os-border)' }}
                    aria-label="Issuer profile scope"
                >
                    <option value="__default__">Platform default (all jurisdictions)</option>
                    {jurisdictions.map((j) => (
                        <option key={j.id} value={j.id}>{j.code} — {j.name}</option>
                    ))}
                </select>
            </div>

            <p className="text-xs text-[var(--os-text-muted)] mt-1 mb-3 max-w-3xl leading-relaxed">
                Printed on every pro-forma: page 1 footer and payment instructions, and the whole
                “Calculation details” page. A jurisdiction only overrides the fields you fill in —
                anything left empty falls back to the platform default.
            </p>

            {blocked && (
                <p className="text-xs text-[#EAB308] mb-3">
                    {canEdit
                        ? 'The platform default applies to every jurisdiction — only a superadmin may change it.'
                        : 'Read-only: changing the account printed on invoices is reserved to finance admins.'}
                </p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {TEXT_FIELDS.map((f) => (
                    <label key={f.key} className={f.wide ? 'md:col-span-2 flex flex-col gap-1' : 'flex flex-col gap-1'}>
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--os-text-secondary)]">
                            {f.label}
                        </span>
                        <OsInput
                            value={draft[f.key]}
                            disabled={blocked}
                            onChange={(e) => set(f.key, e.target.value)}
                        />
                        {f.hint && <span className="text-[10px] text-[var(--os-text-muted)]">{f.hint}</span>}
                    </label>
                ))}

                <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--os-text-secondary)]">
                        Payment terms (days)
                    </span>
                    <OsInput type="number" min="1" value={draft.paymentTermsDays} disabled={blocked}
                        onChange={(e) => set('paymentTermsDays', e.target.value)} />
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--os-text-secondary)]">
                        Late penalty (USD)
                    </span>
                    <OsInput type="number" min="0" value={draft.latePenaltyUsd} disabled={blocked}
                        onChange={(e) => set('latePenaltyUsd', e.target.value)} />
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--os-text-secondary)]">
                        Dispute period (business days)
                    </span>
                    <OsInput type="number" min="1" value={draft.disputePeriodDays} disabled={blocked}
                        onChange={(e) => set('disputePeriodDays', e.target.value)} />
                </label>
            </div>

            <label className="flex flex-col gap-1 mt-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--os-text-secondary)]">
                    Collection accounts (JSON)
                </span>
                <textarea
                    value={draft.bankAccountsJson}
                    disabled={accountsBlocked}
                    onChange={(e) => set('bankAccountsJson', e.target.value)}
                    spellCheck={false}
                    rows={14}
                    className="w-full font-mono text-[11px] leading-relaxed rounded-md border p-2 bg-[var(--os-surface-2)] text-[var(--os-text-primary)] disabled:opacity-60"
                    style={{ borderColor: 'var(--os-border)' }}
                />
                <span className="text-[10px] text-[var(--os-text-muted)]">
                    {jurisdictionId !== null && (
                        <>
                            Leave the list empty (<code>[]</code>) to use the platform&apos;s general accounts —
                            that is the default. Fill it in only when this jurisdiction collects on accounts
                            of its own.{' '}
                        </>
                    )}
                    Exactly one account must carry <code>&quot;is_primary&quot;: true</code> — that is the one
                    printed on page 1 and shown to the shipowner. Each needs an IBAN or an account number.
                </span>
            </label>

            <div className="flex items-center gap-3 mt-3">
                <OsButton variant="primary" size="sm" onClick={save} disabled={blocked || saving}>
                    {saving ? 'Saving…' : 'Save issuer profile'}
                </OsButton>
                {feedback && (
                    <span className={`text-xs ${feedback.ok ? 'text-emerald-400' : 'text-[#EF4444]'}`}>
                        {feedback.text}
                    </span>
                )}
            </div>
        </section>
    );
}
