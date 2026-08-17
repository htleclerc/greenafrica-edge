'use client';

// Checklist de progression affichée au tableau de bord opérateur, du
// rattachement du compte jusqu'au premier paiement. Dérivée de l'état réel
// des tables (aucune colonne de progression, aucun drapeau « tutoriel vu ») :
// elle se décoche si l'état régresse et disparaît d'elle-même une fois
// complète. Le bouton de masquage n'est qu'un état local — pas un tunnel.

import * as React from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { isChecklistComplete, type ChecklistItem } from '@/lib/onboarding/paymentChecklist';

type ActionableKey = 'billing' | 'payment';

const CTA_HREF: Record<ActionableKey, string> = {
    billing: '/owner/onboarding/billing',
    payment: '/dashboard/invoices',
};

const CTA_LABEL_KEY: Record<ActionableKey, string> = {
    billing: 'cta_billing',
    payment: 'cta_payment',
};

function isActionable(key: ChecklistItem['key']): key is ActionableKey {
    return key === 'billing' || key === 'payment';
}

interface Props {
    items: ChecklistItem[];
}

export function PaymentOnboardingChecklist({ items }: Props) {
    const t = useTranslations('PaymentOnboarding');
    const [dismissed, setDismissed] = React.useState(false);

    if (isChecklistComplete(items) || dismissed) return null;

    const firstPending = items.find((item) => !item.done);
    const cta = firstPending && isActionable(firstPending.key) ? firstPending.key : undefined;

    return (
        <div
            role="region"
            aria-labelledby="payment-onboarding-title"
            className="os-card p-4 mb-6 flex items-start justify-between gap-4 flex-wrap
                       border-l-2 border-l-[var(--os-brand-green)]
                       bg-gradient-to-r from-[var(--os-surface-2)] to-[var(--os-surface)]"
        >
            <div className="flex-1 min-w-[240px]">
                <h2
                    id="payment-onboarding-title"
                    className="text-sm font-semibold text-[var(--os-text-primary)]"
                >
                    {t('title')}
                </h2>

                <ul className="mt-3 space-y-2">
                    {items.map((item) => (
                        <li key={item.key} className="flex items-center gap-2 text-sm">
                            {item.done ? (
                                <CheckCircle2
                                    className="w-4 h-4 text-[var(--os-brand-green)] shrink-0"
                                    aria-hidden="true"
                                />
                            ) : (
                                <Circle
                                    className="w-4 h-4 text-[var(--os-text-muted)] shrink-0"
                                    aria-hidden="true"
                                />
                            )}
                            <span
                                className={
                                    item.done
                                        ? 'text-[var(--os-text-muted)] line-through'
                                        : 'text-[var(--os-text-primary)]'
                                }
                            >
                                {t(`item_${item.key}`)}
                            </span>
                        </li>
                    ))}
                </ul>

                <div className="mt-3 flex items-center gap-4 flex-wrap">
                    {cta && (
                        <Link
                            href={CTA_HREF[cta]}
                            className="inline-flex items-center gap-2 px-4 h-9 rounded-xl
                                       bg-[#00D97E] hover:bg-[#00C070] text-[#060D1A]
                                       text-sm font-semibold transition-colors duration-150
                                       focus-visible:outline-none focus-visible:ring-2
                                       focus-visible:ring-[var(--os-brand-green)]"
                        >
                            {t(CTA_LABEL_KEY[cta])}
                        </Link>
                    )}
                    <Link
                        href="/how-to-pay"
                        className="text-xs text-[var(--os-text-muted)] hover:underline"
                    >
                        {t('help')}
                    </Link>
                </div>
            </div>

            <button
                type="button"
                onClick={() => setDismissed(true)}
                aria-label={t('dismiss')}
                className="text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] shrink-0 p-1
                           focus-visible:outline-none focus-visible:ring-2
                           focus-visible:ring-[var(--os-brand-green)] rounded"
            >
                <X className="w-4 h-4" aria-hidden="true" />
            </button>
        </div>
    );
}
