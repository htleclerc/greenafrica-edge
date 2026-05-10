'use client';

import * as React from 'react';
import { OsBadge, type BadgeVariant } from '@/components/ui/OsBadge';
import type { PaymentRow as PaymentRowType } from '@/services/paymentService';

const STATUS_VARIANT: Record<PaymentRowType['status'], BadgeVariant> = {
    INITIATED:  'warning',
    PROCESSING: 'info',
    CONFIRMED:  'active',
    REJECTED:   'critical',
    CANCELLED:  'archived',
    REFUNDED:   'archived',
};

interface Props {
    payment: PaymentRowType;
    onOpen: (id: string) => void;
}

export function PaymentRow({ payment, onOpen }: Props) {
    const amountUsd = payment.amount_usd_minor / 100;
    return (
        <tr
            onClick={() => onOpen(payment.id)}
            className="cursor-pointer hover:bg-[var(--os-surface-3)] transition-colors"
        >
            <td className="px-3 py-2 text-xs font-mono text-[var(--os-text-muted)]">
                {payment.id.slice(0, 8)}
            </td>
            <td className="px-3 py-2 text-xs">{payment.rail}</td>
            <td className="px-3 py-2 text-xs font-mono tabular-nums">
                {amountUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                {payment.currency !== 'USD' && (
                    <span className="ml-1 text-[10px] text-[var(--os-text-muted)]">
                        ({(payment.amount_minor / 100).toFixed(2)} {payment.currency})
                    </span>
                )}
            </td>
            <td className="px-3 py-2">
                <OsBadge variant={STATUS_VARIANT[payment.status]} label={payment.status} />
            </td>
            <td className="px-3 py-2 text-xs text-[var(--os-text-muted)] tabular-nums">
                {new Date(payment.created_at).toLocaleString()}
            </td>
            <td className="px-3 py-2 text-xs font-mono text-[var(--os-text-muted)]">
                {payment.external_reference ?? '—'}
            </td>
        </tr>
    );
}
