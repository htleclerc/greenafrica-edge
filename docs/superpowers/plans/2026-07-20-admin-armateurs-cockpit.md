# Admin Armateurs — Cockpit de recouvrement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une page d'admin `admin/armateurs/` (liste + filtres, cockpit de recouvrement) et sa fiche `[id]`, alimentées par une vue SQL d'agrégats, réutilisant les composants `Os*`, l'action `inviteShipowner` (garde OFAC/UN) et `upsertShipownerEmail`.

**Architecture:** Vue SQL `v_armateur_recouvrement` (agrégats facturé/payé/dû par armateur maritime) → service `armateurService` (lecture) → page liste server + composant client (OsTable + filtres + dialogues) → fiche détail server + composant client. Armateur = `shipowners WHERE iata_code IS NULL` (aviation = `iata_code NOT NULL`, hors périmètre).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Supabase (@supabase/ssr), Tailwind v4, design system `Os*`, next-intl, Vitest.

## Global Constraints

- TypeScript strict — **JAMAIS `any`** (`unknown` + narrowing sinon).
- Composants **`Os*` uniquement** (jamais shadcn) : `OsTable`, `OsBadge`, `OsButton`, `OsInput`, `OsCard`, `OsStatCard`.
- Migration : `NNN_description.sql` séquentiel (next = **095**), bannière `─────`, ADDITIVE, `IF NOT EXISTS`/`CREATE OR REPLACE`, RLS/GRANT, `-- DOWN:` final.
- IBAN **jamais** affiché en clair (masqué).
- i18n : 6 locales `frontend/messages/{en,fr,so,pt,ar,sw}.json`, namespace `AdminArmateurs`.
- Commits : auteur `Loïc Leclerc <leclerc@drwintech.com>`, messages conventionnels humanisés, **JAMAIS** de trailer `Co-Authored-By: Claude` ni « Generated with Claude Code », staging explicite par chemins. Branche `feat/admin-armateurs`, PR vers `develop`.
- Garde de rôle admin (pattern existant) : server component charge `profiles.role`, redirige `/dashboard` si pas dans `['PORT_OFFICER','FINANCE_ADMIN','SUPERADMIN']` ; `canInvite = role === 'SUPERADMIN'`.
- Tests DB-backed : suivre le pattern `skipIf(!ENV_OK)` + insertion de fixtures (jamais dépendre des seeds onboarding, absents de la DB de test CI).

---

### Task 1: Migration 095 — vue `v_armateur_recouvrement`

**Files:**
- Create: `supabase/migrations/095_v_armateur_recouvrement.sql`

**Interfaces:**
- Produces: vue `public.v_armateur_recouvrement` (colonnes : `id UUID`, `name TEXT`, `country_code TEXT`, `account_state`, `is_ofac_sdn BOOL`, `is_un_prohibited BOOL`, `sanctioned BOOL`, `official_email TEXT`, `imo_company_no TEXT`, `proforma_count BIGINT`, `total_invoiced_usd NUMERIC`, `total_paid_usd NUMERIC`, `total_outstanding_usd NUMERIC`). Une ligne par armateur maritime (`shipowners.iata_code IS NULL`), y compris ceux sans pro-forma (montants à 0). Consommée par Task 2.

- [ ] **Step 1: Écrire la migration**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 095: vue v_armateur_recouvrement — cockpit admin armateurs
--
-- Agrège par armateur maritime (shipowners.iata_code IS NULL) les montants issus
-- des pro-formas maritimes (transactions document_type='PROFORMA', mode='MARITIME').
-- partial_paid_usd est maintenu par le trigger recompute_transaction_status
-- (mig 051) à partir de la somme des paiements → c'est le "payé" faisant foi.
-- security_invoker=true : la vue hérite des RLS de shipowners/transactions
-- (le staff les lit déjà ; pas de fuite de données cross-tenant).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_armateur_recouvrement
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.name,
  s.country_code,
  s.account_state,
  s.is_ofac_sdn,
  s.is_un_prohibited,
  (s.is_ofac_sdn OR s.is_un_prohibited)                                 AS sanctioned,
  s.official_email,
  s.imo_company_no,
  COUNT(t.id) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
  )                                                                     AS proforma_count,
  COALESCE(SUM(t.tax_amount_usd) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
  ), 0)                                                                 AS total_invoiced_usd,
  COALESCE(SUM(t.partial_paid_usd) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
  ), 0)                                                                 AS total_paid_usd,
  COALESCE(SUM(t.tax_amount_usd - COALESCE(t.partial_paid_usd, 0)) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
  ), 0)                                                                 AS total_outstanding_usd
FROM public.shipowners s
LEFT JOIN public.transactions t ON t.shipowner_id = s.id
WHERE s.iata_code IS NULL
GROUP BY s.id;

