/**
 * Carbon Tax Domain Constants
 * Enums and codes used throughout the Carbon Tax module.
 * Always compare against these codes, never raw strings.
 */

/** Vessel tax compliance status codes */
export enum VesselTaxStatus {
    PAID = 'PAID',
    PENDING = 'PENDING',
    OVERDUE = 'OVERDUE',
    APPROACHING = 'APPROACHING',
}

/** Human-readable labels for VesselTaxStatus */
export const VesselTaxStatusLabel: Record<VesselTaxStatus, string> = {
    [VesselTaxStatus.PAID]: 'Paid',
    [VesselTaxStatus.PENDING]: 'Pending',
    [VesselTaxStatus.OVERDUE]: 'Overdue',
    [VesselTaxStatus.APPROACHING]: 'Approaching',
};

/** Tailwind color classes for each status badge */
export const VesselTaxStatusColor: Record<VesselTaxStatus, { bg: string; text: string; border: string }> = {
    [VesselTaxStatus.PAID]: {
        bg: 'bg-emerald-500/15',
        text: 'text-emerald-400',
        border: 'border-emerald-500/30',
    },
    [VesselTaxStatus.PENDING]: {
        bg: 'bg-yellow-500/15',
        text: 'text-yellow-400',
        border: 'border-yellow-500/30',
    },
    [VesselTaxStatus.OVERDUE]: {
        bg: 'bg-red-500/15',
        text: 'text-red-400',
        border: 'border-red-500/30',
    },
    [VesselTaxStatus.APPROACHING]: {
        bg: 'bg-amber-500/15',
        text: 'text-amber-400',
        border: 'border-amber-500/30',
    },
};

/** International carbon tax regulatory framework codes */
export enum TaxRegulation {
    IMO_CII = 'IMO_CII',
    IMO_MARPOL = 'IMO_MARPOL',
    EU_ETS = 'EU_ETS',
    CORSIA = 'CORSIA',
    AFRICGREEN_SOVEREIGN = 'AFRICGREEN_SOVEREIGN',
}

/** Vessel type codes */
export enum VesselType {
    CARGO = 'CARGO',
    TANKER = 'TANKER',
    CONTAINER = 'CONTAINER',
    BULK_CARRIER = 'BULK_CARRIER',
    PASSENGER = 'PASSENGER',
    RORO = 'RORO',
}

/** Human-readable vessel type labels */
export const VesselTypeLabel: Record<VesselType, string> = {
    [VesselType.CARGO]: 'Cargo',
    [VesselType.TANKER]: 'Tanker',
    [VesselType.CONTAINER]: 'Container',
    [VesselType.BULK_CARRIER]: 'Bulk Carrier',
    [VesselType.PASSENGER]: 'Passenger',
    [VesselType.RORO]: 'RoRo',
};

/** CII Carbon Intensity Rating grades (A=best, E=worst) */
export enum CiiRating {
    A = 'A',
    B = 'B',
    C = 'C',
    D = 'D',
    E = 'E',
}

export const CiiRatingColor: Record<CiiRating, string> = {
    [CiiRating.A]: 'text-emerald-400',
    [CiiRating.B]: 'text-green-400',
    [CiiRating.C]: 'text-yellow-400',
    [CiiRating.D]: 'text-orange-400',
    [CiiRating.E]: 'text-red-400',
};
