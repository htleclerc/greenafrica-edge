import type { SupabaseClient } from '@supabase/supabase-js';
import { privilegesFromMember, type OwnerPrivileges } from '@/lib/auth/ownerPrivileges';

// ─────────────────────────────────────────────────────────────────────────────
// Annuaire : toutes les personnes qui peuvent se connecter, en une liste.
//
// Quatre populations, quatre tables, un seul écran :
//   — STAFF : profils à rôle interne (SUPERADMIN seulement, comme /admin/staff) ;
//   — OWNER : titulaires — un compte armateur et le profil qui le détient ;
//   — MEMBER : membres invités (mig 135), avec leurs quatre drapeaux ;
//   — REPRESENTATIVE : représentants actifs (owner_agent_mappings).
//
// Périmètre : les comptes que la session VOIT (RLS staff sur shipowners) ;
// membres et représentants sont ensuite lus avec le client plateforme, bornés
// à ces comptes-là. Le service-role ne sert jamais à élargir, seulement à
// joindre profiles, dont la RLS n'ouvre pas la lecture croisée au staff.
// ─────────────────────────────────────────────────────────────────────────────

export type PlatformUserKind = 'STAFF' | 'OWNER' | 'MEMBER' | 'REPRESENTATIVE';

export interface PlatformUser {
    /** Clé de ligne, sans identifiant interne exposé à l'écran. */
    key: string;
    kind: PlatformUserKind;
    fullName: string | null;
    email: string | null;
    /** Rôle interne (STAFF) */
    role: string | null;
    /** Compte armateur rattaché (OWNER, MEMBER, REPRESENTATIVE). */
    ownerRef: string | null;
    ownerName: string | null;
    ownerState: string | null;
    /** Référence `mbr_…` (MEMBER), pour « voir comme ce membre ». */
    memberRef: string | null;
    privileges: OwnerPrivileges | null;
    /** Faux : accès révoqué, profil désactivé, ou compte jamais activé. */
    active: boolean;
    lastSignInAt: string | null;
    createdAt: string | null;
    /** IMO des navires du compte, pour la recherche. */
    imos: string[];
}

export const STAFF_ROLES = ['SUPERADMIN', 'FINANCE_ADMIN', 'PORT_OFFICER', 'MANAGER'] as const;

interface EmbeddedProfile { id?: string; email?: string | null; full_name?: string | null }
function embedded(p: EmbeddedProfile | EmbeddedProfile[] | null | undefined): EmbeddedProfile | null {
    return (Array.isArray(p) ? p[0] : p) ?? null;
}

