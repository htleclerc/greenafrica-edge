import { AisVessel, VesselType, VesselStatus } from '@/domain/ais/aisConstants';

// Coordinates clustered around the Gulf of Aden / Somaliland Coast
export const mockAisVessels: AisVessel[] = [
    {
        id: 'VSL-001',
        name: 'MSC BERBERA',
        imo: '9483721',
        type: VesselType.CONTAINER,
        flagCode: 'LR', // Liberia
        speedKnot: 14.2,
        coordinates: { lat: 11.50, lng: 45.10 },
        status: VesselStatus.PAID,
        estimatedCo2: 125.4,
        dueAmountUsd: 0,
    },
    {
        id: 'VSL-002',
        name: 'GULF EXPLORER',
        imo: '9348122',
        type: VesselType.TANKER,
        flagCode: 'PA', // Panama
        speedKnot: 11.8,
        coordinates: { lat: 12.10, lng: 46.20 },
        status: VesselStatus.UNPAID,
        estimatedCo2: 310.2,
        dueAmountUsd: 4650,
    },
    {
        id: 'VSL-003',
        name: 'AFRICA STAR',
        imo: '9882314',
        type: VesselType.CARGO,
        flagCode: 'MH', // Marshall Islands
        speedKnot: 16.5,
        coordinates: { lat: 11.20, lng: 44.50 },
        status: VesselStatus.APPROACHING,
        estimatedCo2: 85.0,
        dueAmountUsd: 1275,
    },
    {
        id: 'VSL-004',
        name: 'HARGEISA PRIDE',
        imo: '9123456',
        type: VesselType.CONTAINER,
        flagCode: 'DJ', // Djibouti
        speedKnot: 15.0,
        coordinates: { lat: 10.90, lng: 45.40 },
        status: VesselStatus.PAID,
        estimatedCo2: 210.5,
        dueAmountUsd: 0,
    },
    {
        id: 'VSL-005',
        name: 'Somali Spirit',
        imo: '9765432',
        type: VesselType.CARGO,
        flagCode: 'SO', // Somalia
        speedKnot: 12.4,
        coordinates: { lat: 10.44, lng: 45.01 }, // At Berbera Port
        status: VesselStatus.PAID,
        estimatedCo2: 45.2,
        dueAmountUsd: 0,
    },
    {
        id: 'VSL-006',
        name: 'OCEAN VOYAGER',
        imo: '9554433',
        type: VesselType.TANKER,
        flagCode: 'GR', // Greece
        speedKnot: 10.2,
        coordinates: { lat: 12.80, lng: 47.10 },
        status: VesselStatus.UNPAID,
        estimatedCo2: 420.8,
        dueAmountUsd: 6312,
    },
    {
        id: 'VSL-007',
        name: 'RED SEA TRADER',
        imo: '9988776',
        type: VesselType.CARGO,
        flagCode: 'CN', // China
        speedKnot: 13.8,
        coordinates: { lat: 11.80, lng: 43.80 },
        status: VesselStatus.APPROACHING,
        estimatedCo2: 155.0,
        dueAmountUsd: 2325,
    },
    {
        id: 'VSL-008',
        name: 'GLOBAL LINK',
        imo: '9223344',
        type: VesselType.CONTAINER,
        flagCode: 'GB', // United Kingdom
        speedKnot: 18.0,
        coordinates: { lat: 12.50, lng: 44.20 },
        status: VesselStatus.UNPAID,
        estimatedCo2: 280.0,
        dueAmountUsd: 4200,
    }
];

export const radarStats = {
    totalVessels: mockAisVessels.length,
    activeAlerts: mockAisVessels.filter((v) => v.status === VesselStatus.UNPAID).length,
    revenueAtRiskUsd: mockAisVessels
        .filter((v) => v.status === VesselStatus.UNPAID)
        .reduce((sum, v) => sum + v.dueAmountUsd, 0),
    co2Tracked: mockAisVessels.reduce((sum, v) => sum + v.estimatedCo2, 0),
};
