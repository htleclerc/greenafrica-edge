import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));

import { VesselLookupForm } from './VesselLookupForm';

beforeEach(() => vi.clearAllMocks());

describe('VesselLookupForm', () => {
    it("navigue vers /pay avec l'identifiant normalisé", () => {
        render(<VesselLookupForm />);
        fireEvent.change(screen.getByLabelText('form_label'), { target: { value: 'IMO 9424223' } });
        fireEvent.click(screen.getByRole('button', { name: 'form_submit' }));
        expect(mockPush).toHaveBeenCalledWith('/pay?q=9424223');
    });

    it('affiche une erreur et ne navigue pas sur saisie invalide', () => {
        render(<VesselLookupForm />);
        fireEvent.change(screen.getByLabelText('form_label'), { target: { value: '123' } });
        fireEvent.click(screen.getByRole('button', { name: 'form_submit' }));
        expect(mockPush).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('form_invalid');
    });

    it('rejette un IMO à somme de contrôle fausse sans appel réseau', () => {
        render(<VesselLookupForm />);
        fireEvent.change(screen.getByLabelText('form_label'), { target: { value: '9424224' } });
        fireEvent.click(screen.getByRole('button', { name: 'form_submit' }));
        expect(mockPush).not.toHaveBeenCalled();
    });
});
