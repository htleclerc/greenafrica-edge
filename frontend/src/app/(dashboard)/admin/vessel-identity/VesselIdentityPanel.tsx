'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { importVesselIdentityBatch } from '@/actions/importVesselIdentityBatch';
import { applyVesselIdentity, type VesselFieldConflict } from '@/actions/applyVesselIdentity';
import { createManualCandidate } from '@/actions/createManualCandidate';
import {
    CATEGORY_BY_TYPENAME,
    resolveBillingEmail,
} from '@/services/vesselIdentity/vesselFinderParser';

const VESSEL_TYPES = Object.keys(CATEGORY_BY_TYPENAME);

const EMPTY_MANUAL_FORM = {
    imoNumber: '',
    vesselName: '',
    mmsi: '',
    callSign: '',
    flagCode: '',
    typeRaw: VESSEL_TYPES[0] ?? '',
    grossTonnage: '',
    deadweight: '',
    buildYear: '',
    managerName: '',
    managerEmail: '',
    ownerName: '',
    ownerEmail: '',
    ismManagerName: '',
    ismManagerEmail: '',
};

/**
 * Motifs stables rendus par les Server Actions → clé i18n. Les actions ne
 * renvoient jamais de phrase destinée à l'écran : un produit à six locales ne
 * peut pas afficher un message anglais ni un message brut de Postgres. Un motif
 * absent de cette table (message de parseur, contrainte inattendue) est affiché
 * tel quel — repli lisible plutôt que message vide.
 */
const ERROR_KEY_BY_REASON: Readonly<Record<string, string>> = {
    'not authenticated': 'errNotAuthenticated',
    'insufficient role': 'errInsufficientRole',
    'service role not configured': 'errServiceRole',
    'candidate not found': 'errCandidateNotFound',
    'candidate already processed': 'errCandidateProcessed',
    'vessel not found': 'errVesselNotFound',
    'vessel already identified': 'errVesselAlreadyIdentified',
    'identity already held by another vessel': 'errIdentityHeld',
    'field conflict': 'errFieldConflict',
    'sanctions lookup failed': 'errSanctionsLookup',
    'batch already imported': 'errBatchAlreadyImported',
    'candidate insert failed': 'errInsertFailed',
    'candidate already exists': 'errCandidateExists',
};

/** Colonne de `vessels` → clé i18n, pour l'affichage des divergences. */
const CONFLICT_FIELD_KEY: Readonly<Record<string, string>> = {
    gross_tonnage_dwt: 'fieldGrossTonnage',
    dwt: 'fieldDeadweight',
    flag_code: 'fieldFlag',
    category: 'fieldCategory',
    build_year: 'fieldBuildYear',
};

export interface UnidentifiedVessel {
    id: string;
    imo_number: string;
    name: string;
    shipowner_id: string | null;
    shipowner: { name: string } | null;
}

export interface Candidate {
    id: string;
    imo_number: string;
    mmsi: string | null;
    vessel_name: string;
    flag_code: string | null;
    type_raw: string | null;
    gross_tonnage: number | null;
    deadweight: number | null;
    manager_email: string | null;
    owner_email: string | null;
    ism_manager_email: string | null;
    contact_blocked: boolean;
    contact_blocked_reason: string | null;
}

interface Report {
    rowsRead: number;
    inserted: number;
    rejected: Array<{ lineNumber: number; vesselName: string; reason: string }>;
}

