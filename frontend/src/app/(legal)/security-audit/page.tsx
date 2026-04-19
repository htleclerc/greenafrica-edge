import type { Metadata } from 'next';
import SecurityAuditContent from '@/components/legal/SecurityAuditContent';

export const metadata: Metadata = {
    title: 'Security Audit | Green Gate',
    description: 'Security Audit Report for the Green Gate Maritime Carbon Intelligence Platform — Government of Somaliland.',
};

export default function SecurityAuditPage() {
    return <SecurityAuditContent />;
}
