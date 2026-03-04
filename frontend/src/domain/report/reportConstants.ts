export enum ReportType {
    ANALYTIC = 'analytic',
    FINANCIAL = 'financial',
    COMPLIANCE = 'compliance',
    OPERATIONAL = 'operational',
}

export enum ReportFormat {
    PDF = 'PDF',
    CSV = 'CSV',
    XLSX = 'XLSX',
}

export enum ReportStatus {
    AVAILABLE = 'available',
    GENERATING = 'generating',
    ARCHIVED = 'archived',
}

export interface ReportItem {
    id: string;
    titleCode: string; // Translation key
    type: ReportType;
    format: ReportFormat;
    status: ReportStatus;
    date: string;
    size: string;
    downloadUrl: string;
}

export interface ReportTrend {
    period: string;
    compliance: number;
    revenue: number;
    vessels: number;
}
