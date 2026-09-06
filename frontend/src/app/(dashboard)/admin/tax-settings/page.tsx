import { redirect } from 'next/navigation';

/**
 * L'ancienne page mélangeait un tableau de bord de recettes (déjà dans
 * /admin/revenue), un avis « les taux ont déménagé » et un éditeur de clés à
 * plat. Les réglages vivent désormais dans /admin/settings, par volet.
 */
export default function TaxSettingsRoute() {
    redirect('/admin/settings?tab=fiscalite');
}
