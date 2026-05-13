import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { BalanceCard } from './BalanceCard';
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
        expect(screen.getByText(/12,450/)).toBeInTheDocument();
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
});
