/**
 * Redirection des e-mails hors production.
 *
 * Les armateurs réels sont en production. Sur la staging, un envoi qui part
 * pour de bon atteint une personne qui n'a rien demandé — et une relance de
 * recouvrement ou une pro-forma de taxe carbone envoyée par erreur ne se
 * rattrape pas.
 *
 * Quand `EMAIL_REDIRECT_TO` est renseignée, TOUT part vers cette adresse et
 * rien d'autre : les copies sont supprimées, jamais réécrites. On veut voir ce
 * qui serait parti, pas le faire partir un peu.
 *
 * La destination réelle n'est pas perdue pour autant : elle est écrite dans
 * l'objet et en tête du corps, pour que la boîte de démonstration reste
 * lisible et vérifiable.
 *
 * Variable absente ou vide = aucun effet. La production n'a rien à configurer
 * et ne peut pas être redirigée par accident.
 */

export interface Redirectable {
    to: string | string[];
    cc?: string[];
    subject: string;
    html?: string;
    text?: string;
}

export interface RedirectOutcome<T extends Redirectable> {
    /** Message prêt à envoyer — inchangé si aucune redirection n'est active. */
    message: T;
    /** Vrai si la redirection a joué. */
    redirected: boolean;
    /** Destinataires d'origine, pour la journalisation. */
    originalRecipients: string[];
}

function normalise(to: string | string[], cc?: string[]): string[] {
    const list = Array.isArray(to) ? to : [to];
    return [...list, ...(cc ?? [])]
        .map((a) => a?.trim())
        .filter((a): a is string => Boolean(a));
}

/** Adresse de redirection active, ou null en production. */
export function redirectTarget(): string | null {
    const raw = process.env.EMAIL_REDIRECT_TO?.trim();
    return raw ? raw : null;
}

/**
 * Applique la redirection. Le message rendu est prêt à partir tel quel :
 * l'appelant n'a aucune décision à prendre, ce qui évite qu'un chemin d'envoi
 * oublie de la respecter.
 */
export function applyEmailRedirect<T extends Redirectable>(
    message: T,
): RedirectOutcome<T> {
    const target = redirectTarget();
    const originalRecipients = normalise(message.to, message.cc);

    if (!target) {
        return { message, redirected: false, originalRecipients };
    }

    const destinataires = originalRecipients.length
        ? originalRecipients.join(', ')
        : '(aucun destinataire résolu)';

    const banniereTexte =
        `--- ENVOI REDIRIGÉ ---\n` +
        `Cet e-mail serait parti à : ${destinataires}\n` +
        `Il a été redirigé vers ${target} parce que EMAIL_REDIRECT_TO est défini ` +
        `sur cet environnement. Aucun armateur ne l'a reçu.\n` +
        `-----------------------\n\n`;

    const banniereHtml =
        `<div style="border:1px solid #8a5512;background:#f0e3d1;color:#3a2a10;` +
        `padding:12px 14px;margin:0 0 16px;font-family:system-ui,sans-serif;font-size:13px;` +
        `line-height:1.5;border-radius:3px;">` +
        `<strong>Envoi redirigé</strong><br>` +
        `Destinataires réels : ${escapeHtml(destinataires)}<br>` +
        `Redirigé vers ${escapeHtml(target)} — aucun armateur ne l'a reçu.` +
        `</div>`;

    return {
        message: {
            ...message,
            to: [target],
            // Supprimées, pas réécrites : une copie redirigée resterait un
            // envoi à quelqu'un qui ne l'attend pas.
            cc: undefined,
            subject: `[REDIRIGÉ → ${destinataires}] ${message.subject}`,
            ...(message.html !== undefined ? { html: banniereHtml + message.html } : {}),
            ...(message.text !== undefined ? { text: banniereTexte + message.text } : {}),
        },
        redirected: true,
        originalRecipients,
    };
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
