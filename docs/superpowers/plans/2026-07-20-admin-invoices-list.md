# Admin Factures — Liste globale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une page d'administration `/admin/invoices` listant toutes les factures (transactions PROFORMA/FINAL/COMPLEMENT/REFUND, maritime + aviation) avec filtres serveur et pagination, en lecture seule.

**Architecture:** Une vue SQL jointe `v_invoice_admin` (transactions ← shipowners ← jurisdictions) alimente un service `invoiceAdminService` qui applique les filtres et la pagination côté serveur (`count:'exact'` + `range`). La page serveur lit les `searchParams` (parsés/validés par Zod), la barre de filtres client pousse l'état dans l'URL → refetch serveur. Lecture seule : liens PDF/vérif + navigation vers la fiche débiteur.

**Tech Stack:** Next.js 16 App Router (route group `(dashboard)` hors URL), React 19, TypeScript strict, Zod 4, Supabase (`@supabase/ssr`), next-intl (6 locales), Vitest, design system `Os*`.

## Global Constraints

- TypeScript **strict**, **jamais `any`** — SAUF le typage du client Supabase, où l'on suit le patron EXISTANT `type Client = SupabaseClient<any>;` précédé de `// eslint-disable-next-line @typescript-eslint/no-explicit-any` (cf. `frontend/src/services/transactionService.ts:6-7`), car la vue `v_invoice_admin` n'est pas dans `supabase.generated.ts`.
- Validation **Zod** de tout input externe (les `searchParams`).
- Composants **`Os*` uniquement** (jamais shadcn) : `OsTable`, `OsBadge`, `OsButton`, `OsInput`, `OsSelect`.
- `OsSelect({ label, value, onChange, options, placeholder })` où `options: { value: string; label: string }[]` (exporté depuis `@/components/ui/OsInput`).
- `OsTable<T>({ columns, rows, keyExtractor, onRowClick?, emptyMessage })`, `OsColumn<T> { key, header, render, className? }` (depuis `@/components/ui/OsTable`).
- `OsBadge({ variant, label, size? })` — `variant` de type `BadgeVariant` (`'active'|'warning'|'critical'|'info'|'archived'|'draft'` …) ; PAS de `tone`, PAS de children.
- Migration : style `NNN_description.sql` (next = **096**), bannière d'en-tête, **ADDITIVE**, `CREATE OR REPLACE VIEW`, `GRANT`, commentaire `-- DOWN:` en fin.
- **Lecture seule** : aucune écriture/mutation sur `transactions`.
- Commits : auteur `Loïc Leclerc <leclerc@drwintech.com>`, messages conventionnels **humanisés**, **jamais** de trailer/Co-Authored-By IA, **staging explicite** (chemins, jamais `git add -A`). Branche `feat/admin-invoices`, PR vers `develop`.
- Route réelle = `/admin/invoices` (le route group `(dashboard)` n'apparaît pas dans l'URL).
- Clé de navigation = **`admin-invoices`** (la clé `invoices` est déjà prise par le portail owner → `/dashboard/invoices`).

---

### Task 1: Migration — vue `v_invoice_admin`

**Files:**
- Create: `supabase/migrations/096_v_invoice_admin.sql`

**Interfaces:**
- Consumes: tables existantes `transactions`, `shipowners`, `jurisdictions`.
- Produces: vue `public.v_invoice_admin` avec les colonnes : `id, invoice_ref, content_hash, verify_signature, document_type, mode, status, tax_amount_usd, partial_paid_usd, outstanding_usd, created_at, due_date, paid_at, vessel_name, vessel_imo, shipowner_id, debtor_name, flag_country, jurisdiction_id, jurisdiction_code, jurisdiction_name, is_aviation`.

- [ ] **Step 1: Écrire la migration**

Créer `supabase/migrations/096_v_invoice_admin.sql` :

```sql
-- ============================================================================
-- 096_v_invoice_admin.sql
-- Vue de lecture pour la liste admin globale des factures (Sprint 2, ss-projet 3).
-- Agrège à plat les transactions "facture" (PROFORMA/FINAL/COMPLEMENT/REFUND),
-- maritime + aviation, jointes au débiteur (shipowners) et à la juridiction
-- émettrice (jurisdictions). security_invoker => hérite des RLS sous-jacentes.
-- ADDITIVE. Lecture seule.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_invoice_admin
WITH (security_invoker = true) AS
SELECT
    t.id,
    t.invoice_ref,
    t.content_hash,
    t.verify_signature,
    t.document_type,
    t.mode,
    t.status,
    t.tax_amount_usd,
    t.partial_paid_usd,
    (t.tax_amount_usd - COALESCE(t.partial_paid_usd, 0)) AS outstanding_usd,
    t.created_at,
    t.due_date,
    t.paid_at,
    t.vessel_name,
    t.vessel_imo,
    t.shipowner_id,
    s.name          AS debtor_name,
    s.country_code  AS flag_country,
    t.jurisdiction_id,
    j.code          AS jurisdiction_code,
    j.name          AS jurisdiction_name,
    (t.mode = 'AIR' OR s.iata_code IS NOT NULL) AS is_aviation
FROM public.transactions t
LEFT JOIN public.shipowners s   ON t.shipowner_id = s.id
LEFT JOIN public.jurisdictions j ON t.jurisdiction_id = j.id
WHERE t.document_type IN ('PROFORMA', 'FINAL', 'COMPLEMENT', 'REFUND');

GRANT SELECT ON public.v_invoice_admin TO authenticated, service_role;

-- DOWN: DROP VIEW IF EXISTS public.v_invoice_admin;
```

- [ ] **Step 2: Vérifier la syntaxe SQL (lint local)**

Run: `grep -c "security_invoker" supabase/migrations/096_v_invoice_admin.sql`
Expected: `1` (la vue est bien en security_invoker).

