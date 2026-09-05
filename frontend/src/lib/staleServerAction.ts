/**
 * Reconnaît l'échec d'une action serveur dont l'identifiant n'existe plus.
 *
 * Next.js attribue à chaque action serveur un identifiant fixé au build. Un
 * onglet ouvert AVANT un déploiement garde les anciens identifiants ; au
 * premier clic après la mise en ligne, le serveur répond « Server Action
 * "…" was not found on the server ». Ce n'est pas une panne, c'est une page
 * périmée — et la seule correction est de la recharger.
 *
 * Le message est celui de Next (`failed-to-find-server-action`) ; il n'existe
 * pas de code d'erreur typé côté client, d'où la reconnaissance textuelle.
 */
export function isStaleServerActionError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    return /server action ["“']?[0-9a-f]*["”']? was not found on the server|failed to find server action/i.test(message);
}

/**
 * Recharge la page si l'erreur vient d'une action périmée. Rend `true` quand
 * le rechargement est engagé — l'appelant n'a alors rien d'autre à afficher.
 */
export function reloadIfStaleServerAction(error: unknown): boolean {
    if (!isStaleServerActionError(error)) return false;
    if (typeof window !== 'undefined') window.location.reload();
    return true;
}
