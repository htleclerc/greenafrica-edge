export enum VesselType {
    CARGO = 'Cargo',
    TANKER = 'Tanker',
    CONTAINER = 'Container',
}

export enum VesselStatus {
    PAID = 'Paid',
    UNPAID = 'Unpaid',
    APPROACHING = 'Approaching',
}

export interface Coordinates {
    lat: number;
    lng: number;
}

export interface AisVessel {
    id: string;
    name: string;
    imo: string;
    type: VesselType;
    flagCode: string; // ISO 3166-1 alpha-2 code (e.g., 'LR', 'PA', 'MH')
    speedKnot: number;
    coordinates: Coordinates;
    status: VesselStatus;
    estimatedCo2: number;
    dueAmountUsd: number;
}
