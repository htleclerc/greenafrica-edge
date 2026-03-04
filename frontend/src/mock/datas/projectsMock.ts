import {
    ProjectPhase,
    ProjectCategory,
    FundingStatus,
} from '@/domain/project/projectConstants';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ProjectKpi {
    key: string;
    value: string;
    change: string;
    positive: boolean;
}

export interface GreenProject {
    id: string;
    name: string;
    category: ProjectCategory;
    phase: ProjectPhase;
    fundingStatus: FundingStatus;
    location: string;
    region: string;
    areaHa: number;
    budgetUsd: number;           // Total project budget (USD)
    fundedUsd: number;           // Amount secured (USD)
    co2ImpactTons: number;       // tCO₂e offset/sequestered over project life
    jobsCreated: number;
    startDate: string;           // ISO or 'YYYY-QN'
    endDate?: string;
    description: string;
    sdgGoals: number[];
    progressPct: number;
    partners: string[];
    certificationTarget?: string; // e.g. 'VCS', 'Gold Standard', 'ACMI'
    isHighlight?: boolean;        // pinned to top of grid
}

export interface MilestoneEvent {
    date: string;
    title: string;
    categoryKey: string;         // maps to a ProjectCategory for color
    description: string;
}

export interface FundingPartner {
    id: string;
    name: string;
    acronym: string;
    type: string;                // 'Multilateral' | 'NGO' | 'Standard Body' | 'Regional Body' | 'State'
    totalCommitmentUsd: number;
    description: string;
}

// ── KPIs ───────────────────────────────────────────────────────────────────

export const projectsKpis: ProjectKpi[] = [
    {
        key: 'total_budget_committed',
        value: '$84.2M',
        change: '+28% this year',
        positive: true,
    },
    {
        key: 'active_projects',
        value: '8',
        change: '+3 since 2024',
        positive: true,
    },
    {
        key: 'co2_impact_total',
        value: '3.2M tCO₂e',
        change: 'Over project lifecycles',
        positive: true,
    },
    {
        key: 'jobs_created',
        value: '14,800',
        change: 'Direct & indirect',
        positive: true,
    },
];

// ── Projects ───────────────────────────────────────────────────────────────
// Sources: Somaliland SCCWG 2019, ACMI 2022, COP29 ACMI Clean Cooking Dashboard,
// GCF Project Database, UNDP Somalia Climate Portfolio, Verra Registry 2024.

