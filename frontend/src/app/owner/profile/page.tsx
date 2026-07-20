import { redirect } from 'next/navigation';
import { requireOwner } from '@/lib/auth/requireOwner';
import { createClient } from '@/lib/supabase/server';
import { getOwnerKycProfile } from '@/services/ownerKycService';
import { OwnerProfile } from './OwnerProfile';

export const dynamic = 'force-dynamic';

export default async function OwnerProfilePage() {
    const session = await requireOwner();
    const supabase = await createClient();
    const profile = await getOwnerKycProfile(supabase, session.shipowner.id);
    if (!profile) redirect('/owner/login');
    return <OwnerProfile profile={profile} />;
}
