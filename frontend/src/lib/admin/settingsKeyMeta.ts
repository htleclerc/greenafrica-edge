/**
 * Ce que l'écran doit savoir d'une clé `app_config` pour la présenter
 * honnêtement : son unité, ses bornes, et si elle est dangereuse.
 *
 * Les bornes sont larges — elles arrêtent une faute de frappe (un rayon de
 * 500 NM, une tolérance de 120 %), pas une décision. Une valeur hors bornes
 * est refusée AVANT l'appel serveur, avec la borne dans le message.
 */
export interface SettingsKeyMeta {
    /** Suffixe affiché à côté du champ : NM, h, %, min, j. */
    unit?: string;
    min?: number;
    max?: number;
    /** Entier attendu (compteurs, jours, heures). */
    integer?: boolean;
    /** Secret ou plomberie : enregistrement confirmé, cadre rouge. */
    danger?: boolean;
}

export const SETTINGS_KEY_META: Readonly<Record<string, SettingsKeyMeta>> = {
    'arrival.corridor_radius_nm': { unit: 'NM', min: 1, max: 200 },
    'arrival.claim_sla_hours': { unit: 'h', min: 1, max: 168, integer: true },
    'arrival.escalation_eta_buffer_h': { unit: 'h', min: 0, max: 72, integer: true },
    'reconciliation.tolerance_pct': { unit: '%', min: 0, max: 50 },
    'reconciliation.check_interval_min': { unit: 'min', min: 5, max: 1440, integer: true },
    'owner_escalation.delay_days': { unit: 'j', min: 1, max: 90, integer: true },
    'owner_escalation.reminder_count': { min: 0, max: 10, integer: true },
    'queue.worker_url': { danger: true },
    'queue.worker_secret': { danger: true },
};

export function keyMeta(key: string): SettingsKeyMeta {
    return SETTINGS_KEY_META[key] ?? {};
}

export type BoundsCheck = { ok: true } | { ok: false; reason: 'min' | 'max' | 'integer'; bound?: number };

/** Vérifie un nombre contre les bornes de sa clé. Sans bornes : toujours ok. */
export function checkBounds(key: string, value: number): BoundsCheck {
    const m = keyMeta(key);
    if (m.integer && !Number.isInteger(value)) return { ok: false, reason: 'integer' };
    if (m.min !== undefined && value < m.min) return { ok: false, reason: 'min', bound: m.min };
    if (m.max !== undefined && value > m.max) return { ok: false, reason: 'max', bound: m.max };
    return { ok: true };
}
