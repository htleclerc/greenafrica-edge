import type { Metadata } from 'next';
import { InspectorPage } from '@/components/dashboard/inspector/InspectorPage';

export const metadata: Metadata = {
    title: 'Port Inspector | Africgreen',
    description: 'Mobile-first inspection tool — scan MMSI, verify compliance, submit inspection reports.',
};

export default function InspectorRoute() {
    return <InspectorPage />;
}
