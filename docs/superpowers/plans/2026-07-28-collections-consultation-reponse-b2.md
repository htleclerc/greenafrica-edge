# Consultation des relances + saisie réponse débiteur (B2) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un écran staff `admin/collections` qui liste les créances relancées (avec leur historique de paliers) et permet de saisir la réponse du débiteur, ce qui alimente le moteur de relance B1 (branches pause/grâce).

**Architecture:** Vue SQL `v_collection_admin` (une ligne par créance ayant ≥1 relance, `security_invoker`), service `collectionAdminService` (parse filtres + liste paginée), page serveur + liste client (patron `admin/invoices`), panneau détail avec timeline, et server action auditée `recordDebtorResponse` qui stampe la relance la plus récente.

**Tech Stack:** Next.js 15 (App Router, server actions) / TypeScript strict / Supabase (PostgREST) / next-intl / Vitest / design-system `Os*` + Radix Dialog.

**Spec:** [2026-07-28-collections-consultation-reponse-design.md](../specs/2026-07-28-collections-consultation-reponse-design.md)

## Global Constraints

- TypeScript strict, `any` interdit **sauf** le type client de service non typé `SupabaseClient<any>` pour une vue hors types générés (patron `invoiceAdminService`, avec `// eslint-disable-next-line`).
- Commits atomiques humanisés, auteur `Loic Leclerc <leclerc@drwintech.com>` via `git commit --author=`. Jamais de `Co-Authored-By: Claude` ni « Generated with Claude Code ». Staging explicite (paths).
- Rôles staff autorisés : `PORT_OFFICER`, `FINANCE_ADMIN`, `SUPERADMIN` (les 3 seulement — MANAGER passe `is_admin_or_officer()` en base mais n'a **pas** accès à cet écran).
- `collection_reminders` **n'est pas** une table tenant-scopée : `createTenantClient` ne la filtre pas par `jurisdiction_id`. Toute mutation doit **vérifier explicitement** la juridiction (`jurisdiction_id === getServerJurisdictionId()` pour un staff non-SUPERADMIN) avant d'écrire.
- Audit sans migration d'enum : `action:'TRANSACTION_UPDATED'` + `details_json.event:'DEBTOR_RESPONSE_RECORDED'`.
- Enum `debtor_response_type` : `SILENT | ACKNOWLEDGE | DISPUTE | PAYMENT_PROMISE | PARTIAL_PAYMENT | PAID | REFUSED`. Enum `reminder_tier` (après mig 110) : `J3 | J7 | J15 | J30 | J45 | BAILIFF | JUDICIAL`.
- Tests depuis `frontend/` : préfixer chaque commande par `cd /c/Users/lecle/Workspace/africgreen/frontend &&` (le shell se réinitialise entre commandes ; lancer vitest/tsc depuis la racine tire la mauvaise version et casse les alias `@/`). C'est le mode d'échec n°1.
- Ne pas dégrader le baseline lint (`157 problems / 62 errors` sur `develop`).

---

### Task 1 : Vue SQL `v_collection_admin`

**Files:**
- Create: `supabase/migrations/111_v_collection_admin.sql`

**Interfaces:**
- Produces: vue `public.v_collection_admin` (colonnes listées ci-dessous), `security_invoker = true`, `GRANT SELECT` à `authenticated, service_role`.

- [ ] **Step 1 : Écrire la migration**

Créer `supabase/migrations/111_v_collection_admin.sql` :

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 111: v_collection_admin — une ligne par créance ayant ≥1 relance
--
-- Alimente l'écran staff admin/collections (B2). Agrège l'historique
-- collection_reminders (mig 094/099/110) par transaction : nombre de relances,
-- dernier palier, dernière réponse débiteur. security_invoker = true → hérite
-- de la RLS de collection_reminders/transactions (staff par juridiction, mig 099).
-- Miroir du patron v_invoice_admin (mig 096).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_collection_admin WITH (security_invoker = true) AS
SELECT
  t.id                       AS transaction_id,
  t.invoice_ref,
  t.status,
  t.tax_amount_usd,
  (t.tax_amount_usd - COALESCE(t.partial_paid_usd, 0)) AS outstanding_usd,
  t.created_at,
  t.shipowner_id,
  s.name                     AS debtor_name,
  s.country_code             AS flag_country,
  t.jurisdiction_id,
  j.code                     AS jurisdiction_code,
  j.name                     AS jurisdiction_name,
  cr.reminder_count,
  cr.latest_tier,
  cr.latest_sent_at,
  cr.latest_response_type,
  cr.latest_response_at
FROM public.transactions t
JOIN LATERAL (
  SELECT
    count(*)                                                          AS reminder_count,
    (array_agg(r.tier                 ORDER BY r.sent_at DESC))[1]    AS latest_tier,
    max(r.sent_at)                                                    AS latest_sent_at,
    (array_agg(r.debtor_response_type ORDER BY r.sent_at DESC))[1]    AS latest_response_type,
    (array_agg(r.debtor_response_at   ORDER BY r.sent_at DESC))[1]    AS latest_response_at
  FROM public.collection_reminders r
  WHERE r.transaction_id = t.id
) cr ON cr.reminder_count > 0
LEFT JOIN public.shipowners   s ON s.id = t.shipowner_id
LEFT JOIN public.jurisdictions j ON j.id = t.jurisdiction_id;

GRANT SELECT ON public.v_collection_admin TO authenticated, service_role;

-- DOWN:
-- DROP VIEW IF EXISTS public.v_collection_admin;
```

- [ ] **Step 2 : Vérifier la forme**

Relire la migration : `security_invoker = true` présent ; `JOIN LATERAL … ON cr.reminder_count > 0` (exclut les transactions sans relance) ; `array_agg(... ORDER BY sent_at DESC)[1]` pour les `latest_*`. Ne PAS appliquer contre une base (env partagé — la migration s'applique au déploiement via `node scripts/db-migrate.mjs`).

- [ ] **Step 3 : Commit**

```bash
git add supabase/migrations/111_v_collection_admin.sql
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(collections): vue v_collection_admin pour l'écran de recouvrement"
```

---

### Task 2 : Service `collectionAdminService`

**Files:**
- Create: `frontend/src/services/collectionAdminService.ts`
- Test: `frontend/src/services/collectionAdminService.test.ts`

**Interfaces:**
- Produces: `DEFAULT_PAGE_SIZE=25`, `MAX_PAGE_SIZE=100`, `CollectionAdminRow`, `CollectionAdminFilters`, `CollectionAdminPage`, `parseCollectionFilters(sp)`, `listCollectionsAdmin(db, f)`, `listCollectionFilterOptions(db)`, `tierVariant(tier)`, `responseVariant(resp)`.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/src/services/collectionAdminService.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
    parseCollectionFilters, listCollectionsAdmin, tierVariant, responseVariant,
    DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE,
} from './collectionAdminService';

describe('parseCollectionFilters', () => {
    it('applique les défauts sur une entrée vide', () => {
        const f = parseCollectionFilters({});
        expect(f).toMatchObject({ q: undefined, jurisdictionId: undefined, status: undefined,
            latestTier: undefined, latestResponse: undefined, page: 1, pageSize: DEFAULT_PAGE_SIZE });
    });

    it('clampe page et pageSize', () => {
        expect(parseCollectionFilters({ page: '0', pageSize: '999' }))
            .toMatchObject({ page: 1, pageSize: MAX_PAGE_SIZE });
        expect(parseCollectionFilters({ page: '3', pageSize: '10' }))
            .toMatchObject({ page: 3, pageSize: 10 });
    });

    it('ne casse pas sur un champ invalide (catch → défaut)', () => {
        const f = parseCollectionFilters({ page: 'abc', pageSize: 'xyz', jurisdictionId: '  ' });
        expect(f.page).toBe(1);
        expect(f.pageSize).toBe(DEFAULT_PAGE_SIZE);
        expect(f.jurisdictionId).toBeUndefined();
    });

    it('collapse un tableau de valeurs en la première', () => {
        expect(parseCollectionFilters({ status: ['PENDING', 'OVERDUE'] }).status).toBe('PENDING');
    });
});

describe('tierVariant / responseVariant', () => {
    it('mappe chaque palier vers un BadgeVariant', () => {
        expect(tierVariant('J3')).toBe('info');
        expect(tierVariant('J15')).toBe('warning');
        expect(tierVariant('J30')).toBe('overdue');
        expect(tierVariant('J45')).toBe('critical');
        expect(tierVariant('BAILIFF')).toBe('critical');
        expect(tierVariant('JUDICIAL')).toBe('critical');
        expect(tierVariant(null)).toBe('draft');
    });

    it('mappe chaque réponse débiteur vers un BadgeVariant', () => {
        expect(responseVariant('PAID')).toBe('paid');
        expect(responseVariant('DISPUTE')).toBe('disputed');
        expect(responseVariant('PAYMENT_PROMISE')).toBe('warning');
        expect(responseVariant('PARTIAL_PAYMENT')).toBe('warning');
        expect(responseVariant('ACKNOWLEDGE')).toBe('info');
        expect(responseVariant('REFUSED')).toBe('critical');
        expect(responseVariant('SILENT')).toBe('draft');
        expect(responseVariant(null)).toBe('draft');
    });
});

describe('listCollectionsAdmin', () => {
    // Faux query-builder chaînable capturant les appels.
    function makeDb(rows: Record<string, unknown>[], count: number) {
        const calls: { method: string; args: unknown[] }[] = [];
        const builder: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'gt', 'or', 'order']) {
            builder[m] = (...args: unknown[]) => { calls.push({ method: m, args }); return builder; };
        }
        builder.range = (..._args: unknown[]) => {
            calls.push({ method: 'range', args: _args });
            return Promise.resolve({ data: rows, count, error: null });
        };
        const db = { from: (t: string) => { calls.push({ method: 'from', args: [t] }); return builder; } };
        return { db: db as never, calls };
    }

    it('interroge la vue, applique filtres + recherche échappée + pagination', async () => {
        const { db, calls } = makeDb([{ transaction_id: 'tx1', tax_amount_usd: '100', outstanding_usd: '100', reminder_count: '2' }], 1);
        const page = await listCollectionsAdmin(db, {
            q: 'ACME%,(x)', jurisdictionId: 'jur-1', status: 'PENDING',
            latestTier: 'J15', latestResponse: 'SILENT', page: 2, pageSize: 25,
        });
        expect(calls.find((c) => c.method === 'from')?.args[0]).toBe('v_collection_admin');
        // recherche échappée (%,() remplacés par espaces)
        const orCall = calls.find((c) => c.method === 'or');
        expect(String(orCall?.args[0])).not.toMatch(/[%(),]ACME|ACME[%(),]/);
        // pagination : range(offset=25, 49)
        const rangeCall = calls.find((c) => c.method === 'range');
        expect(rangeCall?.args).toEqual([25, 49]);
        expect(page).toMatchObject({ total: 1, page: 2, pageSize: 25 });
        expect(page.rows[0]).toMatchObject({ transaction_id: 'tx1', tax_amount_usd: 100, reminder_count: 2 });
    });
});
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `cd frontend && npx vitest run src/services/collectionAdminService.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

Créer `frontend/src/services/collectionAdminService.ts` :

```ts
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BadgeVariant } from '@/lib/badgeUtils';

// La vue v_collection_admin n'est pas dans supabase.generated.ts ; client non typé
// pour le query builder (même patron que invoiceAdminService).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface CollectionAdminRow {
    transaction_id: string;
    invoice_ref: string | null;
    status: string;
    tax_amount_usd: number;
    outstanding_usd: number;
    created_at: string;
    shipowner_id: string | null;
    debtor_name: string | null;
    flag_country: string | null;
    jurisdiction_id: string | null;
    jurisdiction_code: string | null;
    jurisdiction_name: string | null;
    reminder_count: number;
    latest_tier: string | null;
    latest_sent_at: string | null;
    latest_response_type: string | null;
    latest_response_at: string | null;
}

export interface CollectionAdminFilters {
    q?: string;
    jurisdictionId?: string;
    status?: string;
    latestTier?: string;
    latestResponse?: string;
    page: number;
    pageSize: number;
}

export interface CollectionAdminPage {
    rows: CollectionAdminRow[];
    total: number;
    page: number;
    pageSize: number;
}

function first(v: string | string[] | undefined): string | undefined {
    return Array.isArray(v) ? v[0] : (v ?? undefined);
}

const filtersSchema = z.object({
    q: z.string().trim().min(1).optional().catch(undefined),
    jurisdictionId: z.string().trim().min(1).optional().catch(undefined),
    status: z.string().trim().min(1).optional().catch(undefined),
    latestTier: z.string().trim().min(1).optional().catch(undefined),
    latestResponse: z.string().trim().min(1).optional().catch(undefined),
    page: z.number().int().min(1).catch(1),
    pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).catch(DEFAULT_PAGE_SIZE),
});

export function parseCollectionFilters(
    sp: Record<string, string | string[] | undefined>,
): CollectionAdminFilters {
    const rawPage = Number.parseInt(first(sp.page) ?? '', 10);
    const rawSize = Number.parseInt(first(sp.pageSize) ?? '', 10);
    return filtersSchema.parse({
        q: first(sp.q),
        jurisdictionId: first(sp.jurisdictionId),
        status: first(sp.status),
        latestTier: first(sp.latestTier),
        latestResponse: first(sp.latestResponse),
        page: Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1,
        pageSize: Number.isFinite(rawSize) ? Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize)) : DEFAULT_PAGE_SIZE,
    });
}

function escapeSearch(q: string): string {
    return q.replace(/[%,()]/g, ' ');
}

interface RawRow { [k: string]: unknown }

function toRow(r: RawRow): CollectionAdminRow {
    return {
        transaction_id: String(r.transaction_id),
        invoice_ref: (r.invoice_ref as string | null) ?? null,
        status: String(r.status ?? ''),
        tax_amount_usd: Number(r.tax_amount_usd),
        outstanding_usd: Number(r.outstanding_usd),
        created_at: String(r.created_at),
        shipowner_id: (r.shipowner_id as string | null) ?? null,
        debtor_name: (r.debtor_name as string | null) ?? null,
        flag_country: (r.flag_country as string | null) ?? null,
        jurisdiction_id: (r.jurisdiction_id as string | null) ?? null,
        jurisdiction_code: (r.jurisdiction_code as string | null) ?? null,
        jurisdiction_name: (r.jurisdiction_name as string | null) ?? null,
        reminder_count: Number(r.reminder_count),
        latest_tier: (r.latest_tier as string | null) ?? null,
        latest_sent_at: (r.latest_sent_at as string | null) ?? null,
        latest_response_type: (r.latest_response_type as string | null) ?? null,
        latest_response_at: (r.latest_response_at as string | null) ?? null,
    };
}

export async function listCollectionsAdmin(
    db: Client,
    f: CollectionAdminFilters,
): Promise<CollectionAdminPage> {
    let q = db.from('v_collection_admin').select('*', { count: 'exact' });
    if (f.jurisdictionId) q = q.eq('jurisdiction_id', f.jurisdictionId);
    if (f.status) q = q.eq('status', f.status);
    if (f.latestTier) q = q.eq('latest_tier', f.latestTier);
    if (f.latestResponse) q = q.eq('latest_response_type', f.latestResponse);
    if (f.q) {
        const s = escapeSearch(f.q);
        q = q.or(`invoice_ref.ilike.%${s}%,debtor_name.ilike.%${s}%`);
    }
    const offset = (f.page - 1) * f.pageSize;
    const { data, count, error } = await q
        .order('latest_sent_at', { ascending: false })
        .range(offset, offset + f.pageSize - 1);
    if (error) throw new Error(`listCollectionsAdmin: ${error.message}`);
    return {
        rows: ((data ?? []) as RawRow[]).map(toRow),
        total: count ?? 0,
        page: f.page,
        pageSize: f.pageSize,
    };
}

export async function listCollectionFilterOptions(
    db: Client,
): Promise<{ jurisdictions: { id: string; name: string }[] }> {
    const { data, error } = await db.from('jurisdictions').select('id, name').order('name', { ascending: true });
    if (error) throw new Error(`listCollectionFilterOptions: ${error.message}`);
    return { jurisdictions: ((data ?? []) as { id: string; name: string }[]).map((j) => ({ id: j.id, name: j.name })) };
}

/** Palier de relance → variante de badge. */
export function tierVariant(tier: string | null): BadgeVariant {
    switch (tier) {
        case 'J3':
        case 'J7':  return 'info';
        case 'J15': return 'warning';
        case 'J30': return 'overdue';
        case 'J45':
        case 'BAILIFF':
        case 'JUDICIAL': return 'critical';
        default: return 'draft';
    }
}

/** Réponse du débiteur → variante de badge. */
export function responseVariant(resp: string | null): BadgeVariant {
    switch (resp) {
        case 'PAID': return 'paid';
        case 'DISPUTE': return 'disputed';
        case 'REFUSED': return 'critical';
        case 'PAYMENT_PROMISE':
        case 'PARTIAL_PAYMENT': return 'warning';
        case 'ACKNOWLEDGE': return 'info';
        default: return 'draft'; // SILENT / null
    }
}
```

- [ ] **Step 4 : Lancer les tests + compilation**

Run: `cd frontend && npx vitest run src/services/collectionAdminService.test.ts && npx tsc --noEmit`
Expected: PASS ; `tsc` silencieux.

- [ ] **Step 5 : Commit**

```bash
git add frontend/src/services/collectionAdminService.ts frontend/src/services/collectionAdminService.test.ts
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(collections): service de liste paginée des créances relancées"
```

---

### Task 3 : Server action `recordDebtorResponse`

**Files:**
- Create: `frontend/src/actions/recordDebtorResponse.ts`
- Test: `frontend/src/actions/recordDebtorResponse.test.ts`

**Interfaces:**
- Consumes: `createClient` (`@/lib/supabase/server`), `createPlatformClient` (`@/lib/supabase/tenant`), `getServerJurisdictionId` (`@/lib/auth/tenantContext`).
- Produces: `recordDebtorResponse(raw): Promise<{ ok: true; tier: string } | { ok: false; reason: string }>`.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/src/actions/recordDebtorResponse.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authUser = { id: 'staff-1' };
const getUserMock = vi.fn();
const serverFromMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { getUser: getUserMock }, from: serverFromMock }),
}));