COMMENT ON VIEW public.v_armateur_recouvrement IS
  'Cockpit admin armateurs (Sprint 2) : agrégats facturé/payé/dû par armateur maritime. security_invoker hérite des RLS sous-jacentes.';

GRANT SELECT ON public.v_armateur_recouvrement TO authenticated, service_role;

-- DOWN:
-- DROP VIEW IF EXISTS public.v_armateur_recouvrement;
```

- [ ] **Step 2: Vérifier (méthode scratch — stack local bloqué par conflit de ports proxima)**

Rejouer sur un Postgres 17 jetable un stub minimal (`shipowners` avec `iata_code`/`is_ofac_sdn`/`is_un_prohibited` ; `transactions` avec `shipowner_id`/`tax_amount_usd`/`partial_paid_usd`/`document_type`/`mode`) + la migration, puis :
```sql
INSERT INTO shipowners(id,name,iata_code,is_ofac_sdn,is_un_prohibited) VALUES
 ('11111111-1111-4111-8111-111111111111','ARM Maritime',NULL,false,false),
 ('22222222-2222-4222-8222-222222222222','AVI Compagnie','FZ',false,false);
INSERT INTO transactions(id,shipowner_id,tax_amount_usd,partial_paid_usd,document_type,mode) VALUES
 (gen_random_uuid(),'11111111-1111-4111-8111-111111111111',1000,400,'PROFORMA','MARITIME');
SELECT id,name,proforma_count,total_invoiced_usd,total_paid_usd,total_outstanding_usd
  FROM v_armateur_recouvrement;
```
Attendu : **1 ligne** (l'armateur maritime ; la compagnie aviation `FZ` est exclue), `proforma_count=1`, `total_invoiced_usd=1000`, `total_paid_usd=400`, `total_outstanding_usd=600`.
(Si Docker/scratch indisponible : relire la SQL et signaler DONE_WITH_CONCERNS.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/095_v_armateur_recouvrement.sql
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(db): vue v_armateur_recouvrement pour le cockpit armateurs"
```

---

### Task 2: `armateurService.listArmateursCockpit` (TDD)

**Files:**
- Create: `frontend/src/services/armateurService.ts`
- Test: `frontend/src/services/armateurService.test.ts`

**Interfaces:**
- Consumes: vue `v_armateur_recouvrement` (Task 1).
- Produces:
  - `interface ArmateurCockpitRow { id: string; name: string; country_code: string | null; account_state: string; is_ofac_sdn: boolean; is_un_prohibited: boolean; sanctioned: boolean; official_email: string | null; imo_company_no: string | null; proforma_count: number; total_invoiced_usd: number; total_paid_usd: number; total_outstanding_usd: number }`
  - `async function listArmateursCockpit(db: SupabaseClient): Promise<ArmateurCockpitRow[]>` — `SELECT * FROM v_armateur_recouvrement ORDER BY total_outstanding_usd DESC`. Consommé par Task 4.

- [ ] **Step 1: Écrire le test qui échoue** (DB-backed, insère ses fixtures — CI-safe)

```typescript
// frontend/src/services/armateurService.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { listArmateursCockpit } from './armateurService';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENV_OK = !!URL && !!KEY;

describe.skipIf(!ENV_OK)('armateurService.listArmateursCockpit', () => {
    const admin: SupabaseClient = createClient(URL!, KEY!);
    const armId = '33333333-3333-4333-8333-333333333333';
    const aviId = '44444444-4444-4444-8444-444444444444';

    beforeAll(async () => {
        await admin.from('shipowners').insert([
            { id: armId, name: 'ARM Test Cockpit', iata_code: null, is_ofac_sdn: true },
            { id: aviId, name: 'AVI Test Cockpit', iata_code: 'ZZ' },
        ]);
        await admin.from('transactions').insert({
            shipowner_id: armId, vessel_name: 'MV COCKPIT', vessel_imo: 'TEST-COCKPIT',
            transaction_type: 'ENTRY_TAX', emissions_tco2: 10, tax_amount_usd: 1000,
            partial_paid_usd: 400, status: 'PENDING', collections_status: 'CURRENT',
            document_type: 'PROFORMA', mode: 'MARITIME',
        });
    });

    afterAll(async () => {
        await admin.from('transactions').delete().eq('shipowner_id', armId);
        await admin.from('shipowners').delete().in('id', [armId, aviId]);
    });

    it('renvoie les armateurs maritimes agrégés et exclut les compagnies aviation', async () => {
        const rows = await listArmateursCockpit(admin);
        const arm = rows.find((r) => r.id === armId);
        const avi = rows.find((r) => r.id === aviId);
        expect(avi).toBeUndefined();
        expect(arm).toBeDefined();
        expect(arm!.proforma_count).toBe(1);
        expect(arm!.total_invoiced_usd).toBe(1000);
        expect(arm!.total_paid_usd).toBe(400);
        expect(arm!.total_outstanding_usd).toBe(600);
        expect(arm!.sanctioned).toBe(true);
    });
});
```