export const greenProjects: GreenProject[] = [
    {
        id: 'berbera_carbon_tax_pilot',
        name: 'Berbera Carbon Tax Pilot Programme',
        category: ProjectCategory.CARBON_TAX_POLICY,
        phase: ProjectPhase.ACTIVE,
        fundingStatus: FundingStatus.FUNDED,
        location: 'Port of Berbera, Somaliland',
        region: 'Sahil',
        areaHa: 0,
        budgetUsd: 3_200_000,
        fundedUsd: 3_200_000,
        co2ImpactTons: 480_000,
        jobsCreated: 85,
        startDate: '2024-01-01',
        endDate: '2026-12-31',
        description:
            'Implementation of the Maritime Environmental Levy at Berbera Port — the first sovereign carbon tax mechanism in the Horn of Africa. Covers all vessels transiting the Somaliland EEZ under the Africgreen Sovereign Framework. Revenue channelled to the Somaliland Climate Fund.',
        sdgGoals: [13, 17, 16, 8],
        progressPct: 52,
        partners: ['Africgreen', 'Somaliland MoECC', 'IMO'],
        certificationTarget: 'Africgreen Sovereign',
        isHighlight: true,
    },
    {
        id: 'somaliland_carbon_registry',
        name: 'Somaliland National Carbon Registry',
        category: ProjectCategory.CARBON_TAX_POLICY,
        phase: ProjectPhase.PREPARATION,
        fundingStatus: FundingStatus.PARTIALLY_FUNDED,
        location: 'Hargeisa, Somaliland',
        region: 'Maroodi Jeex',
        areaHa: 0,
        budgetUsd: 1_850_000,
        fundedUsd: 920_000,
        co2ImpactTons: 0,
        jobsCreated: 42,
        startDate: '2025-07-01',
        endDate: '2026-06-30',
        description:
            'Establishment of a digital national carbon registry aligned with ACMI traceability requirements and Paris Agreement Article 6 Corresponding Adjustments. Will serve as the legal and technical backbone for all future sovereign credit issuances. First credits targeted for 2026.',
        sdgGoals: [13, 16, 17],
        progressPct: 22,
        partners: ['UNDP', 'African Union', 'ACMI Secretariat'],
        certificationTarget: 'ACMI',
        isHighlight: true,
    },
    {
        id: 'gulf_blue_carbon',
        name: 'Gulf of Aden Blue Carbon Initiative',
        category: ProjectCategory.BLUE_CARBON,
        phase: ProjectPhase.ACTIVE,
        fundingStatus: FundingStatus.PARTIALLY_FUNDED,
        location: 'Somaliland EEZ — Coastal Wetlands',
        region: 'Awdal / Sahil',
        areaHa: 15_000,
        budgetUsd: 12_400_000,
        fundedUsd: 7_600_000,
        co2ImpactTons: 412_500,
        jobsCreated: 1_200,
        startDate: '2025-03-01',
        description:
            'Conservation of seagrass meadows and coastal wetlands within the Somaliland ZEE. First Article 6.2-compliant maritime carbon project in the Horn of Africa. Pending VVB verification for ITMO designation.',
        sdgGoals: [13, 14, 1, 17],
        progressPct: 18,
        partners: ['GCF', 'Verra', 'UNDP', 'Plan Vivo'],
        certificationTarget: 'Paris Art. 6 (ITMO)',
        isHighlight: false,
    },
    {
        id: 'golis_reforestation',
        name: 'Golis Range Reforestation (VCS)',
        category: ProjectCategory.CARBON_FORESTRY,
        phase: ProjectPhase.ACTIVE,
        fundingStatus: FundingStatus.FUNDED,
        location: 'Golis Mountain Range',
        region: 'Togdheer / Sahil',
        areaHa: 48_000,
        budgetUsd: 22_000_000,
        fundedUsd: 22_000_000,
        co2ImpactTons: 960_000,
        jobsCreated: 3_800,
        startDate: '2024-01-01',
        description:
            'Restoration of 48 000 ha of degraded endemic dry-montane forest in the Golis range. Supported by SCCWG carbon stock assessment (2019). Certified VCS credits to be issued at completion of Year 2 monitoring.',
        sdgGoals: [13, 15, 1, 8],
        progressPct: 34,
        partners: ['Verra', 'World Bank FCPF', 'Africgreen'],
        certificationTarget: 'VCS',
        isHighlight: false,
    },
    {
        id: 'hargeisa_clean_cooking',
        name: 'Hargeisa Clean Cooking Programme',
        category: ProjectCategory.CLEAN_ENERGY,
        phase: ProjectPhase.COMPLETED,
        fundingStatus: FundingStatus.CLOSED,
        location: 'Hargeisa & Peri-urban Areas',
        region: 'Maroodi Jeex',
        areaHa: 0,
        budgetUsd: 8_600_000,
        fundedUsd: 8_600_000,
        co2ImpactTons: 342_000,
        jobsCreated: 2_100,
        startDate: '2023-01-01',
        endDate: '2024-12-31',
        description:
            '28 500 improved cookstoves distributed to households, reducing firewood consumption by 60% and indoor air pollution. Gold Standard credits fully issued. Aligned with COP29 ACMI Clean Cooking Dashboard targets for the Horn of Africa.',
        sdgGoals: [3, 5, 7, 13],
        progressPct: 100,
        partners: ['Gold Standard Foundation', 'UNCDF', 'Total Energies Foundation'],
        certificationTarget: 'Gold Standard',
        isHighlight: false,
    },
    {
        id: 'sheikh_burao_savanna',
        name: 'Sheikh-Burao Savanna Restoration (ACMI)',
        category: ProjectCategory.CARBON_FORESTRY,
        phase: ProjectPhase.UPCOMING,
        fundingStatus: FundingStatus.SEEKING_FUNDING,
        location: 'Central Plateau, Togdheer',
        region: 'Togdheer',
        areaHa: 72_000,
        budgetUsd: 18_500_000,
        fundedUsd: 2_300_000,
        co2ImpactTons: 540_000,
        jobsCreated: 4_600,
        startDate: '2025-10-01',
        description:
            'Avoided grassland degradation through participatory rangeland management across 72 000 ha. ACMI-aligned certification pathway. Launch timed with Somalia\'s 1st National Conference on Carbon Market Potential (Oct 2025).',
        sdgGoals: [13, 15, 2, 8],
        progressPct: 8,
        partners: ['ACMI Secretariat', 'African Development Bank', 'FAO'],
        certificationTarget: 'ACMI',
        isHighlight: false,
    },
    {
        id: 'berbera_port_green_transition',
        name: 'Berbera Port Green Energy Transition',
        category: ProjectCategory.CLEAN_ENERGY,
        phase: ProjectPhase.UPCOMING,
        fundingStatus: FundingStatus.SEEKING_FUNDING,
        location: 'Port of Berbera',
        region: 'Sahil',
        areaHa: 0,
        budgetUsd: 14_200_000,
        fundedUsd: 1_800_000,
        co2ImpactTons: 280_000,
        jobsCreated: 1_950,
        startDate: '2026-01-01',
        description:
            'Solar-powered cold-ironing infrastructure and hydrogen bunkering pilot at Berbera Port. Enables vessels to plug in and shut down auxiliary engines while docked, reducing port emissions by an estimated 42%. Aligns with IMO 2050 decarbonisation strategy.',
        sdgGoals: [7, 9, 11, 13],
        progressPct: 5,
        partners: ['EU Climate Action', 'DP World Berbera', 'IRENA'],
        certificationTarget: 'Gold Standard',
        isHighlight: false,
    },
    {
        id: 'zeila_mangrove_reserve',
        name: 'Zeila Mangrove National Reserve',
        category: ProjectCategory.BLUE_CARBON,
        phase: ProjectPhase.PREPARATION,
        fundingStatus: FundingStatus.SEEKING_FUNDING,
        location: 'Zeila Coastal Area, Awdal',
        region: 'Awdal',
        areaHa: 9_400,
        budgetUsd: 4_200_000,
        fundedUsd: 480_000,
        co2ImpactTons: 188_000,
        jobsCreated: 620,
        startDate: '2025-09-01',
        description:
            'Legal designation and ecological restoration of 9 400 ha of threatened mangrove ecosystems near the Djibouti border. Mangroves sequester 3–5× more carbon than tropical forests. Aligned with GCF Blue Carbon readiness programme for SIDS and LDCs.',
        sdgGoals: [13, 14, 15, 1],
        progressPct: 10,
        partners: ['GCF Readiness Programme', 'IUCN', 'Plan Vivo'],
        certificationTarget: 'VCS (Blue Carbon)',
        isHighlight: false,
    },
];