const platformFromMock = vi.fn();
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({ from: platformFromMock }),
}));

const getJurMock = vi.fn();
vi.mock('@/lib/auth/tenantContext', () => ({ getServerJurisdictionId: getJurMock }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { recordDebtorResponse } from './recordDebtorResponse';

// Helpers pour scripter les tables du client platform.
function platformTables(tables: Record<string, unknown>) {
    platformFromMock.mockImplementation((t: string) => tables[t]);
}

beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: authUser } });
    // profiles.role (server client) → FINANCE_ADMIN par défaut
    serverFromMock.mockImplementation((t: string) => {
        if (t === 'profiles') return { select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'FINANCE_ADMIN' } }) }) }) };
        throw new Error(`unexpected server table ${t}`);
    });
    getJurMock.mockResolvedValue('jur-so');
});

const okInput = { transactionId: '11111111-1111-4111-8111-111111111111', responseType: 'DISPUTE' as const };

describe('recordDebtorResponse', () => {
    it('refuse une entrée invalide', async () => {
        const r = await recordDebtorResponse({ transactionId: 'not-a-uuid', responseType: 'DISPUTE' });
        expect(r).toMatchObject({ ok: false });
    });

    it('refuse un rôle non-staff', async () => {
        serverFromMock.mockImplementation(() => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'SHIPPING_AGENT' } }) }) }) }));
        const r = await recordDebtorResponse(okInput);
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/role/i) });
    });

    it('refuse un staff hors juridiction', async () => {
        getJurMock.mockResolvedValue('jur-dj'); // ≠ jur-so de la transaction
        platformTables({
            transactions: { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { jurisdiction_id: 'jur-so' } }) }) }) },
        });
        const r = await recordDebtorResponse(okInput);
        expect(r).toMatchObject({ ok: false, reason: 'forbidden' });
    });

    it('refuse une créance sans relance', async () => {
        platformTables({
            transactions: { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { jurisdiction_id: 'jur-so' } }) }) }) },
            collection_reminders: { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) },
        });
        const r = await recordDebtorResponse(okInput);
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/no reminder/i) });
    });

    it('stampe la relance la plus récente et audite', async () => {
        const updateSpy = vi.fn(() => ({ eq: async () => ({ error: null }) }));
        const auditInsertSpy = vi.fn(async () => ({ error: null }));
        platformTables({
            transactions: { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { jurisdiction_id: 'jur-so' } }) }) }) },
            collection_reminders: {
                select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { id: 'rem-latest', tier: 'J15', debtor_response_type: 'SILENT' } }) }) }) }) }),
                update: (payload: Record<string, unknown>) => { updateSpy(payload); return { eq: async () => ({ error: null }) }; },
            },
            audit_logs: { insert: auditInsertSpy },
        });
        const r = await recordDebtorResponse(okInput);
        expect(r).toMatchObject({ ok: true, tier: 'J15' });
        expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ debtor_response_type: 'DISPUTE' }));
        expect(auditInsertSpy).toHaveBeenCalledWith(expect.objectContaining({
            action: 'TRANSACTION_UPDATED',
            details_json: expect.objectContaining({ event: 'DEBTOR_RESPONSE_RECORDED', newResponse: 'DISPUTE' }),
        }));
    });

    it('laisse passer un SUPERADMIN hors de sa juridiction courante', async () => {
        serverFromMock.mockImplementation(() => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'SUPERADMIN' } }) }) }) }));
        getJurMock.mockResolvedValue('jur-dj');
        const updateSpy = vi.fn(() => ({ eq: async () => ({ error: null }) }));
        platformTables({
            transactions: { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { jurisdiction_id: 'jur-so' } }) }) }) },
            collection_reminders: {
                select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { id: 'r1', tier: 'J30', debtor_response_type: 'SILENT' } }) }) }) }) }),
                update: (p: Record<string, unknown>) => { updateSpy(p); return { eq: async () => ({ error: null }) }; },
            },
            audit_logs: { insert: async () => ({ error: null }) },
        });
        const r = await recordDebtorResponse(okInput);
        expect(r).toMatchObject({ ok: true });
        expect(updateSpy).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `cd frontend && npx vitest run src/actions/recordDebtorResponse.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

Créer `frontend/src/actions/recordDebtorResponse.ts` :

```ts
'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';

