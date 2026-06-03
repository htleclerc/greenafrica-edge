import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModeBadge, modeBadgeContent } from '../ModeBadge';

describe('ModeBadge', () => {
    it('renders the Air label + plane icon for AIR', () => {
        render(<ModeBadge mode="AIR" />);
        expect(screen.getByText('Air')).toBeInTheDocument();
        expect(screen.getByText('✈')).toBeInTheDocument();
    });

    it('renders the Maritime label + ship icon for MARITIME', () => {
        render(<ModeBadge mode="MARITIME" />);
        expect(screen.getByText('Maritime')).toBeInTheDocument();
        expect(screen.getByText('🚢')).toBeInTheDocument();
    });

    it('modeBadgeContent resolves label/icon purely', () => {
        expect(modeBadgeContent('AIR')).toEqual({ icon: '✈', label: 'Air' });
        expect(modeBadgeContent('MARITIME')).toEqual({ icon: '🚢', label: 'Maritime' });
    });
});