// ── Timeline Milestones ────────────────────────────────────────────────────

export const projectMilestones: MilestoneEvent[] = [
    {
        date: 'Jan 2023',
        title: 'Hargeisa Clean Cooking Launch',
        categoryKey: ProjectCategory.CLEAN_ENERGY,
        description: '28 500 cookstoves distribution begins. Gold Standard registration submitted.',
    },
    {
        date: 'Nov 2022',
        title: 'ACMI Launched at COP27',
        categoryKey: ProjectCategory.CARBON_TAX_POLICY,
        description: 'Africa Carbon Markets Initiative announced. Somaliland joins ACMI pipeline.',
    },
    {
        date: 'Jun 2023',
        title: 'Berbera Mangrove Sanctuary Start',
        categoryKey: ProjectCategory.BLUE_CARBON,
        description: '8 200 ha protection zone gazetted. Gold Standard credits issued.',
    },
    {
        date: 'Jan 2024',
        title: 'Carbon Tax Pilot: First Levy Collected',
        categoryKey: ProjectCategory.CARBON_TAX_POLICY,
        description: 'First Maritime Environmental Levy collected at Berbera Port under Africgreen Framework.',
    },
    {
        date: 'Jan 2024',
        title: 'Golis Reforestation Start',
        categoryKey: ProjectCategory.CARBON_FORESTRY,
        description: '48 000 ha reforestation effort begins with VCS methodology applied.',
    },
    {
        date: 'Dec 2024',
        title: 'Clean Cooking Programme Completed',
        categoryKey: ProjectCategory.CLEAN_ENERGY,
        description: '342 000 tCO₂e credits issued. 100% programme execution confirmed.',
    },
    {
        date: 'Mar 2025',
        title: 'Gulf of Aden Blue Carbon Initiative',
        categoryKey: ProjectCategory.BLUE_CARBON,
        description: 'Art. 6.2 ITMO designation process initiated for seagrass and wetland conservation.',
    },
    {
        date: 'Jul 2025',
        title: 'National Carbon Registry: Design Phase',
        categoryKey: ProjectCategory.CARBON_TAX_POLICY,
        description: 'UNDP technical assistance secured. Registry architecture aligned with ACMI traceability spec.',
    },
    {
        date: 'Oct 2025',
        title: 'Somalia Carbon Market Conference',
        categoryKey: ProjectCategory.CARBON_TAX_POLICY,
        description: 'Somalia hosts 1st National Conference on Carbon Market Potential. Sheikh-Burao project launch.',
    },
    {
        date: 'Jan 2026',
        title: 'Berbera Green Port Pilot Begins',
        categoryKey: ProjectCategory.CLEAN_ENERGY,
        description: 'Solar cold-ironing infrastructure installation commences. First hydrogen bunkering tests.',
    },
    {
        date: 'Q2 2026',
        title: 'First Sovereign Credits Issued',
        categoryKey: ProjectCategory.CARBON_TAX_POLICY,
        description: 'Africgreen Sovereign Credits issued via national registry under Paris Art. 6.2 framework.',
    },
];

