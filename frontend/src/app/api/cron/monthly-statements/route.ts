import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { generateStatementPdf } from '@/services/invoiceService';
import { composeOwnerStatement, statementStoragePath, periodBounds } from '@/services/statementService';
import { fetchJurisdictionName } from '@/lib/jurisdictionName';
import { notifyOwner } from '@/services/notificationService';
import { scopedLogger } from '@/lib/logger';

/**
 * GET /api/cron/monthly-statements — chantier C.
 * Mensuel (0 6 1 * *). Pour chaque armateur à solde dû > 0, génère un relevé PDF
 * informatif du mois écoulé, le stocke, upsert owner_statements, et notifie
 * STATEMENT_READY (envoi inline avec PDF joint via notifyOwner).
 * Auth : Bearer CRON_SECRET. ?dryRun=1 pour ne rien écrire.
 * ?refresh=1 : ne RÉGÉNÈRE que les relevés déjà stockés pour la période (PDF
 * réécrit, ligne mise à jour), sans jamais notifier — pour re-rendre des
 * documents après un changement de gabarit (en-tête, mig 149) sans créer de
 * relevé ni d'e-mail chez qui n'en avait pas.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = scopedLogger('cron.monthly-statements');

let clientOverride: SupabaseClient | null = null;
export function __setClientForTest(c: SupabaseClient | null): void { clientOverride = c; }
function serviceClient(): SupabaseClient { return clientOverride ?? createPlatformClient(); }

interface OwnerRow {
    id: string; name: string | null; official_email: string | null;
    total_outstanding_usd: number;
}

export async function GET(req: NextRequest | Request): Promise<NextResponse> {
    const cronSecret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization');
    if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const params = new URL(req.url).searchParams;
    const dryRun = params.get('dryRun') === '1';
    const refreshOnly = params.get('refresh') === '1';

    const admin = serviceClient();
    const now = new Date();
    const { periodStart, periodEnd, label } = periodBounds(now);
    const periodMonth = periodStart.toISOString().slice(0, 10);
    const counts = { generated: 0, failed: 0, skipped: 0 };

    // Armateurs (maritime + aviation) à solde dû > 0. Dédup par id.
    const [maritimeRes, aviationRes] = await Promise.all([
        admin.from('v_armateur_recouvrement').select('id, name, official_email, total_outstanding_usd').gt('total_outstanding_usd', 0),
        admin.from('v_compagnie_recouvrement').select('id, name, official_email, total_outstanding_usd').gt('total_outstanding_usd', 0),
    ]);
    if (maritimeRes.error || aviationRes.error) {
        log.error('owner_query_failed', {
            maritimeError: maritimeRes.error?.message, aviationError: aviationRes.error?.message,
        });
        return NextResponse.json({ error: 'owner_query_failed' }, { status: 500 });
    }
    const byId = new Map<string, OwnerRow>();
    for (const r of [...((maritimeRes.data ?? []) as OwnerRow[]), ...((aviationRes.data ?? []) as OwnerRow[])]) {
        byId.set(r.id, r);
    }

    // jurisdiction_id vit sur shipowners, pas sur les vues de recouvrement.
    const ownerIds = [...byId.keys()];
    const jurById = new Map<string, string | null>();
    if (ownerIds.length > 0) {
        const { data: jurRows, error: jurErr } = await admin.from('shipowners').select('id, jurisdiction_id').in('id', ownerIds);
        if (jurErr) {
            log.error('jurisdiction_query_failed', { error: jurErr.message });
            return NextResponse.json({ error: 'jurisdiction_query_failed' }, { status: 500 });
        }
        for (const r of (jurRows ?? []) as { id: string; jurisdiction_id: string | null }[]) {
            jurById.set(r.id, r.jurisdiction_id);
        }
    }

    // I-2 : le PDF + la ligne owner_statements sont idempotents (upsert (owner,mois)),
    // mais notifyOwner insère une notification à chaque appel. Sur un retry du cron
    // (timeout Vercel), on ré-enverrait l'e-mail. On ne notifie donc que les armateurs
    // sans ligne préexistante pour la période ; le PDF/la ligne sont quand même réécrits.
    const alreadyNotified = new Set<string>();
    if (ownerIds.length > 0) {
        const { data: existing } = await admin.from('owner_statements')
            .select('shipowner_id').eq('period_month', periodMonth).in('shipowner_id', ownerIds);
        for (const r of (existing ?? []) as { shipowner_id: string }[]) alreadyNotified.add(r.shipowner_id);
    }

    for (const owner of byId.values()) {
        // Mode rafraîchissement : un armateur sans relevé pour la période n'en
        // reçoit pas un nouveau par ce chemin — c'est le cron du 1er qui décide.
        if (refreshOnly && !alreadyNotified.has(owner.id)) { counts.skipped += 1; continue; }
        try {
            const jurisdictionId = jurById.get(owner.id) ?? null;
            if (!jurisdictionId) {
                log.warn('missing_jurisdiction', { ownerId: owner.id });
                counts.failed += 1;
                continue;
            }
            // asOf = periodEnd : le relevé de juillet porte le solde AU
            // 31 JUILLET, pas celui du jour où le cron a tourné. Sans cet
            // arrêté, un document intitulé « July 2026 » listait des factures
            // émises en août, et son total n'était pas reproductible — deux
            // générations du même relevé donnaient deux montants.
            const data = await composeOwnerStatement(admin, {
                shipownerId: owner.id, periodStart, periodEnd, now, asOf: periodEnd,
            });
            if (data.openCount === 0) {
                log.info('skipped_empty', { ownerId: owner.id });
                counts.skipped += 1;
                continue;
            }
            const jurisdictionName = await fetchJurisdictionName(admin, jurisdictionId);
            const pdf = await generateStatementPdf({
                ownerName: owner.name ?? 'Shipowner',
                jurisdiction: jurisdictionName,
                periodLabel: label,
                openLines: data.openLines,
                payments: data.payments,
                totalOutstandingUsd: data.totalOutstandingUsd,
                paymentsInMonthUsd: data.paymentsInMonthUsd,
                asOfIso: data.asOf.toISOString(),
            });
            const path = statementStoragePath(owner.id, periodStart);

            if (dryRun) { counts.generated += 1; continue; }

            const { error: upErr } = await admin.storage.from('documents')
                .upload(path, pdf, { contentType: 'application/pdf', upsert: true });
            if (upErr) { log.warn('upload_failed', { ownerId: owner.id, error: upErr.message }); counts.failed += 1; continue; }

            const { error: upsertErr } = await admin.from('owner_statements').upsert({
                shipowner_id: owner.id, jurisdiction_id: jurisdictionId, period_month: periodMonth,
                pdf_path: path, total_outstanding_usd: data.totalOutstandingUsd,
                payments_in_month_usd: data.paymentsInMonthUsd, open_count: data.openCount,
                generated_at: now.toISOString(),
            }, { onConflict: 'shipowner_id,period_month' });
            if (upsertErr) { log.warn('upsert_failed', { ownerId: owner.id, error: upsertErr.message }); counts.failed += 1; continue; }

            if (!refreshOnly && !alreadyNotified.has(owner.id)) {
                await notifyOwner(admin, {
                    shipownerId: owner.id, kind: 'STATEMENT_READY',
                    params: { period: label, total_outstanding_usd: data.totalOutstandingUsd, period_month: periodMonth },
                    deepLink: '/owner/invoices',
                    attachments: { pdfBuffer: pdf, filename: `statement-${periodMonth}.pdf` },
                });
            }
            counts.generated += 1;
        } catch (e) {
            counts.failed += 1;
            log.warn('statement_failed', { ownerId: owner.id, error: e instanceof Error ? e.message : String(e) });
        }
    }

    log.info('cron_run_complete', { ...counts, dryRun, refreshOnly });
    return NextResponse.json({ ...counts, dryRun, refreshOnly });
}
