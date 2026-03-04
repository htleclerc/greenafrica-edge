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
        <section className="pt-24 pb-12 px-6 h-screen flex flex-col bg-[#050908]">
            <div className="mb-6">
                <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">{t('title')}</h1>
                <p className="text-slate-400 text-sm max-w-2xl">{t('subtitle')}</p>
            </div>

            <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 min-h-0 relative">
                {/* Left Panel: KPIs & Selected Vessel Details */}
                <div className="lg:col-span-1 flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar">
                    {/* Global Stats */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-[#0A1110] border border-white/5 rounded-2xl p-4">
                            <Ship className="w-5 h-5 text-emerald-500 mb-3" />
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-1">{t('stats_total_vessels')}</p>
                            <p className="text-2xl font-bold text-white">{radarStats.totalVessels}</p>
                        </div>
                        <div className="bg-[#0A1110] border border-white/5 rounded-2xl p-4">
                            <AlertTriangle className="w-5 h-5 text-red-500 mb-3" />
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-1">{t('stats_active_alerts')}</p>
                            <p className="text-2xl font-bold text-red-400">{radarStats.activeAlerts}</p>
                        </div>
                        <div className="col-span-2 bg-[#0A1110] border border-white/5 rounded-2xl p-4 relative overflow-hidden group">
                            <div className="absolute right-0 top-0 w-32 h-32 bg-emerald-500/10 rounded-bl-full blur-[30px] transition-transform group-hover:scale-110" />
                            <div className="absolute right-6 top-6">
                                <DollarSign className="w-6 h-6 text-emerald-500/50" />
                            </div>
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-1">{t('stats_revenue_risk')}</p>
                            <p className="text-3xl font-bold text-emerald-400">${radarStats.revenueAtRiskUsd.toLocaleString()}</p>
                        </div>
                        <div className="col-span-2 bg-[#0A1110] border border-white/5 rounded-2xl p-4">
                            <Activity className="w-5 h-5 text-blue-500 mb-3" />
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-1">{t('stats_co2_tracked')}</p>
                            <p className="text-xl font-bold text-blue-400">{radarStats.co2Tracked.toLocaleString()} tCO₂</p>
                        </div>
                    </div>

                    {/* Selected Vessel Inspector */}
                    {selectedVessel ? (
                        <div className="bg-[#0A1110] border border-emerald-500/20 rounded-2xl overflow-hidden flex flex-col shadow-[0_0_30px_rgba(16,185,129,0.05)] animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="p-5 border-b border-white/5 bg-white/[0.02] flex justify-between items-start">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${selectedVessel.flagCode === 'SO' ? 'bg-blue-500 text-white' : 'bg-white/10 text-slate-300'}`}>
                                            {selectedVessel.flagCode}
                                        </span>
                                        <h3 className="text-lg font-bold text-white">{selectedVessel.name}</h3>
                                    </div>
                                    <p className="text-xs text-slate-400">IMO: {selectedVessel.imo}</p>
                                </div>
                                <button
                                    onClick={() => setSelectedVessel(null)}
                                    className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 transition-colors"
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
                                                <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mb-1">Status</p>
                                                <p className={`font-bold ${style.text}`}>
                                                    {t(`vessel_status_${selectedVessel.status.toLowerCase()}`)}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })()}

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">{t('vessel_type_cargo')}</p>
                                        <p className="text-sm font-medium text-white">{selectedVessel.type}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">{t('tooltip_speed')}</p>
                                        <p className="text-sm font-medium text-white">{selectedVessel.speedKnot} kn</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">{t('tooltip_co2')}</p>
                                        <p className="text-sm font-medium text-white">{selectedVessel.estimatedCo2} t</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">{t('tooltip_due')}</p>
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
                        <div className="flex-1 bg-[#0A1110] border border-white/5 rounded-2xl flex flex-col items-center justify-center p-8 text-center border-dashed">
                            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-4">
                                <Ship className="w-5 h-5 text-slate-500" />
                            </div>
                            <p className="text-sm text-slate-400 font-medium">Select a vessel on the map to view detailed compliance data.</p>
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
