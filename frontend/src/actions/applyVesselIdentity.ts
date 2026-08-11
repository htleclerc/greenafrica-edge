'use server';

import { z } from 'zod';
import { type SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { upsertShipownerEmail } from '@/services/shipownerService';
import { isValidImo } from '@/services/vesselIdentity/imo';
import { resolveBillingEmail } from '@/services/vesselIdentity/vesselFinderParser';

// Schéma et types restent internes : un module 'use server' n'exporte que des
// fonctions async, sinon `next build` casse.
// z.guid() (not z.uuid()) : les identifiants de test respectent la forme
// 8-4-4-4-12 mais pas les contraintes de version/variant RFC 4122 strictes
// qu'impose z.uuid() dans Zod v4 — cohérent avec les UUID générés par
// gen_random_uuid() de Postgres, qui eux les respectent, donc aucune perte
// de garde côté production.
const schema = z.object({
    candidateId: z.guid(),
    vesselId: z.guid(),
    /**
     * Arbitrage humain (§7.4) : autorise l'écrasement de valeurs déjà
     * renseignées et divergentes. Jamais posé par défaut — l'opérateur doit
     * confirmer explicitement après avoir vu la liste des divergences.
     */
    acceptFieldOverrides: z.boolean().optional(),
});

const ALLOWED_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

/** Motif de non-écriture du contact de facturation. */
export type ApplyVesselIdentityEmailSkip =
    | 'CONTACT_BLOCKED'
    | 'SHARED_SHIPOWNER'
    | 'NO_EMAIL'
    | 'NO_SHIPOWNER';

/** Une divergence de champ entre le navire cible et le candidat (§7.4). */
export type VesselFieldConflict = {
    field: string;
    current: string;
    proposed: string;
};

export type ApplyVesselIdentityResult =
    | {
          ok: true;
          vesselId: string;
          emailApplied: boolean;
          /** Renseigné quand emailApplied vaut false — dit POURQUOI. */
          emailSkipped?: ApplyVesselIdentityEmailSkip;
      }
    | { ok: false; reason: string; conflicts?: VesselFieldConflict[] };

/**
 * Champs soumis à la garde de divergence (§7.4), sous la forme
 * `[colonne de vessels, colonne du candidat]`.
 *
 * `name` en est volontairement EXCLU : les placeholders s'appellent tous
 * `VESSEL-W4-xx`, la divergence de nom est la règle et non l'exception, et
 * elle n'a aucune portée fiscale. `mmsi` et `call_sign` en sont exclus aussi :
 * la garde 4 traite déjà la collision de MMSI, et l'indicatif est volatil.
 *
 * `gross_tonnage_dwt` est le seul champ à portée monétaire directe :
 * `proformaPipelineService.ts` le transmet à l'API fiscale sous le nom
 * `gross_tonnage`. L'écraser change le montant de toutes les factures
 * suivantes — d'où l'arbitrage humain tracé plutôt que l'écriture muette.
 */
const CONFLICT_FIELDS: ReadonlyArray<readonly [string, string]> = [
    ['gross_tonnage_dwt', 'gross_tonnage'],
    ['dwt', 'deadweight'],
    ['flag_code', 'flag_code'],
    ['category', 'category'],
    ['build_year', 'build_year'],
];

/** Colonnes de `vessels` écrites seulement si le candidat porte une valeur (I1). */
const OPTIONAL_COLUMNS: ReadonlyArray<readonly [string, string]> = [
    ['mmsi', 'mmsi'],
    ['call_sign', 'call_sign'],
    ['flag_code', 'flag_code'],
    ['category', 'category'],
    ['vessel_subtype', 'type_raw'],
    ['gross_tonnage_dwt', 'gross_tonnage'],
    ['dwt', 'deadweight'],
    ['build_year', 'build_year'],
];

const VESSEL_COLUMNS =
    'id, imo_number, mmsi, name, shipowner_id, jurisdiction_id, flag_code, category, gross_tonnage_dwt, dwt, build_year';

/** Normalise pour comparaison : `null`, `undefined` et chaîne vide sont un même vide. */
function normalize(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text === '' ? null : text;
}

/**
 * Divergences entre le navire cible et le candidat. Un champ est divergent si
 * les DEUX valeurs sont renseignées et diffèrent : une cible vide se remplit
 * sans arbitrage (D3), un candidat vide n'écrase rien (I1).
 */
function detectFieldConflicts(
    vessel: Record<string, unknown>,
    candidate: Record<string, unknown>,
): VesselFieldConflict[] {
    const conflicts: VesselFieldConflict[] = [];
    for (const [vesselColumn, candidateColumn] of CONFLICT_FIELDS) {
        const current = normalize(vessel[vesselColumn]);
        const proposed = normalize(candidate[candidateColumn]);
        if (current !== null && proposed !== null && current !== proposed) {
            conflicts.push({ field: vesselColumn, current, proposed });
        }
    }
    return conflicts;
}

/** Texte exploitable, ou `null` — les lignes Supabase arrivent non typées. */
function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value : null;
}

