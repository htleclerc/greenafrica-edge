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
        <section className="py-20 px-6 bg-[#0A1110]">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-12">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold tracking-widest uppercase mb-4">
                            <FileText className="w-3 h-3" />
                            {t('table_badge')}
                        </div>
                        <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">{t('table_title')}</h2>
                        <p className="text-slate-400 max-w-xl">{t('table_subtitle')}</p>
                    </div>
                </div>

                <div className="bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden backdrop-blur-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-white/5 bg-white/[0.01]">
                                    <th className="px-6 py-4 text-[11px] font-bold text-slate-500 uppercase tracking-wider">{t('col_name')}</th>
                                    <th className="px-6 py-4 text-[11px] font-bold text-slate-500 uppercase tracking-wider">{t('col_type')}</th>
                                    <th className="px-6 py-4 text-[11px] font-bold text-slate-500 uppercase tracking-wider">{t('col_format')}</th>
                                    <th className="px-6 py-4 text-[11px] font-bold text-slate-500 uppercase tracking-wider">{t('col_date')}</th>
                                    <th className="px-6 py-4 text-[11px] font-bold text-slate-500 uppercase tracking-wider">{t('col_size')}</th>
                                    <th className="px-6 py-4 text-[11px] font-bold text-slate-500 uppercase tracking-wider">{t('col_status')}</th>
                                    <th className="px-6 py-4 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {mockReports.map((report) => {
                                    const TypeIcon = TYPE_ICONS[report.type];
                                    const StatusIcon = STATUS_ICONS[report.status];
                                    return (
                                        <tr key={report.id} className="hover:bg-white/[0.03] transition-colors group">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-transform">
                                                        <FileText className="w-4 h-4" />
                                                    </div>
                                                    <span className="text-sm font-medium text-white">{t(report.titleCode)}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2 text-slate-400">
                                                    <TypeIcon className="w-3.5 h-3.5" />
                                                    <span className="text-xs">{t(`type_${report.type}`)}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-white/5 text-slate-300 border border-white/10 uppercase">
                                                    {report.format}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-xs text-slate-400">{report.date}</td>
                                            <td className="px-6 py-4 text-xs text-slate-400">{report.size}</td>
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
