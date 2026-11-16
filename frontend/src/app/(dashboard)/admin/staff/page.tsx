import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { administersSomething, canAdminister, getAdminScope } from '@/lib/auth/jurisdictionAdmin';
import { StaffInvite } from '@/components/dashboard/admin/StaffInvite';
import { StaffMembers, type StaffCountryGroup } from '@/components/dashboard/admin/StaffMembers';
import { StaffSettlementRights, type StaffRow } from '@/components/dashboard/admin/StaffSettlementRights';

export const metadata: Metadata = {
    title: 'Staff Management | Green Gate',
    description: 'Invite government staff members and assign their jurisdictions.',
};

export const dynamic = 'force-dynamic';

interface MembershipRow {
    user_id: string;
    jurisdiction_id: string;
    is_admin: boolean;
}

interface ProfileRow {
    id: string;
    full_name: string | null;
    email: string | null;
    role: string;
    is_active: boolean;
}

/**
 * Gestion du personnel.
 *
 * Deux publics (mig 174) :
 *   • l'administrateur général voit tous les pays, nomme les administrateurs
 *     de pays et règle les droits d'encaissement ;
 *   • l'administrateur d'un pays ne voit que les pays qu'il administre : il y
 *     invite et en retire du personnel.
 *
 * La page ne fait que montrer. Chaque action revérifie le droit avant d'écrire.
 */
export default async function AdminStaffRoute() {
    const supabase = await createClient();

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role, is_active')
        .eq('id', auth.user.id)
        .single();
    if (!profile?.role || profile.is_active !== true) {
        redirect('/dashboard');
    }

    const platform = createPlatformClient();
    const scope = await getAdminScope(platform, auth.user.id, profile.role);
    if (!administersSomething(scope)) {
        redirect('/dashboard');
    }

    const { data: allJurisdictions, error: jErr } = await platform
        .from('jurisdictions')
        .select('id, name, code')
        .eq('status', 'ACTIVE')
        .order('code');
    if (jErr) {
        throw new Error(`Failed to load jurisdictions: ${jErr.message}`);
    }
    const jurisdictions = (allJurisdictions ?? []).filter((j) => canAdminister(scope, j.id));
    const jurisdictionIds = jurisdictions.map((j) => j.id);

    // Le personnel de ces pays, et seulement lui.
    let memberships: MembershipRow[] = [];
    let profiles: ProfileRow[] = [];
    if (jurisdictionIds.length > 0) {
        const { data: mRows, error: mErr } = await platform
            .from('user_jurisdictions')
            .select('user_id, jurisdiction_id, is_admin')
            .in('jurisdiction_id', jurisdictionIds);
        if (mErr) {
            throw new Error(`Failed to load memberships: ${mErr.message}`);
        }
        memberships = (mRows ?? []) as MembershipRow[];

        const userIds = [...new Set(memberships.map((m) => m.user_id))];
        if (userIds.length > 0) {
            const { data: pRows, error: pErr } = await platform
                .from('profiles')
                .select('id, full_name, email, role, is_active')
                .in('id', userIds);
            if (pErr) {
                throw new Error(`Failed to load staff profiles: ${pErr.message}`);
            }
            profiles = (pRows ?? []) as ProfileRow[];
        }
    }

    const profileById = new Map(profiles.map((p) => [p.id, p]));
    const groups: StaffCountryGroup[] = jurisdictions.map((j) => ({
        jurisdictionId: j.id,
        code: j.code,
        name: j.name,
        members: memberships
            .filter((m) => m.jurisdiction_id === j.id)
            .flatMap((m) => {
                const p = profileById.get(m.user_id);
                return p
                    ? [{
                        userId: p.id,
                        fullName: p.full_name,
                        email: p.email,
                        role: p.role,
                        isActive: p.is_active,
                        isAdmin: m.is_admin,
                    }]
                    : [];
            })
            .sort((a, b) => (a.fullName ?? '').localeCompare(b.fullName ?? '')),
    }));

    // Droits d'encaissement : ils valent pour toute la plateforme, donc pour
    // l'administrateur général seulement.
    let settlementStaff: StaffRow[] = [];
    if (scope.isGeneralAdmin) {
        // Les armateurs (SHIPPING_AGENT) n'ont rien à faire dans le back-office,
        // la sous-permission ne leur est pas proposable.
        const { data: staff, error: sErr } = await platform
            .from('profiles')
            .select('id, full_name, email, role, is_active, can_settle_payments, payments_only')
            .neq('role', 'SHIPPING_AGENT')
            .order('role')
            .order('full_name');
        if (sErr) {
            throw new Error(`Failed to load staff: ${sErr.message}`);
        }
        settlementStaff = (staff ?? []) as StaffRow[];
    }

    return (
        <div className="px-6 py-4">
            <StaffInvite jurisdictions={jurisdictions} />
            <StaffMembers
                groups={groups}
                currentUserId={auth.user.id}
                canGrantAdmin={scope.isGeneralAdmin}
            />
            {scope.isGeneralAdmin && <StaffSettlementRights staff={settlementStaff} />}
        </div>
    );
}
