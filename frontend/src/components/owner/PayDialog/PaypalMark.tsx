/**
 * Marque PayPal simplifiée, en SVG inline.
 *
 * `lucide-react` ne fournit aucune icône de marque. Au moment de choisir un
 * moyen de paiement, la reconnaissance visuelle du prestataire compte : une
 * icône générique dégrade la confiance. Ce glyphe reprend la forme des deux « P »
 * imbriqués, sans prétendre reproduire le logo officiel — il vaut comme repère,
 * pas comme usage de marque.
 *
 * `currentColor` est utilisé pour que la couleur vienne du conteneur, comme les
 * icônes lucide voisines.
 */
export function PaypalMark({ className }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {/* P arrière */}
            <path d="M5 21V5h5.5a4 4 0 0 1 0 8H7" />
            {/* P avant, décalé */}
            <path d="M11 21v-4h3.5a4 4 0 0 0 0-8H13" />
        </svg>
    );
}
