/**
 * Carbon Credit Domain Constants
 * Enums and codes used throughout the Carbon Credit module.
 * Always compare against these codes, never raw strings.
 */

/** International carbon credit certification standards */
export enum CreditStandard {
    VCS = 'VCS',
    GOLD_STANDARD = 'GOLD_STANDARD',
    ARTICLE6 = 'ARTICLE6',
    AFRICGREEN_SOVEREIGN = 'AFRICGREEN_SOVEREIGN',
    ACMI = 'ACMI',
}

/** Human-readable labels for CreditStandard */
export const CreditStandardLabel: Record<CreditStandard, string> = {
    [CreditStandard.VCS]: 'VCS (Verra)',
    [CreditStandard.GOLD_STANDARD]: 'Gold Standard',
    [CreditStandard.ARTICLE6]: 'Paris Art. 6',
    [CreditStandard.AFRICGREEN_SOVEREIGN]: 'Green Gate Sovereign',
    [CreditStandard.ACMI]: 'ACMI',
};

/** Tailwind color classes for each standard badge */
export const CreditStandardColor: Record<CreditStandard, { bg: string; text: string; border: string }> = {
    [CreditStandard.VCS]: {
        bg: 'bg-blue-500/15',
        text: 'text-blue-400',
        border: 'border-blue-500/30',
    },
    [CreditStandard.GOLD_STANDARD]: {
        bg: 'bg-yellow-500/15',
        text: 'text-yellow-400',
        border: 'border-yellow-500/30',
    },
    [CreditStandard.ARTICLE6]: {
        bg: 'bg-purple-500/15',
        text: 'text-purple-400',
        border: 'border-purple-500/30',
    },
    [CreditStandard.AFRICGREEN_SOVEREIGN]: {
        bg: 'bg-emerald-500/15',
        text: 'text-emerald-400',
        border: 'border-emerald-500/30',
    },
    [CreditStandard.ACMI]: {
        bg: 'bg-teal-500/15',
        text: 'text-teal-400',
        border: 'border-teal-500/30',
    },
};

/** Carbon credit lifecycle status codes */
export enum CreditStatus {
    AVAILABLE = 'AVAILABLE',
    ISSUED = 'ISSUED',
    PENDING_VERIFICATION = 'PENDING_VERIFICATION',
    RETIRED = 'RETIRED',
}

/** Human-readable labels for CreditStatus */
export const CreditStatusLabel: Record<CreditStatus, string> = {
    [CreditStatus.AVAILABLE]: 'Available',
    [CreditStatus.ISSUED]: 'Issued',
    [CreditStatus.PENDING_VERIFICATION]: 'Pending Verification',
    [CreditStatus.RETIRED]: 'Retired',
};

/** Tailwind color classes for CreditStatus badge */
export const CreditStatusColor: Record<CreditStatus, { bg: string; text: string; border: string }> = {
    [CreditStatus.AVAILABLE]: {
        bg: 'bg-emerald-500/15',
        text: 'text-emerald-400',
        border: 'border-emerald-500/30',
    },
    [CreditStatus.ISSUED]: {
        bg: 'bg-blue-500/15',
        text: 'text-blue-400',
        border: 'border-blue-500/30',
    },
    [CreditStatus.PENDING_VERIFICATION]: {
        bg: 'bg-yellow-500/15',
        text: 'text-yellow-400',
        border: 'border-yellow-500/30',
    },
    [CreditStatus.RETIRED]: {
        bg: 'bg-slate-500/15',
        text: 'text-slate-400',
        border: 'border-slate-500/30',
    },
};

/** Carbon offset project type codes */
export enum ProjectType {
    REFORESTATION = 'REFORESTATION',
    MANGROVE = 'MANGROVE',
    CLEAN_COOKING = 'CLEAN_COOKING',
    BLUE_CARBON = 'BLUE_CARBON',
    RENEWABLE_ENERGY = 'RENEWABLE_ENERGY',
    AVOIDED_DEFORESTATION = 'AVOIDED_DEFORESTATION',
}

/** Human-readable labels for ProjectType */
export const ProjectTypeLabel: Record<ProjectType, string> = {
    [ProjectType.REFORESTATION]: 'Reforestation',
    [ProjectType.MANGROVE]: 'Mangrove Restoration',
    [ProjectType.CLEAN_COOKING]: 'Clean Cooking',
    [ProjectType.BLUE_CARBON]: 'Blue Carbon',
    [ProjectType.RENEWABLE_ENERGY]: 'Renewable Energy',
    [ProjectType.AVOIDED_DEFORESTATION]: 'Avoided Deforestation',
};

/** Tailwind color classes for ProjectType badge */
export const ProjectTypeColor: Record<ProjectType, { bg: string; text: string; border: string }> = {
    [ProjectType.REFORESTATION]: { bg: 'bg-green-500/15', text: 'text-green-400', border: 'border-green-500/30' },
    [ProjectType.MANGROVE]: { bg: 'bg-teal-500/15', text: 'text-teal-400', border: 'border-teal-500/30' },
    [ProjectType.CLEAN_COOKING]: { bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/30' },
    [ProjectType.BLUE_CARBON]: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', border: 'border-cyan-500/30' },
    [ProjectType.RENEWABLE_ENERGY]: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', border: 'border-yellow-500/30' },
    [ProjectType.AVOIDED_DEFORESTATION]: { bg: 'bg-lime-500/15', text: 'text-lime-400', border: 'border-lime-500/30' },
};

/**
 * ICVCM Core Carbon Principles (CCP) quality grades.
 * AAA = highest integrity; CCC = lowest voluntary grade.
 */
export enum CreditGrade {
    AAA = 'AAA',
    AA = 'AA',
    A = 'A',
    BBB = 'BBB',
    BB = 'BB',
    CCC = 'CCC',
}

/** Tailwind color classes for CreditGrade, analogous to CiiRating */
export const CreditGradeColor: Record<CreditGrade, string> = {
    [CreditGrade.AAA]: 'text-emerald-400',
    [CreditGrade.AA]: 'text-green-400',
    [CreditGrade.A]: 'text-teal-400',
    [CreditGrade.BBB]: 'text-yellow-400',
    [CreditGrade.BB]: 'text-orange-400',
    [CreditGrade.CCC]: 'text-red-400',
};
