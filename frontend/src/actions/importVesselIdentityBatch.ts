'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { parseVesselFinderPortCalls } from '@/services/vesselIdentity/vesselFinderParser';
import {
    flagSanctionedCandidates,
    insertCandidates,
    isUniqueViolation,
    loadSanctionedEntities,
} from '@/services/vesselIdentity/vesselIdentityService';

const schema = z.object({
    batchLabel: z.string().min(1).max(200),
    csv: z.string().min(1),
});

const ALLOWED_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

export type ImportBatchResult =
    | {
          ok: true;
          batchLabel: string;
          inserted: number;
          rowsRead: number;
          rejected: Array<{ lineNumber: number; vesselName: string; reason: string }>;
      }
    | { ok: false; reason: string };

/**
 * Importe un export d'escales VesselFinder comme lot de candidats.
 * Aucune écriture dans `vessels` : l'import ne fait que constituer la liste à apparier.
 */
export async function importVesselIdentityBatch(raw: unknown): Promise<ImportBatchResult> {
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

    let result;
    try {
        result = parseVesselFinderPortCalls(parsed.data.csv);
    } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : 'parsing failed' };
    }

    // `loadSanctionedEntities` lève sur toute erreur PostgREST. Sans ce filet,
    // une simple coupure réseau remontait comme exception non rattrapée : la
    // Server Action renvoyait une erreur opaque et l'écran restait figé.
    let sanctioned;
    try {
        sanctioned = await loadSanctionedEntities(admin);
    } catch {
        return { ok: false, reason: 'sanctions lookup failed' };
    }
    const flagged = flagSanctionedCandidates(result.candidates, sanctioned);

    // Le scénario le plus probable au premier jour d'usage : l'opérateur
    // redépose le même fichier. `batch_label` vaut le nom du fichier, l'index
    // unique (batch_label, imo_number) rejette, et l'insertion lève.
    let inserted;
    try {
        inserted = await insertCandidates(admin, parsed.data.batchLabel, auth.user.id, flagged);
    } catch (err) {
        return {
            ok: false,
            reason: isUniqueViolation(err) ? 'batch already imported' : 'candidate insert failed',
        };
    }

    return {
        ok: true,
        batchLabel: parsed.data.batchLabel,
        inserted,
        rowsRead: result.rowsRead,
        rejected: result.rejected,
    };
}
