import * as React from 'react';
import { type BadgeVariant } from '@/lib/badgeUtils';

// Re-export helpers so existing imports from OsBadge still work
export { complianceVariant, transactionVariant, severityVariant } from '@/lib/badgeUtils';
export type { BadgeVariant } from '@/lib/badgeUtils';

// ── Variant styles ────────────────────────────────────────────────────────────

const VARIANT_STYLES: Record<BadgeVariant, string> = {
    compliant:      'bg-[var(--os-badge-compliant-bg)]   text-[#22C55E] border border-[#22C55E]/20',
    paid:           'bg-[var(--os-badge-compliant-bg)]   text-[#22C55E] border border-[#22C55E]/20',
    online:         'bg-[var(--os-badge-compliant-bg)]   text-[#00D97E] border border-[#00D97E]/20',
    active:         'bg-[var(--os-badge-compliant-bg)]   text-[#22C55E] border border-[#22C55E]/20',

    payment_due:    'bg-[var(--os-badge-payment-bg)]     text-[#EF4444] border border-[#EF4444]/20',
    non_compliant:  'bg-[var(--os-badge-payment-bg)]     text-[#EF4444] border border-[#EF4444]/20',
    overdue:        'bg-[var(--os-badge-payment-bg)]     text-[#EF4444] border border-[#EF4444]/20',
    critical:       'bg-[var(--os-badge-payment-bg)]     text-[#EF4444] border border-[#EF4444]/20',
    offline:        'bg-[var(--os-badge-payment-bg)]     text-[#EF4444] border border-[#EF4444]/20',

    processing:     'bg-[var(--os-badge-processing-bg)]  text-[#F97316] border border-[#F97316]/20',
    approaching:    'bg-[var(--os-badge-pending-bg)]     text-[#F59E0B] border border-[#F59E0B]/20',
    pending:        'bg-[var(--os-badge-pending-bg)]     text-[#F59E0B] border border-[#F59E0B]/20',
    warning:        'bg-[var(--os-badge-pending-bg)]     text-[#F59E0B] border border-[#F59E0B]/20',
    degraded:       'bg-[var(--os-badge-pending-bg)]     text-[#F59E0B] border border-[#F59E0B]/20',

    exempt:         'bg-[var(--os-badge-info-bg)]        text-[#38BDF8] border border-[#38BDF8]/20',
    info:           'bg-[var(--os-badge-info-bg)]        text-[#38BDF8] border border-[#38BDF8]/20',
    disputed:       'bg-[var(--os-badge-info-bg)]        text-[#38BDF8] border border-[#38BDF8]/20',
    draft:          'bg-[var(--os-badge-info-bg)]        text-[#38BDF8] border border-[#38BDF8]/20',
    archived:       'bg-white/5                          text-slate-400  border border-white/10',
};

const VARIANT_DOTS: Record<BadgeVariant, string> = {
    compliant:      'bg-[#22C55E]',
    paid:           'bg-[#22C55E]',
    online:         'bg-[#00D97E] shadow-[0_0_4px_#00D97E]',
    active:         'bg-[#22C55E]',
    payment_due:    'bg-[#EF4444]',
    non_compliant:  'bg-[#EF4444]',
    overdue:        'bg-[#EF4444]',
    critical:       'bg-[#EF4444]',
    offline:        'bg-[#EF4444]',
    processing:     'bg-[#F97316]',
    approaching:    'bg-[#F59E0B]',
    pending:        'bg-[#F59E0B]',
    warning:        'bg-[#F59E0B]',
    degraded:       'bg-[#F59E0B]',
    exempt:         'bg-[#38BDF8]',
    info:           'bg-[#38BDF8]',
    disputed:       'bg-[#38BDF8]',
    draft:          'bg-[#38BDF8]',
    archived:       'bg-slate-400',
};

// ── Component ────────────────────────────────────────────────────────────────

interface OsBadgeProps {
    variant: BadgeVariant;
    label: string;
    dot?: boolean;
    size?: 'sm' | 'md';
    className?: string;
}

export function OsBadge({ variant, label, dot = true, size = 'sm', className = '' }: OsBadgeProps) {
    const base    = VARIANT_STYLES[variant] ?? VARIANT_STYLES.info;
    const dotCls  = VARIANT_DOTS[variant]   ?? 'bg-slate-400';
    const sizeCls = size === 'sm'
        ? 'px-2 py-0.5 text-[11px] font-semibold'
        : 'px-3 py-1 text-xs font-semibold';

    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full tracking-wide uppercase ${sizeCls} ${base} ${className}`}>
            {dot && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotCls}`} />}
            {label}
        </span>
    );
}
