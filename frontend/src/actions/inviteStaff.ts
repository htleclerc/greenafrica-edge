'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { sendStaffInviteEmail } from '@/services/emailService';
import { appBaseUrl } from '@/lib/appUrl';
import { administersSomething, canAdminister, getAdminScope, isCountryStaffRole } from '@/lib/auth/jurisdictionAdmin';

// Staff roles that can be created via admin invitation.
// SUPERADMIN and SHIPPING_AGENT are excluded: SUPERADMIN is provisioned out-of-band,
// and SHIPPING_AGENT is an operator role (self-service via /signup).
const STAFF_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'MANAGER'] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

const schema = z.object({
    email: z.string().email(),
    fullName: z.string().min(2).max(120),
    role: z.enum(STAFF_ROLES),
    jurisdictionIds: z.array(z.string().uuid()).min(1),
});

export type InviteStaffResult =
    | { ok: true; userId: string; alreadyExisted: boolean }
    | { ok: false; reason: string };

/**
 * Invite a new staff member to the platform.
 *
 * Ouvert à l'administrateur général, pour tout pays, et à l'administrateur
 * d'un pays, pour les pays qu'il administre (mig 174). Ni l'un ni l'autre ne
 * donne ici le droit d'administrer : voir `setJurisdictionAdmin`.
 *
 * Flow:
 *   1. Verify caller administers every requested jurisdiction.
 *   2. Issue Supabase invite — creates auth.users (or links existing) and
 *      sends the invite email via Supabase's configured SMTP. The redirect
 *      points at /auth/setup-password where the invitee sets their password.
 *   3. Upsert profiles row with the chosen staff role, is_active=true.
 *   4. Upsert user_jurisdictions rows (one per jurisdictionId).
 */
