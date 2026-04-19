import type { Metadata } from 'next';
import { CarbonTaxSettingsPage } from '@/components/dashboard/tax/CarbonTaxSettingsPage';

export const metadata: Metadata = {
    title: 'Carbon Tax Settings | Green Gate',
    description: 'Configure maritime carbon tax rates, monitor collection, and manage exemptions.',
};

export default function TaxSettingsRoute() {
    return <CarbonTaxSettingsPage />;
}