const STAFF_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

const inputSchema = z.object({
    transactionId: z.string().uuid(),
    responseType: z.enum(['SILENT', 'ACKNOWLEDGE', 'DISPUTE', 'PAYMENT_PROMISE', 'PARTIAL_PAYMENT', 'PAID', 'REFUSED']),
    note: z.string().trim().max(500).optional(),
});

export async function recordDebtorResponse(
    raw: unknown,
): Promise<{ ok: true; tier: string } | { ok: false; reason: string }> {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    const { transactionId, responseType, note } = parsed.data;

    // 1. Authentifier + rôle staff (depuis profiles, jamais le JWT).
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    if (!profile || !STAFF_ROLES.includes(profile.role)) return { ok: false, reason: 'insufficient role' };

    const platform = createPlatformClient();

    // 2. Résoudre la juridiction de la transaction + isolation EXPLICITE
    //    (collection_reminders n'est pas tenant-scopée → pas d'auto-filtre).
    const { data: txn } = await platform
        .from('transactions').select('jurisdiction_id').eq('id', transactionId).maybeSingle();
    if (!txn) return { ok: false, reason: 'transaction not found' };
    const jurisdictionId = (txn as { jurisdiction_id: string | null }).jurisdiction_id;
    if (profile.role !== 'SUPERADMIN') {
        const staffJur = await getServerJurisdictionId();
        if (jurisdictionId !== staffJur) return { ok: false, reason: 'forbidden' };
    }

    // 3. Charger la relance la plus récente de la transaction.
    const { data: latest } = await platform
        .from('collection_reminders')
        .select('id, tier, debtor_response_type')
        .eq('transaction_id', transactionId)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (!latest) return { ok: false, reason: 'no reminder to annotate' };
    const reminder = latest as { id: string; tier: string; debtor_response_type: string };

    // 4. Stamper la réponse.
    const { error: updErr } = await platform
        .from('collection_reminders')
        .update({ debtor_response_type: responseType, debtor_response_at: new Date().toISOString() })
        .eq('id', reminder.id);
    if (updErr) return { ok: false, reason: `update failed: ${updErr.message}` };

    // 5. Audit (sans migration d'enum : TRANSACTION_UPDATED + event).
    await platform.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: auth.user.email ?? 'Staff',
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Transaction',
        entity_id: transactionId,
        jurisdiction_id: jurisdictionId,
        details_json: {
            event: 'DEBTOR_RESPONSE_RECORDED',
            tier: reminder.tier,
            previousResponse: reminder.debtor_response_type,
            newResponse: responseType,
            note: note ?? null,
        },
    });

    revalidatePath('/admin/collections');
    return { ok: true, tier: reminder.tier };
}
```

- [ ] **Step 4 : Lancer les tests + compilation**

Run: `cd frontend && npx vitest run src/actions/recordDebtorResponse.test.ts && npx tsc --noEmit`
Expected: PASS ; `tsc` silencieux.

- [ ] **Step 5 : Commit**

```bash
git add frontend/src/actions/recordDebtorResponse.ts frontend/src/actions/recordDebtorResponse.test.ts
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(collections): server action de saisie de la réponse débiteur (auditée, isolée par juridiction)"
```

---

### Task 4 : Page serveur + liste client + panneau détail

**Files:**
- Create: `frontend/src/app/(dashboard)/admin/collections/page.tsx`
- Create: `frontend/src/app/(dashboard)/admin/collections/CollectionsAdminList.tsx`

**Interfaces:**
- Consumes: `parseCollectionFilters`, `listCollectionsAdmin`, `listCollectionFilterOptions`, `tierVariant`, `responseVariant`, `CollectionAdminRow` (Task 2) ; `recordDebtorResponse` (Task 3) ; `createClient` (`@/lib/supabase/client`) ; `OsTable`/`OsBadge`/`OsButton`/`OsSelect`/`OsInput` ; `@radix-ui/react-dialog`.

- [ ] **Step 1 : Écrire la page serveur**

Créer `frontend/src/app/(dashboard)/admin/collections/page.tsx` :

```tsx
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import {
    parseCollectionFilters, listCollectionsAdmin, listCollectionFilterOptions,
} from '@/services/collectionAdminService';
import { CollectionsAdminList } from './CollectionsAdminList';

