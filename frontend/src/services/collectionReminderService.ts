// Logique pure du moteur de relance : quel palier est dû pour une pro-forma,
// selon son âge, ce qui a déjà été envoyé, son statut et la dernière réponse du
// débiteur. Aucun accès base/réseau — testable en isolation.

export type ReminderTier = 'J3' | 'J7' | 'J15' | 'J30' | 'J45';

export type DebtorResponseType =
    | 'SILENT' | 'ACKNOWLEDGE' | 'DISPUTE' | 'PAYMENT_PROMISE'
    | 'PARTIAL_PAYMENT' | 'PAID' | 'REFUSED';

/** Paliers automatiques, du plus précoce au plus tardif, avec leur seuil en jours. */
const TIER_THRESHOLDS: ReadonlyArray<{ tier: ReminderTier; minAge: number }> = [
    { tier: 'J3', minAge: 3 },
    { tier: 'J7', minAge: 7 },
    { tier: 'J15', minAge: 15 },
    { tier: 'J30', minAge: 30 },
    { tier: 'J45', minAge: 45 },
];

export const AUTO_TIERS: ReminderTier[] = TIER_THRESHOLDS.map((t) => t.tier);

/** Nombre de jours de grâce accordés après une promesse de paiement. */
export const PAYMENT_PROMISE_GRACE_DAYS = 7;

/** Statuts de transaction pour lesquels l'escalade continue. Tout autre = arrêt. */
const ESCALATABLE_STATUSES = new Set(['PENDING', 'OVERDUE']);

/** Palier attendu pour un âge donné : le plus tardif dont le seuil est atteint. */
export function tierForAge(ageDays: number): ReminderTier | null {
    let match: ReminderTier | null = null;
    for (const { tier, minAge } of TIER_THRESHOLDS) {
        if (ageDays >= minAge) match = tier;
    }
    return match;
}

export interface DueTierInput {
    status: string;
    ageDays: number;
    sentTiers: ReminderTier[];
    latestResponse: DebtorResponseType | null;
    latestResponseAt: Date | null;
    now: Date;
}

/**
 * Palier à envoyer cette passe, ou null s'il n'y a rien à faire.
 *
 * Ordre des gardes : arrêt (statut de clôture ou contesté) → pause (DISPUTE,
 * grâce PAYMENT_PROMISE) → palier attendu pour l'âge → idempotence (déjà envoyé).
 */
export function dueTier(input: DueTierInput): ReminderTier | null {
    // Arrêt : la créance n'est plus recouvrable automatiquement.
    if (!ESCALATABLE_STATUSES.has(input.status)) return null;

    // Pause : une créance contestée ne s'escalade pas tant qu'elle n'est pas tranchée.
    if (input.status === 'DISPUTED' || input.latestResponse === 'DISPUTE') return null;

    // Pause : grâce après une promesse de paiement.
    if (input.latestResponse === 'PAYMENT_PROMISE' && input.latestResponseAt) {
        const graceEnd = new Date(
            input.latestResponseAt.getTime() + PAYMENT_PROMISE_GRACE_DAYS * 86_400_000,
        );
        if (input.now < graceEnd) return null;
    }

    const expected = tierForAge(input.ageDays);
    if (!expected) return null;

    // Idempotence : ce palier a déjà été envoyé.
    if (input.sentTiers.includes(expected)) return null;

    return expected;
}

/** Ton du message par palier — pilote le sujet/corps de l'e-mail. */
export function reminderTemplate(
    tier: ReminderTier,
): { templateId: string; tone: 'courtesy' | 'amicable' | 'formal' | 'pre-bailiff' } {
    switch (tier) {
        case 'J3':
        case 'J7':
            return { templateId: `${tier}_courtesy_reminder`, tone: 'courtesy' };
        case 'J15':
            return { templateId: 'J15_amicale_reminder', tone: 'amicable' };
        case 'J30':
            return { templateId: 'J30_formelle_notice', tone: 'formal' };
        case 'J45':
            return { templateId: 'J45_pre_bailiff_notice', tone: 'pre-bailiff' };
    }
}
