/**
 * Réduit une adresse à un indice : assez pour que l'armateur sache quelle boîte
 * surveiller, pas assez pour identifier l'entreprise depuis une page publique.
 *
 *   contact@hornshipping.com → c••••t@h••••g.com
 *
 * On conserve la première et la dernière lettre de la partie locale et du nom de
 * domaine, plus le TLD. Les niveaux intermédiaires d'un sous-domaine sont
 * écrasés : « mail.hornshipping.co.uk » ne doit pas laisser filtrer
 * « hornshipping ».
 */
function maskSegment(segment: string): string {
    if (segment.length <= 2) return segment;
    return `${segment[0]}••••${segment.at(-1)}`;
}

export function maskEmailHint(email: string): string {
    const at = email.lastIndexOf('@');
    if (at <= 0 || at === email.length - 1) return '•••';

    const local = email.slice(0, at);
    const domain = email.slice(at + 1);

    const parts = domain.split('.');
    if (parts.length < 2) return '•••';

    const tld = parts.at(-1);
    const registrable = parts.at(-2);

    if (!tld || !registrable) return '•••';

    return `${maskSegment(local)}@${maskSegment(registrable)}.${tld}`;
}
