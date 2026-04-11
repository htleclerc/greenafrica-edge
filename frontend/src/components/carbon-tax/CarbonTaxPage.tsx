'use client';

import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { CarbonTaxHeroSection } from '@/components/carbon-tax/CarbonTaxHeroSection';
import { CarbonTaxRatesSection } from '@/components/carbon-tax/CarbonTaxRatesSection';
import { CarbonTaxVesselsSection } from '@/components/carbon-tax/CarbonTaxVesselsSection';
import { CarbonTaxRevenueSection } from '@/components/carbon-tax/CarbonTaxRevenueSection';
import { CarbonTaxImoSection } from '@/components/carbon-tax/CarbonTaxImoSection';
import { CarbonTaxComplianceSection } from '@/components/carbon-tax/CarbonTaxComplianceSection';

export function CarbonTaxPage() {
    return (
        <main className="min-h-screen" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <Navbar activePage="carbon_tax" />
            <CarbonTaxHeroSection />
            <CarbonTaxRatesSection />
            <CarbonTaxVesselsSection />
            <CarbonTaxRevenueSection />
            <CarbonTaxImoSection />
            <CarbonTaxComplianceSection />
            <Footer />
        </main>
    );
}
