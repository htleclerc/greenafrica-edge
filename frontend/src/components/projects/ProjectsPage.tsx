import { Navbar } from '@/components/layout/Navbar';
import { ProjectsHeroSection } from './ProjectsHeroSection';
import { ProjectsGridSection } from './ProjectsGridSection';
import { ProjectsTimelineSection } from './ProjectsTimelineSection';
import { ProjectsImpactSection } from './ProjectsImpactSection';
import { ProjectsPartnersSection } from './ProjectsPartnersSection';
import { Footer } from '@/components/layout/Footer';

export function ProjectsPage() {
    return (
        <main className="min-h-screen bg-[#0A1110]">
            <Navbar activePage="projects" />
            <ProjectsHeroSection />
            <ProjectsGridSection />
            <ProjectsTimelineSection />
            <ProjectsImpactSection />
            <ProjectsPartnersSection />
            <Footer />
        </main>
    );
}
