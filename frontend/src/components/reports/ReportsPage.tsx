'use client';

import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { ReportsHeroSection } from '@/components/reports/ReportsHeroSection';
import { ReportsAnalyticsSection } from '@/components/reports/ReportsAnalyticsSection';
import { ReportsTableSection } from '@/components/reports/ReportsTableSection';

export function ReportsPage() {
    return (
        <main className="min-h-screen bg-[#0A1110]">
            <Navbar activePage="reports" />
            <ReportsHeroSection />
            <ReportsAnalyticsSection />
            <ReportsTableSection />
            <Footer />
        </main>
    );
}
