import {
    VesselTaxStatus,
    TaxRegulation,
    VesselType,
    CiiRating,
} from '@/domain/carbonTax/carbonTaxConstants';

// ===== Types =====

export interface CarbonTaxKpi {
    key: string;
    value: string;
    change: string;
    positive: boolean;
}

export interface CarbonTaxRate {
    id: string;
    regulation: TaxRegulation;
    name: string;
    ratePerTon: number; // USD per tCO2
    applicability: string;
    effectiveDate: string;
    mandatory: boolean;
    authority: string;
}

export interface TaxVessel {
    id: string;
    name: string;
    flag: string;
    flagEmoji: string;
    type: VesselType;
    grossTonnage: number;
    co2Estimated: number; // tCO2
    taxAmount: number; // USD
    status: VesselTaxStatus;
    ciiRating: CiiRating;
    arrivalDate: string;
    imo: string;
}

export interface RevenueDataPoint {
    month: string;
    cargo: number;
    tanker: number;
    container: number;
    total: number;
}

export interface ComplianceRegulation {
    id: string;
    code: TaxRegulation;
    name: string;
    authority: string;
    description: string;
    keyRequirement: string;
    effectiveDate: string;
    penaltyNote: string;
    link: string;
}

// ===== KPIs =====

export const carbonTaxKpis: CarbonTaxKpi[] = [
    {
        key: 'vessels_tracked',
        value: '1,348',
        change: '+8.2% vs last month',
        positive: true,
    },
    {
        key: 'revenue_collected',
        value: '$4.21M',
        change: '+12.4% vs last month',
        positive: true,
    },
    {
        key: 'co2_assessed',
        value: '168,400 t',
        change: '+5.1% vs last month',
        positive: false,
    },
    {
        key: 'compliance_rate',
        value: '94.3%',
        change: '+1.8pts vs last month',
        positive: true,
    },
];

// ===== International Rates =====

export const carbonTaxRates: CarbonTaxRate[] = [
    {
        id: 'africgreen',
        regulation: TaxRegulation.AFRICGREEN_SOVEREIGN,
        name: 'Africgreen Sovereign Rate',
        ratePerTon: 25,
        applicability: 'All vessels >500 GT transiting Somaliland ZEE',
        effectiveDate: '2024-01-01',
        mandatory: true,
        authority: 'Somaliland Ministry of Finance / MoECC',
    },
    {
        id: 'imo_cii',
        regulation: TaxRegulation.IMO_CII,
        name: 'IMO Carbon Intensity Indicator (CII)',
        ratePerTon: 18,
        applicability: 'Ships >5,000 GT on international voyages',
        effectiveDate: '2023-01-01',
        mandatory: true,
        authority: 'International Maritime Organization (IMO)',
    },
    {
        id: 'eu_ets',
        regulation: TaxRegulation.EU_ETS,
        name: 'EU Emissions Trading System (EU ETS)',
        ratePerTon: 65,
        applicability: 'Ships >5,000 GT calling at EU ports (50% of voyages)',
        effectiveDate: '2024-01-01',
        mandatory: true,
        authority: 'European Union / European Commission',
    },
    {
        id: 'corsia',
        regulation: TaxRegulation.CORSIA,
        name: 'CORSIA Offset Standard',
        ratePerTon: 12,
        applicability: 'Voluntary offset by shipping operators (aviation-adapted)',
        effectiveDate: '2021-01-01',
        mandatory: false,
        authority: 'ICAO / Voluntary Carbon Markets',
    },
    {
        id: 'imo_marpol',
        regulation: TaxRegulation.IMO_MARPOL,
        name: 'IMO MARPOL Annex VI',
        ratePerTon: 20,
        applicability: 'All vessels >400 GT — SOx and NOx emission limits',
        effectiveDate: '2020-01-01',
        mandatory: true,
        authority: 'International Maritime Organization (IMO)',
    },
];

// ===== Vessel Data =====

