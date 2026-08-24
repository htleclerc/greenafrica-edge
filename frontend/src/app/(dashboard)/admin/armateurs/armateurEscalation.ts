import type { OsAccent } from '@/lib/osAccent';
import type { ArmateurCockpitRow } from '@/services/armateurService';

/**
 * Niveau d'escalade d'un dossier armateur.
 *
 * C'est ce qui donne son liseré gauche à la ligne du cockpit : au balayage
 * vertical, l'ancienneté de la dette se lit avant le texte. L'ordre de cette
 * union est l'ordre de gravité, du plus grave au moins grave — `LEVEL_ORDER`
 * s'en sert pour le tri par défaut.
 */
export type EscalationLevel =
    | 'sanctioned'  // OFAC / UN — aucun contact possible, procédure in rem
    | 'escalated'   // la rampe légale est déjà passée à J45 / huissier / judiciaire
    | 'default'     // en retard de 30 jours ou plus
    | 'late'        // en retard, moins de 30 jours
    | 'disputed'    // le débiteur conteste — arbitrage avant relance
    | 'kyc'         // compte jamais activé : on ne peut pas encore relancer
    | 'clear';      // rien à faire

/** Le seuil des 30 jours sépare « en retard » de « en défaut » (cf. KPI du cockpit). */
export const DEFAULT_THRESHOLD_DAYS = 30;

/** Paliers de la rampe légale à partir desquels le dossier est considéré escaladé. */
const ESCALATED_TIERS = new Set(['J45', 'BAILIFF', 'JUDICIAL']);

const LEVEL_ORDER: EscalationLevel[] = [
    'sanctioned', 'escalated', 'default', 'late', 'disputed', 'kyc', 'clear',
];

export const LEVEL_ACCENT: Record<EscalationLevel, OsAccent> = {
    sanctioned: 'danger',
    escalated:  'danger',
    default:    'danger',
    late:       'warning',
    disputed:   'info',
    kyc:        'warning',
    clear:      'neutral',
};

/**
 * Ancienneté de la dette, en jours pleins.
 *
 * `next_due_date` est le `MIN(due_date)` des pro-formas encore ouvertes
 * (mig 127) : c'est donc la plus vieille échéance non soldée, et le nombre de
 * jours écoulés depuis est bien l'ancienneté de la dette — pas le délai avant
 * la prochaine facture. Rend `null` tant que rien n'est échu.
 */
export function debtAgeDays(row: ArmateurCockpitRow, now: Date = new Date()): number | null {
    if (!row.next_due_date) return null;
    const due = new Date(row.next_due_date);
    if (Number.isNaN(due.getTime())) return null;
    const days = Math.floor((now.getTime() - due.getTime()) / 86_400_000);
    return days > 0 ? days : null;
}

/**
 * Classe un armateur.
 *
 * L'ordre des tests est un ordre de préséance, pas une commodité : une entité
 * sanctionnée passe avant tout (on n'a pas le droit de la relancer), un litige
 * passe avant le retard (relancer un dossier contesté est une faute de
 * procédure), et un compte jamais activé passe avant « rien à faire » (il n'est
 * pas à jour, il est injoignable).
 */
export function escalationLevel(row: ArmateurCockpitRow, now: Date = new Date()): EscalationLevel {
    if (row.sanctioned) return 'sanctioned';
    if (row.last_auto_tier && ESCALATED_TIERS.has(row.last_auto_tier)) return 'escalated';
    if (row.latest_response_type === 'DISPUTE') return 'disputed';

    const age = debtAgeDays(row, now);
    if (age !== null && row.overdue_count > 0) {
        return age >= DEFAULT_THRESHOLD_DAYS ? 'default' : 'late';
    }
    if (row.account_state !== 'ACTIVE' && row.open_count > 0) return 'kyc';
    return 'clear';
}

/** Onglets du cockpit. `all` ne filtre rien. */
export type CockpitTab = 'defaulting' | 'all' | 'escalated' | 'kyc';

const TAB_LEVELS: Record<Exclude<CockpitTab, 'all'>, Set<EscalationLevel>> = {
    defaulting: new Set<EscalationLevel>(['sanctioned', 'escalated', 'default', 'late']),
    escalated:  new Set<EscalationLevel>(['escalated']),
    kyc:        new Set<EscalationLevel>(['kyc']),
};

export function matchesTab(level: EscalationLevel, tab: CockpitTab): boolean {
    return tab === 'all' || TAB_LEVELS[tab].has(level);
}

/**
 * Tri par défaut du cockpit : ancienneté de la dette décroissante, à niveau
 * d'escalade égal. Le plus vieux dossier du niveau le plus grave arrive en tête,
 * et c'est lui qui porte l'unique action pleine de l'écran.
 */
export function sortByDebtAge<T extends ArmateurCockpitRow>(rows: T[], now: Date = new Date()): T[] {
    return [...rows].sort((a, b) => {
        const la = LEVEL_ORDER.indexOf(escalationLevel(a, now));
        const lb = LEVEL_ORDER.indexOf(escalationLevel(b, now));
        if (la !== lb) return la - lb;
        const aa = debtAgeDays(a, now) ?? -1;
        const ab = debtAgeDays(b, now) ?? -1;
        if (aa !== ab) return ab - aa;
        return b.total_outstanding_usd - a.total_outstanding_usd;
    });
}

export interface CockpitTotals {
    outstandingUsd: number;
    openInvoices: number;
    /** Encours porté par les dossiers d'au moins 30 jours — la part vraiment à risque. */
    agedOutstandingUsd: number;
    agedOwners: number;
    paidUsd: number;
    invoicedUsd: number;
    /** Ancienneté moyenne des dossiers échus, en jours. `null` si aucun n'est échu. */
    averageAgeDays: number | null;
    /** Encaissé / facturé, en pourcentage. `null` si rien n'a été facturé. */
    recoveryRate: number | null;
}

/** Agrégats du bandeau KPI, calculés sur la sélection courante. */
export function cockpitTotals(rows: ArmateurCockpitRow[], now: Date = new Date()): CockpitTotals {
    let outstandingUsd = 0, openInvoices = 0, agedOutstandingUsd = 0, agedOwners = 0;
    let paidUsd = 0, invoicedUsd = 0, ageSum = 0, aged = 0;

    for (const r of rows) {
        outstandingUsd += r.total_outstanding_usd;
        openInvoices += r.open_count;
        paidUsd += r.total_paid_usd;
        invoicedUsd += r.total_invoiced_usd;

        const age = debtAgeDays(r, now);
        if (age !== null) {
            ageSum += age;
            aged += 1;
            if (age >= DEFAULT_THRESHOLD_DAYS) {
                agedOutstandingUsd += r.total_outstanding_usd;
                agedOwners += 1;
            }
        }
    }

    return {
        outstandingUsd, openInvoices, agedOutstandingUsd, agedOwners, paidUsd, invoicedUsd,
        averageAgeDays: aged > 0 ? Math.round(ageSum / aged) : null,
        recoveryRate: invoicedUsd > 0 ? (paidUsd / invoicedUsd) * 100 : null,
    };
}
