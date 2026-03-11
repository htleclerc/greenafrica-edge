'use client';

import * as React from 'react';
import { X, Printer, Ship } from 'lucide-react';
import { Transaction, TransactionType } from '@/types/secure';
import { OsButton } from '@/components/ui/OsButton';

const TX_TYPE_LABEL: Record<TransactionType, string> = {
    [TransactionType.ENTRY_TAX]:   'Entry Tax',
    [TransactionType.TRANSIT_FEE]: 'Transit Fee',
    [TransactionType.PORT_STAY]:   'Port Stay',
};

interface ProFormaModalProps {
    tx: Transaction;
    onClose: () => void;
}

export function ProFormaModal({ tx, onClose }: ProFormaModalProps) {
    const invoiceRef  = `INV-2025-${tx.id.split('-')[1].toUpperCase()}`;
    const issueDate   = new Date(tx.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    const dueDate     = new Date(Date.now() + 30 * 86400000).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

    const containerFee = Math.round(tx.taxAmountUsd * 0.75);
    const portCallFee  = Math.round(tx.taxAmountUsd * 0.20);
    const securityFee  = tx.taxAmountUsd - containerFee - portCallFee;

    function handlePrint() {
        window.print();
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center no-print" style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
            <div
                className="relative w-full max-w-4xl mx-4 rounded-2xl border overflow-hidden flex flex-col"
                style={{ backgroundColor: 'var(--os-surface)', borderColor: 'var(--os-border-strong)', maxHeight: '90vh' }}
            >
                {/* Modal toolbar */}
                <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--os-border)' }}>
                    <div>
                        <h2 className="text-sm font-bold text-[var(--os-text-primary)]">Pro-forma Invoice Preview</h2>
                        <p className="text-[10px] text-[var(--os-text-muted)]">{invoiceRef} · {tx.vesselName}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <OsButton variant="primary" size="sm" icon={<Printer className="w-3.5 h-3.5" />} onClick={handlePrint}>
                            Print / Save PDF
                        </OsButton>
                        <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:bg-[var(--os-surface-2)] transition-colors">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Scrollable content */}
                <div className="overflow-y-auto flex-1 p-6">
                    {/* Two-col: left = form, right = PDF preview */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Left: calculation + delivery */}
                        <div className="flex flex-col gap-5">
                            {/* Vessel & Port Call */}
                            <div className="os-card p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-xs font-bold text-[var(--os-text-primary)] uppercase tracking-wide">Vessel & Port Call</h3>
                                    <a href="#" className="text-[10px] text-[#38BDF8] hover:underline">Change Vessel</a>
                                </div>
                                <div className="flex items-center gap-3 p-3 rounded-xl bg-[var(--os-surface-3)] border border-[var(--os-border)]">
                                    <div className="w-8 h-8 rounded-lg bg-[var(--os-surface-2)] flex items-center justify-center">
                                        <Ship className="w-4 h-4 text-[var(--os-text-muted)]" />
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-sm font-bold text-[var(--os-text-primary)]">{tx.vesselName}</p>
                                        <p className="text-[10px] text-[var(--os-text-muted)]">IMO: {tx.vesselImo} | Port: {tx.portCall}</p>
                                    </div>
                                </div>
                                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                    <div>
                                        <p className="text-[10px] text-[var(--os-text-muted)] mb-0.5">Arrival Date</p>
                                        <p className="font-medium text-[var(--os-text-primary)]">{issueDate}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-[var(--os-text-muted)] mb-0.5">Transaction Type</p>
                                        <p className="font-medium text-[var(--os-text-primary)]">{TX_TYPE_LABEL[tx.transactionType]}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Fee Calculation */}
                            <div className="os-card p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-xs font-bold text-[var(--os-text-primary)] uppercase tracking-wide">Fee Calculation Basis</h3>
                                    <span className="text-[9px] font-bold text-[#38BDF8] bg-[rgba(56,189,248,0.1)] px-2 py-0.5 rounded-full border border-[#38BDF8]/20 uppercase">
                                        OMI Cubic Law
                                    </span>
                                </div>
                                <div className="p-3 rounded-xl bg-[rgba(0,217,126,0.04)] border border-[#00D97E]/15 mb-3">
                                    <p className="text-[10px] text-[var(--os-text-muted)] mb-1">Apply Calculation Formula:</p>
                                    <p className="text-sm font-mono font-bold text-[#00D97E]">
                                        TOTAL = ({tx.emissionsTco2} × 753) = ${tx.taxAmountUsd.toLocaleString()}
                                    </p>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    {[
                                        { label: 'CO₂ Emissions', value: `${tx.emissionsTco2} tCO₂` },
                                        { label: 'Rate / tCO₂', value: '$20.00' },
                                        { label: 'Port Stay Fee', value: `$${portCallFee.toLocaleString()}` },
                                        { label: 'Security Surcharge', value: `$${securityFee.toLocaleString()}` },
                                    ].map(({ label, value }) => (
                                        <div key={label} className="flex flex-col">
                                            <span className="text-[10px] text-[var(--os-text-muted)]">{label}</span>
                                            <span className="font-mono font-semibold text-[var(--os-text-primary)]">{value}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Delivery details */}
                            <div className="os-card p-4">
                                <h3 className="text-xs font-bold text-[var(--os-text-primary)] uppercase tracking-wide mb-3">Delivery Details</h3>
                                <div className="flex flex-col gap-2">
                                    <div>
                                        <p className="text-[10px] text-[var(--os-text-muted)] mb-0.5">Agent / Contact</p>
                                        <input
                                            type="text"
                                            defaultValue="Ahmed Salah — Red Sea Logistics Ltd."
                                            className="w-full h-8 px-3 rounded-lg bg-[var(--os-surface-2)] border border-[var(--os-border)] text-xs text-[var(--os-text-primary)] focus:outline-none focus:border-[#00D97E]/50"
                                        />
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-[var(--os-text-muted)] mb-0.5">Email</p>
                                        <input
                                            type="email"
                                            defaultValue={`operations@${tx.vesselName.toLowerCase().replace(/\s+/g, '')}.logistics.so`}
                                            className="w-full h-8 px-3 rounded-lg bg-[var(--os-surface-2)] border border-[var(--os-border)] text-xs text-[var(--os-text-primary)] focus:outline-none focus:border-[#00D97E]/50"
                                        />
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-[var(--os-text-muted)] mb-0.5">Notes to Finance Dept.</p>
                                        <textarea
                                            rows={2}
                                            placeholder="Add notes…"
                                            className="w-full px-3 py-2 rounded-lg bg-[var(--os-surface-2)] border border-[var(--os-border)] text-xs text-[var(--os-text-primary)] focus:outline-none focus:border-[#00D97E]/50 resize-none"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Right: PDF preview */}
                        <div
                            className="rounded-xl border border-[var(--os-border)] overflow-hidden print-only"
                            style={{ backgroundColor: 'white', color: '#1a1a1a', fontFamily: 'serif' }}
                        >
                            <div className="p-6">
                                {/* PDF header */}
                                <div className="flex items-start justify-between mb-6 pb-4 border-b border-gray-200">
                                    <div>
                                        <h2 className="text-base font-bold text-gray-900">PRO-FORMA INVOICE</h2>
                                        <p className="text-xs text-gray-500 mt-0.5">Maritime Environmental Levy Notice</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-bold text-gray-900">AFRICGREEN</p>
                                        <p className="text-[10px] text-gray-500">Government of Somaliland</p>
                                        <p className="text-[10px] text-gray-500">Ministry of Environment</p>
                                    </div>
                                </div>

                                {/* Meta */}
                                <div className="grid grid-cols-2 gap-4 mb-5 text-xs">
                                    <div>
                                        <p className="text-gray-500 mb-0.5">Issued to</p>
                                        <p className="font-semibold text-gray-900">Red Sea Logistics Ltd.</p>
                                        <p className="text-gray-600">{tx.vesselName}</p>
                                        <p className="text-gray-600">IMO: {tx.vesselImo}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-gray-500 mb-0.5">Invoice No.</p>
                                        <p className="font-bold text-gray-900">{invoiceRef}</p>
                                        <p className="text-gray-600 mt-1">Date: {issueDate}</p>
                                        <p className="text-gray-600">Due: {dueDate}</p>
                                    </div>
                                </div>

                                {/* Line items */}
                                <table className="w-full text-xs mb-4">
                                    <thead>
                                        <tr className="border-y border-gray-200">
                                            <th className="py-2 text-left text-gray-600 font-semibold">Description</th>
                                            <th className="py-2 text-right text-gray-600 font-semibold">Qty</th>
                                            <th className="py-2 text-right text-gray-600 font-semibold">Rate</th>
                                            <th className="py-2 text-right text-gray-600 font-semibold">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[
                                            { desc: 'Carbon Emissions Tax (OMI Est.)', qty: `${tx.emissionsTco2} tCO₂`, rate: '$20.00/t', amount: containerFee },
                                            { desc: 'Port Call Fixed Fee',              qty: '1',                        rate: `$${portCallFee}`,         amount: portCallFee },
                                            { desc: 'Maritime Security Surcharge',       qty: '1',                        rate: `$${securityFee}`,          amount: securityFee },
                                        ].map(({ desc, qty, rate, amount }) => (
                                            <tr key={desc} className="border-b border-gray-100">
                                                <td className="py-2 text-gray-700">{desc}</td>
                                                <td className="py-2 text-right text-gray-600">{qty}</td>
                                                <td className="py-2 text-right text-gray-600">{rate}</td>
                                                <td className="py-2 text-right font-medium text-gray-900">${amount.toLocaleString()}.00</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>

                                {/* Total */}
                                <div className="flex justify-between items-center py-3 border-t border-gray-300">
                                    <span className="text-sm font-bold text-gray-900">Total Due</span>
                                    <span className="text-lg font-bold text-gray-900">${tx.taxAmountUsd.toLocaleString()}.00</span>
                                </div>

                                {/* Footer */}
                                <div className="mt-4 pt-4 border-t border-gray-100 text-[10px] text-gray-400">
                                    <p>Payment required within 30 days to obtain maritime clearance.</p>
                                    <p className="mt-1">Remit to the Sovereign Climate Fund — BER-DC1 / AES-256 Encrypted</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Modal footer */}
                <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--os-border)' }}>
                    <OsButton variant="ghost" size="sm" onClick={onClose}>Cancel</OsButton>
                    <div className="flex items-center gap-2">
                        <OsButton variant="secondary" size="sm">Draft Save</OsButton>
                        <OsButton variant="primary" size="sm" icon={<Printer className="w-3.5 h-3.5" />} onClick={handlePrint}>
                            Print &amp; Send →
                        </OsButton>
                    </div>
                </div>
            </div>
        </div>
    );
}