// ── Funding Partners ───────────────────────────────────────────────────────

export const fundingPartners: FundingPartner[] = [
    {
        id: 'gcf',
        name: 'Green Climate Fund',
        acronym: 'GCF',
        type: 'Multilateral',
        totalCommitmentUsd: 28_500_000,
        description: 'Readiness grants for Blue Carbon and national registry. Largest single contributor.',
    },
    {
        id: 'undp',
        name: 'United Nations Development Programme',
        acronym: 'UNDP',
        type: 'UN Agency',
        totalCommitmentUsd: 14_200_000,
        description: 'Technical assistance for carbon registry, ACMI readiness, and adaptation planning.',
    },
    {
        id: 'world_bank',
        name: 'World Bank FCPF',
        acronym: 'WB / FCPF',
        type: 'Multilateral',
        totalCommitmentUsd: 22_000_000,
        description: 'Forest Carbon Partnership Facility — finances Golis Range Reforestation (VCS).',
    },
    {
        id: 'adb',
        name: 'African Development Bank',
        acronym: 'AfDB',
        type: 'Regional Bank',
        totalCommitmentUsd: 8_000_000,
        description: 'Co-financing for savanna restoration and climate adaptation infrastructure.',
    },
    {
        id: 'eu_climate',
        name: 'European Union — Climate Action',
        acronym: 'EU',
        type: 'Bilateral',
        totalCommitmentUsd: 6_800_000,
        description: 'Green port transition co-financing and carbon market technical cooperation.',
    },
    {
        id: 'acmi',
        name: 'Africa Carbon Markets Initiative',
        acronym: 'ACMI',
        type: 'Regional Body',
        totalCommitmentUsd: 3_200_000,
        description: 'Certification pathway support enabling African sovereign credits to access compliance markets.',
    },
    {
        id: 'verra',
        name: 'Verra – Verified Carbon Standard',
        acronym: 'Verra',
        type: 'Standard Body',
        totalCommitmentUsd: 0,
        description: 'VCS and Blue Carbon methodology certification for Golis and Gulf of Aden projects.',
    },
    {
        id: 'gold_standard',
        name: 'Gold Standard Foundation',
        acronym: 'Gold Std',
        type: 'Standard Body',
        totalCommitmentUsd: 0,
        description: 'SDG impact certification for Clean Cooking Programme and Berbera Green Port.',
    },
];
