'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Download, FileSpreadsheet } from 'lucide-react';

// ── Pure helpers (unit-tested) ────────────────────────────────────────────────

/** Build the download URL for the live settlement export endpoint. */
export function settlementExportHref(monthBucket: string | null): string {
    if (!monthBucket) return '/api/admin/reports/settlement';
    const p = new URLSearchParams({ from: monthBucket, to: monthBucket });
    return `/api/admin/reports/settlement?${p.toString()}`;
}

/** Last `count` month buckets (`YYYY-MM-01`), most recent first, from a reference date. */
export function recentMonthBuckets(now: Date, count = 12): string[] {
    const out: string[] = [];
    for (let i = 1; i <= count; i++) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        out.push(`${d.getUTCFullYear()}-${mm}-01`);
    }
    return out;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Live authority settlement export (Livrable L8). Downloads the real
 * concessionaire/sovereign split CSV from /api/admin/reports/settlement — the
 * endpoint is gated SUPERADMIN/FINANCE_ADMIN server-side, so a non-admin who
 * reaches this card gets a 403 on click rather than data.
 */
export function SettlementExportCard() {
    const t = useTranslations('GovReportsPage');
    const months = React.useMemo(() => recentMonthBuckets(new Date(), 12), []);
    const [selected, setSelected] = React.useState<string>(months[0] ?? '');

    const href = settlementExportHref(selected || null);

    return (
        <div className="os-card p-5 flex flex-col sm:flex-row sm:items-end gap-4">
            <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                    <FileSpreadsheet className="w-4 h-4 text-[#00D97E]" />
                    <h3 className="text-sm font-semibold text-[var(--os-text-primary)]">{t('settlement_title')}</h3>
                </div>
                <p className="text-[11px] text-[var(--os-text-muted)]">{t('settlement_desc')}</p>
            </div>

            <div className="flex items-end gap-2">
                <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)]">
                        {t('settlement_period_label')}
                    </span>
                    <select
                        value={selected}
                        onChange={(e) => setSelected(e.target.value)}
                        className="h-9 px-2 rounded-lg bg-[var(--os-surface-2)] border border-[var(--os-border)] text-xs text-[var(--os-text-primary)]"
                    >
                        <option value="">{t('settlement_all_periods')}</option>
                        {months.map((m) => (
                            <option key={m} value={m}>{m.slice(0, 7)}</option>
                        ))}
                    </select>
                </label>

                <a
                    href={href}
                    download
                    className="h-9 px-3 rounded-lg bg-[rgba(0,217,126,0.12)] text-[#00D97E] text-xs font-semibold flex items-center gap-1.5 hover:bg-[rgba(0,217,126,0.2)] transition-colors"
                >
                    <Download className="w-3.5 h-3.5" />
                    {t('settlement_download_csv')}
                </a>
            </div>
        </div>
    );
}
