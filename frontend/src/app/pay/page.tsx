import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { VesselLookupForm } from '@/components/pay/VesselLookupForm';
import { VesselTeaserCard } from '@/components/pay/VesselTeaserCard';
import { lookupVesselTeaser } from '@/services/vesselTeaserService';
import { getClientId } from '@/lib/rateLimit';

/**
 * Consultation publique. `noindex` : on ne veut pas de page de dette indexée
 * par navire. Le tutoriel /how-to-pay, lui, est indexable — c'est la page
 * qu'on veut voir remonter en recherche.
 */
export const metadata = {
    title: 'Green Gate — Vérifier la taxe carbone d\'un navire',
    robots: { index: false, follow: false },
};

export default async function PayPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string }>;
}) {
    const { q } = await searchParams;
    const t = await getTranslations('VesselLookup');

    const h = await headers();
    const result = q ? await lookupVesselTeaser(q, getClientId(h)) : null;

    return (
        <main className="min-h-screen w-full overflow-x-hidden" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <Navbar activePage="overview" />

            <section className="pt-28 sm:pt-32 pb-16 px-4">
                <div className="max-w-3xl mx-auto">
                    <h1
                        className="text-2xl sm:text-3xl font-bold text-center mb-8"
                        style={{ color: 'var(--ais-page-text)' }}
                    >
                        {t('page_title')}
                    </h1>

                    <div className="mb-10">
                        <VesselLookupForm defaultValue={q ?? ''} autoFocus={!q} />
                    </div>

                    {result && <VesselTeaserCard result={result} query={q ?? ''} />}
                </div>
            </section>

            <Footer />
        </main>
    );
}
