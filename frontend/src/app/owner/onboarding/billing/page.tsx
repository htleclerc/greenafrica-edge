import { redirect } from 'next/navigation';
import { requireOwner } from '@/lib/auth/requireOwner';
import { BillingWizard } from './BillingWizard';

export default async function OwnerBillingOnboardingPage() {
    const session = await requireOwner();
    if (session.shipowner.kyc_level_c_completed_at) {
        redirect('/dashboard');
    }
    return (
        <div className="p-6 max-w-2xl mx-auto">
            <BillingWizard shipownerName={session.shipowner.name} />
        </div>
    );
}
