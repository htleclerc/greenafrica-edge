'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { writeAuditLog } from '@/services/auditService';

const FRIENDLY_NAME = 'Green Gate TOTP';

export type EnrollMfaResult =
    | { ok: true; factorId: string; qrCode: string; secret: string }
    | { ok: false; reason: string };

export type MfaActionResult = { ok: true } | { ok: false; reason: string };

const verifySchema = z.object({
    factorId: z.string().uuid(),
    // Six chiffres : le format d'un TOTP. Rejeter ici évite un aller-retour
    // réseau pour une saisie manifestement incomplète.
    code: z.string().trim().regex(/^\d{6}$/),
});

const unenrollSchema = z.object({ factorId: z.string().uuid() });

async function audit(action: string, userId: string, email: string, details: Record<string, unknown>) {
    await writeAuditLog(createPlatformClient(), {
        user_id: userId,
        user_full_name: email,
        action,
        severity: 'WARNING',
        entity_type: 'Profile',
        entity_id: userId,
        details_json: details,
    });
}

/**
 * Ouvre un enrôlement TOTP et rend de quoi l'afficher.
 *
 * Le facteur créé est **non vérifié** : il ne protège rien tant que
 * `verifyMfaEnrollment` n'a pas prouvé que l'application du téléphone produit
 * bien le bon code. C'est ce qui empêche de se verrouiller dehors en scannant
 * un QR sans jamais confirmer.
 *
 * Les enrôlements abandonnés sont nettoyés à l'ouverture du suivant : sans
 * cela ils s'accumulent, et GoTrue refuse un second facteur portant le même
 * nom convivial.
 */
export async function enrollMfa(): Promise<EnrollMfaResult> {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not_authenticated' };

    const { data: existing } = await supabase.auth.mfa.listFactors();
    for (const stale of (existing?.totp ?? []).filter((f) => f.status !== 'verified')) {
        await supabase.auth.mfa.unenroll({ factorId: stale.id });
    }

    const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: FRIENDLY_NAME,
    });
    if (error || !data) return { ok: false, reason: error?.message ?? 'enroll_failed' };

    return {
        ok: true,
        factorId: data.id,
        // SVG rendu par GoTrue : pas de bibliothèque de QR à embarquer, et le
        // secret ne transite pas par un service tiers de génération d'image.
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
    };
}

/**
 * Confirme l'enrôlement avec un code de l'application.
 *
 * Réussir élève la session en cours à AAL2 : les cookies sont réécrits par le
 * client serveur. Sans cela, la personne qui vient d'activer la MFA serait
 * aussitôt considérée comme n'ayant pas franchi son propre second facteur.
 */
export async function verifyMfaEnrollment(raw: unknown): Promise<MfaActionResult> {
    const parsed = verifySchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'invalid_code' };

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not_authenticated' };

    const { data: challenge, error: challengeErr } =
        await supabase.auth.mfa.challenge({ factorId: parsed.data.factorId });
    if (challengeErr || !challenge) return { ok: false, reason: challengeErr?.message ?? 'challenge_failed' };

    const { error } = await supabase.auth.mfa.verify({
        factorId: parsed.data.factorId,
        challengeId: challenge.id,
        code: parsed.data.code,
    });
    if (error) return { ok: false, reason: 'invalid_code' };

    await audit('MFA_ENROLLED', auth.user.id, auth.user.email ?? '—', { factor_type: 'totp' });
    revalidatePath('/dashboard/settings');
    return { ok: true };
}

/**
 * Retire un facteur.
 *
 * GoTrue exige que la session soit elle-même à AAL2 : on ne désarme pas la
 * protection depuis une session qui ne l'a pas franchie. C'est le contrôle qui
 * compte, et il est chez lui, pas ici.
 */
export async function unenrollMfa(raw: unknown): Promise<MfaActionResult> {
    const parsed = unenrollSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'invalid_input' };

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not_authenticated' };

    const { error } = await supabase.auth.mfa.unenroll({ factorId: parsed.data.factorId });
    if (error) return { ok: false, reason: error.message };

    await audit('MFA_UNENROLLED', auth.user.id, auth.user.email ?? '—', { factor_type: 'totp' });
    revalidatePath('/dashboard/settings');
    return { ok: true };
}
