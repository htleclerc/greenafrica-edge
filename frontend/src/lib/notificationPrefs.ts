import type { NotificationKind } from '@/services/notificationService';

/**
 * Préférences d'envoi d'un profil.
 *
 * Volontairement courtes. L'écran en affichait huit, dont cinq ne commandaient
 * rien : SMS pour alertes critiques (aucun canal SMS n'existe), digest
 * quotidien, rapport hebdomadaire, activité des logs d'audit, déclaration DCS.
 * Une bascule qui ne gouverne aucun envoi est du même ordre que le badge
 * « MFA activée » sur un compte sans facteur — elle promet un comportement.
 *
 * N'en restent que celles dont on peut dire ce qu'elles font.
 */
export type NotificationPrefKey = 'vessel_alert' | 'payment_due' | 'monthly_statement';

export const NOTIFICATION_PREF_KEYS: NotificationPrefKey[] = [
    'vessel_alert',
    'payment_due',
    'monthly_statement',
];

/** Tout est actif tant que la personne n'a rien décidé. */
export const DEFAULT_NOTIFICATION_PREFS: Record<NotificationPrefKey, boolean> = {
    vessel_alert: true,
    payment_due: true,
    monthly_statement: true,
};

/**
 * Quels faits chaque bascule gouverne.
 *
 * Ce qui n'est PAS dans cette table part toujours : confirmations de paiement,
 * refus, KYC, remboursements, et les faits de sécurité (accès ouvert ou fermé
 * sur le compte). Se taire sur un mouvement d'argent ou sur un accès parce
 * qu'une case a été décochée serait une faute, pas une préférence.
 */
const GOVERNED: Record<NotificationPrefKey, NotificationKind[]> = {
    vessel_alert: ['ALERT_DETECTED'],
    payment_due: ['PROFORMA_ISSUED', 'PROFORMA_REMINDER', 'OWNER_ESCALATION'],
    monthly_statement: ['STATEMENT_READY'],
};

/** Normalise ce que porte la colonne JSONB, qui peut être n'importe quoi. */
export function parseNotificationPrefs(raw: unknown): Record<NotificationPrefKey, boolean> {
    const out = { ...DEFAULT_NOTIFICATION_PREFS };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const key of NOTIFICATION_PREF_KEYS) {
        const value = (raw as Record<string, unknown>)[key];
        // `=== true` / `=== false` et non une conversion : une valeur aberrante
        // retombe sur le défaut plutôt que sur `false`, qui couperait un envoi.
        if (value === true || value === false) out[key] = value;
    }
    return out;
}

/**
 * L'envoi de ce fait est-il autorisé par les préférences ?
 *
 * Un fait non gouverné est toujours autorisé — c'est la règle qui protège les
 * notifications transactionnelles d'un décochage involontaire.
 */
export function allowsEmail(kind: NotificationKind, raw: unknown): boolean {
    const prefs = parseNotificationPrefs(raw);
    for (const key of NOTIFICATION_PREF_KEYS) {
        if (GOVERNED[key].includes(kind)) return prefs[key];
    }
    return true;
}
