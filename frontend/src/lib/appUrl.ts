/**
 * URL publique de l'application.
 *
 * Un seul endroit lit `NEXT_PUBLIC_APP_URL`, parce que le repli est piégeux :
 * il fabrique une URL VALIDE mais fausse. Le 2026-09-05, la variable manquait
 * du build de production et les liens de connexion partaient avec
 * `redirect_to=http://localhost:3300/owner/auth/callback` — le destinataire
 * atterrissait sur sa propre machine. Rien ne se voyait côté serveur : l'envoi
 * réussissait, le jeton était valide, seule la redirection était morte.
 *
 * La même variable porte les URLs de retour de paiement, les liens des
 * pro-formas, des relevés et des invitations. Une absence ne se constate donc
 * qu'après coup, chez celui qui reçoit.
 *
 * D'où le contrat : le repli reste (il fait vivre le développement et les
 * tests), mais en PRODUCTION il crie. La variable est inlinée au build pour
 * les `NEXT_PUBLIC_*` — c'est donc au déploiement qu'il faut la voir manquer,
 * et la garde du workflow `deploy-production` la refuse désormais. Cette
 * journalisation est le filet de dernier recours.
 */

const DEV_FALLBACK = 'http://localhost:3300';

let missingWarned = false;

/**
 * Valeur configurée, ou null. Distincte de `appBaseUrl()` pour les chaînes de
 * priorité : `buildVerifyUrl` fait primer la variable sur l'origine du
 * navigateur, sinon un QR code imprimé porterait l'origine de la machine qui a
 * généré la facture. Un repli ne peut pas tenir ce rôle — il est toujours
 * vrai, donc il court-circuiterait les branches suivantes.
 */
export function configuredAppUrl(): string | null {
    const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
    return raw ? raw.replace(/\/+$/, '') : null;
}

/**
 * Base absolue, sans barre oblique finale.
 *
 * La normalisation n'est pas cosmétique : un `NEXT_PUBLIC_APP_URL` saisi avec
 * une barre finale produisait `https://greengate.africa//owner/auth/callback`,
 * que GoTrue compare littéralement à sa liste d'URLs de redirection autorisées.
 */
export function appBaseUrl(): string {
    const configured = configuredAppUrl();
    if (configured) return configured;

    if (process.env.NODE_ENV === 'production' && !missingWarned) {
        missingWarned = true;
        console.error(
            `[appUrl] NEXT_PUBLIC_APP_URL absente du build de production — repli sur ${DEV_FALLBACK}. `
            + `Tous les liens sortants (connexion, invitations, retours de paiement, pro-formas) `
            + `pointeront sur la machine du destinataire. La variable est inlinée au BUILD : `
            + `la poser dans Vercel ne suffit pas, il faut rebuilder, et elle ne doit pas être marquée Sensitive.`,
        );
    }
    return DEV_FALLBACK;
}
