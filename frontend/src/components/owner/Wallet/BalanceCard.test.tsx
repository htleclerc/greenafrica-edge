import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { BalanceCard } from './BalanceCard';
import { usdGrouped } from '@/lib/osMoney';

// usdGrouped sépare les milliers par une espace insécable étroite (U+202F) ;
// Testing Library normalise tout blanc en espace simple avant de comparer.
// On aligne l'attendu sur cette normalisation plutôt que d'assouplir l'assertion.
const spaced = (value: string) => value.replace(/\s/g, ' ');
import en from '../../../../messages/en.json';

describe('BalanceCard', () => {
    it('renders balance + auto-apply badge + topup button', () => {
        const onToggle = vi.fn();
        const onTopup = vi.fn();
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <BalanceCard
                    balanceUsd={12450}
                    autoApplyEnabled={true}
                    onToggleAutoApply={onToggle}
                    onOpenTopup={onTopup}
                    togglePending={false}
                />
            </NextIntlClientProvider>,
        );
        // Le solde est rendu par usdGrouped : séparateur de milliers étroit
        // (espace insécable), sans centimes. C'est la convention de tous les
        // montants des écrans denses, pas une particularité du portefeuille.
        expect(screen.getByText(spaced(usdGrouped(12_450)))).toBeInTheDocument();
        expect(screen.getByText('Enabled')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Top up wallet'));
        expect(onTopup).toHaveBeenCalled();
    });

    it('hides the Top up CTA when topupEnabled=false (Plan 7H-1 Task 5.3)', () => {
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <BalanceCard
                    balanceUsd={500}
                    autoApplyEnabled={true}
                    onToggleAutoApply={() => {}}
                    onOpenTopup={() => {}}
                    togglePending={false}
                    topupEnabled={false}
                />
            </NextIntlClientProvider>,
        );
        expect(screen.queryByText('Top up wallet')).not.toBeInTheDocument();
    });

    it('shows Disabled when autoApplyEnabled is false', () => {
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <BalanceCard
                    balanceUsd={100}
                    autoApplyEnabled={false}
                    onToggleAutoApply={() => {}}
                    onOpenTopup={() => {}}
                    togglePending={false}
                />
            </NextIntlClientProvider>,
        );
        expect(screen.getByText('Disabled')).toBeInTheDocument();
    });

    it('annonce l’absence d’approvisionnement plutôt que de laisser la ligne vide', () => {
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <BalanceCard
                    balanceUsd={0}
                    autoApplyEnabled={false}
                    onToggleAutoApply={() => {}}
                    onOpenTopup={() => {}}
                    togglePending={false}
                />
            </NextIntlClientProvider>,
        );
        expect(screen.getByText('No top-up yet.')).toBeInTheDocument();
    });

    it('rappelle le dernier approvisionnement quand il y en a un', () => {
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <BalanceCard
                    balanceUsd={9_750}
                    autoApplyEnabled={false}
                    onToggleAutoApply={() => {}}
                    onOpenTopup={() => {}}
                    togglePending={false}
                    lastTopupAt="2026-08-04T10:00:00Z"
                    lastTopupUsd={15_000}
                />
            </NextIntlClientProvider>,
        );
        const date = new Date('2026-08-04T10:00:00Z').toLocaleDateString();
        expect(
            screen.getByText(spaced(`Last top-up on ${date} · ${usdGrouped(15_000)}`)),
        ).toBeInTheDocument();
    });
});
