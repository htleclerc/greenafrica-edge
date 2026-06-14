import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock state shared between vi.mock factory and test bodies ────────
const mocks = vi.hoisted(() => ({
    // app_config flag row (null = not found → disabled)
    flagRow: null as { value: unknown } | null,
    // active jurisdictions
    jurisdictions: [] as Array<{ id: string }>,
    // jurisdiction_mode_config rows
    modeCfg: [] as Array<{ jurisdiction_id: string; mode: string }>,
    // arrival_alerts rows returned by the DB query (before client-side filter)
    alertRows: [] as Array<{ id: string; jurisdiction_id: string; mode: string }>,
}));

vi.mock('@/lib/supabase/tenant', () => {
    return {
        createPlatformClient: vi.fn(() => ({
            from: vi.fn((table: string) => {
                if (table === 'app_config') {
                    return {
                        select: vi.fn(() => ({
                            eq: vi.fn(() => ({
                                maybeSingle: vi.fn(() =>
                                    Promise.resolve({ data: mocks.flagRow, error: null }),
                                ),
                            })),
                        })),
                    };
                }
                if (table === 'jurisdictions') {
                    // select('id').eq('status', 'ACTIVE') → resolves with jurs
                    return {
                        select: vi.fn(() => ({
                            eq: vi.fn(() =>
                                Promise.resolve({ data: mocks.jurisdictions, error: null }),
                            ),
                        })),
                    };
                }
                if (table === 'jurisdiction_mode_config') {
                    return {
                        select: vi.fn(() => ({
                            eq: vi.fn(() =>
                                Promise.resolve({ data: mocks.modeCfg, error: null }),
                            ),
                        })),
                    };
                }
                if (table === 'arrival_alerts') {
                    return {
                        select: vi.fn(() => ({
                            in: vi.fn(() => ({
                                is: vi.fn(() => ({
                                    limit: vi.fn(() =>
                                        Promise.resolve({ data: mocks.alertRows, error: null }),
                                    ),
                                })),
                            })),
                        })),
                    };
                }
                return { select: vi.fn(() => Promise.resolve({ data: [], error: null })) };
            }),
        })),
    };
});

import { runDailyPrecompute } from './dailyPrecomputeService';
import { createPlatformClient } from '@/lib/supabase/tenant';

