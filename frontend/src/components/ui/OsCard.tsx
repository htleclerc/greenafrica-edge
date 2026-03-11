import * as React from 'react';

interface OsCardProps {
    children: React.ReactNode;
    className?: string;
    padded?: boolean;
    hover?: boolean;
}

export function OsCard({ children, className = '', padded = true, hover = false }: OsCardProps) {
    return (
        <div
            className={`
                os-card
                ${padded ? 'p-5' : ''}
                ${hover ? 'hover:border-[var(--os-border-strong)] hover:bg-[var(--os-surface-2)] transition-colors cursor-pointer' : ''}
                ${className}
            `}
        >
            {children}
        </div>
    );
}

export function OsCardHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
    return (
        <div className="flex items-start justify-between mb-4">
            <div>
                <h3 className="text-sm font-semibold text-[var(--os-text-primary)]">{title}</h3>
                {subtitle && <p className="text-xs text-[var(--os-text-muted)] mt-0.5">{subtitle}</p>}
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
    );
}
