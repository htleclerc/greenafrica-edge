import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { VesselLookupForm } from '@/components/pay/VesselLookupForm';

/**
 * Tutoriel public, indexable — contrairement à `/pay` et `/pay/claim` qui sont
 * en `noindex`. C'est la page qu'on veut voir remonter en recherche.
 *
 * Les moyens de paiement ne sont jamais énumérés en dur ici : ils varient par
 * juridiction et l'éligibilité par rail n'est exposée que derrière
 * l'authentification (voir /api/owner/payment-availability). Le step 4 reste
 * générique à dessein — c'est la seule version qui ne peut pas devenir fausse.
 */
export const metadata: Metadata = {
    title: 'Green Gate — Régler la taxe carbone de votre navire',
    description:
        'Comment vérifier et régler la taxe carbone maritime : quatre étapes, de la recherche par IMO au paiement en ligne.',
    alternates: { canonical: 'https://greengate.africa/how-to-pay' },
};

export default async function HowToPayPage() {
    const t = await getTranslations('HowToPay');

    const steps = [
        { title: t('step1_title'), body: t('step1_body') },
        { title: t('step2_title'), body: t('step2_body') },
        { title: t('step3_title'), body: t('step3_body') },
        { title: t('step4_title'), body: t('step4_body') },
    ];

    return (
        <main className="min-h-screen w-full overflow-x-hidden" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <Navbar activePage="how-to-pay" />

            <section className="pt-28 sm:pt-32 pb-16 px-4">
                <div className="max-w-2xl mx-auto">
                    <h1
                        className="text-2xl sm:text-3xl font-bold text-center mb-3"
                        style={{ color: 'var(--ais-page-text)' }}
                    >
                        {t('page_title')}
                    </h1>
                    <p
                        className="text-sm sm:text-base text-center mb-12"
                        style={{ color: 'var(--ais-page-text-dim)' }}
                    >
                        {t('intro')}
                    </p>

                    <ol className="space-y-6 mb-12">
                        {steps.map((step, i) => (
                            <li
                                key={step.title}
                                className="flex gap-4 p-5 rounded-xl"
                                style={{
                                    border: '1px solid var(--ais-page-border)',
                                    backgroundColor: 'var(--ais-page-surface)',
                                }}
                            >
                                <span
                                    className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                                    style={{ backgroundColor: 'rgba(0,217,126,0.15)', color: '#00D97E' }}
                                    aria-hidden="true"
                                >
                                    {i + 1}
                                </span>
                                <div>
                                    <h2
                                        className="text-base font-semibold mb-1"
                                        style={{ color: 'var(--ais-page-text)' }}
                                    >
                                        {step.title}
                                    </h2>
                                    <p className="text-sm leading-relaxed" style={{ color: 'var(--ais-page-text-dim)' }}>
                                        {step.body}
                                    </p>
                                </div>
                            </li>
                        ))}
                    </ol>

                    <div
                        className="p-5 rounded-xl mb-12"
                        style={{
                            border: '1px solid var(--ais-page-border)',
                            backgroundColor: 'var(--ais-page-surface)',
                        }}
                    >
                        <h2
                            className="text-base font-semibold mb-1"
                            style={{ color: 'var(--ais-page-text)' }}
                        >
                            {t('dispute_title')}
                        </h2>
                        <p className="text-sm leading-relaxed" style={{ color: 'var(--ais-page-text-dim)' }}>
                            {t.rich('dispute_body', {
                                email: (chunks) => (
                                    <a
                                        href="mailto:st.operations@greengate.africa"
                                        className="underline"
                                        style={{ color: '#00D97E' }}
                                    >
                                        {chunks}
                                    </a>
                                ),
                            })}
                        </p>
                        <a
                            href="/legal-basis"
                            className="inline-block mt-3 text-sm font-medium underline"
                            style={{ color: '#00D97E' }}
                        >
                            {t('legal_link')}
                        </a>
                    </div>

                    <div className="text-center">
                        <p
                            className="text-sm font-semibold mb-4"
                            style={{ color: 'var(--ais-page-text)' }}
                        >
                            {t('cta')}
                        </p>
                        <VesselLookupForm autoFocus={false} />
                    </div>
                </div>
            </section>

            <Footer />
        </main>
    );
}