- [ ] **Step 2: Vérifier l'échec** — `cd frontend && npm run test -- run src/services/armateurService.test.ts` → FAIL (module absent). (Si `ENV_OK` faux localement, le test se skippe : implémenter puis vérifier `tsc`.)

- [ ] **Step 3: Implémenter**

```typescript
// frontend/src/services/armateurService.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ArmateurCockpitRow {
    id: string;
    name: string;
    country_code: string | null;
    account_state: string;
    is_ofac_sdn: boolean;
    is_un_prohibited: boolean;
    sanctioned: boolean;
    official_email: string | null;
    imo_company_no: string | null;
    proforma_count: number;
    total_invoiced_usd: number;
    total_paid_usd: number;
    total_outstanding_usd: number;
}

export async function listArmateursCockpit(db: SupabaseClient): Promise<ArmateurCockpitRow[]> {
    const { data, error } = await db
        .from('v_armateur_recouvrement')
        .select('*')
        .order('total_outstanding_usd', { ascending: false });
    if (error) throw new Error(`listArmateursCockpit: ${error.message}`);
    // Postgres renvoie les NUMERIC/BIGINT en string via PostgREST → normaliser en number.
    return (data ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        country_code: (r.country_code as string | null) ?? null,
        account_state: r.account_state as string,
        is_ofac_sdn: r.is_ofac_sdn as boolean,
        is_un_prohibited: r.is_un_prohibited as boolean,
        sanctioned: r.sanctioned as boolean,
        official_email: (r.official_email as string | null) ?? null,
        imo_company_no: (r.imo_company_no as string | null) ?? null,
        proforma_count: Number(r.proforma_count),
        total_invoiced_usd: Number(r.total_invoiced_usd),
        total_paid_usd: Number(r.total_paid_usd),
        total_outstanding_usd: Number(r.total_outstanding_usd),
    }));
}
```

- [ ] **Step 4: Vérifier** — `npm run test -- run src/services/armateurService.test.ts` (PASS si ENV_OK, sinon skip) + `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/armateurService.ts frontend/src/services/armateurService.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(armateurs): service listArmateursCockpit sur la vue de recouvrement"
```

---

### Task 3: `armateurService.getArmateurDetail` (TDD)

**Files:**
- Modify: `frontend/src/services/armateurService.ts`
- Modify: `frontend/src/services/armateurService.test.ts`

**Interfaces:**
- Produces:
  - `interface ArmateurProformaRow { id: string; invoice_ref: string | null; created_at: string; tax_amount_usd: number; partial_paid_usd: number; status: string }`
  - `interface ArmateurVesselRow { id: string; imo_number: string; name: string; category: string; gross_tonnage_dwt: number; flag_code: string | null }`
  - `interface ArmateurPaymentRow { id: string; amount_usd_minor: number; created_at: string; rail: string; external_reference: string | null; status: string }`
  - `interface ArmateurReminderRow { id: string; tier: string; sent_at: string; debtor_response_type: string; escalated_bailiff: boolean }`
  - `interface ArmateurDetail { id: string; name: string; aliases: string[]; country_code: string | null; address: string | null; official_email: string | null; official_email_source: string | null; ops_email: string | null; finance_email: string | null; phone_e164: string | null; preferred_language: string | null; imo_company_no: string | null; equasis_id: string | null; notes: string | null; is_ofac_sdn: boolean; is_un_prohibited: boolean; account_state: string; kyc_level_b_completed_at: string | null; kyc_level_c_completed_at: string | null; billing_legal_name: string | null; billing_city: string | null; billing_country_code: string | null; vat_number: string | null; iban: string | null; swift_bic: string | null; bank_name: string | null; vessels: ArmateurVesselRow[]; proformas: ArmateurProformaRow[]; payments: ArmateurPaymentRow[]; reminders: ArmateurReminderRow[] }`
  - `async function getArmateurDetail(db: SupabaseClient, id: string): Promise<ArmateurDetail | null>`
  - `function maskIban(iban: string | null): string | null` — renvoie `null` si null, sinon garde les 4 derniers caractères (`•••• 1234`).

- [ ] **Step 1: Ajouter les tests** (fixtures : armateur + navire + proforma + paiement + relance)