Vérifier visuellement : présence du `GRANT`, du `-- DOWN:`, `document_type IN (...)`, et que `outstanding_usd`/`is_aviation` sont bien calculés.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/096_v_invoice_admin.sql
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(db): vue v_invoice_admin pour la liste admin des factures"
```

---

### Task 2: Service — types + `parseInvoiceFilters` (Zod)

**Files:**
- Create: `frontend/src/services/invoiceAdminService.ts`
- Create: `frontend/src/services/invoiceAdminService.test.ts`

**Interfaces:**
- Produces:
  - `type InvoiceDocumentType = 'PROFORMA' | 'FINAL' | 'COMPLEMENT' | 'REFUND'`
  - `type TransportMode = 'MARITIME' | 'AIR'`
  - `interface InvoiceAdminFilters { documentType?: InvoiceDocumentType; mode?: TransportMode; status?: string; jurisdictionId?: string; flagCountry?: string; dueOnly?: boolean; search?: string; dateFrom?: string; dateTo?: string; page: number; pageSize: number; }`
  - `function parseInvoiceFilters(searchParams: Record<string, string | string[] | undefined>): InvoiceAdminFilters`
  - `const DEFAULT_PAGE_SIZE = 25`, `const MAX_PAGE_SIZE = 100`

- [ ] **Step 1: Écrire les tests (échouants)**

Créer `frontend/src/services/invoiceAdminService.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { parseInvoiceFilters } from './invoiceAdminService';

describe('parseInvoiceFilters', () => {
    it('applique les défauts page=1 pageSize=25 quand rien n’est fourni', () => {
        const f = parseInvoiceFilters({});
        expect(f.page).toBe(1);
        expect(f.pageSize).toBe(25);
        expect(f.documentType).toBeUndefined();
        expect(f.dueOnly).toBe(false);
    });

    it('clampe pageSize dans [1,100]', () => {
        expect(parseInvoiceFilters({ pageSize: '0' }).pageSize).toBe(1);
        expect(parseInvoiceFilters({ pageSize: '500' }).pageSize).toBe(100);
        expect(parseInvoiceFilters({ pageSize: '50' }).pageSize).toBe(50);
    });

    it('force page >= 1', () => {
        expect(parseInvoiceFilters({ page: '0' }).page).toBe(1);
        expect(parseInvoiceFilters({ page: '-3' }).page).toBe(1);
        expect(parseInvoiceFilters({ page: '4' }).page).toBe(4);
    });

    it('ignore une énumération invalide (documentType, mode)', () => {
        expect(parseInvoiceFilters({ documentType: 'BOGUS' }).documentType).toBeUndefined();
        expect(parseInvoiceFilters({ documentType: 'PROFORMA' }).documentType).toBe('PROFORMA');
        expect(parseInvoiceFilters({ mode: 'ROCKET' }).mode).toBeUndefined();
        expect(parseInvoiceFilters({ mode: 'AIR' }).mode).toBe('AIR');
    });

    it('interprète dueOnly', () => {
        expect(parseInvoiceFilters({ dueOnly: '1' }).dueOnly).toBe(true);
        expect(parseInvoiceFilters({ dueOnly: 'true' }).dueOnly).toBe(true);
        expect(parseInvoiceFilters({ dueOnly: '0' }).dueOnly).toBe(false);
        expect(parseInvoiceFilters({ dueOnly: 'no' }).dueOnly).toBe(false);
    });

    it('trim la recherche et traite le vide comme undefined', () => {
        expect(parseInvoiceFilters({ search: '  ABC ' }).search).toBe('ABC');
        expect(parseInvoiceFilters({ search: '   ' }).search).toBeUndefined();
    });

    it('valide les dates YYYY-MM-DD et rejette le reste', () => {
        expect(parseInvoiceFilters({ dateFrom: '2026-05-01' }).dateFrom).toBe('2026-05-01');
        expect(parseInvoiceFilters({ dateFrom: '01/05/2026' }).dateFrom).toBeUndefined();
        expect(parseInvoiceFilters({ dateTo: 'hier' }).dateTo).toBeUndefined();
    });

    it('prend la première valeur si le param est un tableau', () => {
        expect(parseInvoiceFilters({ mode: ['AIR', 'MARITIME'] }).mode).toBe('AIR');
    });
});
```

- [ ] **Step 2: Lancer les tests → échec attendu**

Run: `cd frontend && npx vitest run src/services/invoiceAdminService.test.ts`
Expected: FAIL (`parseInvoiceFilters` non exporté / module introuvable).

- [ ] **Step 3: Implémenter types + `parseInvoiceFilters`**

Créer `frontend/src/services/invoiceAdminService.ts` :

```ts
import { z } from 'zod';

export type InvoiceDocumentType = 'PROFORMA' | 'FINAL' | 'COMPLEMENT' | 'REFUND';
export type TransportMode = 'MARITIME' | 'AIR';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface InvoiceAdminFilters {
    documentType?: InvoiceDocumentType;
    mode?: TransportMode;
    status?: string;
    jurisdictionId?: string;
    flagCountry?: string;
    dueOnly?: boolean;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    page: number;
    pageSize: number;
}

/** Retient la première valeur d'un param (string | string[] | undefined). */
function first(v: string | string[] | undefined): string | undefined {
    if (Array.isArray(v)) return v[0];
    return v ?? undefined;
}

const filtersSchema = z.object({
    documentType: z.enum(['PROFORMA', 'FINAL', 'COMPLEMENT', 'REFUND']).optional().catch(undefined),
    mode: z.enum(['MARITIME', 'AIR']).optional().catch(undefined),
    status: z.string().trim().min(1).optional().catch(undefined),
    jurisdictionId: z.string().trim().min(1).optional().catch(undefined),
    flagCountry: z.string().trim().min(1).optional().catch(undefined),
    dueOnly: z.boolean().catch(false),
    search: z.string().trim().min(1).optional().catch(undefined),
    dateFrom: z.string().regex(DATE_RE).optional().catch(undefined),
    dateTo: z.string().regex(DATE_RE).optional().catch(undefined),
    page: z.number().int().min(1).catch(1),
    pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).catch(DEFAULT_PAGE_SIZE),
});

