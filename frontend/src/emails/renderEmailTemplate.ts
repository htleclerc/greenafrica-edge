/**
 * Substitution des variables des templates d'e-mail transactionnels.
 *
 * Les templates viennent du projet Claude Design et portent des marqueurs de
 * la forme `{{nom}}`. Ce module est le SEUL endroit qui les remplace.
 */

/**
 * Échappe les caractères qui changeraient la structure du document.
 *
 * Toutes les valeurs y passent, y compris les URL : un nom de navire ou une
 * raison sociale viennent de la base, donc en dernier ressort d'une saisie
 * armateur. Un `<script>` ou une apostrophe fermant un attribut n'a rien à
 * faire dans un e-mail que le service financier reçoit en copie.
 */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export type TemplateVars = Record<string, string | number>;

/**
 * Remplace chaque `{{nom}}` du template par la valeur correspondante, échappée.
 *
 * @throws si un marqueur reste sans valeur. Un template partiellement rempli
 * part sinon chez l'armateur avec un « {{amount}} » en toutes lettres à la
 * place du montant — mieux vaut un e-mail non envoyé et journalisé (les
 * appelants sont tous en fail-soft) qu'un document incohérent.
 */
export function renderEmailTemplate(template: string, vars: TemplateVars): string {
    const rendered = template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
        const value = vars[key];
        if (value === undefined || value === null) return match;
        return escapeHtml(String(value));
    });

    const leftover = rendered.match(/\{\{(\w+)\}\}/g);
    if (leftover) {
        const names = Array.from(new Set(leftover)).join(', ');
        throw new Error(`Email template is missing values for: ${names}`);
    }

    return rendered;
}