```typescript
// à ajouter dans armateurService.test.ts
import { getArmateurDetail, maskIban } from './armateurService';

describe('maskIban', () => {
    it('masque tout sauf les 4 derniers', () => {
        expect(maskIban(null)).toBeNull();
        expect(maskIban('CY17002001280000001200527600')).toBe('•••• 7600');
    });
});

describe.skipIf(!ENV_OK)('getArmateurDetail', () => {
    const admin: SupabaseClient = createClient(URL!, KEY!);
    const armId = '55555555-5555-4555-8555-555555555555';
    let vId: string; let txId: string;

    beforeAll(async () => {
        await admin.from('shipowners').insert({ id: armId, name: 'ARM Detail', iata_code: null, official_email: 'x@arm.test', imo_company_no: 'IMO-DET-1' });
        const { data: v } = await admin.from('vessels').insert({
            imo_number: 'DET-VESSEL-1', mmsi: null, name: 'MV DETAIL', call_sign: null,
            flag_code: 'SO', category: 'CARGO', gross_tonnage_dwt: 12000, shipowner_id: armId,
        }).select('id').single();
        vId = v!.id;
        const { data: t } = await admin.from('transactions').insert({
            shipowner_id: armId, vessel_name: 'MV DETAIL', vessel_imo: 'DET-VESSEL-1',
            transaction_type: 'ENTRY_TAX', emissions_tco2: 5, tax_amount_usd: 800,
            partial_paid_usd: 0, status: 'PENDING', collections_status: 'CURRENT',
            document_type: 'PROFORMA', mode: 'MARITIME', invoice_ref: 'PRO-DET-0001',
        }).select('id').single();
        txId = t!.id;
    });
    afterAll(async () => {
        await admin.from('transactions').delete().eq('shipowner_id', armId);
        await admin.from('vessels').delete().eq('id', vId);
        await admin.from('shipowners').delete().eq('id', armId);
    });

    it('agrège identité + navires + proformas', async () => {
        const d = await getArmateurDetail(admin, armId);
        expect(d).not.toBeNull();
        expect(d!.name).toBe('ARM Detail');
        expect(d!.vessels.map((v) => v.imo_number)).toContain('DET-VESSEL-1');
        expect(d!.proformas.find((p) => p.id === txId)?.invoice_ref).toBe('PRO-DET-0001');
    });

    it('renvoie null pour un id inconnu', async () => {
        expect(await getArmateurDetail(admin, '00000000-0000-4000-8000-000000000000')).toBeNull();
    });
});
```

- [ ] **Step 2: Vérifier l'échec** — `npm run test -- run src/services/armateurService.test.ts` → FAIL (`getArmateurDetail`/`maskIban` non exportés).

- [ ] **Step 3: Implémenter** (ajouter à `armateurService.ts`)

```typescript
export function maskIban(iban: string | null): string | null {
    if (!iban) return null;
    const tail = iban.slice(-4);
    return `•••• ${tail}`;
}

// ...interfaces ci-dessus...

export async function getArmateurDetail(db: SupabaseClient, id: string): Promise<ArmateurDetail | null> {
    const { data: s } = await db.from('shipowners').select('*').eq('id', id).maybeSingle();
    if (!s) return null;

    const [vesselsRes, txRes] = await Promise.all([
        db.from('vessels').select('id, imo_number, name, category, gross_tonnage_dwt, flag_code').eq('shipowner_id', id),
        db.from('transactions').select('id, invoice_ref, created_at, tax_amount_usd, partial_paid_usd, status')
          .eq('shipowner_id', id).eq('document_type', 'PROFORMA').eq('mode', 'MARITIME')
          .order('created_at', { ascending: false }),
    ]);
    const txIds = (txRes.data ?? []).map((t) => t.id as string);
    const [payRes, remRes] = await Promise.all([
        txIds.length
          ? db.from('payments').select('id, amount_usd_minor, created_at, rail, external_reference, status').in('transaction_id', txIds)
          : Promise.resolve({ data: [] as unknown[] }),
        txIds.length
          ? db.from('collection_reminders').select('id, tier, sent_at, debtor_response_type, escalated_bailiff').in('transaction_id', txIds).order('sent_at', { ascending: true })
          : Promise.resolve({ data: [] as unknown[] }),
    ]);

    // Narrowing explicite depuis les lignes shipowners (types manuels — pas de any).
    const row = s as Record<string, unknown>;
    const str = (k: string) => (row[k] as string | null) ?? null;
    return {
        id: row.id as string,
        name: row.name as string,
        aliases: (row.aliases as string[] | null) ?? [],
        country_code: str('country_code'),
        address: str('address'),
        official_email: str('official_email'),
        official_email_source: str('official_email_source'),
        ops_email: str('ops_email'),
        finance_email: str('finance_email'),
        phone_e164: str('phone_e164'),
        preferred_language: str('preferred_language'),
        imo_company_no: str('imo_company_no'),
        equasis_id: str('equasis_id'),
        notes: str('notes'),
        is_ofac_sdn: !!row.is_ofac_sdn,
        is_un_prohibited: !!row.is_un_prohibited,
        account_state: row.account_state as string,
        kyc_level_b_completed_at: str('kyc_level_b_completed_at'),
        kyc_level_c_completed_at: str('kyc_level_c_completed_at'),
        billing_legal_name: str('billing_legal_name'),
        billing_city: str('billing_city'),
        billing_country_code: str('billing_country_code'),
        vat_number: str('vat_number'),
        iban: str('iban'),
        swift_bic: str('swift_bic'),
        bank_name: str('bank_name'),
        vessels: (vesselsRes.data ?? []).map((v) => ({
            id: v.id as string, imo_number: v.imo_number as string, name: v.name as string,
            category: v.category as string, gross_tonnage_dwt: Number(v.gross_tonnage_dwt),
            flag_code: (v.flag_code as string | null) ?? null,
        })),
        proformas: (txRes.data ?? []).map((t) => ({
            id: t.id as string, invoice_ref: (t.invoice_ref as string | null) ?? null,
            created_at: t.created_at as string, tax_amount_usd: Number(t.tax_amount_usd),
            partial_paid_usd: Number(t.partial_paid_usd ?? 0), status: t.status as string,
        })),
        payments: ((payRes.data ?? []) as Record<string, unknown>[]).map((p) => ({
            id: p.id as string, amount_usd_minor: Number(p.amount_usd_minor),
            created_at: p.created_at as string, rail: p.rail as string,
            external_reference: (p.external_reference as string | null) ?? null, status: p.status as string,
        })),
        reminders: ((remRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
            id: r.id as string, tier: r.tier as string, sent_at: r.sent_at as string,
            debtor_response_type: r.debtor_response_type as string, escalated_bailiff: !!r.escalated_bailiff,
        })),
    };
}
```

