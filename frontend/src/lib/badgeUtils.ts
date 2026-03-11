import { VesselComplianceStatus, TransactionStatus, AuditSeverity } from '@/types/secure';

export type BadgeVariant =
    | 'compliant' | 'payment_due' | 'processing' | 'non_compliant' | 'approaching' | 'exempt'
    | 'pending' | 'paid' | 'overdue' | 'disputed'
    | 'info' | 'warning' | 'critical'
    | 'online' | 'degraded' | 'offline'
    | 'active' | 'draft' | 'archived';

export function complianceVariant(status: VesselComplianceStatus): BadgeVariant {
    const map: Record<VesselComplianceStatus, BadgeVariant> = {
        [VesselComplianceStatus.COMPLIANT]:     'compliant',
        [VesselComplianceStatus.PAYMENT_DUE]:   'payment_due',
        [VesselComplianceStatus.PROCESSING]:    'processing',
        [VesselComplianceStatus.NON_COMPLIANT]: 'non_compliant',
        [VesselComplianceStatus.APPROACHING]:   'approaching',
        [VesselComplianceStatus.EXEMPT]:        'exempt',
    };
    return map[status];
}

export function transactionVariant(status: TransactionStatus): BadgeVariant {
    const map: Record<TransactionStatus, BadgeVariant> = {
        [TransactionStatus.PAID]:     'paid',
        [TransactionStatus.PENDING]:  'pending',
        [TransactionStatus.OVERDUE]:  'overdue',
        [TransactionStatus.EXEMPT]:   'exempt',
        [TransactionStatus.DISPUTED]: 'disputed',
    };
    return map[status];
}

export function severityVariant(s: AuditSeverity): BadgeVariant {
    const map: Record<AuditSeverity, BadgeVariant> = {
        [AuditSeverity.INFO]:     'info',
        [AuditSeverity.WARNING]:  'warning',
        [AuditSeverity.CRITICAL]: 'critical',
    };
    return map[s];
}
