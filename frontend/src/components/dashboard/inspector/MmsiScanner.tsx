'use client';

import * as React from 'react';
import { Search, Ship, AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsBadge } from '@/components/ui/OsBadge';
import { useVessels } from '@/hooks/useVessels';
import { SecureVessel, VesselComplianceStatus } from '@/types/secure';

const COMPLIANCE_VARIANT: Record<VesselComplianceStatus, Parameters<typeof OsBadge>[0]['variant']> = {
    [VesselComplianceStatus.COMPLIANT]:     'compliant',
    [VesselComplianceStatus.PAYMENT_DUE]:   'payment_due',
    [VesselComplianceStatus.PROCESSING]:    'processing',
    [VesselComplianceStatus.NON_COMPLIANT]: 'non_compliant',
    [VesselComplianceStatus.APPROACHING]:   'approaching',
    [VesselComplianceStatus.EXEMPT]:        'exempt',
};

interface MmsiScannerProps {
    onVesselFound: (vessel: SecureVessel) => void;
    onStartInspection: (vessel: SecureVessel) => void;
}

export function MmsiScanner({ onVesselFound, onStartInspection }: MmsiScannerProps) {
    const t = useTranslations('Inspector');
    const { data: vessels } = useVessels();
    const [mmsi, setMmsi] = React.useState('');
    const [loading, setLoading] = React.useState(false);
    const [searched, setSearched] = React.useState(false);
    const [foundVessel, setFoundVessel] = React.useState<SecureVessel | null>(null);
    const [error, setError] = React.useState('');

    function handleMmsiChange(value: string) {
        // Allow only digits, max 9
        const digits = value.replace(/\D/g, '').slice(0, 9);
        setMmsi(digits);
        setError('');
        if (searched) {
            setSearched(false);
            setFoundVessel(null);
        }
    }

    async function handleSearch() {
        if (mmsi.length !== 9) {
            setError(t('mmsi_invalid'));
            return;
        }

        setLoading(true);
        setError('');

        // Simulate async search with small delay
        await new Promise((r) => setTimeout(r, 400));

        const match = vessels.find((v) => v.mmsi === mmsi) ?? null;
        setFoundVessel(match);
        setSearched(true);
        setLoading(false);

        if (match) {
            onVesselFound(match);
        }
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === 'Enter') {
            handleSearch();
        }
    }

    return (
        <div className="flex flex-col gap-6 p-4">
            {/* MMSI Input */}
            <div className="flex flex-col gap-3">
                <label className="text-lg font-semibold" style={{ color: 'var(--os-text-primary)' }}>
                    {t('tab_scanner')}
                </label>
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--os-text-muted)]" />
                    <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={mmsi}
                        onChange={(e) => handleMmsiChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={t('mmsi_placeholder')}
                        className="w-full h-14 pl-12 pr-4 rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] text-lg text-[var(--os-text-primary)] placeholder:text-[var(--os-text-muted)] focus:outline-none focus:border-[#10B981]/50 transition-colors tabular-nums"
                    />
                </div>

                {error && (
                    <div className="flex items-center gap-2 text-sm text-[#EF4444]">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        {error}
                    </div>
                )}

                <button
                    onClick={handleSearch}
                    disabled={loading || mmsi.length === 0}
                    className="w-full h-14 rounded-xl bg-[#10B981] text-[#060D1A] text-lg font-bold hover:bg-[#0D9668] transition-colors shadow-[0_0_12px_rgba(16,185,129,0.25)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {loading ? (
                        <div className="w-5 h-5 border-2 border-[#060D1A]/30 border-t-[#060D1A] rounded-full animate-spin" />
                    ) : (
                        <Search className="w-5 h-5" />
                    )}
                    {t('mmsi_search')}
                </button>
            </div>

            {/* Result */}
            {searched && !foundVessel && (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-[var(--os-surface-2)] border border-[var(--os-border)] flex items-center justify-center">
                        <Ship className="w-8 h-8 text-[var(--os-text-muted)]" />
                    </div>
                    <p className="text-sm text-[var(--os-text-muted)]">{t('mmsi_not_found')}</p>
                </div>
            )}

            {foundVessel && (
                <div className="rounded-xl border border-[var(--os-border)] bg-[var(--os-surface)] overflow-hidden">
                    <div className="px-4 py-3 border-b border-[var(--os-border)] bg-[var(--os-surface-2)]">
                        <span className="text-xs font-bold uppercase tracking-widest text-[#10B981]">{t('vessel_found')}</span>
                    </div>
                    <div className="p-4 flex flex-col gap-4">
                        <div className="flex items-start gap-3">
                            <div className="w-12 h-12 rounded-xl bg-[var(--os-surface-2)] border border-[var(--os-border)] flex items-center justify-center flex-shrink-0">
                                <Ship className="w-6 h-6 text-[var(--os-text-muted)]" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-2xl font-bold text-[var(--os-text-primary)] truncate">{foundVessel.name}</p>
                                <p className="text-sm text-[var(--os-text-muted)]">IMO: {foundVessel.imoNumber} · MMSI: {foundVessel.mmsi}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <InfoCell label="Flag" value={foundVessel.flagCode} />
                            <InfoCell label="Category" value={foundVessel.category.replace('_', ' ')} />
                            <InfoCell label="Emissions" value={`${foundVessel.estimatedEmissionsTco2} tCO\u2082`} />
                            <InfoCell label="Tax Due" value={`$${foundVessel.taxLiabilityUsd.toLocaleString()}`} />
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="text-xs text-[var(--os-text-muted)]">Status:</span>
                            <OsBadge
                                variant={COMPLIANCE_VARIANT[foundVessel.complianceStatus]}
                                label={foundVessel.complianceStatus.replace('_', ' ')}
                            />
                        </div>

                        <button
                            onClick={() => onStartInspection(foundVessel)}
                            className="w-full h-14 rounded-xl bg-[#10B981] text-[#060D1A] text-lg font-bold hover:bg-[#0D9668] transition-colors shadow-[0_0_12px_rgba(16,185,129,0.25)] flex items-center justify-center gap-2"
                        >
                            {t('start_inspection')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function InfoCell({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex flex-col gap-0.5 px-3 py-2 rounded-lg bg-[var(--os-surface-2)]">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">{label}</span>
            <span className="text-sm font-semibold text-[var(--os-text-primary)]">{value}</span>
        </div>
    );
}
