import { CreditCard, HelpCircle, Calculator, Scale, Handshake, type LucideIcon } from 'lucide-react';
import type { CoverageCountry } from '@/components/landing/coverage';

/**
 * Ce qu'un visiteur peut réellement faire pour une juridiction donnée.
 *
 * Chaque entrée pointe vers une route publique qui existe déjà : la page de
 * juridiction n'annonce aucune capacité que l'application n'a pas. Les
 * juridictions en cours de déploiement n'encaissent rien, donc elles n'ont ni
 * paiement ni mode d'emploi de paiement — seulement la méthode, le cadre
 * juridique et le contact.
 */
export interface JurisdictionAction {
    /** Suffixe de clé i18n : `Jurisdiction.action_<key>_title` / `_desc`. */
    key: string;
    href: string;
    icon: LucideIcon;
    /** Mise en avant visuelle de l'action principale. */
    primary?: boolean;
}

const LIVE_ACTIONS: readonly JurisdictionAction[] = [
    { key: 'pay', href: '/pay', icon: CreditCard, primary: true },
    { key: 'how_to_pay', href: '/how-to-pay', icon: HelpCircle },
    { key: 'estimate', href: '/carbon-tax', icon: Calculator },
    { key: 'legal', href: '/legal-basis', icon: Scale },
];

const PIPELINE_ACTIONS: readonly JurisdictionAction[] = [
    { key: 'method', href: '/carbon-tax', icon: Calculator },
    { key: 'legal', href: '/legal-basis', icon: Scale },
    { key: 'partner', href: '/partnership/contact', icon: Handshake, primary: true },
];

export function actionsFor(country: CoverageCountry): readonly JurisdictionAction[] {
    return country.status === 'live' ? LIVE_ACTIONS : PIPELINE_ACTIONS;
}
