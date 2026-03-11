import type { Metadata } from 'next';
import { LoginPage } from '@/components/auth/LoginPage';

export const metadata: Metadata = {
    title: 'Sovereign Access Portal | Africgreen',
    description: 'Authorized personnel only. All activities are monitored and logged.',
};

export default function Login() {
    return <LoginPage />;
}
