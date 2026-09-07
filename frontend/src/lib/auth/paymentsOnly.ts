/**
 * Sous-permission « encaissements seulement » (`profiles.payments_only`, mig 154).
 *
 * La personne finance ne doit pas voir les créances — une pro-forma n'est pas
 * de l'argent, et la montrer invite à des conclusions trop actives sur ce qui
 * n'est pas reçu. Elle voit en revanche ce qui l'aide à tenir la caisse :
 *
 *   — les paiements encaissés (CONFIRMED / REFUNDED) et leurs reçus ;
 *   — les portefeuilles (argent détenu) ;
 *   — les navires, sans encours ;
 *   — les pro-formas ÉMISES CETTE SEMAINE, pour savoir ce qui vient de partir —
 *     jamais le stock historique de créances ni un paiement non confirmé.
 *
 * Ni réglages (barèmes, fournisseurs de paiement), ni annuaire (arbitrage PO
 * 2026-09-07) : ce sont des leviers, pas de la caisse.
 *
 * Le drapeau RETRANCHE, il n'accorde rien. Trois couches l'appliquent, et
 * toutes lisent ce fichier pour ne pas diverger :
 *   1. le menu — {@link PAYMENTS_ONLY_NAV} ;
 *   2. le middleware — {@link isPaymentsOnlyAllowed} sur chaque requête ;
 *   3. les API et pages — {@link clampStatusesForPaymentsOnly},
 *      {@link forceCurrentMonthProformas}.
 */

/** Entrées de menu qui subsistent. Intersecté avec le rôle, jamais ajouté. */
export const PAYMENTS_ONLY_NAV: readonly string[] = [
    'payments', 'wallets', 'navires', 'admin-invoices', 'settings',
];

/** Statuts qui correspondent à de l'argent qui a bougé. */
export const PAYMENTS_ONLY_STATUSES: readonly string[] = ['CONFIRMED', 'REFUNDED'];

/** Préfixes joignables (le chemin et tout ce qu'il y a dessous). */
const ALLOWED_PREFIXES: readonly string[] = [
    '/admin/payments',
    '/admin/wallets',
    '/dashboard/settings',
    '/dashboard/account',
    '/api/admin/payments',
    '/api/admin/wallets',
    '/api/receipts/',
    '/api/payments/',
    '/mfa',
    '/post-login',
    '/auth/',
    '/login',
];

/**
 * Chemins joignables EXACTEMENT : la liste, pas ce qu'il y a dessous.
 * `/admin/navires` sans `/admin/navires/<ref>/portail` — le portail vu d'un
 * navire montre ses factures et son encours.
 */
const ALLOWED_EXACT: readonly string[] = ['/admin/navires', '/admin/invoices'];

/**
 * Chemins sur lesquels la restriction s'exerce : les surfaces staff, et les
 * API legacy qui rendent des transactions ou des indicateurs d'encours — sans
 * écran pour les appeler, mais joignables à la main.
 */
const GUARDED_PREFIXES: readonly string[] = [
    '/admin', '/dashboard', '/api/admin', '/api/transactions', '/api/kpis', '/api/audit', '/api/invoices/generate',
];

export function isPaymentsOnlyGuarded(pathname: string): boolean {
    return GUARDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isPaymentsOnlyAllowed(pathname: string): boolean {
    const clean = pathname.replace(/\/+$/, '') || '/';
    if (ALLOWED_EXACT.includes(clean)) return true;
    return ALLOWED_PREFIXES.some((p) => {
        const base = p.replace(/\/$/, '');
        return clean === base || clean.startsWith(`${base}/`);
    });
}

/** Où atterrit et où est renvoyée cette personne. */
export const PAYMENTS_ONLY_HOME = '/admin/payments';

/**
 * Borne une liste de statuts demandée par le client. Vide ou hors périmètre :
 * CONFIRMED seul — jamais « tout ».
 */
export function clampStatusesForPaymentsOnly(requested: readonly string[]): string[] {
    const kept = requested.filter((s) => PAYMENTS_ONLY_STATUSES.includes(s));
    return kept.length > 0 ? kept : ['CONFIRMED'];
}

/**
 * Premier jour du mois en cours, 00:00 UTC, en `YYYY-MM-DD`.
 *
 * Mois CALENDAIRE et non fenêtre glissante de trente jours : le rapprochement
 * bancaire se fait par mois, et une fenêtre glissante ferait disparaître une
 * pro-forma du champ de vision la veille du jour où on la rapproche.
 *
 * La borne remplace la semaine ISO (mig 154) depuis le 2026-09-07 : une
 * semaine coupait le mois en tronçons, et un règlement reçu le 2 pour une
 * pro-forma émise le 28 du mois précédent sortait déjà du champ.
 */
export function currentMonthStart(now: Date = new Date()): string {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return first.toISOString().slice(0, 10);
}

/**
 * Les seules factures que cette personne voit : les pro-formas émises depuis
 * le premier du mois en cours. Un filtre plus étroit du client est gardé, un
 * filtre plus large est ramené au début du mois.
 */
export function forceCurrentMonthProformas<F extends { documentType?: string | null; dateFrom?: string | null }>(
    filters: F,
    now: Date = new Date(),
): F {
    const monthStart = currentMonthStart(now);
    const dateFrom = filters.dateFrom && filters.dateFrom > monthStart ? filters.dateFrom : monthStart;
    return { ...filters, documentType: 'PROFORMA', dateFrom };
}
