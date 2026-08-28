'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient, createTenantClient } from '@/lib/supabase/tenant';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';
import { upsertShipownerEmail } from '@/services/shipownerService';
import { ALLOWED_LANGS } from '@/lib/kyc/kycSchema';
import { MAX_CC_EMAILS, normalizeCcEmails } from '@/lib/armateurContacts';

const ALLOWED_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'] as const;

// Round de correction 1 (Task 8) : officialEmail reste seul obligatoire.
// billingCcEmails suit désormais EXACTEMENT la même sémantique de patch par
// présence que les cinq autres coordonnées — ce n'est plus une exception.
//
// Auparavant `billingCcEmails: z.array(z.email()).default([])` rendait la clé
// TOUJOURS présente (un défaut n'est jamais `undefined`), donc TOUJOURS écrite
// par buildContactsPatch. Deux écrans « édition rapide » (ArmateursCockpit.tsx,
// AirlinesCockpit.tsx, AirlineDetail.tsx) qui n'éditent que l'e-mail envoyaient
// donc systématiquement `billingCcEmails: []` — écrasant en silence les copies
// déjà configurées à CHAQUE édition rapide, sur CES écrans. Ce n'était pas un
// risque de concurrence : c'était un effacement déterministe. `.optional()`
// (sans `.default()`) restaure la distinction clé-absente (« ne pas toucher »)
// / tableau-vide-explicite (« vider la liste ») que buildContactsPatch()
// exploite ci-dessous, identique au traitement des cinq autres coordonnées.
//
// Le plafond de copies (MAX_CC_EMAILS) est maintenant posé ICI, sur la longueur
// BRUTE envoyée par le client, et REFUSE la requête (ok:false) au lieu d'être
// silencieusement absorbé par normalizeCcEmails plus loin. Un plafond de
// destinataires de mises en demeure ne se laisse pas raboter sans le dire.
//
// Les cinq coordonnées libres restent `nullable().optional()` — SANS
// `.default(null)`. Une clé absente doit signifier « ne pas toucher », pas
// « effacer » : sinon un appelant qui n'envoie que l'e-mail écraserait
// silencieusement des coordonnées déjà enregistrées. `.optional()` sans défaut
// préserve la distinction clé-absente / valeur-null-explicite que
// buildContactsPatch() exploite ci-dessous. Même pattern que
// updateOwnerKycProfile.ts pour ces mêmes colonnes (address/phone_e164/
// preferred_language/ops_email/finance_email) — et maintenant aussi pour
// billing_cc_emails.
//
// preferredLanguage est la SEULE exception à `.nullable()` : la colonne est
// `NOT NULL` (migration 047 / 124), donc `null` n'est jamais une valeur légale — un
// appelant qui voudrait « effacer » cette colonne n'a pas de sens ici. Validé par
// `z.enum(ALLOWED_LANGS)`, la même liste que `updateOwnerKycProfile.ts` (source unique :
// `frontend/src/lib/kyc/kycSchema.ts`), pour ne pas faire diverger à nouveau ce que
// Zod accepte de ce que la contrainte SQL autorise (voir migration 124).
const schema = z.object({
    shipownerId: z.string().uuid(),
    officialEmail: z.email(),
    billingCcEmails: z.array(z.email()).max(MAX_CC_EMAILS, {
        message: `at most ${MAX_CC_EMAILS} CC emails allowed`,
    }).optional(),
    opsEmail: z.email().nullable().optional(),
    financeEmail: z.email().nullable().optional(),
    phoneE164: z.string().trim().max(20).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    preferredLanguage: z.enum(ALLOWED_LANGS).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
});

type ParsedInput = z.infer<typeof schema>;

interface ContactsPatch {
    billing_cc_emails?: string[];
    ops_email?: string | null;
    finance_email?: string | null;
    phone_e164?: string | null;
    address?: string | null;
    preferred_language?: string;
    notes?: string | null;
}

/**
 * Construit le patch shipowners ET la liste des champs modifiés à partir des
 * seules clés réellement présentes dans la requête (`!== undefined`) — jamais
 * de celles retombées à une valeur par défaut de schéma. C'est ce qui évite
 * l'écrasement silencieux décrit ci-dessus : un champ omis n'apparaît pas du
 * tout dans le patch envoyé à Postgres, donc sa valeur actuelle ne bouge pas.
 * `billingCcEmails` suit maintenant cette même règle (voir commentaire du schéma).
 */