export function parseInvoiceFilters(
    searchParams: Record<string, string | string[] | undefined>,
): InvoiceAdminFilters {
    const rawPage = Number.parseInt(first(searchParams.page) ?? '', 10);
    const rawSize = Number.parseInt(first(searchParams.pageSize) ?? '', 10);
    const dueRaw = first(searchParams.dueOnly);

    const parsed = filtersSchema.parse({
        documentType: first(searchParams.documentType),
        mode: first(searchParams.mode),
        status: first(searchParams.status),
        jurisdictionId: first(searchParams.jurisdictionId),
        flagCountry: first(searchParams.flagCountry),
        dueOnly: dueRaw === '1' || dueRaw === 'true',
        search: first(searchParams.search),
        dateFrom: first(searchParams.dateFrom),
        dateTo: first(searchParams.dateTo),
        page: Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1,
        pageSize: Number.isFinite(rawSize) ? Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize)) : DEFAULT_PAGE_SIZE,
    });

    return parsed;
}
```

Note : `.catch()` de Zod garantit qu'une valeur invalide retombe sur le défaut sans lever — pas de 500 sur une URL trafiquée. Le clamp de `page`/`pageSize` est fait avant le parse pour couvrir les valeurs négatives.

- [ ] **Step 4: Lancer les tests → succès attendu**

Run: `cd frontend && npx vitest run src/services/invoiceAdminService.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/invoiceAdminService.ts frontend/src/services/invoiceAdminService.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(invoices): parseInvoiceFilters + types du service factures admin"
```

---

### Task 3: Service — `listInvoicesAdmin` (paginé) + `listInvoiceFilterOptions`

**Files:**
- Modify: `frontend/src/services/invoiceAdminService.ts`
- Modify: `frontend/src/services/invoiceAdminService.test.ts`

**Interfaces:**
- Consumes: `InvoiceAdminFilters` (Task 2), vue `v_invoice_admin` (Task 1).
- Produces:
  - `interface InvoiceAdminRow { id: string; invoice_ref: string | null; content_hash: string | null; verify_signature: string | null; document_type: InvoiceDocumentType; mode: TransportMode; status: string; tax_amount_usd: number; partial_paid_usd: number; outstanding_usd: number; created_at: string; due_date: string | null; paid_at: string | null; vessel_name: string; vessel_imo: string; shipowner_id: string | null; debtor_name: string | null; flag_country: string | null; jurisdiction_id: string; jurisdiction_code: string | null; jurisdiction_name: string | null; is_aviation: boolean; }`
  - `interface InvoiceAdminPage { rows: InvoiceAdminRow[]; total: number; page: number; pageSize: number; }`
  - `function listInvoicesAdmin(db: Client, filters: InvoiceAdminFilters): Promise<InvoiceAdminPage>`
  - `interface InvoiceFilterOptions { jurisdictions: { id: string; name: string }[]; flagCountries: string[]; }`
  - `function listInvoiceFilterOptions(db: Client): Promise<InvoiceFilterOptions>`

- [ ] **Step 1: Écrire les tests (échouants)**

Ajouter à `frontend/src/services/invoiceAdminService.test.ts` (après le bloc existant) :

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { listInvoicesAdmin, listInvoiceFilterOptions } from './invoiceAdminService';

// Chaîne de query builder mockée ; le terminal .range() résout {data,count,error}.
function makeChain(result: { data: unknown[]; count: number | null }) {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gt', 'gte', 'lte', 'or', 'order']) {
        chain[m] = vi.fn(() => chain);
    }
    chain.range = vi.fn(() => Promise.resolve({ data: result.data, count: result.count, error: null }));
    return chain;
}

describe('listInvoicesAdmin', () => {
    it('interroge la vue, applique les filtres et pagine via range', async () => {
        const chain = makeChain({ data: [], count: 0 });
        const db = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
        await listInvoicesAdmin(db, {
            mode: 'AIR', dueOnly: true, search: 'ABC', page: 2, pageSize: 10,
        });
        expect(db.from).toHaveBeenCalledWith('v_invoice_admin');
        expect(chain.eq).toHaveBeenCalledWith('mode', 'AIR');
        expect(chain.gt).toHaveBeenCalledWith('outstanding_usd', 0);
        expect(chain.or).toHaveBeenCalled();
        // page 2, pageSize 10 => range(10, 19)
        expect(chain.range).toHaveBeenCalledWith(10, 19);
    });

    it('renvoie total depuis le count et normalise les nombres', async () => {
        const chain = makeChain({
            data: [{
                id: 'tx-1', invoice_ref: 'INV-1', content_hash: null, verify_signature: null,
                document_type: 'PROFORMA', mode: 'MARITIME', status: 'PENDING',
                tax_amount_usd: '100.5', partial_paid_usd: '40', outstanding_usd: '60.5',
                created_at: '2026-05-01T00:00:00Z', due_date: null, paid_at: null,
                vessel_name: 'MV Test', vessel_imo: 'UNVERIFIED-1', shipowner_id: 'so-1',
                debtor_name: 'Acme', flag_country: 'SO', jurisdiction_id: 'j-1',
                jurisdiction_code: 'SOMALILAND', jurisdiction_name: 'Somaliland', is_aviation: false,
            }],
            count: 87,
        });
        const db = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
        const res = await listInvoicesAdmin(db, { page: 1, pageSize: 25 });
        expect(res.total).toBe(87);
        expect(res.page).toBe(1);
        expect(res.rows[0].tax_amount_usd).toBe(100.5);
        expect(res.rows[0].outstanding_usd).toBe(60.5);
    });

    it('n’applique pas de filtre eq quand les champs sont absents', async () => {
        const chain = makeChain({ data: [], count: 0 });
        const db = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
        await listInvoicesAdmin(db, { page: 1, pageSize: 25 });
        expect(chain.eq).not.toHaveBeenCalled();
        expect(chain.gt).not.toHaveBeenCalled();
        expect(chain.or).not.toHaveBeenCalled();
    });
});

describe('listInvoiceFilterOptions', () => {
    it('charge les juridictions et déduplique les pavillons', async () => {
        const jchain = {
            select: vi.fn(() => jchain),
            order: vi.fn(() => Promise.resolve({ data: [{ id: 'j-1', name: 'Somaliland' }], error: null })),
        };
        const fchain = {
            select: vi.fn(() => Promise.resolve({
                data: [{ flag_country: 'SO' }, { flag_country: 'SO' }, { flag_country: 'DJ' }, { flag_country: null }],
                error: null,
            })),
        };
        const db = {
            from: vi.fn((t: string) => (t === 'jurisdictions' ? jchain : fchain)),
        } as unknown as SupabaseClient;
        const res = await listInvoiceFilterOptions(db);
        expect(res.jurisdictions).toEqual([{ id: 'j-1', name: 'Somaliland' }]);
        expect(res.flagCountries.sort()).toEqual(['DJ', 'SO']);
    });
});
```

