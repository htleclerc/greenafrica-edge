import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { createOwnerScopedClient } from '@/lib/supabase/ownerScope';
import { resolveShipownerByRef } from '@/services/shipownerRefService';
import { isVesselRef } from '@/services/vesselRefService';
import { writeAuditLog } from '@/services/auditService';
import { OWNER_ACCOUNT_COLUMNS } from '@/lib/auth/resolveOwnerAccount';
import { OWNER_ALL_PRIVILEGES } from '@/lib/auth/ownerPrivileges';
import { normaliseOperatorModes, type OwnerViewAs, type Principal } from '@/lib/auth/requirePrincipal';
import type { ShipownerListRow } from '@/services/shipownerService';

// ─────────────────────────────────────────────────────────────────────────────
// « Voir comme l'armateur » — un principal opérateur SYNTHÉTIQUE pour le staff.
//
// Les pages du portail prennent un `Principal` opérateur et lisent à travers
// son client. On leur en fabrique un dont le client est borné au compte (et au
// navire, s'il y a lieu) et refuse toute écriture : elles rendent alors
// EXACTEMENT ce que l'armateur voit, sans qu'aucune session ne soit ouverte en
// son nom. `viewAs` dit aux composants d'afficher les actions désactivées et
// de lier vers la vue admin plutôt que vers `/dashboard`.
//
// Chaque page ouverte s'inscrit dans audit_logs (OWNER_VIEW_AS, mig 150) :
// c'est une consultation de données personnelles et financières.
// ─────────────────────────────────────────────────────────────────────────────

export type OperatorPrincipal = Extract<Principal, { kind: 'operator' }>;

/** Rôles admis à regarder. */
export const VIEW_AS_ROLES: ReadonlySet<string> = new Set(['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN', 'MANAGER']);
/** Rôles qui voient les montants facturés (arbitrage PO 2026-09-06 : cachés à PORT_OFFICER). */
export const VIEW_AS_BILLING_ROLES: ReadonlySet<string> = new Set(['FINANCE_ADMIN', 'SUPERADMIN', 'MANAGER']);

/** Décision pure, testable sans base : qui peut regarder, et avec quels montants. */
export function viewAsAccess(role: string | null | undefined): { allowed: boolean; canViewBilling: boolean } {
    const r = role ?? '';
    return { allowed: VIEW_AS_ROLES.has(r), canViewBilling: VIEW_AS_BILLING_ROLES.has(r) };
}

export interface ViewAsInput {
    /** Référence publique `arm_…` du compte regardé. */
    ownerRef?: string;
    /** Référence publique `ves_…` : la vue se restreint à ce navire. */
    vesselRef?: string;
    /** Nom de la page, pour la trace. */
    page: string;
    /** `false` pour un layout : la page, elle, trace. */
    audit?: boolean;
}

interface OwnerRow extends ShipownerListRow {
    public_ref: string;
    jurisdiction_id: string;
    applicable_modes: unknown;
}

const OWNER_VIEW_COLUMNS = `${OWNER_ACCOUNT_COLUMNS}, public_ref, applicable_modes`;

export async function requireViewAsOwner(input: ViewAsInput): Promise<OperatorPrincipal> {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles').select('role, full_name').eq('id', auth.user.id).maybeSingle();
    const role = (profile as { role?: string } | null)?.role ?? null;
    const access = viewAsAccess(role);
    if (!access.allowed) redirect('/dashboard');

    // Résolution par le client de SESSION : la RLS staff borne shipowners et
    // vessels à la juridiction de l'appelant. Hors périmètre = introuvable.
    let shipownerId: string | null = null;
    let vessel: { id: string; ref: string; name: string } | undefined;

    if (input.vesselRef) {
        if (!isVesselRef(input.vesselRef)) notFound();
        const { data: v } = await supabase
            .from('vessels')
            .select('id, name, public_ref, shipowner_id')
            .eq('public_ref', input.vesselRef)
            .maybeSingle();
        const row = v as { id: string; name: string; public_ref: string; shipowner_id: string | null } | null;
        if (!row?.shipowner_id) notFound();
        shipownerId = row.shipowner_id;
        vessel = { id: row.id, ref: row.public_ref, name: row.name };
    } else if (input.ownerRef) {
        shipownerId = await resolveShipownerByRef(supabase, input.ownerRef);
    }
    if (!shipownerId) notFound();

    const { data: ownerData } = await supabase
        .from('shipowners')
        .select(OWNER_VIEW_COLUMNS)
        .eq('id', shipownerId)
        .maybeSingle();
    const owner = ownerData as unknown as OwnerRow | null;
    if (!owner) notFound();

    const basePath = vessel
        ? `/admin/navires/${vessel.ref}/portail`
        : `/admin/armateurs/${owner.public_ref}/portail`;

    const viewAs: OwnerViewAs = {
        basePath,
        ownerRef: owner.public_ref,
        ownerName: owner.name ?? '',
        canViewBilling: access.canViewBilling,
        vessel,
    };

    if (input.audit !== false) {
        await writeAuditLog(createPlatformClient(), {
            user_id: auth.user.id,
            user_full_name: (profile as { full_name?: string } | null)?.full_name ?? auth.user.email ?? '',
            action: 'OWNER_VIEW_AS',
            severity: 'INFO',
            entity_type: 'Shipowner',
            entity_id: owner.id,
            jurisdiction_id: owner.jurisdiction_id,
            details_json: { page: input.page, vessel_id: vessel?.id ?? null, role },
        });
    }

    return {
        kind: 'operator',
        userId: auth.user.id,
        email: auth.user.email ?? '',
        shipowner: owner,
        jurisdictionId: owner.jurisdiction_id,
        applicableModes: normaliseOperatorModes(owner.applicable_modes),
        // Le titulaire détient tout : la vue montre ses boutons, désactivés.
        privileges: OWNER_ALL_PRIVILEGES,
        isMember: false,
        supabase: createOwnerScopedClient({
            jurisdictionId: owner.jurisdiction_id,
            shipownerId: owner.id,
            vesselId: vessel?.id,
        }),
        viewAs,
    };
}