type BillingContactOutcome = {
    emailApplied: boolean;
    emailSkipped?: ApplyVesselIdentityEmailSkip;
    emailError?: string;
};

/**
 * Écrit — ou refuse d'écrire — le contact de facturation de l'armateur du
 * navire apparié, et dit toujours pourquoi.
 *
 * Le refus le plus important est `SHARED_SHIPOWNER` : `upsertShipownerEmail`
 * n'oppose la chaîne de confiance qu'aux sources strictement moins fiables,
 * donc deux appariements successifs sur le même armateur
 * (VESSELFINDER_VERIFIED contre VESSELFINDER_VERIFIED) s'écrasent l'un
 * l'autre. Or 83 des 100 navires du portefeuille pointent vers le seul
 * `arm-014` « À identifier » : la dixième écriture enverrait au dernier
 * manager appliqué les relances des 83 pro-formas, dont 82 lui sont
 * étrangères. La règle — ne rien écrire dès que l'armateur porte plus d'un
 * navire — est volontairement trop large : ne rien écrire ne dégrade jamais
 * un contact existant, écrire au mauvais endroit produit des mises en demeure
 * erronées.
 */
async function applyBillingContact(
    admin: SupabaseClient,
    vessel: Record<string, unknown>,
    candidate: Record<string, unknown>,
): Promise<BillingContactOutcome> {
    if (candidate.contact_blocked) return { emailApplied: false, emailSkipped: 'CONTACT_BLOCKED' };

    const billingEmail = resolveBillingEmail({
        managerEmail: text(candidate.manager_email),
        ownerEmail: text(candidate.owner_email),
        ismManagerEmail: text(candidate.ism_manager_email),
    });
    if (!billingEmail) return { emailApplied: false, emailSkipped: 'NO_EMAIL' };

    const shipownerId = text(vessel.shipowner_id);
    if (!shipownerId) return { emailApplied: false, emailSkipped: 'NO_SHIPOWNER' };

    // Le navire courant étant lui-même rattaché à cet armateur, « il en existe
    // un autre » équivaut exactement à « le compte dépasse 1 ».
    const { data: sibling } = await admin
        .from('vessels')
        .select('id')
        .eq('shipowner_id', shipownerId)
        .neq('id', vessel.id)
        .limit(1)
        .maybeSingle();
    if (sibling) return { emailApplied: false, emailSkipped: 'SHARED_SHIPOWNER' };

    // Un échec d'écriture du contact ne doit jamais laisser le candidat PENDING
    // alors que l'identité, elle, est déjà écrite : sans ce filet, une exception
    // ici bloquait définitivement le candidat derrière la garde « navire déjà
    // identifié » (I2).
    try {
        await upsertShipownerEmail(admin, shipownerId, billingEmail, 'VESSELFINDER_VERIFIED');
        return { emailApplied: true };
    } catch (err) {
        return {
            emailApplied: false,
            emailError: err instanceof Error ? err.message : String(err),
        };
    }
}

/**
 * Applique un appariement décidé par un humain : le candidat VesselFinder
 * devient l'identité du navire placeholder désigné.
 *
 * Gardes, dans l'ordre, chacune interrompant sans écrire :
 *   1. authentification et rôle
 *   2. candidat existant et encore PENDING
 *   3. navire cible NON identifié — `!isValidImo(imo_number)` couvre
 *      `UNVERIFIED-*`, « à confirmer » et « Hors registre Equasis »
 *   4. aucun autre navire ne porte cet IMO ou ce MMSI (sinon CONFLICT)
 *   5. aucun champ à portée fiscale déjà renseigné et divergent, sauf
 *      arbitrage humain explicite (sinon CONFLICT)
 *   6. contact appliqué seulement s'il est licite, résolu, et si l'armateur
 *      cible ne porte QU'UN navire — 83 des 100 navires du portefeuille
 *      pointent vers le même `arm-014` « À identifier », où une écriture
 *      enverrait les relances de 82 navires étrangers au mauvais manager.
 */
