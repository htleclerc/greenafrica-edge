import { ProjectsPage } from '@/components/projects/ProjectsPage';

export const metadata = {
    title: 'Projects | AIS Portal — Green Gate Initiative',
    description:
        'Explore Somaliland\'s sovereign green and carbon project portfolio — maritime carbon taxation, national carbon registry, blue carbon conservation, reforestation (VCS), clean cooking (Gold Standard), and green energy transition at Berbera Port.',
};

export default function ProjectsRoute() {
    return <ProjectsPage />;
}
