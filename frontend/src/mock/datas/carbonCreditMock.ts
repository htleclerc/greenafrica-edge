import {
    CreditStandard,
    CreditStatus,
    ProjectType,
    CreditGrade,
} from '@/domain/carbonCredit/carbonCreditConstants';

// ===== Types =====

export interface CarbonCreditKpi {
    key: string;
    value: string;
    change: string;
    positive: boolean;
}

export interface MarketRate {
    id: string;
    standard: CreditStandard;
    name: string;
    grade: CreditGrade;
    pricePerTon: number; // USD per tCO2
    priceMin: number;
    priceMax: number;
    certifier: string;
    trend: 'UP' | 'DOWN' | 'STABLE';
    trendPct: number;
    description: string;
}

export interface CarbonProject {
    id: string;
    name: string;
    type: ProjectType;
    location: string;
    region: string;
    areaHa: number;
    creditsGenerated: number; // tCO2e per year
    creditsAvailable: number;
    standard: CreditStandard;
    status: CreditStatus;
    pricePerTon: number;
    startDate: string;
    description: string;
    sdgGoals: number[];
    progressPct: number;
}

export interface PortfolioDataPoint {
    month: string;
    issued: number;
    retired: number;
    available: number;
}

export interface CreditFramework {
    id: string;
    code: CreditStandard;
    name: string;
    authority: string;
    description: string;
    keyRequirement: string;
    effectiveDate: string;
    noteText: string;
    link: string;
}

// ===== KPIs =====

export const carbonCreditKpis: CarbonCreditKpi[] = [
    {
        key: 'credits_issued',
        value: '284,500',
        change: '+22.3% vs last year',
        positive: true,
    },
    {
        key: 'portfolio_value',
        value: '$3.96M',
        change: '+18.7% vs last year',
        positive: true,
    },
    {
        key: 'co2_sequestered',
        value: '284,500 t',
        change: '+22.3% vs last year',
        positive: true,
    },
    {
        key: 'active_projects',
        value: '5',
        change: '+2 this year',
        positive: true,
    },
];

// ===== Market Rates =====
// Sources: MSCI Global Carbon Credit Price Index 2025, Regreener.earth 2024,
// carboncredits.com, IMO global carbon pricing framework 2025

export const marketRates: MarketRate[] = [
    {
        id: 'africgreen_sovereign',
        standard: CreditStandard.AFRICGREEN_SOVEREIGN,
        name: 'Green Gate Sovereign Credits',
        grade: CreditGrade.AA,
        pricePerTon: 14.5,
        priceMin: 12,
        priceMax: 18,
        certifier: 'Somaliland MoECC',
        trend: 'UP',
        trendPct: 9.4,
        description: 'Sovereign-grade credits issued for Somaliland EEZ marine and terrestrial projects. Aligned with Paris Art. 6.2.',
    },
    {
        id: 'high_integrity',
        standard: CreditStandard.VCS,
        name: 'High-Integrity VCS (A–AAA / CCP)',
        grade: CreditGrade.AAA,
        pricePerTon: 14.8,
        priceMin: 10,
        priceMax: 22,
        certifier: 'Verra (ICVCM CCP Label)',
        trend: 'UP',
        trendPct: 21.3,
        description: 'Top-tier VCS credits carrying the ICVCM Core Carbon Principles label. Used by institutional buyers for high-integrity offsetting.',
    },
    {
        id: 'gold_standard',
        standard: CreditStandard.GOLD_STANDARD,
        name: 'Gold Standard — Nature & SDG',
        grade: CreditGrade.AA,
        pricePerTon: 11.2,
        priceMin: 8,
        priceMax: 16,
        certifier: 'Gold Standard Foundation',
        trend: 'STABLE',
        trendPct: 0.8,
        description: 'Certified credits with verified SDG co-benefits. Preferred by corporates with ESG reporting obligations.',
    },
    {
        id: 'mangrove_blue',
        standard: CreditStandard.VCS,
        name: 'Blue Carbon / Mangrove (VCS)',
        grade: CreditGrade.AAA,
        pricePerTon: 18.4,
        priceMin: 14,
        priceMax: 25,
        certifier: 'Verra / Plan Vivo',
        trend: 'UP',
        trendPct: 35.2,
        description: 'Highest-demand credit type. Mangroves store 3–5× more carbon than tropical forests and provide coastal resilience.',
    },
    {
        id: 'redd_plus',
        standard: CreditStandard.VCS,
        name: 'REDD+ (Avoided Deforestation)',
        grade: CreditGrade.BBB,
        pricePerTon: 2.7,
        priceMin: 1.5,
        priceMax: 5,
        certifier: 'Verra',
        trend: 'DOWN',
        trendPct: -18.5,
        description: 'Largest volume segment of the VCM. Under integrity scrutiny since 2023; prices remain depressed due to quality concerns.',
    },
    {
        id: 'article6',
        standard: CreditStandard.ARTICLE6,
        name: 'Paris Art. 6.4 — ITMOs',
        grade: CreditGrade.A,
        pricePerTon: 21.0,
        priceMin: 15,
        priceMax: 35,
        certifier: 'UNFCCC Supervisory Body',
        trend: 'UP',
        trendPct: 42.1,
        description: 'Internationally Transferred Mitigation Outcomes (ITMOs) under Art. 6.4. First ITMO transactions expected 2025–2026.',
    },
];