export async function applyVesselIdentity(raw: unknown): Promise<ApplyVesselIdentityResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role, full_name')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !ALLOWED_ROLES.includes(String(profile.role))) {
        return { ok: false, reason: 'insufficient role' };
    }

    let admin;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: false, reason: 'service role not configured' };
    }

    // Garde 2 — candidat
    const { data: candidate } = await admin
        .from('vessel_identity_candidates')
        .select('*')
        .eq('id', parsed.data.candidateId)
        .maybeSingle();
    if (!candidate) return { ok: false, reason: 'candidate not found' };
    if (candidate.status !== 'PENDING') {
        return { ok: false, reason: 'candidate already processed' };
    }

    // Garde 3 — navire non identifié
    const { data: vessel } = await admin
        .from('vessels')
        .select(VESSEL_COLUMNS)
        .eq('id', parsed.data.vesselId)
        .maybeSingle();
    if (!vessel) return { ok: false, reason: 'vessel not found' };
    if (isValidImo(String(vessel.imo_number))) {
        return { ok: false, reason: 'vessel already identified' };
    }

    // Garde 4 — collision d'identité. Deux requêtes .eq() paramétrées plutôt
    // qu'un .or() interpolé : imo_number est sûr (regex + somme de contrôle
    // en amont), mais mmsi est un TEXT libre sans contrainte (mig 115) — une
    // virgule ou une parenthèse dans sa valeur pourrait altérer la syntaxe
    // du filtre PostgREST si elle était concaténée dans la chaîne .or().
    const { data: imoClash } = await admin
        .from('vessels')
        .select('id')
        .neq('id', vessel.id)
        .eq('imo_number', candidate.imo_number)
        .maybeSingle();
    let mmsiClash: { id: string } | null = null;
    if (!imoClash && candidate.mmsi) {
        const { data } = await admin
            .from('vessels')
            .select('id')
            .neq('id', vessel.id)
            .eq('mmsi', candidate.mmsi)
            .maybeSingle();
        mmsiClash = data;
    }
    const clash = imoClash ?? mmsiClash;
    if (clash) {
        await admin
            .from('vessel_identity_candidates')
            .update({ status: 'CONFLICT' })
            .eq('id', candidate.id);
        return { ok: false, reason: 'identity already held by another vessel' };
    }

    // Garde 5 — divergence de champs déjà renseignés (§7.4)
    const conflicts = detectFieldConflicts(vessel, candidate);
    if (conflicts.length > 0 && !parsed.data.acceptFieldOverrides) {
        await admin
            .from('vessel_identity_candidates')
            .update({ status: 'CONFLICT' })
            .eq('id', candidate.id);
        return { ok: false, reason: 'field conflict', conflicts };
    }

    // Écriture de l'identité. `imo_number` et `vessel_name` sont toujours
    // écrits (ils sont la raison d'être de l'appariement, et le parseur les
    // garantit non nuls) ; les autres colonnes ne sont écrites que si le
    // candidat porte une valeur — `gross_tonnage_dwt` est INTEGER NOT NULL et
    // un GT vide dans l'export ferait échouer l'UPDATE au niveau base (I1).
    const updatePayload: Record<string, unknown> = {
        imo_number: candidate.imo_number,
        name: candidate.vessel_name,
    };
    for (const [vesselColumn, candidateColumn] of OPTIONAL_COLUMNS) {
        const value = candidate[candidateColumn];
        if (value !== null && value !== undefined) updatePayload[vesselColumn] = value;
    }

    const { error: updateErr } = await admin
        .from('vessels')
        .update(updatePayload)
        .eq('id', vessel.id);
    if (updateErr) return { ok: false, reason: updateErr.message };

    // Garde 6 — contact de facturation
    const { emailApplied, emailSkipped, emailError } = await applyBillingContact(
        admin,
        vessel,
        candidate,
    );

    if (candidate.contact_blocked) {
        await admin.from('audit_logs').insert({
            user_id: auth.user.id,
            user_full_name: profile.full_name ?? 'Officier',
            action: 'SANCTIONS_CONTACT_BLOCKED',
            severity: 'CRITICAL',
            entity_type: 'Vessel',
            entity_id: vessel.id,
            jurisdiction_id: vessel.jurisdiction_id ?? null,
            details_json: {
                event: 'VESSELFINDER_CONTACT_BLOCKED',
                imoNumber: candidate.imo_number,
                reason: candidate.contact_blocked_reason,
            },
        });
    }

    await admin
        .from('vessel_identity_candidates')
        .update({
            status: 'MATCHED',
            matched_vessel_id: vessel.id,
            matched_by: auth.user.id,
            matched_at: new Date().toISOString(),
        })
        .eq('id', candidate.id);

    await admin.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: profile.full_name ?? 'Officier',
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Vessel',
        entity_id: vessel.id,
        jurisdiction_id: vessel.jurisdiction_id ?? null,
        details_json: {
            event: 'VESSEL_IDENTITY_MATCHED',
            previousImo: vessel.imo_number,
            imoNumber: candidate.imo_number,
            mmsi: candidate.mmsi,
            vesselName: candidate.vessel_name,
            emailApplied,
            emailSkipped: emailSkipped ?? null,
            emailError: emailError ?? null,
            // Arbitrage humain : la liste des valeurs écrasées, avec leur
            // ancienne valeur, est la seule trace de la décision.
            overriddenFields: conflicts.length > 0 ? conflicts : null,
            candidateId: candidate.id,
        },
    });

    return emailSkipped
        ? { ok: true, vesselId: String(vessel.id), emailApplied, emailSkipped }
        : { ok: true, vesselId: String(vessel.id), emailApplied };
}
