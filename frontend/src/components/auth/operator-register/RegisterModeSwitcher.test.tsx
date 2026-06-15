import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RegisterModeSwitcher } from './RegisterModeSwitcher';

vi.mock('next-intl', () => ({
    useTranslations: () => (k: string) => k,
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));

describe('RegisterModeSwitcher', () => {
    it('shows both tabs when both modes enabled', () => {
        render(<RegisterModeSwitcher recaptchaSiteKey="" maritimeEnabled airEnabled />);
        expect(screen.getByRole('tab', { name: /tab_maritime/i })).toBeDefined();
        expect(screen.getByRole('tab', { name: /tab_air/i })).toBeDefined();
    });

    it('shows only the air form when only air enabled', () => {
        render(<RegisterModeSwitcher recaptchaSiteKey="" maritimeEnabled={false} airEnabled />);
        expect(screen.queryByRole('tab', { name: /tab_maritime/i })).toBeNull();
        // AOC field is unique to the air form
        expect(screen.getByText(/aoc_number/i)).toBeDefined();
    });
});
