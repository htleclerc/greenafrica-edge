'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('updateIssuerProfile');

/**
 * Un compte de collecte. Validé champ par champ : ce qui est écrit ici finit
 * imprimé sur chaque pro-forma et recopié par la banque de l'armateur.
 */
const bankAccount = z.object({
    label: z.string().trim().min(1).max(120),
    currency: z.string().trim().length(3),
    holder: z.string().trim().min(1).max(160),
    holder_address: z.string().trim().max(240).nullable().optional(),
    iban: z.string().trim().max(48).nullable().optional(),
    account_number: z.string().trim().max(48).nullable().optional(),
    swift: z.string().trim().min(8).max(11),
    bank: z.string().trim().min(1).max(160),
    bank_address: z.string().trim().max(240).nullable().optional(),
    deposit_reference: z.string().trim().max(80).nullable().optional(),
    is_primary: z.boolean(),
}).refine((a) => Boolean(a.iban || a.account_number), {
    message: 'each account needs an IBAN or an account number',
});

const schema = z.object({
    /** null = ligne de défaut plateforme. */
    jurisdictionId: z.string().uuid().nullable(),
    issuerName: z.string().trim().min(1).max(160),
    issuerLegalName: z.string().trim().min(1).max(160),
    issuerAddress: z.string().trim().min(1).max(240),
    sovereignLine: z.string().trim().min(1).max(120),
    supervisingMinistry: z.string().trim().min(1).max(200),
    authorityLine: z.string().trim().min(1).max(120),
    decreeReference: z.string().trim().max(200),
    directorName: z.string().trim().min(1).max(120),
    directorTitle: z.string().trim().min(1).max(120),
    directorEmail: z.string().trim().email(),
    directorPhone: z.string().trim().max(40),
    operationsEmail: z.string().trim().email(),
    billingEmail: z.string().trim().email(),
    paymentTermsDays: z.number().int().min(1).max(365),
    latePenaltyUsd: z.number().min(0).max(10_000_000),
    disputePeriodDays: z.number().int().min(1).max(365),
    escalationLine: z.string().trim().max(300),
    bailiffName: z.string().trim().max(160),
    legalBasisUrl: z.string().trim().url(),
    bankAccounts: z.array(bankAccount).min(1).max(8)
        .refine((list) => list.filter((a) => a.is_primary).length === 1, {
            // Le compte principal est celui qu'imprime la page 1 : sans lui, ou
            // avec deux, le document devient ambigu sur le compte à créditer.
            message: 'exactly one account must be marked primary',
        }),
});

export type UpdateIssuerProfileInput = z.infer<typeof schema>;
export type UpdateIssuerProfileResult = { ok: true } | { ok: false; reason: string };

/**
 * Écrit le profil émetteur d'une juridiction, ou la ligne de défaut.
 *
 * Droits plus stricts que l'écran qui l'héberge : `/admin/jurisdictions` est
 * ouvert au PORT_OFFICER, mais changer l'IBAN imprimé sur les factures est le
 * geste le plus lourd de conséquence de l'application. Réservé donc au
 * SUPERADMIN et au FINANCE_ADMIN, et un FINANCE_ADMIN reste confiné à sa
 * juridiction.
 *
 * La ligne de défaut s'applique à TOUTES les juridictions : elle n'appartient
 * à personne en particulier, seul le SUPERADMIN y touche.
 */
export async function updateIssuerProfile(raw: unknown): Promise<UpdateIssuerProfileResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }
    const p = parsed.data;

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role, full_name, is_active')
        .eq('id', auth.user.id)
        .single();
    if (!profile || profile.is_active === false) return { ok: false, reason: 'account inactive' };
    if (profile.role !== 'SUPERADMIN' && profile.role !== 'FINANCE_ADMIN') {
        return { ok: false, reason: 'insufficient role' };
    }
    if (p.jurisdictionId === null && profile.role !== 'SUPERADMIN') {
        return { ok: false, reason: 'only a superadmin may edit the platform default' };
    }
    if (profile.role !== 'SUPERADMIN') {
        const staffJur = await getServerJurisdictionId();
        if (p.jurisdictionId !== staffJur) return { ok: false, reason: 'forbidden' };
    }

    const platform = createPlatformClient();

    // La ligne de défaut n'a pas de clé naturelle exploitable par upsert
    // (`jurisdiction_id` y est NULL) : on la met à jour explicitement.
    const row = {
        issuer_name: p.issuerName,
        issuer_legal_name: p.issuerLegalName,
        issuer_address: p.issuerAddress,
        sovereign_line: p.sovereignLine,
        supervising_ministry: p.supervisingMinistry,
        authority_line: p.authorityLine,
        decree_reference: p.decreeReference,
        director_name: p.directorName,
        director_title: p.directorTitle,
        director_email: p.directorEmail,
        director_phone: p.directorPhone,
        operations_email: p.operationsEmail,
        billing_email: p.billingEmail,
        payment_terms_days: p.paymentTermsDays,
        late_penalty_usd: p.latePenaltyUsd,
        dispute_period_days: p.disputePeriodDays,
        escalation_line: p.escalationLine,
        bailiff_name: p.bailiffName,
        legal_basis_url: p.legalBasisUrl,
        bank_accounts: p.bankAccounts,
    };

    let writeError: string | null = null;
    if (p.jurisdictionId === null) {
        const { data: existing } = await platform
            .from('jurisdiction_issuer_profile')
            .select('id')
            .is('jurisdiction_id', null)
            .maybeSingle();
        const { error } = existing
            ? await platform.from('jurisdiction_issuer_profile').update(row).eq('id', (existing as { id: string }).id)
            : await platform.from('jurisdiction_issuer_profile').insert({ ...row, jurisdiction_id: null });
        writeError = error?.message ?? null;
    } else {
        const { error } = await platform
            .from('jurisdiction_issuer_profile')
            .upsert({ ...row, jurisdiction_id: p.jurisdictionId }, { onConflict: 'jurisdiction_id' });
        writeError = error?.message ?? null;
    }
    if (writeError) return { ok: false, reason: `update failed: ${writeError}` };

    const primary = p.bankAccounts.find((a) => a.is_primary);
    await platform.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: profile.full_name ?? auth.user.email ?? 'Staff',
        action: 'TRANSACTION_UPDATED',
        // WARNING et non INFO : c'est l'entrée qu'on relira pour savoir qui a
        // changé le compte imprimé sur les factures, et quand.
        severity: 'WARNING',
        entity_type: 'Jurisdiction',
        entity_id: p.jurisdictionId ?? 'platform-default',
        jurisdiction_id: p.jurisdictionId,
        details_json: {
            event: 'ISSUER_PROFILE_UPDATED',
            scope: p.jurisdictionId ? 'jurisdiction' : 'platform_default',
            // L'IBAN complet est deja publie sur chaque facture, mais le
            // journal n'a pas besoin de le porter : le BIC et le detenteur
            // suffisent a reperer un changement de compte.
            primary_account: primary ? `${primary.holder} · ${primary.swift}` : null,
            payment_terms_days: p.paymentTermsDays,
        },
    });

    log.info('issuer_profile_updated', {
        jurisdictionId: p.jurisdictionId,
        byUserId: auth.user.id,
        accounts: p.bankAccounts.length,
    });

    revalidatePath('/admin/settings');
    return { ok: true };
}
