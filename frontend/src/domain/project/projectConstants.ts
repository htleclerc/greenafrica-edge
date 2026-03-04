/**
 * Project Domain Constants
 * Enums and codes for the Projects module.
 * Always compare against these codes, never raw strings.
 */

// ── Phase ──────────────────────────────────────────────────────────────────

/** Lifecycle phase of a sovereign green / carbon project */
export enum ProjectPhase {
    PREPARATION = 'PREPARATION',
    ACTIVE = 'ACTIVE',
    COMPLETED = 'COMPLETED',
    UPCOMING = 'UPCOMING',
}

export const ProjectPhaseLabel: Record<ProjectPhase, string> = {
    [ProjectPhase.PREPARATION]: 'Preparation',
    [ProjectPhase.ACTIVE]: 'Active',
    [ProjectPhase.COMPLETED]: 'Completed',
    [ProjectPhase.UPCOMING]: 'Upcoming',
};

export const ProjectPhaseColor: Record<ProjectPhase, { bg: string; text: string; border: string }> = {
    [ProjectPhase.PREPARATION]: {
        bg: 'bg-yellow-500/15',
        text: 'text-yellow-400',
        border: 'border-yellow-500/30',
    },
    [ProjectPhase.ACTIVE]: {
        bg: 'bg-emerald-500/15',
        text: 'text-emerald-400',
        border: 'border-emerald-500/30',
    },
    [ProjectPhase.COMPLETED]: {
        bg: 'bg-blue-500/15',
        text: 'text-blue-400',
        border: 'border-blue-500/30',
    },
    [ProjectPhase.UPCOMING]: {
        bg: 'bg-purple-500/15',
        text: 'text-purple-400',
        border: 'border-purple-500/30',
    },
};

// ── Category ───────────────────────────────────────────────────────────────

/** Thematic category of a project */
export enum ProjectCategory {
    CARBON_FORESTRY = 'CARBON_FORESTRY',
    BLUE_CARBON = 'BLUE_CARBON',
    CLEAN_ENERGY = 'CLEAN_ENERGY',
    CARBON_TAX_POLICY = 'CARBON_TAX_POLICY',
    ADAPTATION = 'ADAPTATION',
    BIODIVERSITY = 'BIODIVERSITY',
}

export const ProjectCategoryLabel: Record<ProjectCategory, string> = {
    [ProjectCategory.CARBON_FORESTRY]: 'Carbon Forestry',
    [ProjectCategory.BLUE_CARBON]: 'Blue Carbon',
    [ProjectCategory.CLEAN_ENERGY]: 'Clean Energy',
    [ProjectCategory.CARBON_TAX_POLICY]: 'Carbon Tax & Policy',
    [ProjectCategory.ADAPTATION]: 'Climate Adaptation',
    [ProjectCategory.BIODIVERSITY]: 'Biodiversity',
};

export const ProjectCategoryColor: Record<ProjectCategory, { bg: string; text: string; border: string }> = {
    [ProjectCategory.CARBON_FORESTRY]: {
        bg: 'bg-green-500/15',
        text: 'text-green-400',
        border: 'border-green-500/30',
    },
    [ProjectCategory.BLUE_CARBON]: {
        bg: 'bg-cyan-500/15',
        text: 'text-cyan-400',
        border: 'border-cyan-500/30',
    },
    [ProjectCategory.CLEAN_ENERGY]: {
        bg: 'bg-orange-500/15',
        text: 'text-orange-400',
        border: 'border-orange-500/30',
    },
    [ProjectCategory.CARBON_TAX_POLICY]: {
        bg: 'bg-teal-500/15',
        text: 'text-teal-400',
        border: 'border-teal-500/30',
    },
    [ProjectCategory.ADAPTATION]: {
        bg: 'bg-sky-500/15',
        text: 'text-sky-400',
        border: 'border-sky-500/30',
    },
    [ProjectCategory.BIODIVERSITY]: {
        bg: 'bg-lime-500/15',
        text: 'text-lime-400',
        border: 'border-lime-500/30',
    },
};

// ── Funding Status ─────────────────────────────────────────────────────────

/** Funding / financial status of a project */
export enum FundingStatus {
    FUNDED = 'FUNDED',
    PARTIALLY_FUNDED = 'PARTIALLY_FUNDED',
    SEEKING_FUNDING = 'SEEKING_FUNDING',
    CLOSED = 'CLOSED',
}

export const FundingStatusLabel: Record<FundingStatus, string> = {
    [FundingStatus.FUNDED]: 'Funded',
    [FundingStatus.PARTIALLY_FUNDED]: 'Partially Funded',
    [FundingStatus.SEEKING_FUNDING]: 'Seeking Funding',
    [FundingStatus.CLOSED]: 'Closed',
};

export const FundingStatusColor: Record<FundingStatus, { bg: string; text: string; border: string }> = {
    [FundingStatus.FUNDED]: {
        bg: 'bg-emerald-500/15',
        text: 'text-emerald-400',
        border: 'border-emerald-500/30',
    },
    [FundingStatus.PARTIALLY_FUNDED]: {
        bg: 'bg-yellow-500/15',
        text: 'text-yellow-400',
        border: 'border-yellow-500/30',
    },
    [FundingStatus.SEEKING_FUNDING]: {
        bg: 'bg-rose-500/15',
        text: 'text-rose-400',
        border: 'border-rose-500/30',
    },
    [FundingStatus.CLOSED]: {
        bg: 'bg-slate-500/15',
        text: 'text-slate-400',
        border: 'border-slate-500/30',
    },
};