export const taxVessels: TaxVessel[] = [
    {
        id: 'v001',
        name: 'MV BERBERA PRIDE',
        flag: 'Somaliland',
        flagEmoji: '🇸🇴',
        type: VesselType.CARGO,
        grossTonnage: 12400,
        co2Estimated: 320,
        taxAmount: 8000,
        status: VesselTaxStatus.PAID,
        ciiRating: CiiRating.B,
        arrivalDate: '2026-02-28',
        imo: 'IMO9876543',
    },
    {
        id: 'v002',
        name: 'MT GULF STAR',
        flag: 'Saudi Arabia',
        flagEmoji: '🇸🇦',
        type: VesselType.TANKER,
        grossTonnage: 85000,
        co2Estimated: 1850,
        taxAmount: 46250,
        status: VesselTaxStatus.OVERDUE,
        ciiRating: CiiRating.D,
        arrivalDate: '2026-02-20',
        imo: 'IMO7654321',
    },
    {
        id: 'v003',
        name: 'CMA CGM ATLAS',
        flag: 'France',
        flagEmoji: '🇫🇷',
        type: VesselType.CONTAINER,
        grossTonnage: 145000,
        co2Estimated: 2900,
        taxAmount: 72500,
        status: VesselTaxStatus.PENDING,
        ciiRating: CiiRating.C,
        arrivalDate: '2026-03-01',
        imo: 'IMO5432109',
    },
    {
        id: 'v004',
        name: 'EVERGREEN COSMOS',
        flag: 'Taiwan',
        flagEmoji: '🇹🇼',
        type: VesselType.CONTAINER,
        grossTonnage: 210000,
        co2Estimated: 4200,
        taxAmount: 105000,
        status: VesselTaxStatus.PAID,
        ciiRating: CiiRating.A,
        arrivalDate: '2026-03-02',
        imo: 'IMO4321098',
    },
    {
        id: 'v005',
        name: 'PACIFIC MERIDIAN',
        flag: 'Panama',
        flagEmoji: '🇵🇦',
        type: VesselType.BULK_CARRIER,
        grossTonnage: 76000,
        co2Estimated: 1520,
        taxAmount: 38000,
        status: VesselTaxStatus.APPROACHING,
        ciiRating: CiiRating.C,
        arrivalDate: '2026-03-04',
        imo: 'IMO3210987',
    },
    {
        id: 'v006',
        name: 'MSC ADEN',
        flag: 'Switzerland',
        flagEmoji: '🇨🇭',
        type: VesselType.CONTAINER,
        grossTonnage: 190000,
        co2Estimated: 3800,
        taxAmount: 95000,
        status: VesselTaxStatus.PAID,
        ciiRating: CiiRating.B,
        arrivalDate: '2026-03-01',
        imo: 'IMO2109876',
    },
    {
        id: 'v007',
        name: 'ORIENT TANKER III',
        flag: 'Singapore',
        flagEmoji: '🇸🇬',
        type: VesselType.TANKER,
        grossTonnage: 95000,
        co2Estimated: 2100,
        taxAmount: 52500,
        status: VesselTaxStatus.OVERDUE,
        ciiRating: CiiRating.E,
        arrivalDate: '2026-02-15',
        imo: 'IMO1098765',
    },
    {
        id: 'v008',
        name: 'HORIZON VENTURE',
        flag: 'Liberia',
        flagEmoji: '🇱🇷',
        type: VesselType.CARGO,
        grossTonnage: 34000,
        co2Estimated: 680,
        taxAmount: 17000,
        status: VesselTaxStatus.PENDING,
        ciiRating: CiiRating.C,
        arrivalDate: '2026-03-03',
        imo: 'IMO0987654',
    },
];

// ===== Revenue trend data =====

