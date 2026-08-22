import * as React from 'react';
import { useRole } from '@/lib/RoleContext';
import { usePrincipalKind } from '@/hooks/usePrincipalKind';
import { createClient } from '@/lib/supabase/client';
import { markNotificationRead } from '@/actions/markNotificationRead';
import { markAllNotificationsRead } from '@/actions/markAllNotificationsRead';
import {
    markStaffNotificationRead, markAllStaffNotificationsRead,
} from '@/actions/markStaffNotificationsRead';
import { staffRowToNotification, type StaffNotificationRow } from '@/lib/notifications';
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

// ── Notifications du staff (mig 133) ────────────────────────────────────────

/**
 * Lit le fil du staff.
 *
 * `v_staff_notifications` est une vue `security_invoker` : les policies de la
 * mig 133 s'appliquent, elle ne rend donc que les faits de la juridiction de
 * l'agent et adresses a son role, avec SON etat de lecture. Un client de
 * session suffit — pas de bascule service-role.
 */
async function fetchStaffNotifications(
    supabase: ReturnType<typeof createClient>,
): Promise<AppNotification[]> {
    const { data, error } = await supabase
        .from('v_staff_notifications')
        .select('id, kind, title_key, body_key, body_params, deep_link, read_at, created_at')
        .order('created_at', { ascending: false })
        .limit(30);
    if (error) throw new Error(`staff notifications: ${error.message}`);
    return sortNotifications(
        ((data ?? []) as unknown as StaffNotificationRow[]).map(staffRowToNotification),
    );
}

/**
 * Compte les inscriptions en attente, pour la pastille de la barre laterale.
 *
 * C'est un compte de travail restant, pas un evenement : il se derive
 * legitimement de l'etat courant, la ou la cloche ne montre plus que des faits
 * datés (mig 133).
 */
async function fetchPendingRegistrations(
    supabase: ReturnType<typeof createClient>,
): Promise<number> {
    const { count } = await supabase
        .from('registration_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'PENDING');
    return count ?? 0;
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
            const [rows, pending] = await Promise.all([
                fetchStaffNotifications(supabase).catch(() => [] as AppNotification[]),
                fetchPendingRegistrations(supabase).catch(() => 0),
            ]);
            if (cancelled) return;
            // Le lu vient de `staff_notification_reads` : plus rien a rejouer
            // depuis le navigateur, contrairement aux alertes dérivées d'avant.
            setNotifications(rows);
            setPendingRegistrations(pending);
        }

        void load();
        const interval = setInterval(() => { void load(); }, 60_000);
        return () => { cancelled = true; clearInterval(interval); };
    }, [isDemo, ready, isOperator]);

    const markRead = React.useCallback((id: string) => {
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
        // Persistance serveur des deux côtés ; l'échec est tracé, il n'interrompt
        // pas la lecture.
        if (isOperator) {
            void markNotificationRead({ notificationId: id })
                .catch((e) => console.error('[useNotifications] markNotificationRead:', e));
        } else if (isDemo) {
            // Les notifications de démonstration sont synthétiques : aucune table
            // derrière elles, leur lu ne peut vivre que dans le navigateur.
            readIdsRef.current = persistReadIds([id]);
        } else {
            void markStaffNotificationRead({ notificationId: id })
                .catch((e) => console.error('[useNotifications] markStaffNotificationRead:', e));
        }
    }, [isOperator, isDemo]);

    const markAllRead = React.useCallback(() => {
        setNotifications((prev) => {
            if (!isOperator && isDemo) {
                readIdsRef.current = persistReadIds(prev.map((n) => n.id));
            }
            return prev.map((n) => ({ ...n, read: true }));
        });
        if (isOperator) {
            void markAllNotificationsRead()
                .catch((e) => console.error('[useNotifications] markAllNotificationsRead:', e));
        } else if (!isDemo) {
            void markAllStaffNotificationsRead()
                .catch((e) => console.error('[useNotifications] markAllStaffNotificationsRead:', e));
        }
    }, [isOperator, isDemo]);

    const unreadCount = notifications.filter((n) => !n.read).length;

    return { notifications, pendingRegistrations, unreadCount, markRead, markAllRead };
}