- [ ] **Step 4: Vérifier** — `npm run test -- run src/services/armateurService.test.ts` (PASS/skip) + `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/armateurService.ts frontend/src/services/armateurService.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(armateurs): getArmateurDetail (identité, navires, proformas, paiements, relances)"
```

---

### Task 4: Page liste + composant `ArmateursCockpit` (filtres + actions)

**Files:**
- Create: `frontend/src/app/(dashboard)/admin/armateurs/page.tsx`
- Create: `frontend/src/app/(dashboard)/admin/armateurs/ArmateursCockpit.tsx`
- Create: `frontend/src/app/(dashboard)/admin/armateurs/armateurFilters.ts` (logique pure, testable)
- Test: `frontend/src/app/(dashboard)/admin/armateurs/armateurFilters.test.ts`

**Interfaces:**
- Consumes: `listArmateursCockpit`, `ArmateurCockpitRow` (Task 2) ; `inviteShipowner` (`{shipownerId, email}` → `{ok,...}`), `upsertShipownerEmail`.
- Produces:
  - `type SanctionFilter = 'all' | 'ofac' | 'un' | 'clean'`
  - `interface ArmateurFilterState { search: string; accountState: string | 'all'; sanction: SanctionFilter; country: string | 'all'; outstandingOnly: boolean }`
  - `function filterArmateurs(rows: ArmateurCockpitRow[], f: ArmateurFilterState): ArmateurCockpitRow[]`

- [ ] **Step 1: Test de la logique de filtre (pure)**

```typescript
// armateurFilters.test.ts
import { describe, it, expect } from 'vitest';
import { filterArmateurs, type ArmateurFilterState } from './armateurFilters';
import type { ArmateurCockpitRow } from '@/services/armateurService';

const base: ArmateurCockpitRow = {
    id: 'x', name: 'ANJIL BULKERS SA', country_code: 'PA', account_state: 'GHOST',
    is_ofac_sdn: false, is_un_prohibited: false, sanctioned: false,
    official_email: null, imo_company_no: '9999999', proforma_count: 1,
    total_invoiced_usd: 100, total_paid_usd: 0, total_outstanding_usd: 100,
};
const rows: ArmateurCockpitRow[] = [
    base,
    { ...base, id: 'ofac', name: 'IRISL', is_ofac_sdn: true, sanctioned: true, country_code: 'IR', total_outstanding_usd: 0 },
    { ...base, id: 'paid', name: 'PAID CO', total_outstanding_usd: 0 },
];
const all: ArmateurFilterState = { search: '', accountState: 'all', sanction: 'all', country: 'all', outstandingOnly: false };

describe('filterArmateurs', () => {
    it('sanction=ofac ne garde que les OFAC', () => {
        expect(filterArmateurs(rows, { ...all, sanction: 'ofac' }).map((r) => r.id)).toEqual(['ofac']);
    });
    it('outstandingOnly retire les dûs à 0', () => {
        expect(filterArmateurs(rows, { ...all, outstandingOnly: true }).map((r) => r.id)).toEqual(['x']);
    });
    it('search filtre par nom ou imo_company_no (insensible casse)', () => {
        expect(filterArmateurs(rows, { ...all, search: 'irisl' }).map((r) => r.id)).toEqual(['ofac']);
        expect(filterArmateurs(rows, { ...all, search: '9999999' }).length).toBe(3);
    });
    it('country filtre par pays', () => {
        expect(filterArmateurs(rows, { ...all, country: 'IR' }).map((r) => r.id)).toEqual(['ofac']);
    });
});
```

