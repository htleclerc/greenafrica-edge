'use client';

import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { AboutHeroSection } from '@/components/about/AboutHeroSection';
import { AboutMissionSection } from '@/components/about/AboutMissionSection';
import { AboutFoundersSection } from '@/components/about/AboutFoundersSection';
import { AboutVisionSection } from '@/components/about/AboutVisionSection';
import { AboutBlockchainSection } from '@/components/about/AboutBlockchainSection';

export function AboutPage() {
    return (
        <main className="min-h-screen" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <Navbar activePage="about" />
            <AboutHeroSection />
            <AboutMissionSection />
            <AboutFoundersSection />
            <AboutBlockchainSection />
            <AboutVisionSection />
            <Footer />
        </main>
    );
}
