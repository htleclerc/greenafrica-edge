'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { X, Printer, ShieldCheck } from 'lucide-react';
import { AisVessel } from '@/domain/ais/aisConstants';

interface ComplianceNoticeModalProps {
    vessel: AisVessel;
    onClose: () => void;
}

export function ComplianceNoticeModal({ vessel, onClose }: ComplianceNoticeModalProps) {
    const t = useTranslations('Invoice');

    const handlePrint = () => {
        window.print();
    };

    const invoiceDate = new Date().toLocaleDateString();
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString();
    const invoiceNumber = `SCN-${new Date().getFullYear()}-${vessel.imo.slice(-4)}`;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 print:p-0 print:bg-white no-print">
            {/* Modal Container for Screen / Full size for Print */}
            <div className="bg-white text-black w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl print:shadow-none print:w-full print:max-w-none print:max-h-none print:rounded-none relative print-only">

                {/* Action Bar (Hidden when printing) */}
                <div className="sticky top-0 bg-slate-100 border-b border-slate-200 p-4 flex justify-between items-center no-print z-10">
                    <h3 className="font-semibold text-slate-800">Document Preview</h3>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-200 transition-colors"
                        >
                            {t('btn_close')}
                        </button>
                        <button
                            onClick={handlePrint}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shadow-sm"
                        >
                            <Printer className="w-4 h-4" />
                            {t('btn_print')}
                        </button>
                    </div>
                </div>

                {/* A4 Document Content */}
                <div className="p-12 md:p-16 max-w-[800px] mx-auto bg-white min-h-[1056px] relative">

                    {/* Watermark */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none">
                        <ShieldCheck className="w-[400px] h-[400px]" />
                    </div>

                    {/* Header */}
                    <div className="flex justify-between items-start border-b-2 border-emerald-800 pb-8 mb-8 relative z-10">
                        <div className="flex items-center gap-4">
                            <div className="w-16 h-16 rounded-xl bg-emerald-800 flex items-center justify-center">
                                <ShieldCheck className="w-8 h-8 text-white" />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold tracking-widest text-emerald-900 uppercase">{t('republic')}</h1>
                                <p className="text-sm font-medium text-slate-600 uppercase tracking-wider mt-1">{t('ministry')}</p>
                                <p className="text-xs text-slate-500 mt-0.5">Green Gate Sovereign Registry</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tight mb-2">{t('title')}</h2>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-600">
                                <span className="font-semibold">{t('invoice_number')}:</span>
                                <span className="text-slate-900 font-mono">{invoiceNumber}</span>
                                <span className="font-semibold">{t('date_issued')}:</span>
                                <span>{invoiceDate}</span>
                                <span className="font-semibold">{t('due_date')}:</span>
                                <span>{dueDate}</span>
                            </div>
                        </div>
                    </div>

                    {/* Content Grid */}
                    <div className="grid grid-cols-2 gap-12 mb-12 relative z-10">
                        <div>
                            <h3 className="text-lg font-bold text-emerald-900 border-b border-emerald-100 pb-2 mb-4 uppercase tracking-wider">{t('vessel_details')}</h3>
                            <div className="space-y-3 text-sm">
                                <div className="flex justify-between border-b border-slate-100 pb-1">
                                    <span className="text-slate-500 font-medium">{t('vessel_name')}</span>
                                    <span className="font-bold text-slate-800">{vessel.name}</span>
                                </div>
                                <div className="flex justify-between border-b border-slate-100 pb-1">
                                    <span className="text-slate-500 font-medium">{t('vessel_imo')}</span>
                                    <span className="font-mono text-slate-800">{vessel.imo}</span>
                                </div>
                                <div className="flex justify-between border-b border-slate-100 pb-1">
                                    <span className="text-slate-500 font-medium">{t('vessel_flag')}</span>
                                    <span className="font-bold text-slate-800">{vessel.flagCode}</span>
                                </div>
                                <div className="flex justify-between border-b border-slate-100 pb-1">
                                    <span className="text-slate-500 font-medium">{t('vessel_type')}</span>
                                    <span className="font-medium text-slate-800">{vessel.type}</span>
                                </div>
                            </div>
                        </div>

                        <div>
                            <h3 className="text-lg font-bold text-emerald-900 border-b border-emerald-100 pb-2 mb-4 uppercase tracking-wider">{t('assessment_details')}</h3>
                            <div className="space-y-3 text-sm">
                                <div className="flex justify-between border-b border-slate-100 pb-1">
                                    <span className="text-slate-500 font-medium">{t('transit_zone')}</span>
                                    <span className="font-bold text-slate-800 text-right">{t('zone_name')}</span>
                                </div>
                                <div className="flex justify-between border-b border-slate-100 pb-1">
                                    <span className="text-slate-500 font-medium">{t('est_emissions')}</span>
                                    <span className="font-mono text-slate-800">{vessel.estimatedCo2} t</span>
                                </div>
                                <div className="flex justify-between border-b border-emerald-100 pb-1">
                                    <span className="text-emerald-700 font-medium">{t('applicable_rate')}</span>
                                    <span className="font-mono font-bold text-emerald-700">$15.00</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Total Box */}
                    <div className="bg-slate-50 rounded-xl p-6 flex justify-between items-center border border-slate-200 mb-12 relative z-10">
                        <div>
                            <p className="text-sm font-bold tracking-widest text-slate-500 uppercase mb-1">{t('total_due')}</p>
                            <p className="text-xs text-slate-400 max-w-sm">{t('payment_desc')}</p>
                        </div>
                        <div className="text-4xl font-black text-emerald-900 tracking-tight">
                            ${vessel.dueAmountUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                    </div>

                    {/* Footer Signatures */}
                    <div className="flex justify-between items-end mt-24 relative z-10">
                        <div className="text-center">
                            {/* Mock QR Code using CSS borders for aesthetic */}
                            <div className="w-24 h-24 border-[8px] border-slate-800 p-1 mb-2">
                                <div className="w-full h-full bg-slate-800 grid grid-cols-3 gap-1 p-1">
                                    {Array.from({ length: 9 }).map((_, i) => (
                                        <div key={i} className={`bg-white ${i % 2 === 0 ? 'opacity-100' : 'opacity-0'}`}></div>
                                    ))}
                                </div>
                            </div>
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest">{t('qr_verify')}</p>
                        </div>

                        <div className="text-center w-64">
                            <div className="border-b border-slate-400 pb-2 mb-2">
                                {/* Mock Signature */}
                                <p className="font-[Brush_Script_MT,cursive] text-4xl text-emerald-900 opacity-80 transform -rotate-3">Validated</p>
                            </div>
                            <p className="text-xs font-bold text-slate-800 uppercase tracking-wider">AIS Portal System</p>
                            <p className="text-[10px] text-slate-500 uppercase">{t('authorized_sig')}</p>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}
