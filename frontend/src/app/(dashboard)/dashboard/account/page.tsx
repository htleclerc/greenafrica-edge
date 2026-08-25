import { redirect } from 'next/navigation';
import { requireOwner } from '@/lib/auth/requireOwner';
import { createClient } from '@/lib/supabase/server';
import { getOwnerKycProfile } from '@/services/ownerKycService';
import { listOwnerMembers } from '@/services/ownerMembersService';
import { OwnerProfile } from '@/app/owner/profile/OwnerProfile';

export const dynamic = 'force-dynamic';

/**
 * Le compte de l'armateur : identité KYC, copies de facturation, et les membres
 * autorisés à agir dessus.
 *
 * Vit ici et non sous `/owner/*` : les neuf autres surfaces du portail ont été
 * relocalisées sous `/dashboard`, celle-ci avait été oubliée. Elle n'était donc
 * référencée par aucune navigation — la gestion des membres existait sans que
 * personne puisse l'atteindre autrement qu'en tapant l'URL.
 */
export default async function AccountPage() {
    const session = await requireOwner();
    const supabase = await createClient();
    const [profile, members] = await Promise.all([
        getOwnerKycProfile(supabase, session.shipowner.id),
        listOwnerMembers(supabase, session.shipowner.id),
    ]);
    if (!profile) redirect('/login');
    return (
        <OwnerProfile
            profile={profile}
            members={members}
            privileges={session.privileges}
            isMember={session.isMember}
        />
    );
}
