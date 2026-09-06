'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface ViewAsTab {
    href: string;
    label: string;
    /** Actif seulement sur l'égalité stricte (l'accueil de la vue). */
    exact?: boolean;
    disabled?: boolean;
    title?: string;
}

/** Volets de la vue « voir comme » ; l'actif se lit sur l'URL. */
export function ViewAsTabs({ tabs }: { tabs: ViewAsTab[] }) {
    const pathname = usePathname();
    return (
        <nav aria-label="view-as" className="flex flex-wrap gap-1.5">
            {tabs.map((tab) => {
                const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
                const cls = `rounded-full px-3 py-1 text-[12.5px] font-semibold transition-colors ${
                    active
                        ? 'bg-[var(--os-text-primary)] text-[var(--os-surface)]'
                        : 'border border-[var(--os-border-strong)] text-[var(--os-text-secondary)] hover:bg-[var(--os-surface-2)]'
                }`;
                if (tab.disabled) {
                    return (
                        <span key={tab.href} aria-disabled title={tab.title} className={`${cls} cursor-not-allowed opacity-50`}>
                            {tab.label}
                        </span>
                    );
                }
                return (
                    <Link key={tab.href} href={tab.href} aria-current={active ? 'page' : undefined} className={cls}>
                        {tab.label}
                    </Link>
                );
            })}
        </nav>
    );
}