export default function VesselIdentityPanel({
    unidentified,
    candidates,
}: {
    unidentified: UnidentifiedVessel[];
    candidates: Candidate[];
}) {
    const t = useTranslations('AdminVesselIdentity');
    const [report, setReport] = useState<Report | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [selectedVessel, setSelectedVessel] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [manualForm, setManualForm] = useState(EMPTY_MANUAL_FORM);
    const [manualError, setManualError] = useState<string | null>(null);
    const [manualBusy, setManualBusy] = useState(false);
    const [conflict, setConflict] = useState<
        { candidateId: string; conflicts: VesselFieldConflict[] } | null
    >(null);

    /** Traduit un motif stable, ou le rend tel quel s'il n'en est pas un. */
    function errorLabel(reason: string): string {
        const key = ERROR_KEY_BY_REASON[reason];
        return key ? t(key) : reason;
    }

    function setManualField(field: keyof typeof EMPTY_MANUAL_FORM, value: string) {
        setManualForm((prev) => ({ ...prev, [field]: value }));
    }

    async function onManualSubmit() {
        setManualBusy(true);
        setManualError(null);
        try {
            const res = await createManualCandidate({
                imoNumber: manualForm.imoNumber,
                vesselName: manualForm.vesselName,
                mmsi: manualForm.mmsi || null,
                callSign: manualForm.callSign || null,
                flagCode: manualForm.flagCode.toUpperCase(),
                typeRaw: manualForm.typeRaw,
                grossTonnage: manualForm.grossTonnage === '' ? null : Number(manualForm.grossTonnage),
                deadweight: manualForm.deadweight === '' ? null : Number(manualForm.deadweight),
                buildYear: manualForm.buildYear === '' ? null : Number(manualForm.buildYear),
                managerName: manualForm.managerName || null,
                managerEmail: manualForm.managerEmail || null,
                ownerName: manualForm.ownerName || null,
                ownerEmail: manualForm.ownerEmail || null,
                ismManagerName: manualForm.ismManagerName || null,
                ismManagerEmail: manualForm.ismManagerEmail || null,
            });
            if (!res.ok) { setManualError(errorLabel(res.reason)); return; }
            window.location.reload();
        } catch {
            setManualError(t('errUnexpected'));
        } finally {
            // Toujours dans un finally : une exception laissait le formulaire
            // désactivé sans message, sans issue autre que recharger la page.
            setManualBusy(false);
        }
    }

    async function onFile(file: File) {
        setBusy(true);
        setError(null);
        try {
            const csv = await file.text();
            const res = await importVesselIdentityBatch({ batchLabel: file.name, csv });
            if (!res.ok) { setError(errorLabel(res.reason)); return; }
            setReport({ rowsRead: res.rowsRead, inserted: res.inserted, rejected: res.rejected });
        } catch {
            setError(t('errUnexpected'));
        } finally {
            setBusy(false);
        }
    }

    async function onMatch(candidateId: string, acceptFieldOverrides = false) {
        if (!selectedVessel) return;
        setBusy(true);
        setError(null);
        try {
            const res = await applyVesselIdentity({
                candidateId,
                vesselId: selectedVessel,
                acceptFieldOverrides,
            });
            if (!res.ok) {
                // Divergence de champs : l'écran montre les valeurs et demande
                // un arbitrage explicite plutôt que d'écraser en silence.
                if (res.reason === 'field conflict' && res.conflicts) {
                    setConflict({ candidateId, conflicts: res.conflicts });
                    return;
                }
                setConflict(null);
                setError(errorLabel(res.reason));
                return;
            }
            window.location.reload();
        } catch {
            setError(t('errUnexpected'));
        } finally {
            setBusy(false);
        }
    }

    const billingEmail = (c: Candidate) =>
        resolveBillingEmail({
            managerEmail: c.manager_email,
            ownerEmail: c.owner_email,
            ismManagerEmail: c.ism_manager_email,
            contactBlocked: c.contact_blocked,
        });

    const visible = candidates.filter((c) => {
        const q = search.trim().toUpperCase();
        if (!q) return true;
        return (
            c.vessel_name.toUpperCase().includes(q) ||
            c.imo_number.includes(q) ||
            (c.mmsi ?? '').includes(q)
        );
    });

    return (
        <div className="space-y-6">
            <section className="rounded-lg border p-4" style={{ borderColor: 'var(--os-border)' }}>
                <label className="block text-sm font-medium text-[var(--os-text-primary)]">{t('uploadLabel')}</label>
                <input
                    type="file"
                    accept=".csv,text/csv"
                    disabled={busy}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
                    className="mt-2 text-sm text-[var(--os-text-primary)]"
                />
                {report && (
                    <div className="mt-3 text-sm text-[var(--os-text-primary)]">
                        <p>{t('importReport', {
                            rowsRead: report.rowsRead,
                            inserted: report.inserted,
                            rejected: report.rejected.length,
                        })}</p>
                        {report.rejected.length > 0 && (
                            <details className="mt-2">
                                <summary>{t('rejectedTitle')}</summary>
                                <ul className="mt-1 list-disc pl-5">
                                    {report.rejected.map((r) => (
                                        <li key={`${r.lineNumber}`}>
                                            {t('rejectedLine', { ...r })}
                                        </li>
                                    ))}
                                </ul>
                            </details>
                        )}
                    </div>
                )}
                {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            </section>

            <details className="rounded-lg border p-4" style={{ borderColor: 'var(--os-border)' }}>
                <summary className="cursor-pointer font-medium text-[var(--os-text-primary)]">
                    {t('manualTitle')}
                </summary>
                <form
                    className="mt-3 grid gap-3 sm:grid-cols-2"
                    onSubmit={(e) => { e.preventDefault(); void onManualSubmit(); }}
                >
                    <label className="block text-sm text-[var(--os-text-primary)]">
                        <span className="block">{t('manualImo')}</span>
                        <input
                            type="text"
                            required
                            value={manualForm.imoNumber}
                            onChange={(e) => setManualField('imoNumber', e.target.value)}
                            className="mt-1 w-full rounded border px-2 py-1 text-sm"
                            style={{ borderColor: 'var(--os-border)' }}
                        />
                    </label>
                    <label className="block text-sm text-[var(--os-text-primary)]">
                        <span className="block">{t('manualName')}</span>
                        <input
                            type="text"
                            required
                            value={manualForm.vesselName}
                            onChange={(e) => setManualField('vesselName', e.target.value)}
                            className="mt-1 w-full rounded border px-2 py-1 text-sm"
                            style={{ borderColor: 'var(--os-border)' }}
                        />
                    </label>
                    <label className="block text-sm text-[var(--os-text-primary)]">
                        <span className="block">MMSI</span>
                        <input
                            type="text"
                            value={manualForm.mmsi}
                            onChange={(e) => setManualField('mmsi', e.target.value)}
                            className="mt-1 w-full rounded border px-2 py-1 text-sm"
                            style={{ borderColor: 'var(--os-border)' }}
                        />
                    </label>
                    <label className="block text-sm text-[var(--os-text-primary)]">
                        <span className="block">{t('manualCallSign')}</span>
                        <input
                            type="text"
                            value={manualForm.callSign}
                            onChange={(e) => setManualField('callSign', e.target.value)}
                            className="mt-1 w-full rounded border px-2 py-1 text-sm"
                            style={{ borderColor: 'var(--os-border)' }}
                        />
                    </label>
                    <label className="block text-sm text-[var(--os-text-primary)]">
                        <span className="block">{t('manualFlag')}</span>
                        <input
                            type="text"
                            required
                            maxLength={2}
                            value={manualForm.flagCode}
                            onChange={(e) => setManualField('flagCode', e.target.value)}
                            className="mt-1 w-full rounded border px-2 py-1 text-sm"
                            style={{ borderColor: 'var(--os-border)' }}
                        />
                    </label>
                    <label className="block text-sm text-[var(--os-text-primary)]">
                        <span className="block">{t('manualType')}</span>
                        <select
                            required
                            value={manualForm.typeRaw}
                            onChange={(e) => setManualField('typeRaw', e.target.value)}
                            className="mt-1 w-full rounded border px-2 py-1 text-sm"
                            style={{ borderColor: 'var(--os-border)' }}
                        >
                            {VESSEL_TYPES.map((type) => (
                                <option key={type} value={type}>{type}</option>
                            ))}
                        </select>
                    </label>
                    <label className="block text-sm text-[var(--os-text-primary)]">
                        <span className="block">GT</span>
                        <input
                            type="number"
                            min={0}
                            value={manualForm.grossTonnage}
                            onChange={(e) => setManualField('grossTonnage', e.target.value)}
                            className="mt-1 w-full rounded border px-2 py-1 text-sm"
                            style={{ borderColor: 'var(--os-border)' }}
                        />
                    </label>
                    <label className="block text-sm text-[var(--os-text-primary)]">
                        <span className="block">DWT</span>
                        <input
                            type="number"
                            min={0}
                            value={manualForm.deadweight}
                            onChange={(e) => setManualField('deadweight', e.target.value)}
                            className="mt-1 w-full rounded border px-2 py-1 text-sm"
                            style={{ borderColor: 'var(--os-border)' }}
                        />
                    </label>
                    <label className="block text-sm text-[var(--os-text-primary)]">
                        <span className="block">BUILT</span>
                        <input
                            type="number"
                            value={manualForm.buildYear}
                            onChange={(e) => setManualField('buildYear', e.target.value)}
                            className="mt-1 w-full rounded border px-2 py-1 text-sm"
                            style={{ borderColor: 'var(--os-border)' }}
                        />
                    </label>
                    <label className="block text-sm text-[var(--os-text-primary)]">
                        <span className="block">{t('manualManager')}</span>
                        <input
                            type="text"
                            value={manualForm.managerName}
                            onChange={(e) => setManualField('managerName', e.target.value)}
                            className="mt-1 w-full rounded border px-2 py-1 text-sm"
                            style={{ borderColor: 'var(--os-border)' }}
                        />
                    </label>
                    <label className="block text-sm text-[var(--os-text-primary)]">
                        <span className="block">{t('manualManagerEmail')}</span>
                        <input
                            type="email"
                            value={manualForm.managerEmail}
                            onChange={(e) => setManualField('managerEmail', e.target.value)}
                            className="mt-1 w-full rounded border px-2 py-1 text-sm"
                            style={{ borderColor: 'var(--os-border)' }}
                        />
                    </label>
                    {/*
                      * Les trois niveaux de contact doivent être saisissables :
                      * 15 des 47 navires joignables de l'export mesuré ne le
                      * sont que par l'owner ou l'ISM manager. Les détourner
                      * dans le champ « Gérant » fausserait aussi le motif de la
                      * garde sanctions, qui nomme la société contactée.
                      */}
                    <label className="block text-sm text-[var(--os-text-primary)]">
                        <span className="block">{t('manualOwner')}</span>
                        <input
                            type="text"
                            value={manualForm.ownerName}
                            onChange={(e) => setManualField('ownerName', e.target.value)}
                            className="mt-1 w-full rounded border px-2 py-1 text-sm"
                            style={{ borderColor: 'var(--os-border)' }}
                        />
                    </label>
                    <label className="block text-sm text-[var(--os-text-primary)]">
                        <span className="block">{t('manualOwnerEmail')}</span>
                        <input
                            type="email"
                            value={manualForm.ownerEmail}
                            onChange={(e) => setManualField('ownerEmail', e.target.value)}
                            className="mt-1 w-full rounded border px-2 py-1 text-sm"
                            style={{ borderColor: 'var(--os-border)' }}
                        />
                    </label>
                    <label className="block text-sm text-[var(--os-text-primary)]">
                        <span className="block">{t('manualIsmManager')}</span>
                        <input
                            type="text"
                            value={manualForm.ismManagerName}
                            onChange={(e) => setManualField('ismManagerName', e.target.value)}
                            className="mt-1 w-full rounded border px-2 py-1 text-sm"
                            style={{ borderColor: 'var(--os-border)' }}
                        />
                    </label>
                    <label className="block text-sm text-[var(--os-text-primary)]">
                        <span className="block">{t('manualIsmManagerEmail')}</span>
                        <input
                            type="email"
                            value={manualForm.ismManagerEmail}
                            onChange={(e) => setManualField('ismManagerEmail', e.target.value)}
                            className="mt-1 w-full rounded border px-2 py-1 text-sm"
                            style={{ borderColor: 'var(--os-border)' }}
                        />
                    </label>
                    <div className="sm:col-span-2">
                        <button
                            type="submit"
                            disabled={manualBusy}
                            className="rounded bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-40"
                        >
                            {t('manualSubmit')}
                        </button>
                    </div>
                    {manualError && (
                        <p className="sm:col-span-2 text-sm text-red-600">{manualError}</p>
                    )}
                </form>
            </details>

            <div className="grid gap-6 md:grid-cols-2">
                <section>
                    <h2 className="mb-2 font-medium text-[var(--os-text-primary)]">{t('unidentifiedTitle')}</h2>
                    <ul className="divide-y rounded-lg border" style={{ borderColor: 'var(--os-border)' }}>
                        {unidentified.map((v) => (
                            <li key={v.id}>
                                <button
                                    type="button"
                                    onClick={() => setSelectedVessel(v.id)}
                                    className={`w-full px-3 py-2 text-left ${
                                        selectedVessel === v.id ? 'bg-emerald-50' : ''
                                    }`}
                                >
                                    <span className="font-medium text-[var(--os-text-primary)]">{v.name}</span>
                                    <span className="block text-xs text-[var(--os-text-muted)]">
                                        {v.imo_number} · {v.shipowner?.name ?? '—'}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>

                <section>
                    <h2 className="mb-2 font-medium text-[var(--os-text-primary)]">{t('candidatesTitle')}</h2>
                    <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('searchPlaceholder')}
                        className="mb-2 w-full rounded border px-2 py-1 text-sm"
                        style={{ borderColor: 'var(--os-border)' }}
                    />
                    {visible.length === 0 && <p className="text-sm text-[var(--os-text-muted)]">{t('empty')}</p>}
                    <ul className="divide-y rounded-lg border" style={{ borderColor: 'var(--os-border)' }}>
                        {visible.map((c) => (
                            <li key={c.id} className="px-3 py-2">
                                <div className="font-medium text-[var(--os-text-primary)]">{c.vessel_name}</div>
                                <div className="text-xs text-[var(--os-text-muted)]">
                                    IMO {c.imo_number} · MMSI {c.mmsi ?? '—'} · {c.flag_code ?? '—'} ·
                                    GT {c.gross_tonnage ?? '—'} · DWT {c.deadweight ?? '—'}
                                </div>
                                {c.contact_blocked ? (
                                    <div className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                                        <strong>{t('contactBlocked')}</strong> — {c.contact_blocked_reason}
                                        <div>{t('contactBlockedHint')}</div>
                                    </div>
                                ) : (
                                    <div className="mt-1 text-xs text-[var(--os-text-muted)]">
                                        {t('billingEmail')} : {billingEmail(c) ?? t('noEmail')}
                                    </div>
                                )}
                                <button
                                    type="button"
                                    disabled={!selectedVessel || busy}
                                    onClick={() => void onMatch(c.id)}
                                    className="mt-2 rounded bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-40"
                                >
                                    {t('match')}
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            </div>

            {conflict && (
                <ModalOverlay onClose={() => !busy && setConflict(null)}>
                    <h3 className="mb-1 text-base font-semibold text-[var(--os-text-primary)]">
                        {t('conflictTitle')}
                    </h3>
                    <p className="mb-4 text-sm text-[var(--os-text-muted)]">{t('conflictIntro')}</p>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs text-[var(--os-text-muted)]">
                                <th className="py-1">{t('conflictField')}</th>
                                <th className="py-1">{t('conflictCurrent')}</th>
                                <th className="py-1">{t('conflictProposed')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {conflict.conflicts.map((f) => (
                                <tr key={f.field} className="text-[var(--os-text-primary)]">
                                    <td className="py-1">
                                        {CONFLICT_FIELD_KEY[f.field] ? t(CONFLICT_FIELD_KEY[f.field]) : f.field}
                                    </td>
                                    <td className="py-1 font-mono">{f.current}</td>
                                    <td className="py-1 font-mono text-emerald-600">{f.proposed}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="mt-3 text-xs text-[var(--os-text-muted)]">{t('conflictWarning')}</p>
                    <div className="mt-5 flex justify-end gap-2">
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConflict(null)}
                            className="rounded border px-3 py-1 text-sm text-[var(--os-text-primary)] disabled:opacity-40"
                            style={{ borderColor: 'var(--os-border)' }}
                        >
                            {t('conflictCancel')}
                        </button>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                                const { candidateId } = conflict;
                                setConflict(null);
                                void onMatch(candidateId, true);
                            }}
                            className="rounded bg-amber-600 px-3 py-1 text-sm text-white disabled:opacity-40"
                        >
                            {t('conflictConfirm')}
                        </button>
                    </div>
                </ModalOverlay>
            )}
        </div>
    );
}

/**
 * Fenêtre modale du dépôt : une `div` en superposition, pas un Dialog Radix —
 * même forme que `EquasisProposalsPanel` et `OriginPortProposalsPanel`.
 */
function ModalOverlay({
    onClose,
    children,
}: Readonly<{ onClose: () => void; children: React.ReactNode }>) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center px-4"
            style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg rounded-2xl p-5"
                style={{
                    backgroundColor: 'var(--os-surface-2)',
                    border: '1px solid var(--os-border)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {children}
            </div>
        </div>
    );
}
