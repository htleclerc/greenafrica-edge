import { CarbonTaxPage } from '@/components/carbon-tax/CarbonTaxPage';

export const metadata = {
    title: 'Carbon Tax | AIS Portal — Africgreen Initiative',
    description:
        'Monitor maritime carbon tax collection, vessel compliance, international tax rates (IMO CII, EU ETS, CORSIA), and revenue trends for the Somaliland ZEE.',
};

export default function CarbonTaxRoute() {
    return <CarbonTaxPage />;
}
