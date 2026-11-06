'use client';

import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { PartnershipHeroSection } from '@/components/partnership/PartnershipHeroSection';
// Section partagée avec la page d'accueil : une seule liste de pays à tenir
// à jour (src/components/landing/coverage.ts), affichée aux deux endroits.
import { CoverageSection } from '@/components/landing/CoverageSection';
import { PartnershipDeploymentSection } from '@/components/partnership/PartnershipDeploymentSection';
import { PartnershipCalculatorSection } from '@/components/partnership/PartnershipCalculatorSection';
import { PartnershipImpactSection } from '@/components/partnership/PartnershipImpactSection';

export function PartnershipPage() {
    return (
        <main className="min-h-screen" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <Navbar activePage="partnership" />
            <PartnershipHeroSection />
            {/* Qui est déjà en service, avant d'expliquer ce qu'on déploie. */}
            <CoverageSection />
            <PartnershipDeploymentSection />
            <PartnershipCalculatorSection />
            <PartnershipImpactSection />
            <Footer />
        </main>
    );
}
