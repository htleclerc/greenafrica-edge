import type { Metadata } from 'next';
import TermsOfServiceContent from '@/components/legal/TermsOfServiceContent';

export const metadata: Metadata = {
    title: 'Terms of Service | Green Gate',
    description: 'Terms of Service for the Green Gate Maritime Carbon Intelligence Platform — Government of Somaliland.',
};

export default function TermsOfServicePage() {
    return <TermsOfServiceContent />;
}
