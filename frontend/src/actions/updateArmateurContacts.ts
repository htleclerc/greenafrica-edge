'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient, createTenantClient } from '@/lib/supabase/tenant';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';
import { upsertShipownerEmail } from '@/services/shipownerService';

export const MAX_CC_EMAILS = 10;

const ALLOWED_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'] as const;

// officialEmail et billingCcEmails restent obligatoires (billingCcEmails à défaut '[]') :
// cette action en est l'unique rédacteur, l'appelant en contrôle donc toujours la valeur.
//
// Les six coordonnées annexes sont `nullable().optional()` — SANS `.default(null)`.
// Une clé absente doit signifier « ne pas toucher », pas « effacer » : sinon un appelant
// qui n'envoie que l'e-mail (le cockpit et la fiche, tant que le formulaire complet de
// la Task 8 n'existe pas) écraserait silencieusement des coordonnées déjà enregistrées.
// `.optional()` sans défaut préserve la distinction clé-absente / valeur-null-explicite
// que buildContactsPatch() exploite ci-dessous. Même pattern que updateOwnerKycProfile.ts
// pour ces mêmes colonnes (address/phone_e164/preferred_language/ops_email/finance_email).
const schema = z.object({
    shipownerId: z.string().uuid(),
    officialEmail: z.email(),
    billingCcEmails: z.array(z.email()).default([]),
    opsEmail: z.email().nullable().optional(),
    financeEmail: z.email().nullable().optional(),
    phoneE164: z.string().trim().max(20).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    preferredLanguage: z.string().trim().max(10).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
});

type ParsedInput = z.infer<typeof schema>;

/**
 * Normalise la liste de copies : minuscules, élagage, déduplication, retrait de
 * l'adresse principale (sinon l'armateur recevrait deux fois le même e-mail),
 * et plafond — une liste de copie n'est pas une liste de diffusion.
 */
export function normalizeCcEmails(list: string[], primary: string): string[] {
    const seen = new Set<string>([primary.trim().toLowerCase()]);
    const out: string[] = [];
    for (const raw of list) {
        const email = raw.trim().toLowerCase();
        if (!email || seen.has(email)) continue;
        seen.add(email);
        out.push(email);
        if (out.length >= MAX_CC_EMAILS) break;
    }
    return out;
}

interface ContactsPatch {
    billing_cc_emails: string[];
    ops_email?: string | null;
    finance_email?: string | null;
    phone_e164?: string | null;
    address?: string | null;
    preferred_language?: string | null;
    notes?: string | null;
}

/**
 * Construit le patch shipowners ET la liste des champs modifiés à partir des
 * seules clés réellement présentes dans la requête (`!== undefined`) — jamais
 * de celles retombées à `null` par un défaut de schéma. C'est ce qui évite
 * l'écrasement silencieux décrit ci-dessus : un champ omis n'apparaît pas du
 * tout dans le patch envoyé à Postgres, donc sa valeur actuelle ne bouge pas.
 */
function buildContactsPatch(
    input: ParsedInput,
    officialEmail: string,
): { patch: ContactsPatch; changedFields: string[] } {
    const patch: ContactsPatch = {
        billing_cc_emails: normalizeCcEmails(input.billingCcEmails, officialEmail),
    };
    const changedFields = ['officialEmail', 'billingCcEmails'];

    if (input.opsEmail !== undefined) {
        patch.ops_email = input.opsEmail;
        changedFields.push('opsEmail');
    }
    if (input.financeEmail !== undefined) {
        patch.finance_email = input.financeEmail;
        changedFields.push('financeEmail');
    }
    if (input.phoneE164 !== undefined) {
        patch.phone_e164 = input.phoneE164;
        changedFields.push('phoneE164');
    }
    if (input.address !== undefined) {
        patch.address = input.address;
        changedFields.push('address');
    }
    if (input.preferredLanguage !== undefined) {
        patch.preferred_language = input.preferredLanguage;
        changedFields.push('preferredLanguage');
    }
    if (input.notes !== undefined) {
        patch.notes = input.notes;
        changedFields.push('notes');
    }

    return { patch, changedFields };
}

export type UpdateArmateurContactsResult = { ok: true } | { ok: false; reason: string };

/**
 * Admin-side edition of an armateur's contacts: official email (staff-sourced,
 * trust tier PORT_OFFICER — see shipownerService.upsertShipownerEmail), billing
 * CC list, and secondary coordinates. Staff isolation: a non-SUPERADMIN admin is
 * confined to their own jurisdiction. Replaces the earlier email-only admin action.
 */
export async function updateArmateurContacts(raw: unknown): Promise<UpdateArmateurContactsResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }
    const input = parsed.data;

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles').select('role, full_name').eq('id', auth.user.id).single();
    if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
        return { ok: false, reason: 'insufficient role' };
    }

    const platform = createPlatformClient();
    const { data: owner, error: ownerErr } = await platform
        .from('shipowners').select('id, jurisdiction_id').eq('id', input.shipownerId).single();
    if (ownerErr || !owner) return { ok: false, reason: 'shipowner not found' };

    const jurisdictionId = (owner as { jurisdiction_id: string }).jurisdiction_id;
    if (profile.role !== 'SUPERADMIN') {
        const adminJurisdictionId = await getServerJurisdictionId();
        if (adminJurisdictionId !== jurisdictionId) {
            return { ok: false, reason: 'forbidden: shipowner belongs to another jurisdiction' };
        }
    }

    const officialEmail = input.officialEmail.trim().toLowerCase();
    const admin = createTenantClient(jurisdictionId);
    const { patch, changedFields } = buildContactsPatch(input, officialEmail);

    try {
        // L'e-mail officiel passe TOUJOURS par upsertShipownerEmail : c'est lui qui
        // porte la comparaison de tiers de confiance. Un staff écrit en PORT_OFFICER
        // (confiance 3, la plus haute) — jamais refusé silencieusement.
        await upsertShipownerEmail(admin, input.shipownerId, officialEmail, 'PORT_OFFICER');

        const { error: updErr } = await admin.from('shipowners').update(patch).eq('id', input.shipownerId);
        if (updErr) return { ok: false, reason: updErr.message };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : 'update failed' };
    }

    // Trace les CHAMPS modifiés, pas leurs valeurs : ce sont des données personnelles.
    await platform.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: profile.full_name ?? auth.user.email ?? 'Staff',
        action: 'SHIPOWNER_UPDATED', severity: 'INFO',
        entity_type: 'Shipowner', entity_id: input.shipownerId,
        jurisdiction_id: jurisdictionId,
        details_json: { event: 'CONTACTS_UPDATED', fields: changedFields },
    });

    revalidatePath('/admin/armateurs');
    revalidatePath(`/admin/armateurs/${input.shipownerId}`);
    return { ok: true };
}
