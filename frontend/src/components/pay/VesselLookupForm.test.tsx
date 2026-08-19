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

    it('affiche l\'erreur de format et ne navigue pas sur une longueur invalide', () => {
        render(<VesselLookupForm />);
        fireEvent.change(screen.getByLabelText('form_label'), { target: { value: '123' } });
        fireEvent.click(screen.getByRole('button', { name: 'form_submit' }));
        expect(mockPush).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('form_invalid');
    });

    it('affiche l\'erreur de somme de contrôle (pas l\'erreur de format) sur un IMO à 7 chiffres mal saisi', () => {
        // 9424224 a la bonne longueur (7 chiffres) mais une clé de contrôle
        // fausse : le message affiché doit le distinguer d'un problème de
        // format, sans quoi l'utilisateur recompte ses chiffres pour rien.
        render(<VesselLookupForm />);
        fireEvent.change(screen.getByLabelText('form_label'), { target: { value: '9424224' } });
        fireEvent.click(screen.getByRole('button', { name: 'form_submit' }));
        expect(mockPush).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('form_invalid_checksum');
    });
});