- [ ] **Step 2: Lancer les tests → échec attendu**

Run: `cd frontend && npx vitest run src/services/invoiceAdminService.test.ts`
Expected: FAIL (`listInvoicesAdmin` / `listInvoiceFilterOptions` non exportés).

- [ ] **Step 3: Implémenter `listInvoicesAdmin` + `listInvoiceFilterOptions`**

Ajouter en tête de `frontend/src/services/invoiceAdminService.ts`, après l'import `zod` :

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

// La vue v_invoice_admin n'est pas dans supabase.generated.ts ; on suit le patron
// existant (cf. transactionService.ts) d'un client non typé pour le query builder.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;
```

Puis, à la fin du fichier :

```ts
export interface InvoiceAdminRow {
    id: string;
    invoice_ref: string | null;
    content_hash: string | null;
    verify_signature: string | null;
    document_type: InvoiceDocumentType;
    mode: TransportMode;
    status: string;
    tax_amount_usd: number;
    partial_paid_usd: number;
    outstanding_usd: number;
    created_at: string;
    due_date: string | null;
    paid_at: string | null;
    vessel_name: string;
    vessel_imo: string;
    shipowner_id: string | null;
    debtor_name: string | null;
    flag_country: string | null;
    jurisdiction_id: string;
    jurisdiction_code: string | null;
    jurisdiction_name: string | null;
    is_aviation: boolean;
}

export interface InvoiceAdminPage {
    rows: InvoiceAdminRow[];
    total: number;
    page: number;
    pageSize: number;
}

/** Échappe les caractères spéciaux d'un terme de recherche pour un filtre PostgREST `.or(ilike)`. */
function escapeSearch(q: string): string {
    return q.replace(/[%,()]/g, ' ');
}

interface RawRow {
    [key: string]: unknown;
}

function toRow(r: RawRow): InvoiceAdminRow {
    return {
        id: String(r.id),
        invoice_ref: (r.invoice_ref as string | null) ?? null,
        content_hash: (r.content_hash as string | null) ?? null,
        verify_signature: (r.verify_signature as string | null) ?? null,
        document_type: r.document_type as InvoiceDocumentType,
        mode: r.mode as TransportMode,
        status: String(r.status),
        tax_amount_usd: Number(r.tax_amount_usd),
        partial_paid_usd: Number(r.partial_paid_usd),
        outstanding_usd: Number(r.outstanding_usd),
        created_at: String(r.created_at),
        due_date: (r.due_date as string | null) ?? null,
        paid_at: (r.paid_at as string | null) ?? null,
        vessel_name: String(r.vessel_name ?? ''),
        vessel_imo: String(r.vessel_imo ?? ''),
        shipowner_id: (r.shipowner_id as string | null) ?? null,
        debtor_name: (r.debtor_name as string | null) ?? null,
        flag_country: (r.flag_country as string | null) ?? null,
        jurisdiction_id: String(r.jurisdiction_id),
        jurisdiction_code: (r.jurisdiction_code as string | null) ?? null,
        jurisdiction_name: (r.jurisdiction_name as string | null) ?? null,
        is_aviation: Boolean(r.is_aviation),
    };
}

export async function listInvoicesAdmin(
    db: Client,
    filters: InvoiceAdminFilters,
): Promise<InvoiceAdminPage> {
    let q = db.from('v_invoice_admin').select('*', { count: 'exact' });

    if (filters.documentType) q = q.eq('document_type', filters.documentType);
    if (filters.mode) q = q.eq('mode', filters.mode);
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.jurisdictionId) q = q.eq('jurisdiction_id', filters.jurisdictionId);
    if (filters.flagCountry) q = q.eq('flag_country', filters.flagCountry);
    if (filters.dueOnly) q = q.gt('outstanding_usd', 0);
    if (filters.dateFrom) q = q.gte('created_at', filters.dateFrom);
    if (filters.dateTo) q = q.lte('created_at', `${filters.dateTo}T23:59:59.999Z`);
    if (filters.search) {
        const s = escapeSearch(filters.search);
        q = q.or(
            `invoice_ref.ilike.%${s}%,vessel_name.ilike.%${s}%,vessel_imo.ilike.%${s}%,debtor_name.ilike.%${s}%`,
        );
    }

    const offset = (filters.page - 1) * filters.pageSize;
    const { data, count, error } = await q
        .order('created_at', { ascending: false })
        .range(offset, offset + filters.pageSize - 1);

    if (error) throw new Error(`listInvoicesAdmin: ${error.message}`);

    return {
        rows: ((data ?? []) as RawRow[]).map(toRow),
        total: count ?? 0,
        page: filters.page,
        pageSize: filters.pageSize,
    };
}

export interface InvoiceFilterOptions {
    jurisdictions: { id: string; name: string }[];
    flagCountries: string[];
}

