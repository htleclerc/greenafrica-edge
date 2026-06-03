import * as React from 'react';

export type TransportMode = 'MARITIME' | 'AIR';

/** Pure label/icon resolver — exported for unit testing without rendering. */
export function modeBadgeContent(mode: TransportMode): { icon: string; label: string } {
    return mode === 'AIR'
        ? { icon: '✈', label: 'Air' }
        : { icon: '🚢', label: 'Maritime' };
}

// Mode accents: maritime reuses the emerald/teal house accent; air gets a distinct
// sky/indigo accent so the two transport modes are visually separable in the fleet.
const MODE_STYLES: Record<TransportMode, string> = {
    MARITIME: 'bg-[var(--os-badge-compliant-bg)] text-[#22C55E] border border-[#22C55E]/20',
    AIR:      'bg-[#38BDF8]/10                     text-[#7DD3FC] border border-[#38BDF8]/30',
};

/**
 * Small mode pill (🚢 Maritime / ✈ Air). Reused on vessel + aircraft rows and on
 * air recent-invoice rows so a unified fleet stays mode-distinguishable.
 */
export function ModeBadge({ mode }: { mode: TransportMode }) {
    const { icon, label } = modeBadgeContent(mode);
    return (
        <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${MODE_STYLES[mode]}`}
            title={`${label} mode`}
        >
            <span aria-hidden="true">{icon}</span>
            {label}
        </span>
    );
}
