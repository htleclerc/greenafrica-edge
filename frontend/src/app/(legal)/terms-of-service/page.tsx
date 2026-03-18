import type { Metadata } from 'next';
import TermsOfServiceContent from '@/components/legal/TermsOfServiceContent';

export const metadata: Metadata = {
    title: 'Terms of Service | Africgreen',
    description: 'Terms of Service for the Africgreen Maritime Carbon Intelligence Platform — Government of Somaliland.',
};

export default function TermsOfServicePage() {
    return <TermsOfServiceContent />;
}