function buildContactsPatch(
    input: ParsedInput,
    officialEmail: string,
): { patch: ContactsPatch; changedFields: string[] } {
    const patch: ContactsPatch = {};
    const changedFields = ['officialEmail'];

    if (input.billingCcEmails !== undefined) {
        patch.billing_cc_emails = normalizeCcEmails(input.billingCcEmails, officialEmail);
        changedFields.push('billingCcEmails');
    }
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

/**
 * Écrit une entrée d'audit pour cette action et en remonte l'échec au lieu de
 * l'avaler — un insert `audit_logs` non vérifié laisserait une trace manquante
 * passer pour un succès (voir le corps de l'action pour l'usage des deux sites
 * d'appel : succès complet et succès partiel).
 */
async function writeContactsAudit(
    platform: SupabaseClient,
    args: {
        userId: string;
        userFullName: string;
        shipownerId: string;
        jurisdictionId: string;
        severity: 'INFO' | 'WARNING';
        event: string;
        fields: string[];
    },
): Promise<{ error: { message: string } | null }> {
    const { error } = await platform.from('audit_logs').insert({
        user_id: args.userId,
        user_full_name: args.userFullName,
        action: 'SHIPOWNER_UPDATED', severity: args.severity,
        entity_type: 'Shipowner', entity_id: args.shipownerId,
        jurisdiction_id: args.jurisdictionId,
        // Trace les CHAMPS modifiés, pas leurs valeurs : ce sont des données personnelles.
        details_json: { event: args.event, fields: args.fields },
    });
    return { error };
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
    const userFullName = profile.full_name ?? auth.user.email ?? 'Staff';

    try {
        // L'e-mail officiel passe TOUJOURS par upsertShipownerEmail : c'est lui qui
        // porte la comparaison de tiers de confiance. Un staff écrit en PORT_OFFICER
        // (confiance 3, la plus haute) — jamais refusé silencieusement. upsertShipownerEmail
        // lit avant d'écrire et son update+RETURNING est une transaction PostgREST unique :
        // un échec ici annule sa propre mutation, il n'y a donc rien à auditer.
        await upsertShipownerEmail(admin, input.shipownerId, officialEmail, 'PORT_OFFICER');
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : 'update failed' };
    }

    // À partir d'ici, l'e-mail officiel est écrit DURABLEMENT (transaction distincte,
    // déjà commitée). Le patch de coordonnées ci-dessous est une SECONDE transaction,
    // indépendante : si elle échoue, on ne doit ni prétendre que rien n'a changé
    // (ok:false sans audit serait trompeur : l'e-mail a bel et bien changé) ni
    // prétendre que tout a réussi. On trace ce qui a réellement changé et on le dit
    // dans le message renvoyé à l'appelant.
    //
    // Patch vide (édition rapide : seul l'e-mail était fourni, aucune autre clé
    // présente) → rien à écrire côté coordonnées : on saute ce second aller-retour
    // plutôt que d'envoyer `.update({})`, qui ne correspond à aucune colonne.
    if (Object.keys(patch).length > 0) {
        const { error: updErr } = await admin.from('shipowners').update(patch).eq('id', input.shipownerId);
        if (updErr) {
            const { error: partialAuditErr } = await writeContactsAudit(platform, {
                userId: auth.user.id, userFullName, shipownerId: input.shipownerId, jurisdictionId,
                severity: 'WARNING', event: 'CONTACTS_PARTIALLY_UPDATED', fields: ['officialEmail'],
            });
            if (partialAuditErr) {
                // Échec en cascade (coordonnées ET trace) : on ne masque pas la cause
                // première du refus renvoyée à l'appelant, mais l'ops doit pouvoir la voir.
                console.error(
                    `[audit] echec de trace apres ecriture partielle shipowner=${input.shipownerId}: ${partialAuditErr.message}`,
                );
            }
            return {
                ok: false,
                reason: `official email saved, but contacts could not be updated: ${updErr.message}`,
            };
        }
    }

    const { error: auditErr } = await writeContactsAudit(platform, {
        userId: auth.user.id, userFullName, shipownerId: input.shipownerId, jurisdictionId,
        severity: 'INFO', event: 'CONTACTS_UPDATED', fields: changedFields,
    });
    if (auditErr) {
        // Aligné sur updateOwnerKycProfile.ts : un échec d'audit n'est jamais avalé.
        // Les données SONT changées (les deux transactions ci-dessus ont réussi) —
        // le message le dit, pour ne pas laisser croire que rien ne s'est passé.
        return { ok: false, reason: `contacts updated, but the audit trail failed: ${auditErr.message}` };
    }

    revalidatePath('/admin/armateurs');
    // La route est indexee par la reference opaque, pas par l'identifiant :
    // revalider le chemin construit avec l'UUID ne purgerait rien.
    const { data: refRow } = await platform
        .from('shipowners').select('public_ref').eq('id', input.shipownerId).maybeSingle();
    const publicRef = (refRow as { public_ref?: string } | null)?.public_ref;
    if (publicRef) revalidatePath(`/admin/armateurs/${publicRef}`);
    return { ok: true };
}