export const dynamic = 'force-dynamic';

const STAFF_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

export default async function AdminCollectionsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    if (!profile || !STAFF_ROLES.includes(profile.role)) redirect('/dashboard');

    const filters = parseCollectionFilters(await searchParams);
    const [page, options] = await Promise.all([
        listCollectionsAdmin(supabase, filters),
        listCollectionFilterOptions(supabase),
    ]);
    const t = await getTranslations('AdminCollections');

    return (
        <div className="p-4 sm:p-6">
            <h1 className="text-xl font-bold text-[var(--os-text-primary)]">{t('title')}</h1>
            <p className="text-sm text-[var(--os-text-muted)] mb-4">{t('subtitle')}</p>
            <CollectionsAdminList
                rows={page.rows}
                total={page.total}
                page={page.page}
                pageSize={page.pageSize}
                filters={filters}
                jurisdictions={options.jurisdictions}
            />
        </div>
    );
}
```

- [ ] **Step 2 : Écrire la liste client + panneau détail + dialogue**

Créer `frontend/src/app/(dashboard)/admin/collections/CollectionsAdminList.tsx` :

```tsx
'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as Dialog from '@radix-ui/react-dialog';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsBadge } from '@/components/ui/OsBadge';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput, OsSelect } from '@/components/ui/OsInput';
import { createClient } from '@/lib/supabase/client';
import { recordDebtorResponse } from '@/actions/recordDebtorResponse';
import {
    tierVariant, responseVariant, type CollectionAdminRow, type CollectionAdminFilters,
} from '@/services/collectionAdminService';