export async function listInvoiceFilterOptions(db: Client): Promise<InvoiceFilterOptions> {
    const { data: jData } = await db
        .from('jurisdictions')
        .select('id, name')
        .order('name', { ascending: true });

    const { data: fData } = await db
        .from('v_invoice_admin')
        .select('flag_country');

    const flagSet = new Set<string>();
    for (const row of (fData ?? []) as { flag_country: string | null }[]) {
        if (row.flag_country) flagSet.add(row.flag_country);
    }

    return {
        jurisdictions: ((jData ?? []) as { id: string; name: string }[]).map((j) => ({ id: j.id, name: j.name })),
        flagCountries: [...flagSet].sort(),
    };
}
```

- [ ] **Step 4: Lancer les tests → succès attendu**

Run: `cd frontend && npx vitest run src/services/invoiceAdminService.test.ts`
Expected: PASS (12 tests au total).

- [ ] **Step 5: Vérifier tsc + lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/services/invoiceAdminService.ts`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/invoiceAdminService.ts frontend/src/services/invoiceAdminService.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(invoices): listInvoicesAdmin paginé + options de filtres"
```

---

### Task 4: Pages — server `page.tsx` + client `InvoicesAdminList.tsx`

**Files:**
- Create: `frontend/src/app/(dashboard)/admin/invoices/page.tsx`
- Create: `frontend/src/app/(dashboard)/admin/invoices/InvoicesAdminList.tsx`

**Interfaces:**
- Consumes: `parseInvoiceFilters`, `listInvoicesAdmin`, `listInvoiceFilterOptions`, `InvoiceAdminRow`, `InvoiceAdminFilters`, `InvoiceFilterOptions` (Tasks 2/3) ; `createClient` de `@/lib/supabase/server` ; `OsTable`/`OsColumn`, `OsBadge`/`BadgeVariant`, `OsButton`, `OsInput`, `OsSelect`.

- [ ] **Step 1: Écrire le server component**

Créer `frontend/src/app/(dashboard)/admin/invoices/page.tsx` :

```tsx
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import {
    parseInvoiceFilters,
    listInvoicesAdmin,
    listInvoiceFilterOptions,
} from '@/services/invoiceAdminService';
import { InvoicesAdminList } from './InvoicesAdminList';

export const dynamic = 'force-dynamic';

const STAFF_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

export default async function AdminInvoicesPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !STAFF_ROLES.includes(profile.role)) redirect('/dashboard');

    const filters = parseInvoiceFilters(await searchParams);
    const [pageData, options] = await Promise.all([
        listInvoicesAdmin(supabase, filters),
        listInvoiceFilterOptions(supabase),
    ]);

    const t = await getTranslations('AdminInvoices');
    return (
        <div className="px-6 py-4">
            <h1 className="text-2xl font-semibold mb-2 text-[var(--os-text-primary)]">{t('title')}</h1>
            <p className="text-[var(--os-text-muted)] mb-6 text-sm">{t('subtitle')}</p>
            <InvoicesAdminList
                rows={pageData.rows}
                total={pageData.total}
                page={pageData.page}
                pageSize={pageData.pageSize}
                filters={filters}
                options={options}
            />
        </div>
    );
}
```

- [ ] **Step 2: Écrire le client component**

Créer `frontend/src/app/(dashboard)/admin/invoices/InvoicesAdminList.tsx` :

```tsx
'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Download, ShieldCheck } from 'lucide-react';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsBadge, type BadgeVariant } from '@/components/ui/OsBadge';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput, OsSelect } from '@/components/ui/OsInput';
import type {
    InvoiceAdminRow,
    InvoiceAdminFilters,
    InvoiceFilterOptions,
} from '@/services/invoiceAdminService';

interface Props {
    rows: InvoiceAdminRow[];
    total: number;
    page: number;
    pageSize: number;
    filters: InvoiceAdminFilters;
    options: InvoiceFilterOptions;
}

const DOC_TYPES = ['PROFORMA', 'FINAL', 'COMPLEMENT', 'REFUND'] as const;
const MODES = ['MARITIME', 'AIR'] as const;
const STATUSES = ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED'] as const;

function docVariant(d: InvoiceAdminRow['document_type']): BadgeVariant {
    if (d === 'PROFORMA') return 'warning';
    if (d === 'FINAL') return 'active';
    if (d === 'COMPLEMENT') return 'info';
    return 'archived'; // REFUND
}

function statusVariant(s: string): BadgeVariant {
    if (s === 'PAID') return 'active';
    if (s === 'OVERDUE') return 'critical';
    if (s === 'PENDING' || s === 'PARTIAL') return 'warning';
    if (s === 'CANCELLED') return 'archived';
    return 'info';
}

