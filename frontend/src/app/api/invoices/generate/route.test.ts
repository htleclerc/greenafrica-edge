import { describe, it, expect, vi, afterEach } from 'vitest';
import { canGenerateInvoice, STAFF_ROLES, buildHashFields, buildLineItems } from './route';

// ─── canGenerateInvoice ───────────────────────────────────────────────────────

describe('canGenerateInvoice — who may POST /api/invoices/generate', () => {
    it('allows the 3 staff roles', () => {
        expect(canGenerateInvoice('PORT_OFFICER')).toBe(true);
        expect(canGenerateInvoice('FINANCE_ADMIN')).toBe(true);
        expect(canGenerateInvoice('SUPERADMIN')).toBe(true);
    });

    // REGRESSION GUARD — changed 2026-04-21. SHIPPING_AGENT used to return true
    // for tx on their own fleet; that path was removed so armateurs never trigger
    // the INVOICE_GENERATED audit in their own name.
    it('rejects SHIPPING_AGENT (armateurs do not generate, they consume)', () => {
        expect(canGenerateInvoice('SHIPPING_AGENT')).toBe(false);
    });

    it('rejects MANAGER (onboarding role, not invoicing)', () => {
        expect(canGenerateInvoice('MANAGER')).toBe(false);
    });

    it('rejects null / undefined / unknown role', () => {
        expect(canGenerateInvoice(null)).toBe(false);
        expect(canGenerateInvoice(undefined)).toBe(false);
        expect(canGenerateInvoice('')).toBe(false);
        expect(canGenerateInvoice('RANDOM_ROLE')).toBe(false);
    });

    it('STAFF_ROLES set size is 3 (exhaustiveness guard)', () => {
        expect(STAFF_ROLES.size).toBe(3);
    });
});

// ─── buildHashFields ──────────────────────────────────────────────────────────

describe('buildHashFields — symmetric UPDATE guard', () => {
    const HASH = 'abc123hash';
    const SIG  = 'def456sig';

    it('returns {} when both content_hash and verify_signature are already set', () => {
        const result = buildHashFields(
            { content_hash: 'existing-hash', verify_signature: 'existing-sig' },
            HASH,
            SIG,
        );
        expect(result).toEqual({});
    });

    it('returns the new pair when content_hash is NULL (row never signed)', () => {
        const result = buildHashFields(
            { content_hash: null, verify_signature: null },
            HASH,
            SIG,
        );
        expect(result).toEqual({ content_hash: HASH, verify_signature: SIG });
    });

    it('returns the new pair when content_hash is undefined', () => {
        const result = buildHashFields(
            { content_hash: undefined, verify_signature: undefined },
            HASH,
            SIG,
        );
        expect(result).toEqual({ content_hash: HASH, verify_signature: SIG });
    });

    // Orphaned state: hash written but signature is NULL (e.g. a past partial write).
    // Must be treated as unsigned so both fields are (re-)written — symmetric with
    // the step-7 read guard which also requires BOTH to be truthy.
    it('returns the new pair when content_hash is set but verify_signature is NULL (orphaned state)', () => {
        const result = buildHashFields(
            { content_hash: 'stale-hash', verify_signature: null },
            HASH,
            SIG,
        );
        expect(result).toEqual({ content_hash: HASH, verify_signature: SIG });
    });

    it('returns the new pair when verify_signature is set but content_hash is NULL', () => {
        const result = buildHashFields(
            { content_hash: null, verify_signature: 'stale-sig' },
            HASH,
            SIG,
        );
        expect(result).toEqual({ content_hash: HASH, verify_signature: SIG });
    });
});

// ─── buildLineItems ───────────────────────────────────────────────────────────

describe('buildLineItems — single carbon-tax line', () => {
    it('returns exactly 1 element with amount === total', () => {
        const items = buildLineItems(10.5, 25.0, 262.5);
        expect(items).toHaveLength(1);
        expect(items[0].amount).toBe(262.5);
    });

    it('sets emissionsTco2 and rate on the single item', () => {
        const items = buildLineItems(8.0, 30.0, 240.0);
        expect(items[0].emissionsTco2).toBe(8.0);
        expect(items[0].rate).toBe(30.0);
    });

    it('amount equals total even when effectiveRate is 0 (zero-emissions edge)', () => {
        // emissionsTco2=0 → effectiveRate=0 (div-by-zero guard in caller); totalUsd=0
        const items = buildLineItems(0, 0, 0);
        expect(items).toHaveLength(1);
        expect(items[0].amount).toBe(0);
    });
});

// ─── fetchJurisdictionName — DJ jurisdiction ──────────────────────────────────

const DJ_JID = '00000000-0000-4000-8000-00000000444a';
const DJ_NAME = 'Republic of Djibouti';

afterEach(() => {
    vi.resetModules();
});

describe('fetchJurisdictionName — Djibouti row produces correct sovereign name', () => {
    it('returns "Republic of Djibouti" for a DJ transaction (jurisdiction_id = DJ_JID)', async () => {
        // Clear the module-level cache so a fresh lookup is always performed.
        const { _clearCacheForTest, fetchJurisdictionName } = await import('@/lib/jurisdictionName');
        _clearCacheForTest();

        // Minimal mock SupabaseClient — only the jurisdictions table path is needed.
        const mockClient = {
            from: vi.fn(() => ({
                select: vi.fn(() => ({
                    eq: vi.fn(() => ({
                        maybeSingle: vi.fn().mockResolvedValue({
                            // `code` is NOT NULL in jurisdictions; fetchJurisdictionMeta
                            // now selects it alongside `name`, so a realistic stub must
                            // supply both or the lookup falls back to the legacy name.
                            data: { code: 'DJ', name: DJ_NAME },
                            error: null,
                        }),
                    })),
                })),
            })),
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const name = await fetchJurisdictionName(mockClient as any, DJ_JID);
        expect(name).toBe(DJ_NAME);
    });
});