const RESPONSE_TYPES = ['ACKNOWLEDGE', 'DISPUTE', 'PAYMENT_PROMISE', 'PARTIAL_PAYMENT', 'PAID', 'REFUSED'] as const;
const TIERS = ['J3', 'J7', 'J15', 'J30', 'J45', 'BAILIFF', 'JUDICIAL'];
const STATUSES = ['PENDING', 'OVERDUE', 'PAID', 'DISPUTED'];

interface ReminderRow {
    id: string; tier: string; sent_at: string; sent_email: string; cc_emails: string[] | null;
    template_used: string; debtor_response_type: string; debtor_response_at: string | null;
}

interface Props {
    rows: CollectionAdminRow[];
    total: number;
    page: number;
    pageSize: number;
    filters: CollectionAdminFilters;
    jurisdictions: { id: string; name: string }[];
}

export function CollectionsAdminList({ rows, total, page, pageSize, filters, jurisdictions }: Props) {
    const t = useTranslations('AdminCollections');
    const router = useRouter();
    const searchParams = useSearchParams();
    const [selected, setSelected] = React.useState<CollectionAdminRow | null>(null);

    function setParam(key: string, value: string) {
        const params = new URLSearchParams(searchParams.toString());
        if (value) params.set(key, value); else params.delete(key);
        if (key !== 'page') params.delete('page');
        router.push(`?${params.toString()}`);
    }

    const columns: OsColumn<CollectionAdminRow>[] = [
        { key: 'debtor', header: t('col_debtor'), render: (r) => <span className="text-sm">{r.debtor_name ?? '—'}</span> },
        { key: 'invoice', header: t('col_invoice'), render: (r) => <span className="font-mono text-xs">{r.invoice_ref ?? r.transaction_id.slice(0, 8)}</span> },
        { key: 'outstanding', header: t('col_outstanding'), className: 'text-right', render: (r) => <span className="font-mono text-sm tabular-nums">${r.outstanding_usd.toLocaleString()}</span> },
        { key: 'status', header: t('col_status'), render: (r) => <OsBadge variant={r.status === 'PAID' ? 'paid' : r.status === 'OVERDUE' ? 'overdue' : r.status === 'DISPUTED' ? 'disputed' : 'pending'} label={r.status} /> },
        { key: 'tier', header: t('col_tier'), render: (r) => <OsBadge variant={tierVariant(r.latest_tier)} label={r.latest_tier ?? '—'} /> },
        { key: 'response', header: t('col_response'), render: (r) => <OsBadge variant={responseVariant(r.latest_response_type)} label={r.latest_response_type ?? 'SILENT'} /> },
        { key: 'count', header: t('col_count'), className: 'text-right', render: (r) => <span className="text-xs tabular-nums">{r.reminder_count}</span> },
    ];

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return (
        <>
            <div className="flex flex-wrap gap-2 mb-3">
                <OsInput placeholder={t('search')} defaultValue={filters.q ?? ''}
                    onKeyDown={(e) => { if (e.key === 'Enter') setParam('q', (e.target as HTMLInputElement).value); }} />
                <OsSelect placeholder={t('f_jurisdiction')} value={filters.jurisdictionId ?? ''}
                    onChange={(e) => setParam('jurisdictionId', e.target.value)}
                    options={jurisdictions.map((j) => ({ value: j.id, label: j.name }))} />
                <OsSelect placeholder={t('f_status')} value={filters.status ?? ''}
                    onChange={(e) => setParam('status', e.target.value)}
                    options={STATUSES.map((s) => ({ value: s, label: s }))} />
                <OsSelect placeholder={t('f_tier')} value={filters.latestTier ?? ''}
                    onChange={(e) => setParam('latestTier', e.target.value)}
                    options={TIERS.map((s) => ({ value: s, label: s }))} />
                <OsSelect placeholder={t('f_response')} value={filters.latestResponse ?? ''}
                    onChange={(e) => setParam('latestResponse', e.target.value)}
                    options={RESPONSE_TYPES.map((s) => ({ value: s, label: s }))} />
            </div>

            <OsTable columns={columns} rows={rows} keyExtractor={(r) => r.transaction_id}
                onRowClick={(r) => setSelected(r)} emptyMessage={t('empty')} />

            <div className="flex items-center justify-between mt-3 text-xs text-[var(--os-text-muted)]">
                <span>{t('pagination', { start: (page - 1) * pageSize + 1, end: Math.min(page * pageSize, total), total })}</span>
                <div className="flex gap-2">
                    <OsButton size="sm" variant="secondary" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>{t('prev')}</OsButton>
                    <OsButton size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setParam('page', String(page + 1))}>{t('next')}</OsButton>
                </div>
            </div>

            {selected && <DetailPanel row={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); router.refresh(); }} />}
        </>
    );
}

