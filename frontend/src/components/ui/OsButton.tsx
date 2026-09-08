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

const BASE_STYLES = `
    inline-flex items-center justify-center
    font-medium transition-all duration-150 cursor-pointer
    disabled:opacity-50 disabled:cursor-not-allowed
`;

/**
 * Les mêmes styles, pour ce qui ne peut pas être un `<button>`.
 *
 * Un lien de navigation reste un `<a>` — le transformer en bouton lui ferait
 * perdre l'ouverture dans un nouvel onglet, la copie d'adresse et l'annonce
 * correcte aux lecteurs d'écran. Il a pourtant besoin de l'apparence d'un
 * bouton, et la recopier ailleurs est précisément ce qui a produit les classes
 * `os-button` / `os-button-sm`, employées par cinq composants et définies nulle
 * part : l'apparence était donc simplement absente.
 */
export function osButtonClass(
    variant: ButtonVariant = 'primary',
    size: ButtonSize = 'md',
): string {
    return `${BASE_STYLES} ${VARIANT_STYLES[variant]} ${SIZE_STYLES[size]}`;
}

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
            className={`${osButtonClass(variant, size)} ${className}`}
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
