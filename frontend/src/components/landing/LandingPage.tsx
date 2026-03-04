'use client';

import { Navbar } from '@/components/layout/Navbar';
import { HeroSection } from '@/components/landing/HeroSection';
import { CapabilitiesSection } from '@/components/landing/CapabilitiesSection';
import { SimulationSection } from '@/components/landing/SimulationSection';
import { SovereignSection } from '@/components/landing/SovereignSection';
import { Footer } from '@/components/layout/Footer';

export function LandingPage() {
    return (
        <main className="min-h-screen bg-[#0A1110]">
            <Navbar activePage="overview" />
            <HeroSection />
            <CapabilitiesSection />
            <SimulationSection />
            <SovereignSection />
            <Footer />
        </main>
    );
}
