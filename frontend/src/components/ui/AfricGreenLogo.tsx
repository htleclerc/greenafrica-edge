import Image from 'next/image';

interface AfricGreenLogoProps {
    /** Icon size in pixels */
    size?: number;
    /** 'dark' background (emerald gradient icon) or 'light' background (mono-dark icon) */
    variant?: 'dark' | 'light';
    className?: string;
}

/**
 * Brand icon — renders the Green Gate shield emblem from /public/brand/.
 * Use variant="dark" on dark backgrounds (default), variant="light" on light backgrounds.
 */
export function AfricGreenLogo({ size = 32, variant = 'dark', className }: AfricGreenLogoProps) {
    const src = variant === 'dark'
        ? '/brand/africgreen-icon-emerald.svg'
        : '/brand/africgreen-icon-mono-dark.svg';

    return (
        <Image
            src={src}
            alt="Green Gate"
            width={size}
            height={size}
            className={className}
            priority
        />
    );
}
