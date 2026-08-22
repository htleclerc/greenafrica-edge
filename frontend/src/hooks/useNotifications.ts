import * as React from 'react';
import { useRole } from '@/lib/RoleContext';
import { usePrincipalKind } from '@/hooks/usePrincipalKind';
import { createClient } from '@/lib/supabase/client';
import { markNotificationRead } from '@/actions/markNotificationRead';
import { markAllNotificationsRead } from '@/actions/markAllNotificationsRead';
import {
    ownerRowToNotification, sortNotifications,
    type AppNotification, type OwnerNotificationRow,
} from '@/lib/notifications';
import { applyReadState, loadReadIds, persistReadIds } from '@/lib/notificationReadState';
import { mockSecureVessels, mockTransactions } from '@/mock/datas/secureMock';
import { VesselComplianceStatus, TransactionStatus } from '@/types/secure';

export type { AppNotification, NotificationType } from '@/lib/notifications';

interface NotificationsResult {
    notifications: AppNotification[];
    pendingRegistrations: number;
    unreadCount: number;
    markRead: (id: string) => void;
    markAllRead: () => void;
}

/**
 * Prefixe d'espace de noms des alertes derivees.
 *
 * Les notifications d'armateur portent deja une cle pleinement qualifiee
 * (`OwnerPortal.notifications.kind.X.title`) ; les alertes derivees vivaient
 * sous `Dashboard.notif_*` et etaient resolues par un traducteur deja borne a
 * cet espace. La cloche resout desormais depuis la racine, pour melanger les
 * deux sources : on qualifie donc les clefs derivees a la source.
 */
const DERIVED_NS = 'Dashboard.';
const derived = (key: string) => DERIVED_NS + key;

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
            titleKey: isNonCompliant ? derived('notif_noncompliant_title') : derived('notif_payment_due_title'),
            messageKey: isNonCompliant ? derived('notif_noncompliant_msg') : derived('notif_payment_due_msg'),
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
            titleKey: derived('notif_overdue_title'),
            messageKey: derived('notif_overdue_msg'),
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
            titleKey: derived('notif_pending_title'),
            messageKey: derived('notif_pending_msg'),
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
            titleKey: derived('notif_received_title'),
            messageKey: derived('notif_received_msg'),
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
            titleKey: derived('notif_new_vessel_title'),
            messageKey: derived('notif_new_vessel_msg'),
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
        titleKey: derived('notif_registration_title'),
        messageKey: derived('notif_registration_msg'),
        messageParams: { org: 'Gulf Marine Services FZCO' },
        createdAt: new Date(now - 24 * 3600_000).toISOString(),
        read: true,
        href: '/dashboard/validations',
    });

    // Sort: unread first, then by createdAt descending
    return sortNotifications(notifications);
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
                titleKey: derived('notif_registration_title'),
                messageKey: derived('notif_registration_msg'),
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
                    titleKey: derived('notif_overdue_title'),
                    messageKey: derived('notif_overdue_msg'),
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
                    titleKey: isNonCompliant ? derived('notif_noncompliant_title') : derived('notif_payment_due_title'),
                    messageKey: isNonCompliant ? derived('notif_noncompliant_msg') : derived('notif_payment_due_msg'),
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

    return { notifications: sortNotifications(notifications), pendingRegistrations };
}

// ── Notifications d'armateur (vraies lignes persistees) ─────────────────────

/**
 * Lit les notifications reellement emises pour l'armateur connecte.
 *
 * `owner_notifications` porte RLS sans aucune politique (mig 053) : un client
 * de session n'y verrait rien. La route API fait la bascule service-role
 * derriere le controle d'authentification, c'est donc elle qu'on interroge.
 */
async function fetchOwnerNotifications(): Promise<AppNotification[]> {
    const res = await fetch('/api/owner/notifications?limit=20', { cache: 'no-store' });
    if (!res.ok) throw new Error(`notifications: ${res.status}`);
    const data = (await res.json()) as { notifications?: OwnerNotificationRow[] };
    return sortNotifications((data.notifications ?? []).map(ownerRowToNotification));
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Alimente la cloche du tableau de bord.
 *
 * Deux sources, une seule sortie :
 *   - **operateur** : les lignes de `owner_notifications`, celles-la memes qui
 *     declenchent les e-mails. Le lu est persiste cote serveur (`read_at`).
 *   - **staff** : faute de table, des alertes derivees de l'etat courant. Le lu
 *     est memorise dans le navigateur, sans quoi chaque rafraichissement les
 *     rendait toutes non lues (cf. lib/notificationReadState).
 */
export function useNotifications(): NotificationsResult {
    const { isDemo, ready } = useRole();
    const { kind } = usePrincipalKind();
    const [notifications, setNotifications] = React.useState<AppNotification[]>([]);
    const [pendingRegistrations, setPendingRegistrations] = React.useState(0);
    // Le lu local ne concerne que les sources sans persistance serveur.
    const readIdsRef = React.useRef<Set<string>>(new Set());
    const isOperator = kind === 'operator';

    React.useEffect(() => {
        if (!ready) return;
        readIdsRef.current = loadReadIds();
        let cancelled = false;

        async function load() {
            if (isDemo) {
                setNotifications(applyReadState(buildDemoNotifications(), readIdsRef.current));
                setPendingRegistrations(2);
                return;
            }

            if (isOperator) {
                try {
                    const rows = await fetchOwnerNotifications();
                    if (!cancelled) {
                        // Le lu vient de `read_at` : rien a rejouer localement.
                        setNotifications(rows);
                        setPendingRegistrations(0);
                    }
                } catch {
                    // Une cloche muette vaut mieux qu'un tableau de bord casse.
                    if (!cancelled) setNotifications([]);
                }
                return;
            }

            const supabase = createClient();
            const { notifications: n, pendingRegistrations: pending } =
                await fetchRealNotifications(supabase);
            if (cancelled) return;
            setNotifications(applyReadState(n, readIdsRef.current));
            setPendingRegistrations(pending);
        }

        void load();
        const interval = setInterval(() => { void load(); }, 60_000);
        return () => { cancelled = true; clearInterval(interval); };
    }, [isDemo, ready, isOperator]);

    const markRead = React.useCallback((id: string) => {
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
        if (isOperator) {
            // Persistance serveur ; l'echec est trace, il n'interrompt pas la lecture.
            void markNotificationRead({ notificationId: id })
                .catch((e) => console.error('[useNotifications] markNotificationRead:', e));
        } else {
            readIdsRef.current = persistReadIds([id]);
        }
    }, [isOperator]);

    const markAllRead = React.useCallback(() => {
        setNotifications((prev) => {
            if (!isOperator) readIdsRef.current = persistReadIds(prev.map((n) => n.id));
            return prev.map((n) => ({ ...n, read: true }));
        });
        if (isOperator) {
            void markAllNotificationsRead()
                .catch((e) => console.error('[useNotifications] markAllNotificationsRead:', e));
        }
    }, [isOperator]);

    const unreadCount = notifications.filter((n) => !n.read).length;

    return { notifications, pendingRegistrations, unreadCount, markRead, markAllRead };
}
