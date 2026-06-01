import { ShippingAgentView } from '@/components/dashboard/tco/TcoDashboard';

export const metadata = { title: 'Owner portal — TCO' };
export const dynamic = 'force-dynamic';

export default function OwnerTcoPage() {
    return (
        <div className="px-6 py-6 max-w-6xl mx-auto">
            <ShippingAgentView />
        </div>
    );
}
