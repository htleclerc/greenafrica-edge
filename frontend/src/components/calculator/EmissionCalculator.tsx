'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Calculator as CalcIcon, AlertTriangle, Info, CheckCircle2, CreditCard, ShieldCheck } from 'lucide-react';
import { calculatorOptions, offsetTransactions } from '@/mock/datas';

export function EmissionCalculator({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
    const t = useTranslations('Calculator');
    const [step, setStep] = React.useState<1 | 2>(1); // 1: Input, 2: Result & Payment

    // State for inputs
    const [activity, setActivity] = React.useState(calculatorOptions.activityTypes[0].id);
    const [fuel, setFuel] = React.useState(calculatorOptions.fuelSources[0].id);
    const [quantity, setQuantity] = React.useState('');

    // Computed values
    const fuelFactor = calculatorOptions.fuelSources.find(f => f.id === fuel)?.factor || 0;
    const calculatedEmissions = quantity ? (parseFloat(quantity) * fuelFactor / 1000).toFixed(2) : '0.00';
    const totalPayable = quantity ? ((parseFloat(calculatedEmissions) * 15 * 0.4) + 128.55 + 964.12).toFixed(2) : '0.00';

    return (
        <Dialog.Root open={isOpen} onOpenChange={(open) => { onOpenChange(open); if (!open) setStep(1); }}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
                <Dialog.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-6xl translate-x-[-50%] translate-y-[-50%] bg-white rounded-3xl shadow-2xl p-0 overflow-hidden outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] max-h-[90vh] overflow-y-auto">

                    <div className="sticky top-0 bg-white/90 backdrop-blur-md border-b border-slate-100 z-10 px-8 py-4 flex justify-between items-center">
                        <div>
                            <p className="text-sm font-medium text-slate-500">{t('subtitle')}</p>
                            <h2 className="text-2xl font-bold text-slate-900">{t('title')}</h2>
                        </div>
                        <Dialog.Close className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors">
                            <X className="w-5 h-5" />
                        </Dialog.Close>
                    </div>

                    <div className="flex flex-col lg:flex-row min-h-[600px] bg-slate-50/50">
                        {/* Left Column: Form */}
                        <div className="flex-1 p-8 bg-white border-r border-slate-100">

                            <div className="mb-8">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <CalcIcon className="w-5 h-5 text-emerald-600" />
                                        <h3 className="text-lg font-bold text-slate-900">{t('input_params')}</h3>
                                    </div>
                                    <span className="text-xs font-semibold bg-blue-50 text-blue-600 px-3 py-1 rounded-full flex items-center gap-1 border border-blue-100">
                                        <Info className="w-3 h-3" /> {t('guidelines')}
                                    </span>
                                </div>
                                <p className="text-sm text-slate-500">{t('input_desc')}</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-slate-700">{t('activity_type')}</label>
                                    <select
                                        value={activity} onChange={e => setActivity(e.target.value)}
                                        className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-white text-slate-900 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all appearance-none"
                                    >
                                        {calculatorOptions.activityTypes.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-slate-700">{t('fuel_source')}</label>
                                    <select
                                        value={fuel} onChange={e => setFuel(e.target.value)}
                                        className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-white text-slate-900 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all appearance-none"
                                    >
                                        {calculatorOptions.fuelSources.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-slate-700">{t('quantity_consumed')}</label>
                                    <div className="relative">
                                        <input
                                            type="number" min="0" placeholder="0.00" value={quantity} onChange={e => setQuantity(e.target.value)}
                                            className="w-full border border-slate-200 rounded-xl pl-4 pr-16 py-3 bg-white text-slate-900 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all"
                                        />
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded">Liters</div>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-slate-700">{t('region_facility')}</label>
                                    <select className="w-full border border-slate-200 rounded-xl px-4 py-3 bg-white text-slate-900 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all appearance-none">
                                        {calculatorOptions.regions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                                    </select>
                                </div>
                            </div>

                            <button
                                onClick={() => setStep(2)}
                                className="w-full bg-[#1f2924] hover:bg-[#141b18] text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors mb-6"
                            >
                                <CalcIcon className="w-5 h-5" /> {t('btn_calculate')}
                            </button>

                            {quantity && (
                                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex gap-3">
                                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                                    <div>
                                        <h4 className="text-sm font-bold text-emerald-900">{t('validation_success')}</h4>
                                        <p className="text-xs text-emerald-700 mt-1">{t('validation_desc').replace('{factor}', fuelFactor.toString())}</p>
                                    </div>
                                </div>
                            )}

                        </div>

                        {/* Right Column: Output & Payment */}
                        <div className={`flex-1 p-8 transition-opacity duration-300 ${step === 2 ? 'opacity-100' : 'opacity-30 pointer-events-none grayscale'}`}>

                            <div className="bg-[#1f2924] text-white rounded-2xl p-6 mb-8 relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/20 rounded-full blur-[40px]" />
                                <h3 className="text-xs font-bold tracking-widest text-emerald-400 uppercase mb-4 opacity-80">{t('total_emissions')}</h3>
                                <div className="flex items-baseline gap-2 mb-6">
                                    <span className="text-5xl font-bold">{calculatedEmissions}</span>
                                    <span className="text-lg text-slate-400">tCO₂e</span>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex justify-between text-xs font-medium text-slate-400">
                                        <span>{t('current_qtr_limit')}</span>
                                        <span>65% Used</span>
                                    </div>
                                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: '65%' }}></div>
                                    </div>
                                    <div className="flex justify-between text-[10px] text-slate-500">
                                        <span>0 tCO₂e</span>
                                        <span>Max: 650 tCO₂e</span>
                                    </div>
                                </div>
                            </div>

                            <div className="mb-8">
                                <h3 className="text-sm font-bold text-slate-900 mb-4">{t('rec_offset_action')}</h3>
                                <div className="space-y-3">
                                    <label className="flex items-start gap-4 p-4 border-2 border-emerald-500 rounded-xl bg-emerald-50/30 cursor-pointer">
                                        <input type="radio" name="offset" className="mt-1 flex-shrink-0 text-emerald-600 focus:ring-emerald-500 scale-150" defaultChecked />
                                        <div className="flex-1">
                                            <div className="flex justify-between mb-1">
                                                <span className="font-bold text-emerald-950">{t('min_offset_title')}</span>
                                                <span className="font-bold text-emerald-700">${((parseFloat(calculatedEmissions) * 15 * 0.4)).toFixed(2)}</span>
                                            </div>
                                            <span className="text-xs text-emerald-800/80">{t('min_offset_desc')}</span>
                                        </div>
                                    </label>
                                    <label className="flex items-start gap-4 p-4 border border-slate-200 rounded-xl hover:border-emerald-200 cursor-pointer transition-colors">
                                        <input type="radio" name="offset" className="mt-1 flex-shrink-0text-slate-400 scale-150" />
                                        <div className="flex-1">
                                            <div className="flex justify-between mb-1">
                                                <span className="font-bold text-slate-700">{t('full_offset_title')}</span>
                                                <span className="font-bold text-slate-900">${((parseFloat(calculatedEmissions) * 15)).toFixed(2)}</span>
                                            </div>
                                            <span className="text-xs text-slate-500">{t('full_offset_desc')}</span>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            <div className="border-t border-slate-200 pt-6 mb-8">
                                <div className="space-y-3 mb-6">
                                    <div className="flex justify-between text-sm text-slate-600">
                                        <span>{t('offset_cost')} ($15/tCO₂e)</span>
                                        <span>${((parseFloat(calculatedEmissions) * 15 * 0.4)).toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm text-slate-600">
                                        <span>{t('platform_fee')} (2%)</span>
                                        <span>$128.55</span>
                                    </div>
                                    <div className="flex justify-between text-sm text-slate-600">
                                        <span>{t('vat')} (15%)</span>
                                        <span>$964.12</span>
                                    </div>
                                    <div className="flex justify-between text-lg font-bold text-slate-900 pt-3 border-t border-slate-100">
                                        <span>{t('total_payable')}</span>
                                        <span>${totalPayable}</span>
                                    </div>
                                </div>

                                <button className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors shadow-lg shadow-emerald-500/20">
                                    <CreditCard className="w-5 h-5" /> {t('btn_pay').replace('{amount}', `$${totalPayable}`)}
                                </button>
                                <p className="text-center text-xs text-slate-500 mt-4 flex items-center justify-center gap-1">
                                    <ShieldCheck className="w-3 h-3" /> {t('secure_transaction')}
                                </p>
                            </div>

                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
