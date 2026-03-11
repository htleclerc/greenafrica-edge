import type { Metadata } from 'next';
import { SignupPage } from '@/components/auth/SignupPage';

export const metadata: Metadata = {
    title: 'Register | Africgreen',
    description: 'Request access to the Africgreen sovereign carbon intelligence platform — Port Authority or Shipping Agent registration.',
};

export default function SignupRoute() {
    return <SignupPage />;
}
