/**
 * Chemins du portail armateur cités dans les modèles d'e-mail.
 *
 * Ils vivent ici plutôt qu'en littéraux répétés parce qu'ils ont déjà divergé
 * une fois : les modèles pointaient sur /owner/invoices et /owner/wallet,
 * routes supprimées lors de la convergence des portails. Chaque e-mail envoyé
 * à un armateur portait donc un bouton mort — 404, puis redirection vers
 * /login, où l'authentification est par mot de passe alors que les armateurs
 * ont été importés sans mot de passe.
 *
 * Une constante unique, et un test qui la confronte à l'arborescence réelle
 * de app/, rendent la rechute bruyante.
 */
export const OWNER_INVOICES_PATH = '/dashboard/invoices';
export const OWNER_WALLET_PATH = '/dashboard/wallet';

export const ALL_OWNER_EMAIL_PATHS = [
    OWNER_INVOICES_PATH,
    OWNER_WALLET_PATH,
] as const;
