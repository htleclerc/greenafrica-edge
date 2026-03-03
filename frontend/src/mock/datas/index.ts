import { ShipType } from '@/domain/simulation/simulationEngine';

// ===== Landing Page Mocks =====

export const emissionTrendsData = [
    { month: 'Jan', value: 30 },
    { month: 'Feb', value: 45 },
    { month: 'Mar', value: 35 },
    { month: 'Apr', value: 50 },
    { month: 'May', value: 40 },
    { month: 'Jun', value: 60 },
    { month: 'Jul', value: 55 },
    { month: 'Aug', value: 70 },
    { month: 'Sep', value: 65 },
    { month: 'Oct', value: 80 },
    { month: 'Nov', value: 75 },
    { month: 'Dec', value: 90 },
];

export const assetValuationData = [
    { quarter: 'Q1', value: 20 },
    { quarter: 'Q2', value: 30 },
    { quarter: 'Q3', value: 28 },
    { quarter: 'Q4', value: 40 },
];

export const faqItems = [
    {
        question: "How does the platform handle data sovereignty?",
        answer: "Our platform ensures complete data sovereignty by providing localized hosting options within your national borders. All environmental data remains under the exclusive control and ownership of your state institutions, compliant with local security and privacy regulations."
    },
    {
        question: "Is the emission calculation methodology IPCC compliant?",
        answer: "Yes, all emission calculation engines are strictly aligned with the Intergovernmental Panel on Climate Change (IPCC) 2006 Guidelines for National Greenhouse Gas Inventories, specifically utilizing Tier 2 approaches with country-specific emission factors where available."
    },
    {
        question: "Can we integrate existing legacy systems?",
        answer: "Absolutely. Africgreen features a robust, API-first interoperability layer designed to seamlessly connect with existing government IT infrastructure, legacy environmental databases, and international reporting frameworks."
    },
    {
        question: "What support is available for staff training?",
        answer: "We provide comprehensive onboarding programs including dedicated training workshops for ministry staff, extensive multilingual documentation, and a 24/7 dedicated support portal to ensure smooth institutional adoption."
    }
];

// ===== Calculator Mocks =====

export const calculatorOptions = {
    activityTypes: [
        { id: "stationary", label: "Stationary Combustion" },
        { id: "mobile", label: "Mobile Combustion" },
        { id: "fugitive", label: "Fugitive Emissions" },
    ],
    fuelSources: [
        { id: "diesel_ind", label: "Diesel (Industrial)", factor: 2.68 },
        { id: "petrol", label: "Petrol", factor: 2.31 },
        { id: "natural_gas", label: "Natural Gas", factor: 0.202 },
    ],
    scopeCategories: [
        { id: "scope1", label: "Scope 1 (Direct)" },
        { id: "scope2", label: "Scope 2 (Indirect)" },
        { id: "scope3", label: "Scope 3 (Value Chain)" },
    ],
    regions: [
        { id: "accra", label: "Accra Central HQ" },
        { id: "kumasi", label: "Kumasi Regional Office" },
        { id: "tamale", label: "Tamale Northern Hub" },
    ]
};

export const offsetTransactions = [
    {
        id: "#TRX-88291",
        date: "Oct 12, 2024",
        description: "Volta Reforestation Credit",
        offset: "120 tCO2e",
        amount: "$1,800.00",
        status: "Paid",
        certificate: "CRT-2024-A"
    },
    {
        id: "#TRX-88104",
        date: "Sep 28, 2024",
        description: "Solar Grid Contribution",
        offset: "450 tCO2e",
        amount: "$6,750.00",
        status: "Paid",
        certificate: "CRT-2024-B"
    }
];

// ===== Simulation Section Mocks =====

export const simulationDefaults = {
    shipsPerMonth: 500,
    avgEmissionsPerShip: 50,
    taxRatePerTon: 25,
    shipType: ShipType.CARGO,
};

export const companySimulationDefaults = {
    fleetSize: 15,
    daysInZeePerShip: 3,
    taxRatePerTon: 25,
    shipType: ShipType.CARGO,
};

export const simulationSliderRanges = {
    shipsPerMonth: { min: 10, max: 1000, step: 10 },
    avgEmissionsPerShip: { min: 1, max: 200, step: 1 },
    taxRatePerTon: { min: 1, max: 100, step: 1 },
    fleetSize: { min: 1, max: 100, step: 1 },
    daysInZeePerShip: { min: 1, max: 15, step: 1 },
};

// ===== Sovereign Section Mocks =====

export const sovereignStats = {
    carbonRevenue: '$4.2M',
    carbonRevenueSubtitle: '+12% vs last quarter',
    activeVessels: '1,348',
    activeVesselsSubtitle: 'In tracking area',
};