// ===== Somaliland Carbon Projects =====

export const carbonProjects: CarbonProject[] = [
    {
        id: 'golis_reforestation',
        name: 'Golis Range Reforestation',
        type: ProjectType.REFORESTATION,
        location: 'Golis Mountain Range, Somaliland',
        region: 'Togdheer / Sahil',
        areaHa: 48000,
        creditsGenerated: 96000,
        creditsAvailable: 42000,
        standard: CreditStandard.VCS,
        status: CreditStatus.AVAILABLE,
        pricePerTon: 14.5,
        startDate: '2024-01-01',
        description: 'Restoration of degraded highland forest in the Golis range, targeting 48,000 ha of endemic dry-montane forest. Supported by carbon stock assessment (SCCWG 2019).',
        sdgGoals: [13, 15, 1, 8],
        progressPct: 34,
    },
    {
        id: 'berbera_mangrove',
        name: 'Berbera Mangrove Sanctuary',
        type: ProjectType.MANGROVE,
        location: 'Gulf of Aden Coast, Berbera',
        region: 'Sahil',
        areaHa: 8200,
        creditsGenerated: 57400,
        creditsAvailable: 57400,
        standard: CreditStandard.GOLD_STANDARD,
        status: CreditStatus.ISSUED,
        pricePerTon: 18.4,
        startDate: '2023-06-01',
        description: 'Protection and expansion of mangrove ecosystems along the Gulf of Aden coast. Mangroves deliver coastal protection, fish nurseries, and 3–5× the carbon density of tropical forests.',
        sdgGoals: [13, 14, 1, 11],
        progressPct: 61,
    },
    {
        id: 'gulf_blue_carbon',
        name: 'Gulf of Aden Blue Carbon Initiative',
        type: ProjectType.BLUE_CARBON,
        location: 'Somaliland EEZ — Coastal Wetlands',
        region: 'Awdal / Sahil',
        areaHa: 15000,
        creditsGenerated: 82500,
        creditsAvailable: 0,
        standard: CreditStandard.ARTICLE6,
        status: CreditStatus.PENDING_VERIFICATION,
        pricePerTon: 21.0,
        startDate: '2025-03-01',
        description: 'Marine seagrass meadows and coastal wetland conservation within the Somaliland ZEE. First Art. 6.2-compliant maritime carbon project in the Horn of Africa.',
        sdgGoals: [13, 14, 1, 17],
        progressPct: 18,
    },
    {
        id: 'hargeisa_clean_cooking',
        name: 'Hargeisa Clean Cooking Programme',
        type: ProjectType.CLEAN_COOKING,
        location: 'Hargeisa & Peri-urban Areas',
        region: 'Maroodi Jeex',
        areaHa: 0,
        creditsGenerated: 34200,
        creditsAvailable: 34200,
        standard: CreditStandard.GOLD_STANDARD,
        status: CreditStatus.ISSUED,
        pricePerTon: 11.2,
        startDate: '2023-01-01',
        description: 'Distribution of improved cookstoves to 28,500 households. Reduces firewood consumption by 60%, reducing deforestation pressure and indoor air pollution. Aligned with COP29 ACMI clean cooking goals.',
        sdgGoals: [3, 5, 7, 13],
        progressPct: 100,
    },
    {
        id: 'sheikh_burao_savanna',
        name: 'Sheikh-Burao Savanna Restoration',
        type: ProjectType.AVOIDED_DEFORESTATION,
        location: 'Central Plateau, Togdheer',
        region: 'Togdheer',
        areaHa: 72000,
        creditsGenerated: 54000,
        creditsAvailable: 0,
        standard: CreditStandard.ACMI,
        status: CreditStatus.PENDING_VERIFICATION,
        pricePerTon: 9.5,
        startDate: '2025-10-01',
        description: 'Avoided grassland degradation through participatory rangeland management. Eligible for ACMI-aligned certification. Aligns with Somalia National Conference on Carbon Market Potential (Oct 2025).',
        sdgGoals: [13, 15, 2, 8],
        progressPct: 8,
    },
];

// ===== Portfolio Time Series (12 months) =====

