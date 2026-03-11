'use client';

import * as React from 'react';

interface OsInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    icon?: React.ReactNode;
    hint?: string;
}

export function OsInput({ label, error, icon, hint, className = '', ...props }: OsInputProps) {
    return (
        <div className="flex flex-col gap-1.5">
            {label && (
                <label className="text-xs font-medium text-[var(--os-text-secondary)] uppercase tracking-wider">
                    {label}
                </label>
            )}
            <div className="relative">
                {icon && (
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--os-text-muted)] pointer-events-none">
                        {icon}
                    </span>
                )}
                <input
                    {...props}
                    className={`
                        w-full h-11 rounded-xl
                        bg-[var(--os-surface-2)]
                        border ${error ? 'border-[#EF4444]/50' : 'border-[var(--os-border)]'}
                        text-sm text-[var(--os-text-primary)]
                        placeholder:text-[var(--os-text-muted)]
                        focus:outline-none focus:border-[#00D97E]/60 focus:ring-1 focus:ring-[#00D97E]/20
                        transition-colors
                        ${icon ? 'pl-10 pr-4' : 'px-4'}
                        ${className}
                    `}
                />
            </div>
            {error && <p className="text-xs text-[#EF4444]">{error}</p>}
            {hint && !error && <p className="text-xs text-[var(--os-text-muted)]">{hint}</p>}
        </div>
    );
}

interface OsSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    label?: string;
    error?: string;
    placeholder?: string;
    options: { value: string; label: string }[];
}

export function OsSelect({ label, error, placeholder, options, className = '', ...props }: OsSelectProps) {
    return (
        <div className="flex flex-col gap-1.5">
            {label && (
                <label className="text-xs font-medium text-[var(--os-text-secondary)] uppercase tracking-wider">
                    {label}
                </label>
            )}
            <select
                {...props}
                className={`
                    w-full h-11 rounded-xl px-4
                    bg-[var(--os-surface-2)]
                    border ${error ? 'border-[#EF4444]/50' : 'border-[var(--os-border)]'}
                    text-sm text-[var(--os-text-primary)]
                    focus:outline-none focus:border-[#00D97E]/60 focus:ring-1 focus:ring-[#00D97E]/20
                    transition-colors appearance-none cursor-pointer
                    ${className}
                `}
            >
                {placeholder && <option value="">{placeholder}</option>}
                {options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                ))}
            </select>
            {error && <p className="text-xs text-[#EF4444]">{error}</p>}
        </div>
    );
}
