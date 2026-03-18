'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Navbar } from '@/components/layout/Navbar';

interface Section {
    id: string;
    title: string;
}

interface LegalPageShellProps {
    title: string;
    subtitle: string;
    version: string;
    effectiveDate: string;
    lastUpdated: string;
    badgeLabel: string;
    badgeColor: string;
    sections: Section[];
    children: React.ReactNode;
}

export function LegalPageShell({
    title, subtitle, version, effectiveDate, lastUpdated,
    badgeLabel, badgeColor, sections, children,
}: LegalPageShellProps) {
    const t = useTranslations('Legal');
    const searchParams = useSearchParams();
    const fromAuth = searchParams.get('from') === 'auth';

    return (
        <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--os-bg)' }}>
            {fromAuth ? (
                /* Back-to-login bar when coming from auth pages */
                <header className="sticky top-0 z-10 border-b flex items-center justify-between px-4 sm:px-6 py-3" style={{ backgroundColor: 'var(--os-surface)', borderColor: 'var(--os-border)' }}>
                    <a href="/login" className="flex items-center gap-2 text-sm font-semibold text-[#38BDF8] hover:text-[#60CAFF] transition-colors">
                        <ArrowLeft className="w-4 h-4" />
                        {t('back_to_login')}
                    </a>
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center flex-shrink-0">
                            <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
                                <path d="M12 22C12 22 20 18 20 12C20 6 12 2 12 2C12 2 4 6 4 12C4 18 12 22 12 22Z" />
                            </svg>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-sm font-bold tracking-tight leading-tight text-[var(--os-text-primary)]">
                                AIS Portal
                            </span>
                            <span className="text-[9px] font-medium tracking-widest uppercase leading-tight text-emerald-500/70">
                                AFRICGREEN INITIATIVE
                            </span>
                        </div>
                    </div>
                </header>
            ) : (
                /* Public Navbar when coming from the website */
                <Navbar />
            )}

            <div className={`flex flex-1 max-w-7xl mx-auto w-full px-6 py-10 gap-10 ${!fromAuth ? 'pt-24' : ''}`}>
                {/* Sidebar — table of contents */}
                <aside className="hidden lg:flex flex-col gap-1 w-56 flex-shrink-0">
                    <div className="sticky top-20">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-3 px-2">{t('contents_label')}</p>
                        {sections.map((s, i) => (
                            <a
                                key={s.id}
                                href={`#${s.id}`}
                                className="flex items-start gap-2 px-2 py-1.5 rounded-lg text-xs text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:bg-[var(--os-surface-2)] transition-colors group"
                            >
                                <span className="text-[9px] font-bold tabular-nums mt-0.5 text-[var(--os-text-muted)] group-hover:text-[#00D97E] transition-colors w-4 flex-shrink-0">
                                    {String(i + 1).padStart(2, '0')}
                                </span>
                                <span className="leading-tight">{s.title}</span>
                            </a>
                        ))}
                    </div>
                </aside>

                {/* Main content */}
                <main className="flex-1 min-w-0">
                    {/* Document header */}
                    <div className="mb-10 pb-8 border-b" style={{ borderColor: 'var(--os-border)' }}>
                        <div className="flex items-center gap-3 mb-4">
                            <span
                                className="text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-widest"
                                style={{ backgroundColor: `${badgeColor}15`, color: badgeColor, border: `1px solid ${badgeColor}30` }}
                            >
                                {badgeLabel}
                            </span>
                            <span className="text-[10px] text-[var(--os-text-muted)]">{t('official_document')}</span>
                        </div>
                        <h1 className="text-3xl font-bold text-[var(--os-text-primary)] mb-2">{title}</h1>
                        <p className="text-sm text-[var(--os-text-muted)] max-w-2xl leading-relaxed">{subtitle}</p>
                        <div className="flex items-center gap-6 mt-5 text-[10px] text-[var(--os-text-muted)]">
                            <div><span className="font-semibold text-[var(--os-text-secondary)]">{t('version_label')}</span> {version}</div>
                            <div><span className="font-semibold text-[var(--os-text-secondary)]">{t('effective_date_label')}</span> {effectiveDate}</div>
                            <div><span className="font-semibold text-[var(--os-text-secondary)]">{t('last_updated_label')}</span> {lastUpdated}</div>
                            <div><span className="font-semibold text-[var(--os-text-secondary)]">{t('jurisdiction_label')}</span> {t('jurisdiction_value')}</div>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="legal-content">
                        {children}
                    </div>

                    {/* Footer */}
                    <div className="mt-12 pt-6 border-t" style={{ borderColor: 'var(--os-border)' }}>
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-[10px] text-[var(--os-text-muted)]">
                            <p>
                                {t('footer_copyright')} ·{' '}
                                <span className="text-[var(--os-text-secondary)]">{t('footer_platform_name')}</span>
                            </p>
                            <div className="flex items-center gap-4">
                                <a href={`/privacy-policy${fromAuth ? '?from=auth' : ''}`}  className="hover:text-[#38BDF8] transition-colors">{t('footer_privacy_policy')}</a>
                                <a href={`/terms-of-service${fromAuth ? '?from=auth' : ''}`} className="hover:text-[#38BDF8] transition-colors">{t('footer_terms_of_service')}</a>
                                <a href={`/security-audit${fromAuth ? '?from=auth' : ''}`}  className="hover:text-[#38BDF8] transition-colors">{t('footer_security_audit')}</a>
                            </div>
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}

