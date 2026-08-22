/**
 * Format commun de la cloche, quelle que soit la source.
 *
 * Deux sources l'alimentent aujourd'hui :
 *   - les armateurs, avec de vraies lignes persistées (`owner_notifications`),
 *     émises par `notifyOwner` et doublées d'un e-mail pour la plupart ;
 *   - le staff, avec des alertes **dérivées** de l'état courant, faute de table.
 *
 * Les deux convergent ici pour que la cloche n'ait qu'un seul rendu.
 */

export type NotificationType = 'registration' | 'vessel_alert' | 'payment' | 'compliance' | 'system';

export interface AppNotification {
    id: string;
    type: NotificationType;
    /**
     * Clé i18n **pleinement qualifiée** (`Dashboard.notif_x` ou
     * `OwnerPortal.notifications.kind.X.title`). Les deux sources n'ayant pas le
     * même espace de noms, la cloche résout depuis la racine.
     */
    titleKey: string;
    messageKey: string;
    messageParams?: Record<string, string | number>;
    createdAt: string;
    read: boolean;
    href?: string;
}

/** Une ligne de `owner_notifications`, telle que la rend l'API. */
export interface OwnerNotificationRow {
    id: string;
    kind: string;
    title_key: string;
    body_key: string;
    body_params: Record<string, unknown>;
    deep_link: string | null;
    read_at: string | null;
    created_at: string;
}

/**
 * Famille visuelle d'un type de notification armateur.
 *
 * Elle ne décide que de l'icône et de la couleur : le fond du message reste
 * porté par ses clés i18n. Un type inconnu retombe sur `system` plutôt que de
 * faire échouer le rendu — la base peut gagner un type avant l'interface.
 */
export function typeForOwnerKind(kind: string): NotificationType {
    if (kind.startsWith('KYC_')) return 'registration';
    if (kind === 'ALERT_DETECTED') return 'vessel_alert';
    if (kind === 'DISPUTE_UPDATED' || kind === 'OWNER_ESCALATION') return 'compliance';
    if (
        kind.startsWith('PROFORMA_') || kind.startsWith('PAYMENT_') || kind.startsWith('WALLET_')
        || kind === 'FINAL_ISSUED' || kind === 'COMPLEMENT_ISSUED' || kind === 'REFUND_ISSUED'
        || kind === 'STATEMENT_READY'
    ) return 'payment';
    return 'system';
}

/** Convertit une ligne persistée au format de la cloche. */
export function ownerRowToNotification(row: OwnerNotificationRow): AppNotification {
    return {
        id: row.id,
        type: typeForOwnerKind(row.kind),
        titleKey: row.title_key,
        messageKey: row.body_key,
        // `body_params` est du JSONB : tout ce qui n'est ni chaîne ni nombre ne
        // saurait pas s'interpoler dans un message ICU, on l'écarte.
        messageParams: sanitizeParams(row.body_params),
        createdAt: row.created_at,
        read: row.read_at !== null,
        href: row.deep_link ?? undefined,
    };
}

function sanitizeParams(params: Record<string, unknown>): Record<string, string | number> {
    const out: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(params ?? {})) {
        if (typeof value === 'string' || typeof value === 'number') out[key] = value;
        else if (value != null) out[key] = String(value);
    }
    return out;
}

/** Non lues d'abord, puis les plus récentes — l'ordre de lecture de la cloche. */
export function sortNotifications(items: readonly AppNotification[]): AppNotification[] {
    return [...items].sort((a, b) => {
        if (a.read !== b.read) return a.read ? 1 : -1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
}

/** Une ligne de `v_staff_notifications` (mig 133). */
export interface StaffNotificationRow {
    id: string;
    kind: string;
    title_key: string;
    body_key: string;
    body_params: Record<string, unknown>;
    deep_link: string | null;
    read_at: string | null;
    created_at: string;
}

/**
 * Famille visuelle d'un fait staff.
 *
 * Elle suit la nature du geste attendu, pas la table d'origine : un
 * encaissement au guichet et une réponse de débiteur touchent tous deux au rail
 * monétaire, une inscription et une validation relèvent de l'arbitrage.
 */
export function typeForStaffKind(kind: string): NotificationType {
    switch (kind) {
        case 'VALIDATION_PENDING':
        case 'REGISTRATION_SUBMITTED':
            return 'registration';
        case 'COLLECTION_ESCALATED':
        case 'DISPUTE_OPENED':
            return 'compliance';
        case 'DEBTOR_RESPONDED':
        case 'CASH_PAYMENT_RECORDED':
            return 'payment';
        default:
            return 'system';
    }
}

/** Convertit une ligne staff au format de la cloche. */
export function staffRowToNotification(row: StaffNotificationRow): AppNotification {
    return {
        id: row.id,
        type: typeForStaffKind(row.kind),
        titleKey: row.title_key,
        messageKey: row.body_key,
        messageParams: sanitizeParams(row.body_params),
        createdAt: row.created_at,
        read: row.read_at !== null,
        href: row.deep_link ?? undefined,
    };
}