export async function inviteStaff(raw: unknown): Promise<InviteStaffResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    // ── 1. Auth + role gate ───────────────────────────────────────────────────
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: me } = await supabase
        .from('profiles')
        .select('role, full_name, is_active')
        .eq('id', auth.user.id)
        .single();
    if (!me || me.is_active !== true) return { ok: false, reason: 'insufficient role' };

    const { email, fullName, role, jurisdictionIds } = parsed.data;
    const normEmail = email.trim().toLowerCase();
    const admin = createPlatformClient();
    const appUrl = appBaseUrl();

    // L'administrateur général invite dans n'importe quel pays. L'administrateur
    // d'un pays n'invite que dans les pays qu'il administre : un seul pays hors
    // de sa liste fait refuser toute la demande.
    let scope;
    try {
        scope = await getAdminScope(admin, auth.user.id, me.role);
    } catch {
        return { ok: false, reason: 'lookup failed: admin rights' };
    }
    // Refus explicite : ne rien administrer, ou ne rien demander, ne passe jamais.
    if (!administersSomething(scope) || jurisdictionIds.length === 0
        || !jurisdictionIds.every((jid) => canAdminister(scope, jid))) {
        return { ok: false, reason: 'insufficient role' };
    }

    // ── 2. Issue invite (or resolve existing user) ────────────────────────────
    let userId: string;
    let alreadyExisted = false;

    // `createUser` et non `inviteUserByEmail`.
    //
    // `inviteUserByEmail` laisse GoTrue expedier le courriel. Mesure en
    // production le 2026-09-07 : il partait dans le gabarit PAR DEFAUT de
    // Supabase — 347 caracteres, hors charte — parce que les gabarits de
    // `supabase/templates/` ne valent que pour la pile locale et ne sont
    // jamais televerses vers le projet heberge. Et son lien ne menait a
    // `/auth/setup-password` que si cette cible etait declaree dans les
    // « Redirect URLs » du projet, ce qui n'etait pas le cas : l'invite
    // atterrissait sur la page d'accueil publique, sans session.
    //
    // On cree donc le compte en silence et on envoie NOTRE courriel, avec un
    // lien vers nos propres routes. `email_confirm: true` parce qu'aucun
    // courriel de confirmation ne partira : sans cela le compte resterait non
    // confirme et le premier lien echouerait.
    const { data: invited, error: inviteErr } = await admin.auth.admin.createUser({
        email: normEmail,
        email_confirm: true,
        user_metadata: { full_name: fullName, role: role as StaffRole },
    });

    if (invited?.user) {
        userId = invited.user.id;
    } else if (
        inviteErr &&
        (inviteErr.code === 'email_exists' ||
            /already.*registered|already.*been.*registered/i.test(inviteErr.message ?? ''))
    ) {
        // Existing user — find them via paginated list (supabase-js has no getUserByEmail).
        const { data: list, error: listErr } = await admin.auth.admin.listUsers({
            page: 1,
            perPage: 200,
        });
        if (listErr) return { ok: false, reason: `lookup failed: ${listErr.message}` };
        const existing = list.users.find((u) => u.email?.toLowerCase() === normEmail);
        if (!existing) return { ok: false, reason: 'user exists but cannot be located' };
        userId = existing.id;
        alreadyExisted = true;
    } else {
        return { ok: false, reason: `invite failed: ${inviteErr?.message ?? 'unknown error'}` };
    }

    // ── 3. Upsert profiles row ────────────────────────────────────────────────
    //
    // Un compte qui existait déjà n'est réécrit que par l'administrateur
    // général. Un administrateur de pays le rattache tel qu'il est, et
    // seulement si c'est déjà du personnel : sans cette limite, « inviter »
    // l'adresse de quelqu'un d'autre suffirait à changer son rôle — celui d'un
    // agent d'un autre pays, d'un armateur, ou de l'administrateur général.
    if (alreadyExisted && !scope.isGeneralAdmin) {
        const { data: existingProfile, error: existingErr } = await admin
            .from('profiles')
            .select('role')
            .eq('id', userId)
            .maybeSingle();
        if (existingErr) return { ok: false, reason: `lookup failed: ${existingErr.message}` };
        if (!isCountryStaffRole((existingProfile as { role: string } | null)?.role)) {
            return { ok: false, reason: 'this account is not a staff account' };
        }
    } else {
        const { error: profileErr } = await admin.from('profiles').upsert(
            { id: userId, email: normEmail, full_name: fullName, role, is_active: true },
            { onConflict: 'id' },
        );
        if (profileErr) {
            return { ok: false, reason: `profile upsert failed: ${profileErr.message}` };
        }
    }

    // ── 4. Upsert user_jurisdictions rows ─────────────────────────────────────
    // PK constraint on (user_id, jurisdiction_id) from mig 071 — safe to upsert.
    const rows = jurisdictionIds.map((jid) => ({ user_id: userId, jurisdiction_id: jid }));
    const { error: ujErr } = await admin
        .from('user_jurisdictions')
        .upsert(rows, { onConflict: 'user_id,jurisdiction_id' });
    if (ujErr) {
        return { ok: false, reason: `jurisdiction link failed: ${ujErr.message}` };
    }

    // Journal, au mieux : une ligne par pays, pour que chaque pays voie qui a
    // fait entrer qui.
    try {
        await admin.from('audit_logs').insert(
            jurisdictionIds.map((jid) => ({
                user_id: auth.user.id,
                user_full_name: me.full_name,
                action: 'TRANSACTION_UPDATED', // audit_action est une énumération : valeur générique, l'événement réel est dans details_json.
                severity: 'INFO',
                entity_type: 'Profile',
                entity_id: userId,
                jurisdiction_id: jid,
                details_json: { event: 'STAFF_INVITED', role, already_existed: alreadyExisted },
            })),
        );
    } catch {
        // Ne fait pas échouer l'invitation.
    }

    // ── 5. Envoi de l'invitation, par notre rail ──────────────────────────────
    //
    // Le compte est cree, le droit existe : un echec d'envoi n'annule pas
    // l'invitation, l'administrateur peut re-inviter. Mais il est journalise —
    // sans quoi une personne aurait un acces dont elle ignore l'existence,
    // exactement le trou que le rail armateur avait deja connu.
    //
    // `type: 'magiclink'` et non `'invite'` : le compte existe deja a ce stade,
    // et c'est la forme que `/auth/callback` verifie.
    //
    // Rien n'est envoye quand un administrateur de pays rattache un compte qui
    // existait deja : cette personne a deja son acces, et le courriel porterait
    // un nom et un role choisis par l'appelant avec un lien de connexion valide
    // — de quoi faire ecrire la plateforme a n'importe qui, au nom de n'importe qui.
    if (alreadyExisted && !scope.isGeneralAdmin) {
        return { ok: true, userId, alreadyExisted };
    }
    try {
        const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
            type: 'magiclink',
            email: normEmail,
        });
        const tokenHash = link?.properties?.hashed_token;
        const code = link?.properties?.email_otp;
        if (tokenHash && code) {
            const target = `${appUrl}/auth/callback`
                + `?token_hash=${encodeURIComponent(tokenHash)}`
                + `&type=magiclink&next=${encodeURIComponent('/auth/setup-password')}`;
            const sent = await sendStaffInviteEmail({
                to: normEmail,
                recipientName: fullName,
                role,
                link: target,
                code,
            });
            if (!sent.success) {
                console.error('[inviteStaff] envoi echoue pour', normEmail, sent.error);
            }
        } else {
            console.error('[inviteStaff] lien non genere pour', normEmail, linkErr?.message);
        }
    } catch (e) {
        console.error('[inviteStaff] envoi de l invitation', e);
    }

    return { ok: true, userId, alreadyExisted };
}
