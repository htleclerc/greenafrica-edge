/**
 * Sous-permission « encaissements seulement » (`profiles.payments_only`, mig 154).
 *
 * La personne finance ne doit voir que l'argent réellement reçu — jamais une
 * pro-forma, un encours ou une déclaration de paiement non confirmée : une
 * créance n'est pas de l'argent, et la montrer invite à des conclusions trop
 * actives sur ce qui n'est pas arrivé.
 *
 * Le drapeau RETRANCHE, il n'accorde rien. Trois couches l'appliquent, et
 * toutes lisent ce fichier pour ne pas diverger :
 *   1. le menu — {@link PAYMENTS_ONLY_NAV} ;
 *   2. le middleware — {@link isPaymentsOnlyAllowed} sur chaque requête ;
 *   3. l'API des paiements — {@link clampStatusesForPaymentsOnly}.
 */

/** Entrées de menu qui subsistent. Intersecté avec le rôle, jamais ajouté. */
export const PAYMENTS_ONLY_NAV: readonly string[] = ['payments', 'settings'];

/** Statuts qui correspondent à de l'argent qui a bougé. */
export const PAYMENTS_ONLY_STATUSES: readonly string[] = ['CONFIRMED', 'REFUNDED'];

/**
 * Chemins joignables. Tout le reste de /admin, /dashboard et /api/admin est
 * refusé — y compris ce qu'une page ajoutée demain exposerait.
 */
const ALLOWED_PREFIXES: readonly string[] = [
    '/admin/payments',
    '/dashboard/settings',
    '/dashboard/account',
    '/api/admin/payments',
    '/api/receipts/',
    '/api/payments/',
    '/mfa',
    '/post-login',
    '/auth/',
    '/login',
];

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
    return ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`) || pathname === p.replace(/\/$/, ''));
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
