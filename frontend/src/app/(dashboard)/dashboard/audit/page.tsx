import type { Metadata } from 'next';
import { AuditLogPage } from '@/components/dashboard/audit/AuditLogPage';

export const metadata: Metadata = {
    title: 'Audit Trail | Africgreen',
    description: 'Immutable audit log of all system events and operator actions.',
};

export default function AuditRoute() {
    return <AuditLogPage />;
}