// ── Legal section component ───────────────────────────────────────────────────

export function LegalSection({ id, number, title, children }: {
    id: string;
    number: string;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <section id={id} className="mb-10 scroll-mt-20">
            <div className="flex items-center gap-3 mb-4">
                <span className="text-[10px] font-bold tabular-nums text-[#00D97E] bg-[rgba(0,217,126,0.08)] px-2 py-1 rounded-lg">{number}</span>
                <h2 className="text-base font-bold text-[var(--os-text-primary)]">{title}</h2>
            </div>
            <div className="flex flex-col gap-3 pl-0">
                {children}
            </div>
        </section>
    );
}

export function LegalP({ children }: { children: React.ReactNode }) {
    return <p className="text-sm text-[var(--os-text-secondary)] leading-relaxed">{children}</p>;
}

export function LegalUl({ children }: { children: React.ReactNode }) {
    return (
        <ul className="flex flex-col gap-1.5 pl-5">
            {children}
        </ul>
    );
}

export function LegalLi({ children }: { children: React.ReactNode }) {
    return (
        <li className="text-sm text-[var(--os-text-secondary)] leading-relaxed relative before:absolute before:-left-4 before:top-2 before:w-1.5 before:h-1.5 before:rounded-full before:bg-[#00D97E]/40">
            {children}
        </li>
    );
}

export function LegalHighlight({ children }: { children: React.ReactNode }) {
    return (
        <div className="p-4 rounded-xl border-l-2 border-[#00D97E]/60 bg-[rgba(0,217,126,0.04)]">
            <p className="text-sm text-[var(--os-text-secondary)] leading-relaxed">{children}</p>
        </div>
    );
}

export function LegalWarning({ children }: { children: React.ReactNode }) {
    return (
        <div className="p-4 rounded-xl border-l-2 border-[#F59E0B]/60 bg-[rgba(245,158,11,0.04)]">
            <p className="text-sm text-[var(--os-text-secondary)] leading-relaxed">{children}</p>
        </div>
    );
}

export function LegalTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
    return (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--os-border)' }}>
            <table className="w-full text-xs">
                <thead>
                    <tr className="border-b" style={{ backgroundColor: 'var(--os-surface-2)', borderColor: 'var(--os-border)' }}>
                        {headers.map((h) => (
                            <th key={h} className="px-4 py-2.5 text-left font-bold uppercase tracking-widest text-[var(--os-text-muted)] whitespace-nowrap text-[10px]">{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-[var(--os-surface-2)] transition-colors" style={{ borderColor: 'var(--os-border)' }}>
                            {row.map((cell, j) => (
                                <td key={j} className="px-4 py-3 text-[var(--os-text-secondary)] leading-relaxed">{cell}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
