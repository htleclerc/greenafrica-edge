'use client';

import { useTranslations } from 'next-intl';
import { Download, FileText, Database, Shield, LayoutDashboard, Clock, CheckCircle2, Archive } from 'lucide-react';
import { mockReports } from '@/mock/datas/reportsMock';
import { ReportType, ReportStatus } from '@/domain/report/reportConstants';

const TYPE_ICONS = {
    [ReportType.ANALYTIC]: LayoutDashboard,
    [ReportType.FINANCIAL]: Database,
    [ReportType.COMPLIANCE]: Shield,
    [ReportType.OPERATIONAL]: Clock,
};

const STATUS_ICONS = {
    [ReportStatus.AVAILABLE]: CheckCircle2,
    [ReportStatus.GENERATING]: Clock,
    [ReportStatus.ARCHIVED]: Archive,
};

const STATUS_COLORS = {
    [ReportStatus.AVAILABLE]: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    [ReportStatus.GENERATING]: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    [ReportStatus.ARCHIVED]: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
};

export function ReportsTableSection() {
    const t = useTranslations('Reports');

    return (
        <section className="py-20 px-6" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-12">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold tracking-widest uppercase mb-4">
                            <FileText className="w-3 h-3" />
                            {t('table_badge')}
                        </div>
                        <h2 className="text-3xl md:text-4xl font-bold mb-3" style={{ color: 'var(--ais-page-text)' }}>{t('table_title')}</h2>
                        <p className="max-w-xl" style={{ color: 'var(--ais-page-text-muted)' }}>{t('table_subtitle')}</p>
                    </div>
                </div>

                <div className="rounded-2xl overflow-hidden backdrop-blur-sm" style={{ backgroundColor: 'var(--ais-page-card)', border: '1px solid var(--ais-page-border)' }}>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--ais-page-border)', backgroundColor: 'var(--ais-page-surface)' }}>
                                    <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--ais-page-text-dim)' }}>{t('col_name')}</th>
                                    <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--ais-page-text-dim)' }}>{t('col_type')}</th>
                                    <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--ais-page-text-dim)' }}>{t('col_format')}</th>
                                    <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--ais-page-text-dim)' }}>{t('col_date')}</th>
                                    <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--ais-page-text-dim)' }}>{t('col_size')}</th>
                                    <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--ais-page-text-dim)' }}>{t('col_status')}</th>
                                    <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider text-right" style={{ color: 'var(--ais-page-text-dim)' }}>Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y" style={{ '--tw-divide-opacity': '1' } as React.CSSProperties}>
                                {mockReports.map((report) => {
                                    const TypeIcon = TYPE_ICONS[report.type];
                                    const StatusIcon = STATUS_ICONS[report.status];
                                    return (
                                        <tr key={report.id} className="transition-colors group" style={{ borderBottom: '1px solid var(--ais-page-border)' }}>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-transform">
                                                        <FileText className="w-4 h-4" />
                                                    </div>
                                                    <span className="text-sm font-medium" style={{ color: 'var(--ais-page-text)' }}>{t(report.titleCode)}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2" style={{ color: 'var(--ais-page-text-muted)' }}>
                                                    <TypeIcon className="w-3.5 h-3.5" />
                                                    <span className="text-xs">{t(`type_${report.type}`)}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase" style={{ backgroundColor: 'var(--ais-page-surface)', color: 'var(--ais-page-text-secondary)', border: '1px solid var(--ais-page-border)' }}>
                                                    {report.format}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-xs" style={{ color: 'var(--ais-page-text-muted)' }}>{report.date}</td>
                                            <td className="px-6 py-4 text-xs" style={{ color: 'var(--ais-page-text-muted)' }}>{report.size}</td>
                                            <td className="px-6 py-4">
                                                <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-bold uppercase ${STATUS_COLORS[report.status]}`}>
                                                    <StatusIcon className="w-3 h-3" />
                                                    {t(`status_${report.status}`)}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <button className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 text-xs font-bold transition-all transform active:scale-95 group/btn">
                                                    <Download className="w-3.5 h-3.5 group-hover/btn:translate-y-0.5 transition-transform" />
                                                    {t('btn_download')}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </section>
    );
}
