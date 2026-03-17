import * as React from 'react';
import { useRole } from '@/lib/RoleContext';
import { createClient } from '@/lib/supabase/client';
import { mockSecureVessels, mockTransactions } from '@/mock/datas/secureMock';
import { VesselComplianceStatus, TransactionStatus } from '@/types/secure';

export type NotificationType = 'registration' | 'vessel_alert' | 'payment' | 'compliance' | 'system';

export interface AppNotification {
    id: string;
    type: NotificationType;
    /** i18n key for the title (resolved in component via t()) */
    titleKey: string;
    /** i18n key for the message (resolved in component via t()) */
    messageKey: string;
    /** Interpolation params for messageKey */
    messageParams?: Record<string, string | number>;
    /** ISO timestamp or relative string */
    createdAt: string;
    read: boolean;
    href?: string;
}

interface NotificationsResult {
    notifications: AppNotification[];
    pendingRegistrations: number;
    unreadCount: number;
    markRead: (id: string) => void;
    markAllRead: () => void;
}

// ── Demo notifications generated from mock data ──────────────────────────────

function buildDemoNotifications(): AppNotification[] {
    const now = Date.now();
    const notifications: AppNotification[] = [];

    // 1. Non-compliant / payment-due vessels → compliance alerts
    const alertVessels = mockSecureVessels.filter(
        (v) => v.complianceStatus === VesselComplianceStatus.NON_COMPLIANT ||
               v.complianceStatus === VesselComplianceStatus.PAYMENT_DUE,
    );
    alertVessels.forEach((v, i) => {
        const isNonCompliant = v.complianceStatus === VesselComplianceStatus.NON_COMPLIANT;
        notifications.push({
            id: `demo-compliance-${v.id}`,
            type: 'compliance',
            titleKey: isNonCompliant ? 'notif_noncompliant_title' : 'notif_payment_due_title',
            messageKey: isNonCompliant ? 'notif_noncompliant_msg' : 'notif_payment_due_msg',
            messageParams: {
                vessel: v.name,
                imo: v.imoNumber,
                amount: v.taxLiabilityUsd.toLocaleString('en-US'),
            },
            createdAt: new Date(now - (10 + i * 15) * 60_000).toISOString(), // 10min, 25min ago...
            read: false,
            href: '/dashboard/vessels',
        });
    });

    // 2. Overdue transactions → payment alerts
    const overdueTransactions = mockTransactions.filter((t) => t.status === TransactionStatus.OVERDUE);
    overdueTransactions.forEach((txn, i) => {
        notifications.push({
            id: `demo-overdue-${txn.id}`,
            type: 'payment',
            titleKey: 'notif_overdue_title',
            messageKey: 'notif_overdue_msg',
            messageParams: {
                vessel: txn.vesselName,
                amount: txn.taxAmountUsd.toLocaleString('en-US'),
            },
            createdAt: new Date(now - (45 + i * 30) * 60_000).toISOString(),
            read: false,
            href: '/dashboard/invoices',
        });
    });

    // 3. Pending transactions → payment pending
    const pendingTransactions = mockTransactions.filter((t) => t.status === TransactionStatus.PENDING);
    pendingTransactions.forEach((txn, i) => {
        notifications.push({
            id: `demo-pending-${txn.id}`,
            type: 'payment',
            titleKey: 'notif_pending_title',
            messageKey: 'notif_pending_msg',
            messageParams: {
                vessel: txn.vesselName,
                amount: txn.taxAmountUsd.toLocaleString('en-US'),
            },
            createdAt: new Date(now - (2 + i) * 3600_000).toISOString(), // 2h, 3h ago...
            read: false,
            href: '/dashboard/invoices',
        });
    });

    // 4. Recently paid transactions → payment received (read)
    const paidTransactions = mockTransactions
        .filter((t) => t.status === TransactionStatus.PAID)
        .slice(0, 2);
    paidTransactions.forEach((txn, i) => {
        notifications.push({
            id: `demo-paid-${txn.id}`,
            type: 'system',
            titleKey: 'notif_received_title',
            messageKey: 'notif_received_msg',
            messageParams: {
                vessel: txn.vesselName,
                amount: txn.taxAmountUsd.toLocaleString('en-US'),
            },
            createdAt: new Date(now - (6 + i * 8) * 3600_000).toISOString(),
            read: true,
        });
    });

    // 5. New vessel entering EEZ
    const approachingVessels = mockSecureVessels.filter(
        (v) => v.complianceStatus === VesselComplianceStatus.PROCESSING,
    );
    approachingVessels.forEach((v, i) => {
        notifications.push({
            id: `demo-eez-${v.id}`,
            type: 'vessel_alert',
            titleKey: 'notif_new_vessel_title',
            messageKey: 'notif_new_vessel_msg',
            messageParams: { vessel: v.name, port: v.portCall },
            createdAt: new Date(now - (3 + i) * 3600_000).toISOString(),
            read: true,
            href: '/dashboard',
        });
    });

    // 6. Registration request (always one demo)
    notifications.push({
        id: 'demo-reg-1',
        type: 'registration',
        titleKey: 'notif_registration_title',
        messageKey: 'notif_registration_msg',
        messageParams: { org: 'Gulf Marine Services FZCO' },
        createdAt: new Date(now - 24 * 3600_000).toISOString(),
        read: true,
        href: '/dashboard/validations',
    });

    // Sort: unread first, then by createdAt descending
    notifications.sort((a, b) => {
        if (a.read !== b.read) return a.read ? 1 : -1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return notifications;
}

// ── Real notifications (derived from DB state) ──────────────────────────────

async function fetchRealNotifications(supabase: ReturnType<typeof createClient>): Promise<{
    notifications: AppNotification[];
    pendingRegistrations: number;
}> {
    const notifications: AppNotification[] = [];

    // 1. Pending registrations
    const { data: regs, count: regCount } = await supabase
        .from('registration_requests')
        .select('id, contact_name, org_name, created_at', { count: 'exact' })
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false })
        .limit(5);

    const pendingRegistrations = regCount ?? 0;

    if (regs) {
        for (const reg of regs) {
            const row = reg as Record<string, unknown>;
            notifications.push({
                id: `reg-${row.id}`,
                type: 'registration',
                titleKey: 'notif_registration_title',
                messageKey: 'notif_registration_msg',
                messageParams: { org: String(row.org_name) },
                createdAt: row.created_at as string,
                read: false,
                href: '/dashboard/validations',
            });
        }
    }

    // 2. Overdue transactions
    try {
        const { data: overdue } = await supabase
            .from('transactions')
            .select('id, vessel_name, tax_amount_usd, created_at')
            .eq('status', 'OVERDUE')
            .order('created_at', { ascending: false })
            .limit(3);

        if (overdue) {
            for (const txn of overdue) {
                const row = txn as Record<string, unknown>;
                notifications.push({
                    id: `txn-${row.id}`,
                    type: 'payment',
                    titleKey: 'notif_overdue_title',
                    messageKey: 'notif_overdue_msg',
                    messageParams: {
                        vessel: String(row.vessel_name),
                        amount: Number(row.tax_amount_usd).toLocaleString(),
                    },
                    createdAt: row.created_at as string,
                    read: false,
                    href: '/dashboard/invoices',
                });
            }
        }
    } catch {
        // transactions table may not exist yet
    }

    // 3. Non-compliant vessels
    try {
        const { data: nonCompliant } = await supabase
            .from('vessels')
            .select('id, name, imo_number, compliance_status, updated_at')
            .in('compliance_status', ['NON_COMPLIANT', 'PAYMENT_DUE'])
            .order('updated_at', { ascending: false })
            .limit(3);

        if (nonCompliant) {
            for (const v of nonCompliant) {
                const row = v as Record<string, unknown>;
                const isNonCompliant = row.compliance_status === 'NON_COMPLIANT';
                notifications.push({
                    id: `vessel-${row.id}`,
                    type: 'compliance',
                    titleKey: isNonCompliant ? 'notif_noncompliant_title' : 'notif_payment_due_title',
                    messageKey: isNonCompliant ? 'notif_noncompliant_msg' : 'notif_payment_due_msg',
                    messageParams: {
                        vessel: String(row.name),
                        imo: String(row.imo_number ?? ''),
                        amount: '0',
                    },
                    createdAt: row.updated_at as string,
                    read: false,
                    href: '/dashboard/vessels',
                });
            }
        }
    } catch {
        // vessels table may not exist yet
    }

    notifications.sort((a, b) => {
        if (a.read !== b.read) return a.read ? 1 : -1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return { notifications, pendingRegistrations };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useNotifications(): NotificationsResult {
    const { isDemo, ready } = useRole();
    const [notifications, setNotifications] = React.useState<AppNotification[]>([]);
    const [pendingRegistrations, setPendingRegistrations] = React.useState(0);

    React.useEffect(() => {
        if (!ready) return;

        if (isDemo) {
            setNotifications(buildDemoNotifications());
            setPendingRegistrations(2);

            // Refresh demo timestamps every 60s so relative times update
            const interval = setInterval(() => {
                setNotifications(buildDemoNotifications());
            }, 60_000);
            return () => clearInterval(interval);
        }

        const supabase = createClient();
        fetchRealNotifications(supabase).then(({ notifications: n, pendingRegistrations: p }) => {
            setNotifications(n);
            setPendingRegistrations(p);
        });

        const interval = setInterval(() => {
            fetchRealNotifications(supabase).then(({ notifications: n, pendingRegistrations: p }) => {
                setNotifications(n);
                setPendingRegistrations(p);
            });
        }, 60_000);

        return () => clearInterval(interval);
    }, [isDemo, ready]);

    const markRead = React.useCallback((id: string) => {
        setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    }, []);

    const markAllRead = React.useCallback(() => {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    }, []);

    const unreadCount = notifications.filter((n) => !n.read).length;

    return { notifications, pendingRegistrations, unreadCount, markRead, markAllRead };
}
