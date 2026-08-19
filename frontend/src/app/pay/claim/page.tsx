import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { ClaimByCodePanel } from '@/components/pay/ClaimByCodePanel';
import { ClaimByStaffPanel } from '@/components/pay/ClaimByStaffPanel';
import { lookupVesselTeaser } from '@/services/vesselTeaserService';
import { getClientId } from '@/lib/rateLimit';

/**
 * `noindex`, comme `/pay` : pas de page de rattachement par navire indexée.
 */
export const metadata = {
    title: 'Green Gate — Accéder à vos avis',
    robots: { index: false, follow: false },
};

export default async function ClaimPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string }>;
}) {
    const { q } = await searchParams;
    if (!q) redirect('/pay');

    const h = await headers();
    const result = await lookupVesselTeaser(q, getClientId(h));

    // Un navire inconnu n'a rien à revendiquer — on renvoie sur la
    // consultation, qui affichera l'état UNKNOWN.
    if (result.state === 'UNKNOWN') redirect(`/pay?q=${encodeURIComponent(q)}`);

    return (
        <main className="min-h-screen w-full overflow-x-hidden" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <Navbar activePage="overview" />
            <section className="pt-28 sm:pt-32 pb-16 px-4">
                {result.teaser.claimable
                    ? <ClaimByCodePanel identifier={q} />
                    : <ClaimByStaffPanel identifier={result.teaser.imoNumber} />}
            </section>
            <Footer />
        </main>
    );
}
