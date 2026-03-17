'use client';

import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { CarbonCreditHeroSection } from '@/components/carbon-credits/CarbonCreditHeroSection';
import { CarbonCreditMarketSection } from '@/components/carbon-credits/CarbonCreditMarketSection';
import { CarbonCreditProjectsSection } from '@/components/carbon-credits/CarbonCreditProjectsSection';
import { CarbonCreditPortfolioSection } from '@/components/carbon-credits/CarbonCreditPortfolioSection';
import { CarbonCreditFrameworkSection } from '@/components/carbon-credits/CarbonCreditFrameworkSection';

export function CarbonCreditPage() {
    return (
        <main className="min-h-screen" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <Navbar activePage="carbon_credits" />
            <CarbonCreditHeroSection />
            <CarbonCreditMarketSection />
            <CarbonCreditProjectsSection />
            <CarbonCreditPortfolioSection />
            <CarbonCreditFrameworkSection />
            <Footer />
        </main>
    );
}
