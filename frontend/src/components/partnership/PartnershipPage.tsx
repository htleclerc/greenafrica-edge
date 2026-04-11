'use client';

import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { PartnershipHeroSection } from '@/components/partnership/PartnershipHeroSection';
import { PartnershipDeploymentSection } from '@/components/partnership/PartnershipDeploymentSection';
import { PartnershipCalculatorSection } from '@/components/partnership/PartnershipCalculatorSection';
import { PartnershipImpactSection } from '@/components/partnership/PartnershipImpactSection';

export function PartnershipPage() {
    return (
        <main className="min-h-screen" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <Navbar activePage="partnership" />
            <PartnershipHeroSection />
            <PartnershipDeploymentSection />
            <PartnershipCalculatorSection />
            <PartnershipImpactSection />
            <Footer />
        </main>
    );
}
