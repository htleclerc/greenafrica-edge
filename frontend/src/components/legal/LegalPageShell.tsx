import * as React from 'react';
import { Anchor } from 'lucide-react';

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
    return (
        <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--os-bg)' }}>
            {/* Top nav */}
            <header className="sticky top-0 z-10 border-b flex items-center justify-between px-6 py-3" style={{ backgroundColor: 'var(--os-surface)', borderColor: 'var(--os-border)' }}>
                <a href="/login" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                    <div className="w-8 h-8 rounded-xl bg-[#0B2818] border border-[#00D97E]/25 flex items-center justify-center">
                        <Anchor className="w-4 h-4 text-[#00D97E]" />
                    </div>
                    <span className="text-sm font-bold text-[var(--os-text-primary)]">
                        Africgreen<span className="text-[#00D97E]">OS</span>
                    </span>
                </a>
                <div className="flex items-center gap-4 text-[10px] text-[var(--os-text-muted)]">
                    <span className="font-mono">{version}</span>
                    <span>Effective {effectiveDate}</span>
                    <a href="/login" className="text-[#38BDF8] hover:underline font-semibold">← Back to Login</a>
                </div>
            </header>

            <div className="flex flex-1 max-w-7xl mx-auto w-full px-6 py-10 gap-10">
                {/* Sidebar — table of contents */}
                <aside className="hidden lg:flex flex-col gap-1 w-56 flex-shrink-0">
                    <div className="sticky top-20">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-3 px-2">Contents</p>
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
                            <span className="text-[10px] text-[var(--os-text-muted)]">OFFICIAL DOCUMENT · GOVERNMENT OF SOMALILAND</span>
                        </div>
                        <h1 className="text-3xl font-bold text-[var(--os-text-primary)] mb-2">{title}</h1>
                        <p className="text-sm text-[var(--os-text-muted)] max-w-2xl leading-relaxed">{subtitle}</p>
                        <div className="flex items-center gap-6 mt-5 text-[10px] text-[var(--os-text-muted)]">
                            <div><span className="font-semibold text-[var(--os-text-secondary)]">Version:</span> {version}</div>
                            <div><span className="font-semibold text-[var(--os-text-secondary)]">Effective date:</span> {effectiveDate}</div>
                            <div><span className="font-semibold text-[var(--os-text-secondary)]">Last updated:</span> {lastUpdated}</div>
                            <div><span className="font-semibold text-[var(--os-text-secondary)]">Jurisdiction:</span> Republic of Somaliland</div>
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
                                © 2025 Government of Somaliland · Ministry of Finance & Economic Development ·{' '}
                                <span className="text-[var(--os-text-secondary)]">Africgreen Maritime Carbon Intelligence Platform</span>
                            </p>
                            <div className="flex items-center gap-4">
                                <a href="/privacy-policy"  className="hover:text-[#38BDF8] transition-colors">Privacy Policy</a>
                                <a href="/terms-of-service" className="hover:text-[#38BDF8] transition-colors">Terms of Service</a>
                                <a href="/security-audit"  className="hover:text-[#38BDF8] transition-colors">Security Audit</a>
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
