// frontend/src/components/auth/__tests__/ResetPasswordPage.redirect.test.tsx
import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
const updateUser = vi.fn();
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { updateUser } }) }));

import { ResetPasswordPage } from '../ResetPasswordPage';

beforeEach(() => { vi.clearAllMocks(); });

it('calls updateUser on a valid password and shows the success state', async () => {
    updateUser.mockResolvedValue({ error: null });
    render(<ResetPasswordPage redirectTo="/owner/dashboard" />);
    const inputs = screen.getAllByPlaceholderText('••••••••••••');
    fireEvent.change(inputs[0], { target: { value: 'Abcdef1!' } });
    fireEvent.change(inputs[1], { target: { value: 'Abcdef1!' } });
    fireEvent.click(screen.getByText('reset_btn_submit'));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'Abcdef1!' }));
    expect(await screen.findByText('reset_btn_go_login')).toBeInTheDocument();
});