export async function listPlatformUsers(
    session: SupabaseClient,
    platform: SupabaseClient,
    opts: { includeStaff: boolean },
): Promise<PlatformUser[]> {
    // 1. Les comptes que la session voit — c'est la RLS qui borne.
    const { data: ownerRows, error: ownerErr } = await session
        .from('shipowners')
        .select('id, name, public_ref, account_state, profile_id, official_email, created_at');
    if (ownerErr) throw new Error(`listPlatformUsers: shipowners: ${ownerErr.message}`);
    const owners = (ownerRows ?? []) as {
        id: string; name: string | null; public_ref: string; account_state: string;
        profile_id: string | null; official_email: string | null; created_at: string | null;
    }[];
    const ownerIds = owners.map((o) => o.id);
    const ownerById = new Map(owners.map((o) => [o.id, o]));

    // 2. Navires (recherche par IMO), membres, représentants, profils titulaires.
    const holderProfileIds = owners.map((o) => o.profile_id).filter((x): x is string => Boolean(x));
    const [vesselsRes, membersRes, repsRes, holderProfilesRes, staffRes] = await Promise.all([
        ownerIds.length
            ? session.from('vessels').select('shipowner_id, imo_number').in('shipowner_id', ownerIds)
            : Promise.resolve({ data: [] as unknown[] }),
        ownerIds.length
            ? platform.from('owner_members')
                .select('id, public_ref, shipowner_id, profile_id, can_pay, can_dispute, can_manage_vessels, can_invite, active, created_at, profiles!owner_members_profile_id_fkey(id, email, full_name)')
                .in('shipowner_id', ownerIds)
            : Promise.resolve({ data: [] as unknown[] }),
        ownerIds.length
            ? platform.from('owner_agent_mappings')
                .select('id, shipowner_id, agent_profile_id, active, created_at, profiles!owner_agent_mappings_agent_profile_id_fkey(id, email, full_name)')
                .in('shipowner_id', ownerIds)
                .eq('active', true)
            : Promise.resolve({ data: [] as unknown[] }),
        holderProfileIds.length
            ? platform.from('profiles').select('id, email, full_name, is_active').in('id', holderProfileIds)
            : Promise.resolve({ data: [] as unknown[] }),
        opts.includeStaff
            ? platform.from('profiles').select('id, email, full_name, role, is_active, created_at').in('role', [...STAFF_ROLES])
            : Promise.resolve({ data: [] as unknown[] }),
    ]);

    const imosByOwner = new Map<string, string[]>();
    for (const v of (vesselsRes.data ?? []) as { shipowner_id: string; imo_number: string | null }[]) {
        if (!v.imo_number) continue;
        const list = imosByOwner.get(v.shipowner_id) ?? [];
        list.push(String(v.imo_number));
        imosByOwner.set(v.shipowner_id, list);
    }
    const holderProfile = new Map<string, { email?: string | null; full_name?: string | null; is_active?: boolean }>();
    for (const p of (holderProfilesRes.data ?? []) as { id: string; email?: string | null; full_name?: string | null; is_active?: boolean }[]) {
        holderProfile.set(p.id, p);
    }

    const users: PlatformUser[] = [];

    for (const o of owners) {
        const p = o.profile_id ? holderProfile.get(o.profile_id) : undefined;
        users.push({
            key: `owner:${o.public_ref}`,
            kind: 'OWNER',
            fullName: p?.full_name ?? o.name,
            email: p?.email ?? o.official_email,
            role: null,
            ownerRef: o.public_ref,
            ownerName: o.name,
            ownerState: o.account_state,
            memberRef: null,
            privileges: null,
            active: o.account_state === 'ACTIVE' && (p?.is_active ?? true),
            lastSignInAt: null,
            createdAt: o.created_at,
            imos: imosByOwner.get(o.id) ?? [],
        });
    }

    for (const m of (membersRes.data ?? []) as {
        id: string; public_ref: string; shipowner_id: string; profile_id: string; active: boolean; created_at: string | null;
        can_pay?: boolean | null; can_dispute?: boolean | null; can_manage_vessels?: boolean | null; can_invite?: boolean | null;
        profiles?: EmbeddedProfile | EmbeddedProfile[] | null;
    }[]) {
        const o = ownerById.get(m.shipowner_id);
        const p = embedded(m.profiles);
        users.push({
            key: `member:${m.public_ref}`,
            kind: 'MEMBER',
            fullName: p?.full_name ?? null,
            email: p?.email ?? null,
            role: null,
            ownerRef: o?.public_ref ?? null,
            ownerName: o?.name ?? null,
            ownerState: o?.account_state ?? null,
            memberRef: m.public_ref,
            privileges: privilegesFromMember(m),
            active: m.active,
            lastSignInAt: null,
            createdAt: m.created_at,
            imos: o ? (imosByOwner.get(o.id) ?? []) : [],
        });
    }

    for (const r of (repsRes.data ?? []) as {
        id: string; shipowner_id: string; agent_profile_id: string; active: boolean; created_at: string | null;
        profiles?: EmbeddedProfile | EmbeddedProfile[] | null;
    }[]) {
        const o = ownerById.get(r.shipowner_id);
        const p = embedded(r.profiles);
        users.push({
            key: `rep:${o?.public_ref ?? r.shipowner_id}:${r.agent_profile_id}`,
            kind: 'REPRESENTATIVE',
            fullName: p?.full_name ?? null,
            email: p?.email ?? null,
            role: null,
            ownerRef: o?.public_ref ?? null,
            ownerName: o?.name ?? null,
            ownerState: o?.account_state ?? null,
            memberRef: null,
            privileges: null,
            active: r.active,
            lastSignInAt: null,
            createdAt: r.created_at,
            imos: o ? (imosByOwner.get(o.id) ?? []) : [],
        });
    }

    for (const s of (staffRes.data ?? []) as {
        id: string; email?: string | null; full_name?: string | null; role: string; is_active?: boolean; created_at?: string | null;
    }[]) {
        users.push({
            key: `staff:${s.id}`,
            kind: 'STAFF',
            fullName: s.full_name ?? null,
            email: s.email ?? null,
            role: s.role,
            ownerRef: null, ownerName: null, ownerState: null, memberRef: null, privileges: null,
            active: s.is_active ?? true,
            lastSignInAt: null,
            createdAt: s.created_at ?? null,
            imos: [],
        });
    }

    // 3. Dernière connexion — une seule lecture, fonction staff (mig 151).
    const profileIds = [
        ...holderProfileIds,
        ...((membersRes.data ?? []) as { profile_id: string }[]).map((m) => m.profile_id),
        ...((repsRes.data ?? []) as { agent_profile_id: string }[]).map((r) => r.agent_profile_id),
        ...((staffRes.data ?? []) as { id: string }[]).map((s) => s.id),
    ].filter(Boolean);
    if (profileIds.length > 0) {
        const { data: signIns } = await session.rpc('profile_last_sign_in', { profile_ids: [...new Set(profileIds)] });
        const byProfile = new Map<string, string | null>();
        for (const r of (signIns ?? []) as { profile_id: string; last_sign_in_at: string | null }[]) {
            byProfile.set(r.profile_id, r.last_sign_in_at);
        }
        const profileOfKey = new Map<string, string>();
        for (const o of owners) if (o.profile_id) profileOfKey.set(`owner:${o.public_ref}`, o.profile_id);
        for (const m of (membersRes.data ?? []) as { public_ref: string; profile_id: string }[]) profileOfKey.set(`member:${m.public_ref}`, m.profile_id);
        for (const r of (repsRes.data ?? []) as { shipowner_id: string; agent_profile_id: string }[]) {
            const o = ownerById.get(r.shipowner_id);
            profileOfKey.set(`rep:${o?.public_ref ?? r.shipowner_id}:${r.agent_profile_id}`, r.agent_profile_id);
        }
        for (const s of (staffRes.data ?? []) as { id: string }[]) profileOfKey.set(`staff:${s.id}`, s.id);
        for (const u of users) {
            const pid = profileOfKey.get(u.key);
            if (pid) u.lastSignInAt = byProfile.get(pid) ?? null;
        }
    }

    return users.sort((a, b) => (a.fullName ?? a.email ?? '').localeCompare(b.fullName ?? b.email ?? ''));
}

/** Recherche plein texte côté client : nom, e-mail, compte, IMO. */
export function matchesUserSearch(u: PlatformUser, q: string): boolean {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    const hay = [u.fullName, u.email, u.ownerName, u.role, ...u.imos]
        .filter(Boolean).map((s) => String(s).toLowerCase());
    return hay.some((h) => h.includes(needle));
}
