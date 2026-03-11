import type { Metadata } from 'next';
import { PostLoginPage } from '@/components/auth/PostLoginPage';

export const metadata: Metadata = {
    title: 'Session Setup | Africgreen',
    description: 'Select your role and operational context.',
};

export default function PostLogin() {
    return <PostLoginPage />;
}
