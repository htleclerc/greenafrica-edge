import type { Metadata } from 'next';
import LegalBasisContent from '@/components/legal/LegalBasisContent';

export const metadata: Metadata = {
    title: 'Legal Basis & Methodology | Green-Gate Programme',
    description:
        'Full legal framework, calculation methodology and international references supporting the Green-Gate sovereign carbon contribution — Republic of Somaliland. Ministerial Decree MOE&CC/MWI/36/2026, IMO MEPC.346(78), UNCLOS, CORSIA.',
    keywords: [
        'Green-Gate',
        'Somaliland carbon tax',
        'sovereign carbon contribution',
        'SOLIDE TECHNOLOGY',
        'MOE&CC/MWI/36/2026',
        'IMO MEPC.346(78)',
        'CORSIA',
        'UNCLOS Article 211',
        'ASCR',
    ],
    robots: { index: true, follow: true },
    alternates: { canonical: 'https://greengate.africa/legal-basis' },
    openGraph: {
        title: 'Green-Gate — Legal Basis & Methodology',
        description:
            'Ministerial Decree MOE&CC/MWI/36/2026 · IMO MEPC.346(78) · CORSIA · UNCLOS · ASCR',
        url: 'https://greengate.africa/legal-basis',
        type: 'article',
    },
};

const JSON_LD = {
    '@context': 'https://schema.org',
    '@type': 'GovernmentService',
    name: 'Green-Gate Sovereign Carbon Contribution Programme',
    provider: {
        '@type': 'Organization',
        name: 'SOLIDE TECHNOLOGY',
        url: 'https://greengate.africa',
        email: 'st.operations@greengate.africa',
    },
    serviceType: 'Environmental levy / carbon contribution',
    areaServed: { '@type': 'Country', name: 'Somaliland' },
    url: 'https://greengate.africa/legal-basis',
} as const;

export default function LegalBasisPage() {
    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
            />
            <LegalBasisContent />
        </>
    );
}
