import type { SupabaseClient } from '@supabase/supabase-js';
import { runProformaPipeline } from '@/services/proformaPipelineService';

const ACTIONABLE_NO_PROFORMA = ['MATCHED_AUTO', 'CLAIMED', 'ESCALATED'];
const DEFAULT_CAP = 200;

export interface DailyPrecomputeResult {
    enabled: boolean;
    dryRun: boolean;
    scanned: number;
    generated: number;
    skipped: number;
    failed: Array<{ alertId: string; reason: string }>;
}

/** Injectable runner signature — receives only alertId; admin/taxApi are pre-bound in the default. */
type Runner = (alertId: string) => Promise<{ ok: boolean; reason?: string }>;

export interface DailyPrecomputeOpts {
    admin: SupabaseClient;
    taxApiUrl: string;
    taxApiSecret?: string;
    dryRun?: boolean;
    cap?: number;
    /**
     * Injectable for tests. Defaults to `runProformaPipeline` bound to
     * admin/taxApi so the caller never needs to pass it in production.
     */
    runner?: Runner;
}

export async function runDailyPrecompute(opts: DailyPrecomputeOpts): Promise<DailyPrecomputeResult> {
    const { admin } = opts;

    // 1. Flag gate — feature.daily_precompute_enabled in app_config (value === true).
    const { data: flag } = await admin
        .from('app_config')
        .select('value')
        .eq('key', 'feature.daily_precompute_enabled')
        .maybeSingle();
    if (flag?.value !== true) {
        return { enabled: false, dryRun: !!opts.dryRun, scanned: 0, generated: 0, skipped: 0, failed: [] };
    }

    // 2. Active (jurisdiction, mode) set.
    const [{ data: jurs }, { data: modes }] = await Promise.all([
        admin.from('jurisdictions').select('id').eq('status', 'ACTIVE'),
        admin.from('jurisdiction_mode_config').select('jurisdiction_id, mode').eq('enabled', true),
    ]);
    const activeJur = new Set((jurs ?? []).map((j: { id: string }) => j.id));
    const activePair = new Set(
        (modes ?? [])
            .filter((m: { jurisdiction_id: string; mode: string }) => activeJur.has(m.jurisdiction_id))
            .map((m: { jurisdiction_id: string; mode: string }) => `${m.jurisdiction_id}:${m.mode}`),
    );

    // 3. Target alerts — status in actionable set AND no proforma yet.
    //    DB-level filter is broad; client-side we further restrict to active pairs.
    const { data: alerts } = await admin
        .from('arrival_alerts')
        .select('id, jurisdiction_id, mode')
        .in('status', ACTIONABLE_NO_PROFORMA)
        .is('proforma_transaction_id', null)
        .limit(opts.cap ?? DEFAULT_CAP);
    const targets = (alerts ?? []).filter(
        (a: { id: string; jurisdiction_id: string; mode: string }) =>
            activePair.has(`${a.jurisdiction_id}:${a.mode}`),
    );

    // 4. Dry-run → just report scanned count, do not call the pipeline.
    const result: DailyPrecomputeResult = {
        enabled: true,
        dryRun: !!opts.dryRun,
        scanned: targets.length,
        generated: 0,
        skipped: 0,
        failed: [],
    };
    if (opts.dryRun) return result;

    // 5. Generate — idempotent: PROFORMA_SENT is excluded by the filter + pipeline.
    const runner: Runner =
        opts.runner ??
        ((alertId) =>
            runProformaPipeline({
                alertId,
                adminClient: admin,
                taxApiUrl: opts.taxApiUrl,
                taxApiSecret: opts.taxApiSecret,
            }));

    for (const a of targets) {
        try {
            const r = await runner(a.id as string);
            if (r.ok) {
                result.generated++;
            } else {
                result.skipped++;
                result.failed.push({ alertId: a.id as string, reason: r.reason ?? 'unknown' });
            }
        } catch (e) {
            result.failed.push({
                alertId: a.id as string,
                reason: e instanceof Error ? e.message : 'error',
            });
        }
    }

    return result;
}