function DetailPanel({ row, onClose, onSaved }: { row: CollectionAdminRow; onClose: () => void; onSaved: () => void }) {
    const t = useTranslations('AdminCollections');
    const [reminders, setReminders] = React.useState<ReminderRow[] | null>(null);
    const [dialogOpen, setDialogOpen] = React.useState(false);
    const [responseType, setResponseType] = React.useState<string>('ACKNOWLEDGE');
    const [error, setError] = React.useState<string | null>(null);
    const [pending, startTransition] = React.useTransition();

    React.useEffect(() => {
        let cancelled = false;
        const supabase = createClient();
        supabase.from('collection_reminders')
            .select('id, tier, sent_at, sent_email, cc_emails, template_used, debtor_response_type, debtor_response_at')
            .eq('transaction_id', row.transaction_id)
            .order('sent_at', { ascending: true })
            .then(({ data }) => { if (!cancelled) setReminders((data ?? []) as ReminderRow[]); });
        return () => { cancelled = true; };
    }, [row.transaction_id]);

    function submit() {
        setError(null);
        startTransition(async () => {
            const res = await recordDebtorResponse({ transactionId: row.transaction_id, responseType });
            if (!res.ok) { setError(res.reason); return; }
            setDialogOpen(false);
            onSaved();
        });
    }

    return (
        <div className="mt-4 os-card p-4">
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-[var(--os-text-primary)]">
                    {t('timeline_title', { debtor: row.debtor_name ?? '—', ref: row.invoice_ref ?? row.transaction_id.slice(0, 8) })}
                </h2>
                <div className="flex gap-2">
                    <OsButton size="sm" variant="secondary" onClick={() => setDialogOpen(true)}>{t('record_response')}</OsButton>
                    <OsButton size="sm" variant="ghost" onClick={onClose}>{t('close')}</OsButton>
                </div>
            </div>

            {reminders === null ? (
                <p className="text-xs text-[var(--os-text-muted)]">{t('loading')}</p>
            ) : reminders.length === 0 ? (
                <p className="text-xs text-[var(--os-text-muted)]">{t('no_reminders')}</p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {reminders.map((r) => (
                        <li key={r.id} className="flex items-center gap-3 text-xs border-b border-[var(--os-border)] pb-2">
                            <OsBadge variant={tierVariant(r.tier)} label={r.tier} />
                            <span className="text-[var(--os-text-muted)]">{new Date(r.sent_at).toLocaleDateString()}</span>
                            <span className="text-[var(--os-text-secondary)] truncate">{r.sent_email}{r.cc_emails?.length ? ` +${r.cc_emails.length} cc` : ''}</span>
                            <span className="ml-auto"><OsBadge variant={responseVariant(r.debtor_response_type)} label={r.debtor_response_type} /></span>
                        </li>
                    ))}
                </ul>
            )}

            <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0" style={{ background: 'rgba(0,0,0,0.6)' }} />
                    <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] max-w-[92vw] rounded-2xl p-5"
                        style={{ background: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}>
                        <Dialog.Title className="text-sm font-bold text-[var(--os-text-primary)]">{t('dialog_title')}</Dialog.Title>
                        <Dialog.Description className="text-xs text-[var(--os-text-muted)] mb-3">{t('dialog_subtitle')}</Dialog.Description>
                        <OsSelect label={t('response_label')} value={responseType} onChange={(e) => setResponseType(e.target.value)}
                            options={RESPONSE_TYPES.map((s) => ({ value: s, label: s }))} />
                        {error && <p className="text-xs text-[#EF4444] mt-2">{error}</p>}
                        <div className="flex justify-end gap-2 mt-4">
                            <OsButton size="sm" variant="ghost" onClick={() => setDialogOpen(false)}>{t('cancel')}</OsButton>
                            <OsButton size="sm" variant="primary" loading={pending} onClick={submit}>{t('save')}</OsButton>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </div>
    );
}
```

- [ ] **Step 3 : Compilation + lint des deux fichiers**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/app/\(dashboard\)/admin/collections/`
Expected: `tsc` silencieux ; eslint 0 erreur (warnings tolérés s'ils existent déjà ailleurs). Si `OsSelect`/`OsInput` n'exposent pas `placeholder`/`onKeyDown`, adapter aux props réelles (voir `src/components/ui/OsInput.tsx`) — ne pas inventer de props.

- [ ] **Step 4 : Vérifier le rendu ne casse pas la build (import server action depuis client)**

Run: `cd frontend && npx vitest run src/services/collectionAdminService.test.ts` (garde-fou : les helpers importés par le composant compilent). Confirmer visuellement que `recordDebtorResponse` est bien un `'use server'` importé (server action appelable depuis un composant client).

- [ ] **Step 5 : Commit**

```bash
git add "frontend/src/app/(dashboard)/admin/collections/"
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(collections): écran admin de consultation des relances + saisie de réponse"
```

---

### Task 5 : Navigation, permissions RBAC, i18n

**Files:**
- Modify: `frontend/src/lib/rbac.ts` (ajouter `admin-collections` à `NAV_PERMISSIONS`)
- Modify: `frontend/src/components/dashboard/layout/DashboardSidebar.tsx` (entrée `NAV_ITEMS`)
- Modify: `frontend/messages/en.json`, `fr.json`, `pt.json`, `so.json`, `sw.json`, `ar.json`

**Interfaces:**
- Consumes: `UserRole` (`@/types/secure`).

- [ ] **Step 1 : Permission RBAC**

Dans `frontend/src/lib/rbac.ts`, ajouter au dictionnaire `NAV_PERMISSIONS` (à côté de `admin-invoices`) :

```ts
    'admin-collections': [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SUPERADMIN],
```

- [ ] **Step 2 : Entrée de navigation**

Dans `frontend/src/components/dashboard/layout/DashboardSidebar.tsx`, importer une icône lucide (`Scale` si pas déjà importée) et ajouter à `NAV_ITEMS` (dans la section `admin`, à côté de l'entrée `admin-invoices`) :

```tsx
    { key: 'admin-collections', icon: <Scale className="w-4 h-4" />, href: '/admin/collections', labelKey: 'nav_admin_collections', section: 'admin' },
```

(Adapter la forme exacte de l'objet — `icon`/`href`/`labelKey`/`section` — à celle des entrées voisines réellement présentes dans le fichier.)

- [ ] **Step 3 : i18n — clé de nav + namespace (6 locales)**

Dans **chaque** fichier `frontend/messages/{en,fr,pt,so,sw,ar}.json` : ajouter `nav_admin_collections` dans le namespace `Dashboard` (à côté de `nav_admin_invoices`), et un namespace `AdminCollections`. Valeurs de référence (en.json) :

```json
"AdminCollections": {
  "title": "Collections",
  "subtitle": "Reminder history and debtor responses for outstanding pro-formas.",
  "search": "Search debtor or invoice…",
  "f_jurisdiction": "All jurisdictions",
  "f_status": "All statuses",
  "f_tier": "All tiers",
  "f_response": "All responses",
  "col_debtor": "Debtor",
  "col_invoice": "Invoice",
  "col_outstanding": "Outstanding",
  "col_status": "Status",
  "col_tier": "Last tier",
  "col_response": "Response",
  "col_count": "Reminders",
  "empty": "No reminded receivables.",
  "pagination": "{start}–{end} of {total}",
  "prev": "Previous",
  "next": "Next",
  "timeline_title": "{debtor} — {ref}",
  "record_response": "Record response",
  "close": "Close",
  "loading": "Loading…",
  "no_reminders": "No reminders on file.",
  "dialog_title": "Record debtor response",
  "dialog_subtitle": "This is recorded against the most recent reminder and drives the reminder engine.",
  "response_label": "Debtor response",
  "cancel": "Cancel",
  "save": "Save"
}
```

Pour `fr.json`, traduire proprement (français métier). Pour `pt/so/sw/ar`, traduire dans le style existant du projet (baseline auto à relire natif — dette i18n connue). `Dashboard.nav_admin_collections` : en `"Collections"`, fr `"Recouvrement"`, et l'équivalent par locale.

- [ ] **Step 4 : Vérifier build i18n + lint**

Run: `cd frontend && npx tsc --noEmit && node -e "['en','fr','pt','so','sw','ar'].forEach(l=>{const m=require('./messages/'+l+'.json'); if(!m.AdminCollections||!m.Dashboard.nav_admin_collections) throw new Error('missing keys in '+l)}); console.log('i18n keys OK')"`
Expected: `tsc` silencieux ; `i18n keys OK`.

- [ ] **Step 5 : Commit**

```bash
git add frontend/src/lib/rbac.ts frontend/src/components/dashboard/layout/DashboardSidebar.tsx frontend/messages/en.json frontend/messages/fr.json frontend/messages/pt.json frontend/messages/so.json frontend/messages/sw.json frontend/messages/ar.json
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(collections): entrée de navigation, permission staff et traductions"
```

---

### Task 6 : Vérification d'ensemble

- [ ] **Step 1 : Suite complète**

Run: `cd frontend && npx vitest run`
Expected: 0 échec ; total ≥ baseline + les nouveaux tests (collectionAdminService, recordDebtorResponse).

- [ ] **Step 2 : Typage**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune sortie.

- [ ] **Step 3 : Lint non dégradé**

Run: `cd frontend && npm run lint 2>&1 | tail -3`
Expected: `✖ 157 problems (62 errors, 95 warnings)` (baseline `develop`) — ou meilleur. Toute erreur nouvelle sur un fichier touché doit être corrigée.

- [ ] **Step 4 : Build de la route (garde-fou App Router)**

Run: `cd frontend && npx next build --no-lint 2>&1 | grep -iE "admin/collections|error" | head`
Expected: la route `/admin/collections` apparaît dans la sortie de build sans erreur. (Si `--no-lint` n'est pas supporté par la version de Next, lancer `npx next build` et ne regarder que l'absence d'erreur de compilation de cette route.)

---

## Bascule / déploiement

- La mig 111 (`v_collection_admin`) s'applique au déploiement (`node scripts/db-migrate.mjs`) — additive, sans risque. Elle **dépend de la mig 110** (paliers J3/J7) déjà sur develop ; appliquer 110 puis 111.
- L'écran n'affiche des lignes que lorsque le cron B1 (chantier B1) a produit des relances — cohérent, pas un bug.

## Chantier suivant (B3)

Escalade manuelle BAILIFF/JUDICIAL : boutons dans le panneau détail, server action `escalateCollection` (modelée sur `escalateToOwner` : `resolveInvoiceRecipients` + `fetchJurisdictionBailiffCc` + gabarits e-mail contentieux + insert `collection_reminders` tier BAILIFF/JUDICIAL + `escalated_bailiff=true`, garde anti-doublon via l'index unique `(transaction_id, tier)`), édition de `bailiff_cc_emails`, extension de `reminderTemplate` aux deux paliers manuels.