function usd(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

export function InvoicesAdminList({ rows, total, page, pageSize, filters, options }: Props) {
    const t = useTranslations('AdminInvoices');
    const router = useRouter();
    const searchParams = useSearchParams();
    const [search, setSearch] = React.useState(filters.search ?? '');

    // Met à jour un paramètre d'URL et réinitialise la page (sauf pour 'page').
    const setParam = React.useCallback(
        (key: string, value: string | null) => {
            const params = new URLSearchParams(searchParams.toString());
            if (value === null || value === '') params.delete(key);
            else params.set(key, value);
            if (key !== 'page') params.delete('page');
            router.push(`?${params.toString()}`);
        },
        [router, searchParams],
    );

    const onSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setParam('search', search.trim() || null);
    };

    const columns: OsColumn<InvoiceAdminRow>[] = [
        {
            key: 'ref',
            header: t('col_ref'),
            render: (r) => (
                <span className="font-mono text-xs text-[var(--os-text-primary)]">
                    {r.invoice_ref ?? r.id.slice(0, 8)}
                </span>
            ),
        },
        { key: 'type', header: t('col_type'), render: (r) => <OsBadge variant={docVariant(r.document_type)} label={r.document_type} /> },
        { key: 'mode', header: t('col_mode'), render: (r) => <OsBadge variant={r.mode === 'AIR' ? 'info' : 'draft'} label={r.mode} /> },
        { key: 'debtor', header: t('col_debtor'), render: (r) => <span className="text-sm">{r.debtor_name ?? '—'}</span> },
        { key: 'flag', header: t('col_flag'), render: (r) => <span className="text-sm tabular-nums">{r.flag_country ?? '—'}</span> },
        { key: 'jurisdiction', header: t('col_jurisdiction'), render: (r) => <span className="text-sm">{r.jurisdiction_name ?? '—'}</span> },
        {
            key: 'created',
            header: t('col_created'),
            render: (r) => <span className="text-xs text-[var(--os-text-muted)] tabular-nums">{new Date(r.created_at).toLocaleDateString()}</span>,
        },
        { key: 'amount', header: t('col_amount'), className: 'text-right', render: (r) => <span className="font-mono text-sm tabular-nums">{usd(r.tax_amount_usd)}</span> },
        {
            key: 'due',
            header: t('col_due'),
            className: 'text-right',
            render: (r) => (
                <span className={`font-mono text-sm tabular-nums ${r.outstanding_usd > 0 ? 'text-[#F59E0B] font-semibold' : 'text-[var(--os-text-muted)]'}`}>
                    {usd(r.outstanding_usd)}
                </span>
            ),
        },
        { key: 'status', header: t('col_status'), render: (r) => <OsBadge variant={statusVariant(r.status)} label={r.status} /> },
        {
            key: 'actions',
            header: '',
            className: 'text-right',
            render: (r) => {
                const canLink = Boolean(r.invoice_ref && r.content_hash && r.verify_signature);
                if (!canLink) return <span className="text-xs text-[var(--os-text-muted)]">—</span>;
                const ref = encodeURIComponent(r.invoice_ref as string);
                const verifyHref = `/verify/${ref}?h=${encodeURIComponent(r.content_hash as string)}&s=${encodeURIComponent(r.verify_signature as string)}`;
                return (
                    <div className="flex justify-end items-center gap-3" onClick={(e) => e.stopPropagation()}>
                        <a href={`/api/invoices/${ref}/download`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:underline">
                            <Download className="w-3.5 h-3.5" /> {t('action_pdf')}
                        </a>
                        <a href={verifyHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-[var(--os-text-muted)] hover:text-[#10B981]">
                            <ShieldCheck className="w-3.5 h-3.5" /> {t('action_verify')}
                        </a>
                    </div>
                );
            },
        },
    ];

    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);
    const hasPrev = page > 1;
    const hasNext = page * pageSize < total;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
                <OsSelect label={t('f_type')} value={filters.documentType ?? ''} onChange={(e) => setParam('documentType', e.target.value || null)}
                    options={[{ value: '', label: t('all') }, ...DOC_TYPES.map((d) => ({ value: d, label: d }))]} />
                <OsSelect label={t('f_mode')} value={filters.mode ?? ''} onChange={(e) => setParam('mode', e.target.value || null)}
                    options={[{ value: '', label: t('all') }, ...MODES.map((m) => ({ value: m, label: m }))]} />
                <OsSelect label={t('f_status')} value={filters.status ?? ''} onChange={(e) => setParam('status', e.target.value || null)}
                    options={[{ value: '', label: t('all') }, ...STATUSES.map((s) => ({ value: s, label: s }))]} />
                <OsSelect label={t('f_jurisdiction')} value={filters.jurisdictionId ?? ''} onChange={(e) => setParam('jurisdictionId', e.target.value || null)}
                    options={[{ value: '', label: t('all') }, ...options.jurisdictions.map((j) => ({ value: j.id, label: j.name }))]} />
                <OsSelect label={t('f_flag')} value={filters.flagCountry ?? ''} onChange={(e) => setParam('flagCountry', e.target.value || null)}
                    options={[{ value: '', label: t('all') }, ...options.flagCountries.map((c) => ({ value: c, label: c }))]} />
                <OsInput label={t('f_date_from')} type="date" value={filters.dateFrom ?? ''} onChange={(e) => setParam('dateFrom', e.target.value || null)} />
                <OsInput label={t('f_date_to')} type="date" value={filters.dateTo ?? ''} onChange={(e) => setParam('dateTo', e.target.value || null)} />
                <label className="flex items-center gap-2 text-sm text-[var(--os-text-muted)] pb-2">
                    <input type="checkbox" checked={filters.dueOnly ?? false} onChange={(e) => setParam('dueOnly', e.target.checked ? '1' : null)} />
                    {t('f_due_only')}
                </label>
                <form onSubmit={onSearchSubmit} className="flex-1 min-w-[200px]">
                    <OsInput label={t('f_search')} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('f_search_ph')} />
                </form>
            </div>

            <OsTable
                columns={columns}
                rows={rows}
                keyExtractor={(r) => r.id}
                onRowClick={(r) => { if (r.shipowner_id) router.push(`/admin/armateurs/${r.shipowner_id}`); }}
                emptyMessage={t('empty')}
            />

            <div className="flex items-center justify-between text-sm text-[var(--os-text-muted)]">
                <span className="tabular-nums">{t('pagination', { start, end, total })}</span>
                <div className="flex gap-2">
                    <OsButton size="sm" variant="secondary" disabled={!hasPrev} onClick={() => setParam('page', String(page - 1))}>{t('prev')}</OsButton>
                    <OsButton size="sm" variant="secondary" disabled={!hasNext} onClick={() => setParam('page', String(page + 1))}>{t('next')}</OsButton>
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 3: Vérifier tsc + lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint "src/app/(dashboard)/admin/invoices/page.tsx" "src/app/(dashboard)/admin/invoices/InvoicesAdminList.tsx"`
Expected: aucune erreur. (Si `OsButton` n'accepte pas `children`, utiliser la même signature que dans `InvoicesTable.tsx` — vérifier `OsButton` avant.)

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/(dashboard)/admin/invoices/page.tsx" "frontend/src/app/(dashboard)/admin/invoices/InvoicesAdminList.tsx"
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(invoices): page liste admin des factures (filtres URL + pagination)"
```

---

### Task 5: i18n — namespace `AdminInvoices` (6 locales) + `nav_admin_invoices`

**Files:**
- Modify: `frontend/messages/en.json`
- Modify: `frontend/messages/fr.json`
- Modify: `frontend/messages/so.json`
- Modify: `frontend/messages/pt.json`
- Modify: `frontend/messages/ar.json`
- Modify: `frontend/messages/sw.json`

**Interfaces:**
- Consumes: clés `t('…')` référencées dans Task 4 : `title, subtitle, all, col_ref, col_type, col_mode, col_debtor, col_flag, col_jurisdiction, col_created, col_amount, col_due, col_status, action_pdf, action_verify, f_type, f_mode, f_status, f_jurisdiction, f_flag, f_date_from, f_date_to, f_due_only, f_search, f_search_ph, empty, pagination, prev, next` + `Dashboard.nav_admin_invoices`.
- Produces: le namespace `AdminInvoices` et la clé `Dashboard.nav_admin_invoices` dans les 6 fichiers.

- [ ] **Step 1: Ajouter le namespace `AdminInvoices` (en.json)**

Dans `frontend/messages/en.json`, ajouter un objet de premier niveau `"AdminInvoices"` :

```json
"AdminInvoices": {
    "title": "Invoices",
    "subtitle": "All pro-forma, final, complement and refund documents across maritime and aviation.",
    "all": "All",
    "col_ref": "Reference",
    "col_type": "Type",
    "col_mode": "Mode",
    "col_debtor": "Debtor",
    "col_flag": "Flag",
    "col_jurisdiction": "Jurisdiction",
    "col_created": "Issued",
    "col_amount": "Amount",
    "col_due": "Outstanding",
    "col_status": "Status",
    "action_pdf": "PDF",
    "action_verify": "Verify",
    "f_type": "Document type",
    "f_mode": "Mode",
    "f_status": "Status",
    "f_jurisdiction": "Jurisdiction",
    "f_flag": "Flag country",
    "f_date_from": "From",
    "f_date_to": "To",
    "f_due_only": "Outstanding only",
    "f_search": "Search",
    "f_search_ph": "Reference, vessel, IMO or debtor…",
    "empty": "No invoices match these filters.",
    "pagination": "{start}–{end} of {total}",
    "prev": "Previous",
    "next": "Next"
}
```

Et dans l'objet `"Dashboard"` du même fichier, ajouter la clé : `"nav_admin_invoices": "Invoices"`.

- [ ] **Step 2: Répliquer et traduire dans les 5 autres locales**

Ajouter le même bloc `AdminInvoices` + la clé `Dashboard.nav_admin_invoices`, traduits, dans `fr.json`, `so.json`, `pt.json`, `ar.json`, `sw.json`. Les placeholders `{start}`, `{end}`, `{total}` de `pagination` restent **inchangés**. Traductions de référence :

- **fr.json** — `title` "Factures", `subtitle` "Tous les documents pro-forma, finaux, complémentaires et avoirs, maritime et aviation.", `all` "Tous", `col_ref` "Référence", `col_type` "Type", `col_mode` "Mode", `col_debtor` "Débiteur", `col_flag` "Pavillon", `col_jurisdiction` "Juridiction", `col_created` "Émission", `col_amount` "Montant", `col_due` "Dû", `col_status` "Statut", `action_pdf` "PDF", `action_verify` "Vérifier", `f_type` "Type de document", `f_mode` "Mode", `f_status` "Statut", `f_jurisdiction` "Juridiction", `f_flag` "Pays du pavillon", `f_date_from` "Du", `f_date_to` "Au", `f_due_only` "Dû uniquement", `f_search` "Recherche", `f_search_ph` "Référence, navire, OMI ou débiteur…", `empty` "Aucune facture ne correspond à ces filtres.", `pagination` "{start}–{end} sur {total}", `prev` "Précédent", `next` "Suivant" ; `Dashboard.nav_admin_invoices` "Factures".
- **so.json** — `title` "Biilasha", `subtitle` "Dhammaan dukumentiyada pro-forma, kama dambeeys, dheeraad iyo celin lacageed, badda iyo hawada.", `all` "Dhammaan", `col_ref` "Tixraac", `col_type` "Nooc", `col_mode` "Hab", `col_debtor` "Deyn qaade", `col_flag` "Calan", `col_jurisdiction` "Xukun", `col_created` "La soo saaray", `col_amount` "Qadar", `col_due` "La sugayo", `col_status` "Xaalad", `action_pdf` "PDF", `action_verify` "Xaqiiji", `f_type` "Nooca dukumentiga", `f_mode` "Hab", `f_status` "Xaalad", `f_jurisdiction` "Xukun", `f_flag` "Dalka calanka", `f_date_from` "Laga bilaabo", `f_date_to` "Ilaa", `f_due_only` "Kaliya la sugayo", `f_search` "Raadi", `f_search_ph` "Tixraac, markab, IMO ama deyn qaade…", `empty` "Ma jiro biil ku habboon shaandhaynta.", `pagination` "{start}–{end} ee {total}", `prev` "Hore", `next` "Xiga" ; `Dashboard.nav_admin_invoices` "Biilasha".
- **pt.json** — `title` "Faturas", `subtitle` "Todos os documentos pró-forma, finais, complementares e reembolsos, marítimo e aviação.", `all` "Todos", `col_ref` "Referência", `col_type` "Tipo", `col_mode` "Modo", `col_debtor` "Devedor", `col_flag` "Bandeira", `col_jurisdiction` "Jurisdição", `col_created` "Emissão", `col_amount` "Montante", `col_due` "Em dívida", `col_status` "Estado", `action_pdf` "PDF", `action_verify` "Verificar", `f_type` "Tipo de documento", `f_mode` "Modo", `f_status` "Estado", `f_jurisdiction` "Jurisdição", `f_flag` "País da bandeira", `f_date_from` "De", `f_date_to` "Até", `f_due_only` "Apenas em dívida", `f_search` "Pesquisar", `f_search_ph` "Referência, navio, IMO ou devedor…", `empty` "Nenhuma fatura corresponde a estes filtros.", `pagination` "{start}–{end} de {total}", `prev` "Anterior", `next` "Seguinte" ; `Dashboard.nav_admin_invoices` "Faturas".
- **ar.json** — `title` "الفواتير", `subtitle` "جميع مستندات الفاتورة الأولية والنهائية والتكميلية والمبالغ المستردة، بحري وطيران.", `all` "الكل", `col_ref` "المرجع", `col_type` "النوع", `col_mode` "الوضع", `col_debtor` "المدين", `col_flag` "العلم", `col_jurisdiction` "الولاية", `col_created` "الإصدار", `col_amount` "المبلغ", `col_due` "المستحق", `col_status` "الحالة", `action_pdf` "PDF", `action_verify` "تحقق", `f_type` "نوع المستند", `f_mode` "الوضع", `f_status` "الحالة", `f_jurisdiction` "الولاية", `f_flag` "بلد العلم", `f_date_from` "من", `f_date_to` "إلى", `f_due_only` "المستحق فقط", `f_search` "بحث", `f_search_ph` "المرجع أو السفينة أو IMO أو المدين…", `empty` "لا توجد فواتير مطابقة لهذه المرشحات.", `pagination` "{start}–{end} من {total}", `prev` "السابق", `next` "التالي" ; `Dashboard.nav_admin_invoices` "الفواتير".
- **sw.json** — `title` "Ankara", `subtitle` "Nyaraka zote za pro-forma, za mwisho, za nyongeza na marejesho, baharini na anga.", `all` "Zote", `col_ref` "Rejea", `col_type` "Aina", `col_mode` "Njia", `col_debtor` "Mdaiwa", `col_flag` "Bendera", `col_jurisdiction` "Mamlaka", `col_created` "Ilitolewa", `col_amount` "Kiasi", `col_due` "Inayodaiwa", `col_status` "Hali", `action_pdf` "PDF", `action_verify` "Thibitisha", `f_type` "Aina ya hati", `f_mode` "Njia", `f_status` "Hali", `f_jurisdiction` "Mamlaka", `f_flag` "Nchi ya bendera", `f_date_from` "Kuanzia", `f_date_to` "Hadi", `f_due_only` "Inayodaiwa pekee", `f_search` "Tafuta", `f_search_ph` "Rejea, meli, IMO au mdaiwa…", `empty` "Hakuna ankara zinazolingana na vichujio hivi.", `pagination` "{start}–{end} kati ya {total}", `prev` "Iliyotangulia", `next` "Ifuatayo" ; `Dashboard.nav_admin_invoices` "Ankara".

- [ ] **Step 3: Vérifier la validité JSON des 6 fichiers**

Run: `cd frontend && for f in en fr so pt ar sw; do node -e "JSON.parse(require('fs').readFileSync('messages/$f.json','utf8')); console.log('$f ok')"; done`
Expected: `en ok` … `sw ok` (aucune exception de parsing).

- [ ] **Step 4: Vérifier que toutes les clés référencées existent (en.json)**

Run: `cd frontend && node -e "const m=require('./messages/en.json').AdminInvoices; ['title','subtitle','all','col_ref','col_type','col_mode','col_debtor','col_flag','col_jurisdiction','col_created','col_amount','col_due','col_status','action_pdf','action_verify','f_type','f_mode','f_status','f_jurisdiction','f_flag','f_date_from','f_date_to','f_due_only','f_search','f_search_ph','empty','pagination','prev','next'].forEach(k=>{if(!(k in m))throw new Error('missing '+k)});console.log('all keys present')"`
Expected: `all keys present`.

- [ ] **Step 5: Commit**

```bash
git add frontend/messages/en.json frontend/messages/fr.json frontend/messages/so.json frontend/messages/pt.json frontend/messages/ar.json frontend/messages/sw.json
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(invoices): i18n AdminInvoices (6 locales) + libellé de navigation"
```

---

### Task 6: Navigation + RBAC

**Files:**
- Modify: `frontend/src/lib/rbac.ts` (objet `NAV_PERMISSIONS`, ~ligne 72)
- Modify: `frontend/src/components/dashboard/layout/DashboardSidebar.tsx` (tableau des items de nav, ~ligne 56)

**Interfaces:**
- Consumes: `Dashboard.nav_admin_invoices` (Task 5), enum `UserRole`, route `/admin/invoices` (Task 4).
- Produces: la clé `admin-invoices` dans `NAV_PERMISSIONS` et une entrée de nav pointant vers `/admin/invoices`.

- [ ] **Step 1: Ajouter la permission de navigation**

Dans `frontend/src/lib/rbac.ts`, dans l'objet `NAV_PERMISSIONS`, après la ligne `'jurisdictions': [...]` (section Money rail), ajouter :

```ts
    'admin-invoices': [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SUPERADMIN],
```

- [ ] **Step 2: Ajouter l'entrée de navigation**

Dans `frontend/src/components/dashboard/layout/DashboardSidebar.tsx`, dans le tableau des items (section `admin`), après l'entrée `jurisdictions` (~ligne 56), ajouter — en réutilisant une icône déjà importée dans ce fichier (`FileText` est déjà importé pour `invoices`) :

```tsx
    { key: 'admin-invoices', icon: <FileText className="w-5 h-5" />, href: '/admin/invoices', labelKey: 'nav_admin_invoices', section: 'admin' },
```

(Si `FileText` n'est pas visible dans le scope, l'importer depuis `lucide-react` en tête de fichier.)

- [ ] **Step 3: Vérifier tsc + lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/lib/rbac.ts "src/components/dashboard/layout/DashboardSidebar.tsx"`
Expected: aucune erreur.

- [ ] **Step 4: Lancer toute la suite de tests**

Run: `cd frontend && npx vitest run src/services/invoiceAdminService.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/rbac.ts "frontend/src/components/dashboard/layout/DashboardSidebar.tsx"
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(invoices): entrée de navigation + permission RBAC (staff)"
```

---

## Notes finales (à valider en revue de branche)

- **PDF/vérif** : les liens ne s'affichent que si `invoice_ref && content_hash && verify_signature` (comme le cockpit armateurs). Les routes `/api/invoices/[ref]/download` et `/verify/[ref]` existent déjà.
- **Navigation ligne** : tous les débiteurs pointent vers `/admin/armateurs/[id]` (fiche maritime). La fiche aviation dédiée viendra au sous-projet 2 ; en attendant, un débiteur aviation ouvrira la fiche armateur générique (acceptable, non bloquant). Un `shipowner_id` nul → pas de navigation.
- **RLS** : `security_invoker` fait hériter la vue des policies de `transactions`/`shipowners`/`jurisdictions` ; le staff voit tout via la garde de rôle du server component + les policies admin existantes.
- **Dépendance de branche** : `feat/admin-invoices` part de `origin/develop` (indépendante de `feat/admin-armateurs`/PR #92). Si #92 n'est pas encore mergée quand cette PR l'est, le clic vers `/admin/armateurs/[id]` renverra 404 jusqu'à la fusion de #92 — non bloquant (les deux ciblent `develop`).
- **Aucune mutation** : lecture seule stricte, aucune écriture sur les transactions immuables (mig 089).
```
