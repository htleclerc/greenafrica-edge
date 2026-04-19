import type { Metadata } from 'next';
import { PendingApprovalPage } from '@/components/auth/PendingApprovalPage';

export const metadata: Metadata = {
    title: 'Pending Approval | Green Gate',
    description: 'Your account is under review by an administrator.',
};

export default function PendingApprovalRoute() {
    return <PendingApprovalPage />;
}
