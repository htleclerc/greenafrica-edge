import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApproxFlag } from '../ApproxFlag';

describe('ApproxFlag', () => {
    it('renders the approximate-estimate text', () => {
        render(<ApproxFlag />);
        expect(screen.getByText(/Estimation approximée/)).toBeInTheDocument();
    });

    it('exposes an accessible label explaining the MTOW fallback', () => {
        render(<ApproxFlag />);
        expect(
            screen.getByLabelText(/aircraft type not in the ICAO EDB/i),
        ).toBeInTheDocument();
    });
});
