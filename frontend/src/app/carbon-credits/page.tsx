import { CarbonCreditPage } from '@/components/carbon-credits/CarbonCreditPage';

export const metadata = {
    title: 'Carbon Credits | AIS Portal — Green Gate Initiative',
    description:
        'Monitor Somaliland sovereign carbon credit issuance, voluntary carbon market benchmarks (VCS, Gold Standard, ICVCM/CCP, ACMI, Paris Art. 6), active projects, and portfolio analytics.',
};

export default function CarbonCreditsRoute() {
    return <CarbonCreditPage />;
}
