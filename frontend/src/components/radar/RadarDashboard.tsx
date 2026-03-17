'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Ship, Anchor, AlertTriangle, CheckCircle2, DollarSign, Activity, X } from 'lucide-react';
import { AisRadarMap } from '@/components/radar/AisRadarMap';
import { AisVessel, VesselStatus } from '@/domain/ais/aisConstants';
import { radarStats } from '@/mock/datas/aisMock';
import { ComplianceNoticeModal } from '@/components/invoice/ComplianceNoticeModal';

export function RadarDashboard() {
    const t = useTranslations('Radar');
    const [selectedVessel, setSelectedVessel] = useState<AisVessel | null>(null);
    const [isNoticeOpen, setIsNoticeOpen] = useState(false);

    const getStatusStyle = (status: VesselStatus) => {
        switch (status) {
            case VesselStatus.PAID:
                return { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', icon: CheckCircle2 };
            case VesselStatus.UNPAID:
                return { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', icon: AlertTriangle };
            case VesselStatus.APPROACHING:
                return { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', icon: Anchor };
            default:
                return { text: 'text-slate-400', bg: 'bg-white/5', border: 'border-white/10', icon: Ship };
        }
    };

    return (
        <section className="pt-24 pb-12 px-6 h-screen flex flex-col" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <div className="mb-6">
                <h1 className="text-3xl font-bold mb-2 tracking-tight" style={{ color: 'var(--ais-page-text)' }}>{t('title')}</h1>
                <p className="text-sm max-w-2xl" style={{ color: 'var(--ais-page-text-muted)' }}>{t('subtitle')}</p>
            </div>

            <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 min-h-0 relative">
                {/* Left Panel: KPIs & Selected Vessel Details */}
                <div className="lg:col-span-1 flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar">
                    {/* Global Stats */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}>
                            <Ship className="w-5 h-5 text-emerald-500 mb-3" />
                            <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--ais-page-text-dim)' }}>{t('stats_total_vessels')}</p>
                            <p className="text-2xl font-bold" style={{ color: 'var(--ais-page-text)' }}>{radarStats.totalVessels}</p>
                        </div>
                        <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}>
                            <AlertTriangle className="w-5 h-5 text-red-500 mb-3" />
                            <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--ais-page-text-dim)' }}>{t('stats_active_alerts')}</p>
                            <p className="text-2xl font-bold text-red-400">{radarStats.activeAlerts}</p>
                        </div>
                        <div className="col-span-2 rounded-2xl p-4 relative overflow-hidden group" style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}>
                            <div className="absolute right-0 top-0 w-32 h-32 bg-emerald-500/10 rounded-bl-full blur-[30px] transition-transform group-hover:scale-110" />
                            <div className="absolute right-6 top-6">
                                <DollarSign className="w-6 h-6 text-emerald-500/50" />
                            </div>
                            <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--ais-page-text-dim)' }}>{t('stats_revenue_risk')}</p>
                            <p className="text-3xl font-bold text-emerald-400">${radarStats.revenueAtRiskUsd.toLocaleString()}</p>
                        </div>
                        <div className="col-span-2 rounded-2xl p-4" style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}>
                            <Activity className="w-5 h-5 text-blue-500 mb-3" />
                            <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--ais-page-text-dim)' }}>{t('stats_co2_tracked')}</p>
                            <p className="text-xl font-bold text-blue-400">{radarStats.co2Tracked.toLocaleString()} tCO₂</p>
                        </div>
                    </div>

                    {/* Selected Vessel Inspector */}
                    {selectedVessel ? (
                        <div className="rounded-2xl overflow-hidden flex flex-col shadow-[0_0_30px_rgba(16,185,129,0.05)] animate-in fade-in slide-in-from-bottom-4 duration-500" style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid rgba(16,185,129,0.2)' }}>
                            <div className="p-5 flex justify-between items-start" style={{ borderBottom: '1px solid var(--ais-page-border)', backgroundColor: 'var(--ais-page-surface)' }}>
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${selectedVessel.flagCode === 'SO' ? 'bg-blue-500 text-white' : 'text-white'}`} style={selectedVessel.flagCode !== 'SO' ? { backgroundColor: 'var(--ais-page-surface)', color: 'var(--ais-page-text-secondary)' } : undefined}>
                                            {selectedVessel.flagCode}
                                        </span>
                                        <h3 className="text-lg font-bold" style={{ color: 'var(--ais-page-text)' }}>{selectedVessel.name}</h3>
                                    </div>
                                    <p className="text-xs" style={{ color: 'var(--ais-page-text-muted)' }}>IMO: {selectedVessel.imo}</p>
                                </div>
                                <button
                                    onClick={() => setSelectedVessel(null)}
                                    className="p-1.5 rounded-lg transition-colors"
                                    style={{ color: 'var(--ais-page-text-muted)' }}
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            <div className="p-5 flex flex-col gap-5">
                                {(() => {
                                    const style = getStatusStyle(selectedVessel.status);
                                    const StatusIcon = style.icon;
                                    return (
                                        <div className={`p-4 rounded-xl border flex items-start gap-4 ${style.bg} ${style.border}`}>
                                            <div className={`p-2 rounded-lg bg-white/10 ${style.text}`}>
                                                <StatusIcon className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <p className="text-[10px] uppercase font-bold tracking-widest mb-1" style={{ color: 'var(--ais-page-text-muted)' }}>Status</p>
                                                <p className={`font-bold ${style.text}`}>
                                                    {t(`vessel_status_${selectedVessel.status.toLowerCase()}`)}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })()}

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: 'var(--ais-page-text-dim)' }}>{t('vessel_type_cargo')}</p>
                                        <p className="text-sm font-medium" style={{ color: 'var(--ais-page-text)' }}>{selectedVessel.type}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: 'var(--ais-page-text-dim)' }}>{t('tooltip_speed')}</p>
                                        <p className="text-sm font-medium" style={{ color: 'var(--ais-page-text)' }}>{selectedVessel.speedKnot} kn</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: 'var(--ais-page-text-dim)' }}>{t('tooltip_co2')}</p>
                                        <p className="text-sm font-medium" style={{ color: 'var(--ais-page-text)' }}>{selectedVessel.estimatedCo2} t</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: 'var(--ais-page-text-dim)' }}>{t('tooltip_due')}</p>
                                        <p className="text-sm font-bold text-emerald-400">${selectedVessel.dueAmountUsd.toLocaleString()}</p>
                                    </div>
                                </div>

                                {selectedVessel.status === VesselStatus.UNPAID && (
                                    <button
                                        onClick={() => setIsNoticeOpen(true)}
                                        className="w-full py-3 mt-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 font-bold text-sm transition-colors uppercase tracking-wider"
                                    >
                                        Issue Compliance Notice
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 rounded-2xl flex flex-col items-center justify-center p-8 text-center border-dashed" style={{ backgroundColor: 'var(--ais-page-card)', border: '1px dashed var(--ais-page-border)' }}>
                            <div className="w-12 h-12 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: 'var(--ais-page-surface)' }}>
                                <Ship className="w-5 h-5" style={{ color: 'var(--ais-page-text-dim)' }} />
                            </div>
                            <p className="text-sm font-medium" style={{ color: 'var(--ais-page-text-muted)' }}>Select a vessel on the map to view detailed compliance data.</p>
                        </div>
                    )}
                </div>

                {/* Right Panel: Interactive Map */}
                <div className="lg:col-span-3 h-[50vh] lg:h-full">
                    <AisRadarMap onSelectVessel={setSelectedVessel} />
                </div>
            </div>

            {/* Compliance Notice Modal Wrapper */}
            {isNoticeOpen && selectedVessel && (
                <ComplianceNoticeModal
                    vessel={selectedVessel}
                    onClose={() => setIsNoticeOpen(false)}
                />
            )}
        </section>
    );
}
