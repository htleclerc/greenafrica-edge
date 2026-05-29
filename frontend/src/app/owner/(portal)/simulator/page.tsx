import { TaxSimulatorPage } from '@/components/dashboard/simulator/TaxSimulatorPage';

export const metadata = { title: 'Owner portal — tax simulator' };
export const dynamic = 'force-dynamic';

export default function OwnerSimulatorPage() {
    return <TaxSimulatorPage />;
}
