import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KycStatus } from './KycStatus';

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

describe('KycStatus', () => {
    it('montre le CTA billing quand C manque', () => {
        render(<KycStatus bDone={true} cDone={false} />);
        expect(screen.getByRole('link')).toHaveAttribute('href', '/owner/onboarding/billing');
    });
    it('ne montre pas de CTA quand tout est complet', () => {
        render(<KycStatus bDone={true} cDone={true} />);
        expect(screen.queryByRole('link')).toBeNull();
    });
});