- [ ] **Step 2: Vérifier l'échec** — `npm run test -- run "src/app/(dashboard)/admin/armateurs/armateurFilters.test.ts"` → FAIL.

- [ ] **Step 3: Implémenter la logique de filtre**

```typescript
// armateurFilters.ts
import type { ArmateurCockpitRow } from '@/services/armateurService';

export type SanctionFilter = 'all' | 'ofac' | 'un' | 'clean';
export interface ArmateurFilterState {
    search: string;
    accountState: string | 'all';
    sanction: SanctionFilter;
    country: string | 'all';
    outstandingOnly: boolean;
}

export function filterArmateurs(rows: ArmateurCockpitRow[], f: ArmateurFilterState): ArmateurCockpitRow[] {
    const q = f.search.trim().toLowerCase();
    return rows.filter((r) => {
        if (f.accountState !== 'all' && r.account_state !== f.accountState) return false;
        if (f.country !== 'all' && (r.country_code ?? '') !== f.country) return false;
        if (f.outstandingOnly && r.total_outstanding_usd <= 0) return false;
        if (f.sanction === 'ofac' && !r.is_ofac_sdn) return false;
        if (f.sanction === 'un' && !r.is_un_prohibited) return false;
        if (f.sanction === 'clean' && r.sanctioned) return false;
        if (q) {
            const hay = `${r.name} ${r.imo_company_no ?? ''}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
}
```

- [ ] **Step 4: Vérifier le succès** — `npm run test -- run "src/app/(dashboard)/admin/armateurs/armateurFilters.test.ts"` → PASS.

- [ ] **Step 5: Écrire le composant client `ArmateursCockpit.tsx`**

Réutiliser le pattern de `frontend/src/app/(dashboard)/admin/owner-agent-mappings/ShipownersList.tsx` (dialogues Radix invite + email). Points clés :
- `'use client'`. Props : `{ rows: ArmateurCockpitRow[]; canInvite: boolean }`.
- État filtres (`useState<ArmateurFilterState>`), `const visible = filterArmateurs(rows, filters)`.
- Barre de filtres : `OsInput` (recherche), `<select>` stylés (statut, sanction, pays — options dérivées de `rows`), checkbox `outstandingOnly`.
- `OsTable<ArmateurCockpitRow>` colonnes : name ; country_code ; account_state (`OsBadge`) ; sanctions (`{r.is_ofac_sdn && <OsBadge tone="danger">OFAC</OsBadge>}{r.is_un_prohibited && <OsBadge tone="danger">UN</OsBadge>}`) ; proforma_count ; total_invoiced_usd, total_paid_usd, total_outstanding_usd (formatés `usd()` — réutiliser un helper `formatUsd` existant dans `lib/` ; sinon `Intl.NumberFormat('en-US',{style:'currency',currency:'USD'})`). `onRowClick` → `router.push('/dashboard/admin/armateurs/' + r.id)`.
- Dialogues **inviter** (`inviteShipowner({ shipownerId, email })`) et **éditer email** (`upsertShipownerEmail` via une server action fine — créer `frontend/src/actions/updateArmateurEmail.ts` qui appelle `upsertShipownerEmail(admin, id, email, 'PORT_OFFICER')` avec garde de rôle staff, `revalidatePath`). Bouton inviter **désactivé** si `row.sanctioned` (tooltip « contact interdit »). Consulter `OsBadge` pour le nom exact de la prop de couleur (`tone`/`variant`) et adapter.

Vérifier les props exactes de `OsBadge`/`OsButton` en lisant leurs fichiers avant usage.

- [ ] **Step 6: Écrire la page server `page.tsx`**

```tsx
// frontend/src/app/(dashboard)/admin/armateurs/page.tsx
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { listArmateursCockpit } from '@/services/armateurService';
import { ArmateursCockpit } from './ArmateursCockpit';

export const dynamic = 'force-dynamic';