export const portfolioTimeSeries: PortfolioDataPoint[] = [
    { month: 'Mar', issued: 18000, retired: 4200, available: 13800 },
    { month: 'Apr', issued: 24000, retired: 5800, available: 18200 },
    { month: 'May', issued: 28500, retired: 7100, available: 21400 },
    { month: 'Jun', issued: 35000, retired: 9400, available: 25600 },
    { month: 'Jul', issued: 42000, retired: 11200, available: 30800 },
    { month: 'Aug', issued: 56000, retired: 14800, available: 41200 },
    { month: 'Sep', issued: 68000, retired: 18500, available: 49500 },
    { month: 'Oct', issued: 88000, retired: 22000, available: 66000 },
    { month: 'Nov', issued: 112000, retired: 28400, available: 83600 },
    { month: 'Dec', issued: 168000, retired: 34600, available: 133400 },
    { month: 'Jan', issued: 224000, retired: 41200, available: 182800 },
    { month: 'Feb', issued: 284500, retired: 51200, available: 233300 },
];

// ===== Regulatory Frameworks =====

export const creditFrameworks: CreditFramework[] = [
    {
        id: 'framework_article6',
        code: CreditStandard.ARTICLE6,
        name: 'Paris Agreement — Article 6',
        authority: 'UNFCCC',
        description:
            'Establishes the legal basis for international carbon market cooperation. Art. 6.2 governs bilateral ITMO transfers (Corresponding Adjustments mandatory). Art. 6.4 creates a new UN-supervised crediting mechanism open to all parties.',
        keyRequirement: 'Corresponding Adjustments applied to avoid double-counting. Host country authorization required for all Art. 6.2 transfers.',
        effectiveDate: '2021-11-01',
        noteText: 'First ITMOs traded between Switzerland and Ghana (2020). Somaliland aligns sovereign credits with Art. 6.2 framework.',
        link: 'https://unfccc.int/topics/carbon-credits',
    },
    {
        id: 'framework_vcs',
        code: CreditStandard.VCS,
        name: 'Verified Carbon Standard (VCS) — Verra',
        authority: 'Verra (Washington D.C.)',
        description:
            'World\'s largest voluntary carbon market standard. Over 1,900 certified projects globally; 1.2 billion credits issued. Verra\'s REDD+ and Blue Carbon methodologies are the most widely used. First VCS project with ICVCM CCP label issued for Burkina Faso reforestation (2024).',
        keyRequirement: 'Third-party VVB validation and verification. Annual monitoring reports submitted to Verra registry.',
        effectiveDate: '2006-01-01',
        noteText: 'ICVCM Core Carbon Principles (CCP) label now required for top-grade VCS credits used in compliance markets.',
        link: 'https://verra.org/programs/verified-carbon-standard/',
    },
    {
        id: 'framework_gold',
        code: CreditStandard.GOLD_STANDARD,
        name: 'Gold Standard — Impact Labels',
        authority: 'Gold Standard Foundation (Geneva)',
        description:
            'Premium standard certifying credits that deliver verified SDG co-benefits beyond carbon. Co-developed with WWF and NGOs. Used extensively for clean cooking, renewable energy, and ecosystem projects across Africa.',
        keyRequirement: 'SDG impact assessment and stakeholder consultation mandatory. Multi-stakeholder methodology design.',
        effectiveDate: '2003-01-01',
        noteText: 'Rwanda partners with Gold Standard & GenZero on Art. 6-compliant pipeline. African Union developing own "African Gold Standard".',
        link: 'https://www.goldstandard.org/',
    },
    {
        id: 'framework_icvcm',
        code: CreditStandard.VCS,
        name: 'ICVCM — Core Carbon Principles (CCP)',
        authority: 'Integrity Council for the Voluntary Carbon Market',
        description:
            'Framework of 10 principles and assessment criteria to identify high-integrity carbon credits. The CCP label distinguishes reliable offsets from questionable ones, driving premiums of $5–$8/tCO₂ vs lower-rated credits.',
        keyRequirement: 'Credits must meet all 10 Core Carbon Principles. Standard must receive ICVCM programme-level approval before credits can carry the CCP label.',
        effectiveDate: '2023-07-01',
        noteText: 'Spread between CCP-labeled and non-labeled credits widened to $5.1/tCO₂ in 2025 (MSCI Index).',
        link: 'https://icvcm.org/',
    },
    {
        id: 'framework_acmi',
        code: CreditStandard.ACMI,
        name: 'Africa Carbon Markets Initiative (ACMI)',
        authority: 'African Union / SE4All / COP27',
        description:
            'Launched at COP27 (Sharm el-Sheikh, 2022). Target: 300 million carbon credits produced annually across Africa by 2030. Roadmap includes a pipeline of 16+ nations and a pan-African carbon credit exchange. Somaliland aligns sovereign projects with ACMI eligibility criteria.',
        keyRequirement: 'National-level carbon registry. Traceability from project to credit issuance. Alignment with Article 6 CAs.',
        effectiveDate: '2022-11-01',
        noteText: 'Somalia to host its 1st National Conference on Carbon Market Potential (Oct 2025). First Somali credits targeted for issuance by 2026.',
        link: 'https://africacarbonmarkets.org/',
    },
];
