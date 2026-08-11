'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { importVesselIdentityBatch } from '@/actions/importVesselIdentityBatch';
import { applyVesselIdentity } from '@/actions/applyVesselIdentity';

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

    async function onFile(file: File) {
        setBusy(true);
        setError(null);
        const csv = await file.text();
        const res = await importVesselIdentityBatch({ batchLabel: file.name, csv });
        setBusy(false);
        if (!res.ok) { setError(res.reason); return; }
        setReport({ rowsRead: res.rowsRead, inserted: res.inserted, rejected: res.rejected });
    }

    async function onMatch(candidateId: string) {
        if (!selectedVessel) return;
        setBusy(true);
        setError(null);
        const res = await applyVesselIdentity({ candidateId, vesselId: selectedVessel });
        setBusy(false);
        if (!res.ok) { setError(res.reason); return; }
        window.location.reload();
    }

    const billingEmail = (c: Candidate) =>
        c.contact_blocked ? null : (c.manager_email ?? c.owner_email ?? c.ism_manager_email);

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
        </div>
    );
}