describe('runDailyPrecompute', () => {
    const baseOpts = () => ({
        admin: createPlatformClient(),
        taxApiUrl: 'http://localhost:8080',
    });

    beforeEach(() => {
        mocks.flagRow = null;
        mocks.jurisdictions = [];
        mocks.modeCfg = [];
        mocks.alertRows = [];
        vi.clearAllMocks();
    });

    // (a) Flag OFF → {enabled:false, scanned:0, generated:0}, runner not called
    it('returns enabled:false and does not call runner when flag is OFF', async () => {
        mocks.flagRow = { value: false };
        const runner = vi.fn();
        const result = await runDailyPrecompute({ ...baseOpts(), runner });
        expect(result).toMatchObject({ enabled: false, scanned: 0, generated: 0, skipped: 0 });
        expect(result.failed).toHaveLength(0);
        expect(runner).not.toHaveBeenCalled();
    });

    it('returns enabled:false when flag key is absent (null)', async () => {
        mocks.flagRow = null; // key not in app_config
        const runner = vi.fn();
        const result = await runDailyPrecompute({ ...baseOpts(), runner });
        expect(result.enabled).toBe(false);
        expect(runner).not.toHaveBeenCalled();
    });

    // (b) Flag ON + 2 alerts → runner called 2×, generated:2
    it('calls runner for each target alert and returns generated:2', async () => {
        mocks.flagRow = { value: true };
        mocks.jurisdictions = [{ id: 'jur-1' }];
        mocks.modeCfg = [{ jurisdiction_id: 'jur-1', mode: 'MARITIME' }];
        mocks.alertRows = [
            { id: 'alert-1', jurisdiction_id: 'jur-1', mode: 'MARITIME' },
            { id: 'alert-2', jurisdiction_id: 'jur-1', mode: 'MARITIME' },
        ];
        const runner = vi.fn().mockResolvedValue({ ok: true });
        const result = await runDailyPrecompute({ ...baseOpts(), runner });
        expect(result.enabled).toBe(true);
        expect(result.scanned).toBe(2);
        expect(result.generated).toBe(2);
        expect(result.skipped).toBe(0);
        expect(result.failed).toHaveLength(0);
        expect(runner).toHaveBeenCalledTimes(2);
        expect(runner).toHaveBeenCalledWith('alert-1');
        expect(runner).toHaveBeenCalledWith('alert-2');
    });

    // (c) One alert where runner returns {ok:false} → counted in failed, loop continues
    it('counts failed alerts and continues loop when runner returns ok:false', async () => {
        mocks.flagRow = { value: true };
        mocks.jurisdictions = [{ id: 'jur-1' }];
        mocks.modeCfg = [{ jurisdiction_id: 'jur-1', mode: 'MARITIME' }];
        mocks.alertRows = [
            { id: 'alert-a', jurisdiction_id: 'jur-1', mode: 'MARITIME' },
            { id: 'alert-b', jurisdiction_id: 'jur-1', mode: 'MARITIME' },
        ];
        const runner = vi
            .fn()
            .mockResolvedValueOnce({ ok: false, reason: 'tax api 422' })
            .mockResolvedValueOnce({ ok: true });
        const result = await runDailyPrecompute({ ...baseOpts(), runner });
        expect(result.generated).toBe(1);
        expect(result.skipped).toBe(1);
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toMatchObject({ alertId: 'alert-a', reason: 'tax api 422' });
        expect(runner).toHaveBeenCalledTimes(2);
    });

    // (d) dryRun:true → runner NEVER called, scanned = nb targets, generated:0
    it('dry-run mode: reports scanned count without calling runner', async () => {
        mocks.flagRow = { value: true };
        mocks.jurisdictions = [{ id: 'jur-2' }];
        mocks.modeCfg = [{ jurisdiction_id: 'jur-2', mode: 'AIR' }];
        mocks.alertRows = [
            { id: 'alert-dry-1', jurisdiction_id: 'jur-2', mode: 'AIR' },
            { id: 'alert-dry-2', jurisdiction_id: 'jur-2', mode: 'AIR' },
            { id: 'alert-dry-3', jurisdiction_id: 'jur-2', mode: 'AIR' },
        ];
        const runner = vi.fn();
        const result = await runDailyPrecompute({ ...baseOpts(), dryRun: true, runner });
        expect(result.dryRun).toBe(true);
        expect(result.scanned).toBe(3);
        expect(result.generated).toBe(0);
        expect(runner).not.toHaveBeenCalled();
    });

    // (e) Filter active: alert from inactive jurisdiction/mode is excluded
    it('excludes alerts whose jurisdiction/mode pair is not active', async () => {
        mocks.flagRow = { value: true };
        mocks.jurisdictions = [{ id: 'jur-active' }];
        mocks.modeCfg = [{ jurisdiction_id: 'jur-active', mode: 'MARITIME' }];
        // DB returns two alerts: one from active pair, one from inactive pair
        mocks.alertRows = [
            { id: 'alert-active', jurisdiction_id: 'jur-active', mode: 'MARITIME' },
            { id: 'alert-inactive', jurisdiction_id: 'jur-inactive', mode: 'MARITIME' },
        ];
        const runner = vi.fn().mockResolvedValue({ ok: true });
        const result = await runDailyPrecompute({ ...baseOpts(), runner });
        expect(result.scanned).toBe(1);
        expect(runner).toHaveBeenCalledTimes(1);
        expect(runner).toHaveBeenCalledWith('alert-active');
        expect(runner).not.toHaveBeenCalledWith('alert-inactive');
    });

    // Runner throws → counted as failed, loop continues
    it('counts thrown errors as failed and continues loop', async () => {
        mocks.flagRow = { value: true };
        mocks.jurisdictions = [{ id: 'jur-1' }];
        mocks.modeCfg = [{ jurisdiction_id: 'jur-1', mode: 'MARITIME' }];
        mocks.alertRows = [
            { id: 'alert-throw', jurisdiction_id: 'jur-1', mode: 'MARITIME' },
            { id: 'alert-ok', jurisdiction_id: 'jur-1', mode: 'MARITIME' },
        ];
        const runner = vi
            .fn()
            .mockRejectedValueOnce(new Error('Go backend unreachable'))
            .mockResolvedValueOnce({ ok: true });
        const result = await runDailyPrecompute({ ...baseOpts(), runner });
        expect(result.generated).toBe(1);
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toMatchObject({
            alertId: 'alert-throw',
            reason: 'Go backend unreachable',
        });
    });
});
