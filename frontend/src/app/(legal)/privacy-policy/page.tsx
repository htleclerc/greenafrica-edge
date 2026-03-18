import type { Metadata } from 'next';
import PrivacyPolicyContent from '@/components/legal/PrivacyPolicyContent';

export const metadata: Metadata = {
    title: 'Privacy Policy | Africgreen',
    description: 'Privacy Policy of the Africgreen Maritime Carbon Intelligence Platform — Government of Somaliland.',
};

export default function PrivacyPolicyPage() {
    return <PrivacyPolicyContent />;
}
