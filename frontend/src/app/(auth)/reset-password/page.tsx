import type { Metadata } from 'next';
import { ResetPasswordPage } from '@/components/auth/ResetPasswordPage';

export const metadata: Metadata = {
    title: 'Reset Password | Africgreen',
    description: 'Set a new password for your Africgreen account.',
};

export default function ResetPasswordRoute() {
    return <ResetPasswordPage />;
}
