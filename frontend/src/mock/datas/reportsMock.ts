import { ReportItem, ReportType, ReportFormat, ReportStatus, ReportTrend } from '@/domain/report/reportConstants';

export const mockReports: ReportItem[] = [
    {
        id: 'REP-001',
        titleCode: 'report_annual_environmental_2025',
        type: ReportType.COMPLIANCE,
        format: ReportFormat.PDF,
        status: ReportStatus.AVAILABLE,
        date: '2025-12-31',
        size: '4.2 MB',
        downloadUrl: '#',
    },
    {
        id: 'REP-002',
        titleCode: 'report_revenue_q4_2025',
        type: ReportType.FINANCIAL,
        format: ReportFormat.PDF,
        status: ReportStatus.AVAILABLE,
        date: '2026-01-05',
        size: '1.8 MB',
        downloadUrl: '#',
    },
    {
        id: 'REP-003',
        titleCode: 'report_vessel_traffic_jan_2026',
        type: ReportType.OPERATIONAL,
        format: ReportFormat.CSV,
        status: ReportStatus.AVAILABLE,
        date: '2026-02-01',
        size: '850 KB',
        downloadUrl: '#',
    },
    {
        id: 'REP-004',
        titleCode: 'report_carbon_emission_trends_2025',
        type: ReportType.ANALYTIC,
        format: ReportFormat.PDF,
        status: ReportStatus.AVAILABLE,
        date: '2026-01-15',
        size: '3.5 MB',
        downloadUrl: '#',
    },
];

export const reportTrends: ReportTrend[] = [
    { period: 'Sep', compliance: 82, revenue: 1200000, vessels: 450 },
    { period: 'Oct', compliance: 85, revenue: 1450000, vessels: 480 },
    { period: 'Nov', compliance: 88, revenue: 1680000, vessels: 520 },
    { period: 'Dec', compliance: 92, revenue: 2100000, vessels: 580 },
    { period: 'Jan', compliance: 90, revenue: 1950000, vessels: 550 },
    { period: 'Feb', compliance: 94, revenue: 2300000, vessels: 610 },
];