export const carbonTaxRevenue: RevenueDataPoint[] = [
    { month: 'Mar', cargo: 820000, tanker: 1200000, container: 900000, total: 2920000 },
    { month: 'Apr', cargo: 950000, tanker: 1350000, container: 1100000, total: 3400000 },
    { month: 'May', cargo: 870000, tanker: 1100000, container: 1050000, total: 3020000 },
    { month: 'Jun', cargo: 1100000, tanker: 1500000, container: 1300000, total: 3900000 },
    { month: 'Jul', cargo: 1050000, tanker: 1450000, container: 1200000, total: 3700000 },
    { month: 'Aug', cargo: 1200000, tanker: 1600000, container: 1400000, total: 4200000 },
    { month: 'Sep', cargo: 1150000, tanker: 1550000, container: 1350000, total: 4050000 },
    { month: 'Oct', cargo: 1300000, tanker: 1700000, container: 1500000, total: 4500000 },
    { month: 'Nov', cargo: 1250000, tanker: 1650000, container: 1450000, total: 4350000 },
    { month: 'Dec', cargo: 1400000, tanker: 1800000, container: 1600000, total: 4800000 },
    { month: 'Jan', cargo: 1350000, tanker: 1750000, container: 1550000, total: 4650000 },
    { month: 'Feb', cargo: 1450000, tanker: 1900000, container: 1700000, total: 5050000 },
];

// ===== Regulatory Framework =====

export const complianceRegulations: ComplianceRegulation[] = [
    {
        id: 'reg_africgreen',
        code: TaxRegulation.AFRICGREEN_SOVEREIGN,
        name: 'Africgreen Sovereign Framework',
        authority: 'Somaliland MoECC',
        description:
            'Maritime Environmental Levy applicable to all commercial vessels transiting or anchoring in Somaliland Exclusive Economic Zone (ZEE). Based on polluter-pays principle.',
        keyRequirement: 'Payment prior to Clearance issuance at Port of Berbera.',
        effectiveDate: '2024-01-01',
        penaltyNote: 'Clearance denied / vessel detained pending payment.',
        link: '#',
    },
    {
        id: 'reg_imo_cii',
        code: TaxRegulation.IMO_CII,
        name: 'IMO Carbon Intensity Indicator (CII)',
        authority: 'International Maritime Organization',
        description:
            'Annual rating system (A–E) measuring CO₂ emitted per cargo carried over distance. Ships rated D or E for 3 consecutive years must submit corrective action plans.',
        keyRequirement: 'Annual CII rating submission to flag State.',
        effectiveDate: '2023-01-01',
        penaltyNote: 'Mandatory corrective action plans; operational restrictions for low-rated vessels.',
        link: 'https://www.imo.org/en/OurWork/Environment/Pages/CII-ratings.aspx',
    },
    {
        id: 'reg_marpol',
        code: TaxRegulation.IMO_MARPOL,
        name: 'IMO MARPOL Annex VI',
        authority: 'International Maritime Organization',
        description:
            'International convention to minimize airborne pollution from ships. Sets limits on SOx and NOx emissions and mandates Energy Efficiency measures (EEXI, EEDI).',
        keyRequirement: 'SULFur cap: max 0.5% sulfur fuel globally; 0.1% in ECAs.',
        effectiveDate: '2020-01-01',
        penaltyNote: 'Port-State Control detention; fines by flag State.',
        link: 'https://www.imo.org/en/OurWork/Environment/Pages/Air-Pollution.aspx',
    },
    {
        id: 'reg_eu_ets',
        code: TaxRegulation.EU_ETS,
        name: 'EU Emissions Trading System — Maritime',
        authority: 'European Union / European Commission',
        description:
            'As of 2024, large ships calling at EU ports must surrender EU Allowances (EUAs) for 40% of their verified CO₂ emissions (scaling to 100% by 2026).',
        keyRequirement: 'Annual surrender of EUAs matching verified emissions.',
        effectiveDate: '2024-01-01',
        penaltyNote: '€100 per tCO₂ not covered, plus public reporting of non-compliance.',
        link: 'https://climate.ec.europa.eu/eu-action/eu-emissions-trading-system-eu-ets_en',
    },
    {
        id: 'reg_paris',
        code: TaxRegulation.CORSIA,
        name: 'Paris Agreement — Art. 6 (Carbon Markets)',
        authority: 'UNFCCC',
        description:
            'Establishes cooperative approaches for countries to meet NDCs through carbon credit trading. Africgreen aligns sovereign carbon offsets with Article 6.2 and 6.4 mechanisms.',
        keyRequirement: 'Corresponding adjustments to avoid double-counting of carbon credits.',
        effectiveDate: '2021-11-01',
        penaltyNote: 'Non-recognized credits cannot be used for NDC compliance.',
        link: 'https://unfccc.int/topics/carbon-credits',
    },
];