export default async function ArmateursPage() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    if (!profile || !['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'].includes(profile.role)) redirect('/dashboard');

    const rows = await listArmateursCockpit(supabase);
    const t = await getTranslations('AdminArmateurs');
    return (
        <div className="px-6 py-4">
            <h1 className="text-2xl font-semibold mb-2 text-[var(--os-text-primary)]">{t('title')}</h1>
            <p className="text-[var(--os-text-muted)] mb-6 text-sm">{t('subtitle')}</p>
            <ArmateursCockpit rows={rows} canInvite={profile.role === 'SUPERADMIN'} />
        </div>
    );
}
```

- [ ] **Step 7: Vérifier** — `npx tsc --noEmit` (frontend) clean ; `npm run lint` pas de nouvelle erreur ; `npm run test -- run "src/app/(dashboard)/admin/armateurs"`.

- [ ] **Step 8: Commit**

```bash
git add "frontend/src/app/(dashboard)/admin/armateurs/page.tsx" "frontend/src/app/(dashboard)/admin/armateurs/ArmateursCockpit.tsx" "frontend/src/app/(dashboard)/admin/armateurs/armateurFilters.ts" "frontend/src/app/(dashboard)/admin/armateurs/armateurFilters.test.ts" frontend/src/actions/updateArmateurEmail.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(armateurs): page liste cockpit + filtres + actions invite/email"
```

---

### Task 5: Fiche détail `[id]` + composant `ArmateurDetail`

**Files:**
- Create: `frontend/src/app/(dashboard)/admin/armateurs/[id]/page.tsx`
- Create: `frontend/src/app/(dashboard)/admin/armateurs/[id]/ArmateurDetail.tsx`

**Interfaces:**
- Consumes: `getArmateurDetail`, `maskIban`, tous les types `Armateur*Row`/`ArmateurDetail` (Task 3) ; `inviteShipowner`, `updateArmateurEmail` (Task 4).

- [ ] **Step 1: Page server `[id]/page.tsx`**

```tsx
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getArmateurDetail } from '@/services/armateurService';
import { ArmateurDetail } from './ArmateurDetail';

export const dynamic = 'force-dynamic';

export default async function ArmateurDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    if (!profile || !['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'].includes(profile.role)) redirect('/dashboard');

    const detail = await getArmateurDetail(supabase, id);
    if (!detail) notFound();
    return <ArmateurDetail detail={detail} canInvite={profile.role === 'SUPERADMIN'} />;
}
```

- [ ] **Step 2: Composant `ArmateurDetail.tsx`** (`'use client'`)

Structure (sections `OsCard`), en réutilisant `maskIban(detail.iban)` :
- Bandeau : `detail.name` + `OsBadge` statut. Si `detail.is_ofac_sdn || detail.is_un_prohibited` → bandeau rouge (div `bg-red-*`/`--os-danger`) « {t('sanctionBanner', {kind})} ».
- **Identité** : official_email (+ source), ops/finance emails, pays, adresse, imo_company_no, equasis_id, aliases (join ', '), phone, langue, notes.
- **KYC** : account_state, KYC-B/C (dates ou « — »), billing (legal_name, city, country, vat), `maskIban(detail.iban)`, swift_bic, bank_name.
- **Navires** : `OsTable<ArmateurVesselRow>` (imo_number, name, category, gross_tonnage_dwt, flag_code).
- **Pro-formas** : `OsTable<ArmateurProformaRow>` (invoice_ref, created_at (date), tax_amount_usd, status `OsBadge`, dû = tax_amount_usd - partial_paid_usd) + liens `/verify` et `/api/invoices/{invoice_ref}/download` (ancres, `target="_blank"`).
- **Paiements** : `OsTable<ArmateurPaymentRow>` (amount_usd_minor/100 formaté, created_at, rail, external_reference, status).
- **Relances** : liste `detail.reminders` (tier, sent_at, debtor_response_type) — simple liste verticale, pas de tableau.
- **Actions** (`OsCard`) : bouton **Éditer email** (dialogue → `updateArmateurEmail`) ; **Inviter** (dialogue → `inviteShipowner`) désactivé si sanctionné + tooltip. `router.refresh()` après succès.

Lire `OsBadge`/`OsButton`/`OsCard` pour les props exactes avant écriture. Formatage USD via le même helper que Task 4.

- [ ] **Step 3: Vérifier** — `npx tsc --noEmit` clean ; `npm run lint` sans nouvelle erreur ; naviguer mentalement : `/dashboard/admin/armateurs/<id>` rend les sections.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/(dashboard)/admin/armateurs/[id]/page.tsx" "frontend/src/app/(dashboard)/admin/armateurs/[id]/ArmateurDetail.tsx"
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(armateurs): fiche détaillée [id] (identité, KYC, navires, proformas, paiements, relances)"
```

