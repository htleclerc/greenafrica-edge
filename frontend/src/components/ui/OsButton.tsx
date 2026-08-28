'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type ButtonSize    = 'sm' | 'md' | 'lg';

const VARIANT_STYLES: Record<ButtonVariant, string> = {
    // #00D97E etait le vert de Navy SOMBRE, pose en dur : le bouton primaire
    // restait vert sur un ecran bleu clair, et vert-Navy sur Emerald. Les
    // jetons portent la bonne valeur dans chaque combinaison, et
    // --os-on-primary le contraste qui va avec (sombre sur vert vif, blanc
    // sur marine).
    primary:   'bg-[var(--os-brand-green)] text-[var(--os-on-primary)] font-semibold transition-opacity hover:opacity-90',
    secondary: 'bg-[var(--os-surface-2)] hover:bg-[var(--os-surface-3)] text-[var(--os-text-primary)] border border-[var(--os-border-strong)]',
    ghost:     'bg-transparent hover:bg-[var(--os-surface-2)] text-[var(--os-text-secondary)] hover:text-[var(--os-text-primary)]',
    danger:    'bg-[#EF4444]/10 hover:bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/25',
    outline:   'bg-transparent hover:bg-[var(--os-surface-2)] text-[var(--os-brand-cyan)] border border-[var(--os-brand-green)]/40 hover:border-[var(--os-brand-green)]/70',
};

const SIZE_STYLES: Record<ButtonSize, string> = {
    sm: 'h-8  px-3 text-xs  gap-1.5 rounded-lg',
    md: 'h-10 px-4 text-sm  gap-2   rounded-xl',
    lg: 'h-12 px-6 text-base gap-2.5 rounded-xl',
};

interface OsButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    icon?: React.ReactNode;
    iconRight?: React.ReactNode;
}

export function OsButton({
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    iconRight,
    children,
    className = '',
    disabled,
    ...props
}: OsButtonProps) {
    return (
        <button
            {...props}
            disabled={disabled || loading}
            className={`
                inline-flex items-center justify-center
                font-medium transition-all duration-150 cursor-pointer
                disabled:opacity-50 disabled:cursor-not-allowed
                ${VARIANT_STYLES[variant]}
                ${SIZE_STYLES[size]}
                ${className}
            `}
        >
            {loading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : icon
            }
            {children}
            {!loading && iconRight}
        </button>
    );
}
