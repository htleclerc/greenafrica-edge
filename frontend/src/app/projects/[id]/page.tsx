import { ProjectDetailPage } from '@/components/projects/ProjectDetailPage';
import { greenProjects } from '@/mock/datas/projectsMock';

type Props = {
    params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props) {
    const { id } = await params;
    const project = greenProjects.find((p) => p.id === id);

    if (!project) {
        return {
            title: 'Project Not Found | Africgreen',
        };
    }

    return {
        title: `${project.name} | Africgreen — Green Gate Digital System`,
        description: project.description,
    };
}

export async function generateStaticParams() {
    return greenProjects.map((project) => ({
        id: project.id,
    }));
}

export default async function ProjectDetailRoute({ params }: Props) {
    const { id } = await params;
    return <ProjectDetailPage id={id} />;
}
