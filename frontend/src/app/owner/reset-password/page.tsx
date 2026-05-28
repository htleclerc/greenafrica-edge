import { ResetPasswordPage } from '@/components/auth/ResetPasswordPage';

export const metadata = { title: 'Reset password — Owner portal' };

export default function OwnerResetPassword() {
    return <ResetPasswordPage redirectTo="/owner/dashboard" />;
}
