import { redirect } from 'next/navigation';

/** Barèmes, juridictions et profil émetteur vivent dans /admin/settings (volets Fiscalité et Documents). */
export default function AdminJurisdictionsRoute() {
    redirect('/admin/settings?tab=fiscalite');
}
