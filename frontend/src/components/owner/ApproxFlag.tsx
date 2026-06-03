import * as React from 'react';

const APPROX_TITLE =
    'Approximate estimate — aircraft type not in the ICAO EDB; CO2 estimated from MTOW';

/**
 * Yellow warning pill flagging an air transaction whose CO2 used the MTOW fallback
 * (aircraft type absent from the ICAO EDB). Transparency per design §8.
 */
export function ApproxFlag() {
    return (
        <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide bg-[var(--os-badge-pending-bg)] text-[#F59E0B] border border-[#F59E0B]/20"
            title={APPROX_TITLE}
            aria-label={APPROX_TITLE}
        >
            ≈ Estimation approximée
        </span>
    );
}
