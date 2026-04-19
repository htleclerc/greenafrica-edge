import type { Metadata } from 'next';
import { ResetPasswordPage } from '@/components/auth/ResetPasswordPage';

export const metadata: Metadata = {
    title: 'Reset Password | Green Gate',
    description: 'Set a new password for your Green Gate account.',
};

export default function ResetPasswordRoute() {
    return <ResetPasswordPage />;
}
