/**
 * Sous-permission « encaissements seulement » (`profiles.payments_only`, mig 154).
 *
 * La personne finance ne doit pas voir les créances — une pro-forma n'est pas
 * de l'argent, et la montrer invite à des conclusions trop actives sur ce qui
 * n'est pas reçu. Elle voit en revanche ce qui l'aide à tenir la caisse :
 *
 *   — les paiements encaissés (CONFIRMED / REFUNDED) et leurs reçus ;
 *   — les portefeuilles (argent détenu) ;
 *   — l'annuaire, les navires (sans encours), les réglages ;
 *   — les pro-formas ÉMISES CETTE SEMAINE, pour savoir ce qui vient de partir —
 *     jamais le stock historique de créances ni un paiement non confirmé.
 *
 * Le drapeau RETRANCHE, il n'accorde rien. Trois couches l'appliquent, et
 * toutes lisent ce fichier pour ne pas diverger :
 *   1. le menu — {@link PAYMENTS_ONLY_NAV} ;
 *   2. le middleware — {@link isPaymentsOnlyAllowed} sur chaque requête ;
 *   3. les API et pages — {@link clampStatusesForPaymentsOnly},
 *      {@link forceCurrentWeekProformas}.
 */

/** Entrées de menu qui subsistent. Intersecté avec le rôle, jamais ajouté. */
export const PAYMENTS_ONLY_NAV: readonly string[] = [
    'payments', 'wallets', 'users', 'navires', 'admin-invoices', 'admin-settings', 'settings',
];

/** Statuts qui correspondent à de l'argent qui a bougé. */
export const PAYMENTS_ONLY_STATUSES: readonly string[] = ['CONFIRMED', 'REFUNDED'];

/** Préfixes joignables (le chemin et tout ce qu'il y a dessous). */
const ALLOWED_PREFIXES: readonly string[] = [
    '/admin/payments',
    '/admin/wallets',
    '/admin/users',
    '/admin/settings',
    '/dashboard/settings',
    '/dashboard/account',
    '/api/admin/payments',
    '/api/admin/wallets',
    '/api/admin/payment-config',
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

/** Lundi 00:00 UTC de la semaine ISO en cours, en `YYYY-MM-DD`. */
export function currentIsoWeekStart(now: Date = new Date()): string {
    const day = now.getUTCDay() || 7; // dimanche = 7
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)));
    return monday.toISOString().slice(0, 10);
}

/**
 * Les seules factures que cette personne voit : les pro-formas émises depuis
 * le lundi de la semaine en cours. Un filtre plus étroit du client est gardé,
 * un filtre plus large est ramené à la semaine.
 */
export function forceCurrentWeekProformas<F extends { documentType?: string | null; dateFrom?: string | null }>(
    filters: F,
    now: Date = new Date(),
): F {
    const weekStart = currentIsoWeekStart(now);
    const dateFrom = filters.dateFrom && filters.dateFrom > weekStart ? filters.dateFrom : weekStart;
    return { ...filters, documentType: 'PROFORMA', dateFrom };
}
