'use client';

import * as React from 'react';
import Link from 'next/link';
import { Sparkles, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Full-width banner shown at the top of /dashboard when the armateur has
 * registered but has NOT yet declared any vessel. Progressive disclosure:
 * the rest of the dashboard still renders (with empty states), so the
 * armateur can explore the portal while nudged to add their first vessel.
 */
export function OnboardingBanner() {
    const t = useTranslations('OnboardingBanner');

    return (
        <div
            role="region"
            aria-labelledby="onboarding-banner-title"
            className="os-card p-4 flex items-center justify-between gap-4 flex-wrap
                       border-l-2 border-l-[var(--os-brand-green)]
                       bg-gradient-to-r from-[var(--os-surface-2)] to-[var(--os-surface)]"
        >
            <div className="flex items-start gap-3">
                <Sparkles
                    className="w-5 h-5 text-[var(--os-brand-green)] mt-0.5 shrink-0"
                    aria-hidden="true"
                />
                <div>
                    <h2
                        id="onboarding-banner-title"
                        className="text-sm font-semibold text-[var(--os-text-primary)]"
                    >
                        {t('title')}
                    </h2>
                    <p className="text-xs text-[var(--os-text-muted)] mt-0.5">
                        {t('sub')}
                    </p>
                </div>
            </div>
            <Link
                href="/dashboard/my-fleet"
                className="inline-flex items-center gap-2 px-4 h-10 rounded-xl
                           bg-[#00D97E] hover:bg-[#00C070] text-[#060D1A]
                           text-sm font-semibold transition-colors duration-150
                           focus-visible:outline-none focus-visible:ring-2
                           focus-visible:ring-[var(--os-brand-green)]"
            >
                {t('cta')}
                <ArrowRight className="w-4 h-4" />
            </Link>
        </div>
    );
}
