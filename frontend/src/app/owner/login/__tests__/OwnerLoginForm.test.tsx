// frontend/src/app/owner/login/__tests__/OwnerLoginForm.test.tsx
import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next-intl', () => {
    // The mock translator returns the key verbatim. We also stub `t.rich` (used by the
    // `linkSent` confirmation branch) so rendering that branch doesn't throw; it returns
    // the key, matching the plain-text mock behaviour. Assertions are unchanged.
    const t = (k: string) => k;
    (t as unknown as { rich: (k: string) => string }).rich = (k: string) => k;
    return { useTranslations: () => t };
});
const push = vi.fn();
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push }),
    useSearchParams: () => new URLSearchParams(''),
}));
const signInWithPassword = vi.fn();
const signInWithOtp = vi.fn();
const resetPasswordForEmail = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
    createClient: () => ({ auth: { signInWithPassword, signInWithOtp, resetPasswordForEmail } }),
}));

import { OwnerLoginForm } from '../OwnerLoginForm';

beforeEach(() => { vi.clearAllMocks(); });

// NOTE: the two queries below use placeholder text. If OsInput exposes an accessible
// label tied to the input you MAY switch to getByLabelText('emailLabel') /
// getByLabelText('passwordLabel') — but do NOT weaken the assertions. Confirm which
// works against the real OsInput and keep it.
function fill(email: string, password?: string) {
    fireEvent.change(screen.getByPlaceholderText('owner@example.com'), { target: { value: email } });
    if (password !== undefined) {
        fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: password } });
    }
}

it('signs in with password and redirects to /owner/dashboard', async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    render(<OwnerLoginForm />);
    fill('owner@example.com', 'secret123');
    fireEvent.click(screen.getByText('passwordSubmit'));
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledWith({ email: 'owner@example.com', password: 'secret123' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/owner/dashboard'));
});

it('shows a generic error on bad credentials and does not redirect', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    render(<OwnerLoginForm />);
    fill('owner@example.com', 'wrong');
    fireEvent.click(screen.getByText('passwordSubmit'));
    await waitFor(() => expect(screen.getByText('errors.invalidCredentials')).toBeInTheDocument());
    expect(push).not.toHaveBeenCalled();
});

it('requests a magic link via signInWithOtp', async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    render(<OwnerLoginForm />);
    fill('owner@example.com');
    fireEvent.click(screen.getByText('useMagicLink'));
    await waitFor(() => expect(signInWithOtp).toHaveBeenCalled());
    expect(signInWithOtp.mock.calls[0][0].email).toBe('owner@example.com');
});

it('triggers a password reset email and shows a generic confirmation', async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null });
    render(<OwnerLoginForm />);
    fill('owner@example.com');
    fireEvent.click(screen.getByText('setPassword'));
    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalled());
    expect(resetPasswordForEmail.mock.calls[0][0]).toBe('owner@example.com');
    expect(await screen.findByText('resetSent')).toBeInTheDocument();
});
