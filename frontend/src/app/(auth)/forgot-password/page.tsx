import type { Metadata } from 'next';
import { ForgotPasswordPage } from '@/components/auth/ForgotPasswordPage';

export const metadata: Metadata = {
    title: 'Forgot Password | Green Gate',
    description: 'Reset your password for the Green Gate sovereign carbon intelligence platform.',
};

export default function ForgotPasswordRoute() {
    return <ForgotPasswordPage />;
}
