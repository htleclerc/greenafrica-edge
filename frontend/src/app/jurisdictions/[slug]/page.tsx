import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { COVERAGE_COUNTRIES, findCountryBySlug } from '@/components/landing/coverage';
import { JurisdictionPage } from '@/components/jurisdictions/JurisdictionPage';

type Params = Promise<{ slug: string }>;

/** Les juridictions sont une liste fermée : toutes les pages sont pré-rendues. */
export function generateStaticParams() {
    return COVERAGE_COUNTRIES.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: { params: Params }) {
    const { slug } = await params;
    const country = findCountryBySlug(slug);
    if (!country) return {};

    const t = await getTranslations('Landing');
    const j = await getTranslations('Jurisdiction');
    const name = t(`coverage_country_${country.key}`);

    return {
        title: `${name} | Green Gate`,
        description: country.status === 'live'
            ? j('intro_live', { name })
            : j('intro_pipeline', { name }),
    };
}

export default async function JurisdictionRoute({ params }: { params: Params }) {
    const { slug } = await params;
    const country = findCountryBySlug(slug);
    // Slug inconnu : 404 franc, plutôt qu'une page de juridiction vide qui
    // laisserait croire que Green Gate couvre ce pays.
    if (!country) notFound();

    return <JurisdictionPage country={country} />;
}