---

### Task 6: i18n `AdminArmateurs` (6 locales) + navigation + vérification finale

**Files:**
- Modify: `frontend/messages/{en,fr,so,pt,ar,sw}.json`
- Modify: la source de navigation admin (sidebar) pour ajouter le lien « Armateurs » — repérer le composant de nav (`components/dashboard/layout/DashboardSidebar.tsx` ou l'équivalent listant les entrées admin) et y ajouter l'entrée pointant `/dashboard/admin/armateurs` avec la même garde de visibilité que les autres liens admin.

**Interfaces:** aucune (finalisation).

- [ ] **Step 1: Ajouter le namespace `AdminArmateurs`** dans les 6 fichiers. Clés minimales (mêmes clés dans chaque locale, valeurs traduites — `en`/`fr` complètes, `so`/`pt`/`ar`/`sw` traduites au mieux, cohérent avec l'existant) :

```jsonc
"AdminArmateurs": {
  "title": "Armateurs",
  "subtitle": "Cockpit de recouvrement — statut, sanctions et montants par armateur.",
  "colName": "Armateur", "colCountry": "Pays", "colStatus": "Statut",
  "colSanctions": "Sanctions", "colProformas": "Pro-formas",
  "colInvoiced": "Facturé", "colPaid": "Payé", "colOutstanding": "Dû",
  "filterSearch": "Rechercher (nom / IMO)", "filterStatus": "Statut",
  "filterSanction": "Sanctions", "filterCountry": "Pays",
  "filterOutstandingOnly": "Dû > 0 uniquement",
  "sanctionAll": "Toutes", "sanctionOfac": "OFAC", "sanctionUn": "UN", "sanctionClean": "Sans sanction",
  "sanctionBanner": "Contact interdit — {kind}. Procédure in rem / consulaire uniquement.",
  "sectionIdentity": "Identité", "sectionKyc": "KYC", "sectionVessels": "Navires",
  "sectionProformas": "Pro-formas", "sectionPayments": "Paiements", "sectionReminders": "Relances",
  "sectionActions": "Actions",
  "actionEditEmail": "Éditer l'email", "actionInvite": "Inviter",
  "inviteBlocked": "Contact interdit (sanctions).",
  "empty": "Aucun armateur.", "navLink": "Armateurs"
}
```

- [ ] **Step 2: Vérifier la validité des locales** — la CI a un check « Locale files valid » (`ci.yml`). Le reproduire :
```bash
cd frontend && node -e "for (const l of ['en','fr','so','pt','ar','sw']) { const j=require('./messages/'+l+'.json'); if(!j.AdminArmateurs) throw new Error('AdminArmateurs manquant: '+l); } console.log('locales OK')"
```
Expected : `locales OK`.

- [ ] **Step 3: Suite complète**

Run (depuis `frontend/`) : `npx tsc --noEmit && npm run lint && npm run test -- run`
Expected : 0 erreur TS, pas de nouvelle erreur lint, tests verts (les tests DB-backed se skippent sans stack).

- [ ] **Step 4: Commit**

```bash
git add frontend/messages/en.json frontend/messages/fr.json frontend/messages/so.json frontend/messages/pt.json frontend/messages/ar.json frontend/messages/sw.json frontend/src/components/dashboard/layout/DashboardSidebar.tsx
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(armateurs): i18n AdminArmateurs (6 locales) + entrée de navigation"
```

---

## Self-Review (fait à l'écriture)

- **Couverture spec** : migration vue (T1) ; service list (T2) + detail (T3) ; page liste + filtres + actions (T4) ; fiche [id] (T5) ; i18n + nav + vérif (T6). IBAN masqué (T3 `maskIban`, T5). Garde sanctions réutilisée (T4/T5, action `inviteShipowner`). Split maritime/aviation via `iata_code IS NULL` (T1 vue, T2/T3 requêtes).
- **Placeholders** : les parties porteuses (SQL, service, filtres, tests) ont du code complet ; les JSX pages donnent structure + snippets + renvoi explicite à `ShipownersList`/`OsTable`/`OsBadge` à lire avant écriture (props exactes non devinées).
- **Types cohérents** : `ArmateurCockpitRow` (T2) réutilisé en T4 ; `ArmateurDetail`/`Armateur*Row` (T3) en T5 ; `filterArmateurs`/`ArmateurFilterState` (T4). `inviteShipowner({shipownerId,email})` et `upsertShipownerEmail(db,id,email,source)` conformes aux signatures réelles.
- **Écart assumé** : `updateArmateurEmail` (server action fine autour de `upsertShipownerEmail`) introduite en T4 car l'action manque — garde de rôle staff + `revalidatePath`.
