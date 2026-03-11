import * as React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface OsStatCardProps {
    label: string;
    value: string;
    delta?: number;         // % change, positive = up, negative = down
    unit?: string;          // e.g. 't', 'USD', '%'
    icon?: React.ReactNode;
    highlight?: boolean;    // yellow accent border-top
    className?: string;
}

export function OsStatCard({ label, value, delta, unit, icon, highlight = false, className = '' }: OsStatCardProps) {
    const isPositive = delta !== undefined && delta >= 0;

    return (
        <div className={`
            os-card p-4
            ${highlight ? 'border-t-2 border-t-[#F59E0B]' : ''}
            ${className}
        `}>
            <div className="flex items-start justify-between mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
                    {label}
                </span>
                {icon && (
                    <span className="text-[var(--os-text-muted)]">{icon}</span>
                )}
            </div>
            <div className="flex items-end gap-2">
                <span className="text-2xl font-bold text-[var(--os-text-primary)] leading-none tabular-nums">
                    {value}
                </span>
                {unit && (
                    <span className="text-xs text-[var(--os-text-muted)] mb-0.5">{unit}</span>
                )}
            </div>
            {delta !== undefined && (
                <div className={`flex items-center gap-1 mt-1.5 text-xs font-medium ${isPositive ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>
                    {isPositive
                        ? <TrendingUp className="w-3 h-3" />
                        : <TrendingDown className="w-3 h-3" />
                    }
                    {isPositive ? '+' : ''}{delta}%
                </div>
            )}
        </div>
    );
}
