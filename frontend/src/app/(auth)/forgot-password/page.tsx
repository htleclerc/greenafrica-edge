import type { Metadata } from 'next';
import { ForgotPasswordPage } from '@/components/auth/ForgotPasswordPage';

export const metadata: Metadata = {
    title: 'Forgot Password | Africgreen',
    description: 'Reset your password for the Africgreen sovereign carbon intelligence platform.',
};

export default function ForgotPasswordRoute() {
    return <ForgotPasswordPage />;
}
