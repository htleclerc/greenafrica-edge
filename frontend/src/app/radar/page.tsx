import { Metadata } from 'next';
import { RadarDashboard } from '@/components/radar/RadarDashboard';
import { Navbar } from '@/components/layout/Navbar';

export const metadata: Metadata = {
    title: 'AIS Radar | Africgreen — Green Gate Digital System',
    description: 'Real-time sovereign maritime radar monitoring the Gulf of Aden and Somaliland EEZ.',
};

export default function RadarPage() {
    return (
        <main className="min-h-screen" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <Navbar activePage="radar" />
            <RadarDashboard />
        </main>
    );
}
