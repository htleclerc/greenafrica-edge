# Admin Compagnies aviation — Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un cockpit d'administration `/admin/airlines` (liste + fiche `[id]`) pour les compagnies aviation (`shipowners.iata_code IS NOT NULL`), miroir aérien du cockpit armateurs, avec recouvrement (facturé/payé/dû) sur les pro-formas `mode='AIR'`.

**Architecture:** Une vue SQL `v_compagnie_recouvrement` (miroir de `v_armateur_recouvrement` mig 095, filtrée aviation) alimente `airlineService` (liste + fiche détail). Pages serveur + composants client calqués sur le sous-projet armateurs (présent sur cette branche, base `feat/admin-armateurs`), avec adaptations aviation. Réutilisation par import : `maskIban`, `updateArmateurEmail`, `inviteShipowner`.

**Tech Stack:** Next.js 16 App Router (route group `(dashboard)` hors URL), React 19, TS strict, Supabase (`@supabase/ssr`), next-intl (6 locales), Vitest, design system `Os*`.

## Global Constraints

- TypeScript **strict, jamais `any`** — sauf le client Supabase sur une vue hors types générés : suivre le patron du fichier `armateurService.ts` (même signature de client).
- Composants **`Os*` uniquement** : `OsTable`/`OsColumn`, `OsBadge`/`BadgeVariant` (`{variant,label,size?}`, variant `'critical'` pour OFAC/UN, PAS de children/tone), `OsButton` (accepte children + `icon`), `OsInput`, `OsSelect` (`{label,value,onChange,options:{value,label}[]}`, exporté depuis `OsInput.tsx`), `OsCard`/`OsCardHeader`.
- **IBAN jamais exposé en clair** : masqué **côté serveur** (`decryptIban` + `maskIban`), gaté par un paramètre `canViewBilling` (leçon PR #92). Le champ `iban` chiffré ne doit jamais entrer dans un DTO renvoyé au client.
- Migration : style `NNN_description.sql` (**097**), bannière, ADDITIVE, `CREATE OR REPLACE VIEW`, `security_invoker=true`, `GRANT`, `-- DOWN:` final.
- **Lecture seule** sauf les actions existantes invite (`inviteShipowner`, SUPERADMIN, garde sanctions) et edit-email (`updateArmateurEmail`).
- Route réelle = `/admin/airlines`. Clé nav/RBAC = **`airlines`**.
- Commits : auteur `Loïc Leclerc <leclerc@drwintech.com>`, messages humanisés, **jamais** de trailer IA, staging explicite. Branche `feat/admin-airlines` (base `feat/admin-armateurs`), PR vers `develop`.
- **Référence de code sur la branche** : le sous-projet armateurs est présent (`frontend/src/services/armateurService.ts`, `frontend/src/app/(dashboard)/admin/armateurs/**`). Les tâches UI le calquent avec les deltas énumérés.

---

### Task 1: Migration — vue `v_compagnie_recouvrement`

**Files:**
- Create: `supabase/migrations/097_v_compagnie_recouvrement.sql`

**Interfaces:**
- Consumes: tables `shipowners`, `transactions`.
- Produces: vue `public.v_compagnie_recouvrement` avec colonnes `id, name, country_code, account_state, is_ofac_sdn, is_un_prohibited, sanctioned, official_email, iata_code, icao_code, hub_code, aoc_number, proforma_count, total_invoiced_usd, total_paid_usd, total_outstanding_usd`.

- [ ] **Step 1: Écrire la migration**

Créer `supabase/migrations/097_v_compagnie_recouvrement.sql` :

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 097: vue v_compagnie_recouvrement — cockpit admin compagnies aviation
--
-- Miroir aérien de v_armateur_recouvrement (mig 095) : agrège par compagnie
-- aviation (shipowners.iata_code IS NOT NULL) les montants des pro-formas
-- aériennes (transactions document_type='PROFORMA', mode='AIR').
-- security_invoker=true : hérite des RLS de shipowners/transactions.
-- Numéro 097 (et non 096) pour éviter la collision develop avec la mig 096
-- (sous-projet 3, liste des factures).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_compagnie_recouvrement
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
  s.iata_code,
  s.icao_code,
  s.hub_code,
  s.aoc_number,
  COUNT(t.id) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'AIR'
  )                                                                     AS proforma_count,
  COALESCE(SUM(t.tax_amount_usd) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'AIR'
  ), 0)                                                                 AS total_invoiced_usd,
  COALESCE(SUM(t.partial_paid_usd) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'AIR'
  ), 0)                                                                 AS total_paid_usd,
  COALESCE(SUM(t.tax_amount_usd - COALESCE(t.partial_paid_usd, 0)) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'AIR'
  ), 0)                                                                 AS total_outstanding_usd
FROM public.shipowners s
LEFT JOIN public.transactions t ON t.shipowner_id = s.id
WHERE s.iata_code IS NOT NULL
GROUP BY s.id;

COMMENT ON VIEW public.v_compagnie_recouvrement IS
  'Cockpit admin compagnies aviation (Sprint 2) : agrégats facturé/payé/dû par compagnie aérienne. security_invoker hérite des RLS sous-jacentes.';

GRANT SELECT ON public.v_compagnie_recouvrement TO authenticated, service_role;

-- DOWN:
-- DROP VIEW IF EXISTS public.v_compagnie_recouvrement;
```

- [ ] **Step 2: Vérifier**

Run: `grep -c "iata_code IS NOT NULL" supabase/migrations/097_v_compagnie_recouvrement.sql`
Expected: `1`. Vérifier visuellement : `security_invoker`, `mode = 'AIR'` sur les 4 agrégats, `GRANT`, `-- DOWN:`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/097_v_compagnie_recouvrement.sql
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(db): vue v_compagnie_recouvrement pour le cockpit compagnies aviation"
```

---

### Task 2: Service — `listAirlinesCockpit` + types + `maskIban` réutilisé

**Files:**
- Create: `frontend/src/services/airlineService.ts`
- Create: `frontend/src/services/airlineService.test.ts`

**Interfaces:**
- Consumes: vue `v_compagnie_recouvrement` (Task 1).
- Produces: `type AirlineCockpitRow`, `listAirlinesCockpit(db): Promise<AirlineCockpitRow[]>`. (`maskIban`/`decryptIban` sont importés en Task 3, pas ici.)

- [ ] **Step 1: Écrire le test (échouant)**

Créer `frontend/src/services/airlineService.test.ts` :

```ts
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('listAirlinesCockpit', () => {
    it('interroge la vue et normalise les nombres, tri dû décroissant', async () => {
        const chain = {
            select: vi.fn(() => chain),
            order: vi.fn(() => Promise.resolve({
                data: [{
                    id: 'a-1', name: 'Demo Airways', country_code: 'SO', account_state: 'GHOST',
                    is_ofac_sdn: false, is_un_prohibited: false, sanctioned: false,
                    official_email: null, iata_code: 'DA', icao_code: 'DMO', hub_code: 'HGA', aoc_number: 'AOC-1',
                    proforma_count: '3', total_invoiced_usd: '1000.5', total_paid_usd: '400', total_outstanding_usd: '600.5',
                }],
                error: null,
            })),
        } as Record<string, unknown>;
        const db = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
        const { listAirlinesCockpit } = await import('./airlineService');
        const rows = await listAirlinesCockpit(db);
        expect(db.from).toHaveBeenCalledWith('v_compagnie_recouvrement');
        expect(chain.order).toHaveBeenCalledWith('total_outstanding_usd', { ascending: false });
        expect(rows[0].proforma_count).toBe(3);
        expect(rows[0].total_outstanding_usd).toBe(600.5);
        expect(rows[0].iata_code).toBe('DA');
    });

    it('throw si la requête renvoie une erreur', async () => {
        const chain = {
            select: vi.fn(() => chain),
            order: vi.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } })),
        } as Record<string, unknown>;
        const db = { from: vi.fn(() => chain) } as unknown as SupabaseClient;
        const { listAirlinesCockpit } = await import('./airlineService');
        await expect(listAirlinesCockpit(db)).rejects.toThrow(/boom/);
    });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd frontend && npx vitest run src/services/airlineService.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter**

Créer `frontend/src/services/airlineService.ts` :

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptIban } from './kycService';
import { maskIban } from './armateurService';

export interface AirlineCockpitRow {
    id: string;
    name: string;
    country_code: string | null;
    account_state: string;
    is_ofac_sdn: boolean;
    is_un_prohibited: boolean;
    sanctioned: boolean;
    official_email: string | null;
    iata_code: string | null;
    icao_code: string | null;
    hub_code: string | null;
    aoc_number: string | null;
    proforma_count: number;
    total_invoiced_usd: number;
    total_paid_usd: number;
    total_outstanding_usd: number;
}

export async function listAirlinesCockpit(db: SupabaseClient): Promise<AirlineCockpitRow[]> {
    const { data, error } = await db
        .from('v_compagnie_recouvrement')
        .select('*')
        .order('total_outstanding_usd', { ascending: false });
    if (error) throw new Error(`listAirlinesCockpit: ${error.message}`);
    return (data ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        country_code: (r.country_code as string | null) ?? null,
        account_state: r.account_state as string,
        is_ofac_sdn: r.is_ofac_sdn as boolean,
        is_un_prohibited: r.is_un_prohibited as boolean,
        sanctioned: r.sanctioned as boolean,
        official_email: (r.official_email as string | null) ?? null,
        iata_code: (r.iata_code as string | null) ?? null,
        icao_code: (r.icao_code as string | null) ?? null,
        hub_code: (r.hub_code as string | null) ?? null,
        aoc_number: (r.aoc_number as string | null) ?? null,
        proforma_count: Number(r.proforma_count),
        total_invoiced_usd: Number(r.total_invoiced_usd),
        total_paid_usd: Number(r.total_paid_usd),
        total_outstanding_usd: Number(r.total_outstanding_usd),
    }));
}
```

**Imports de Task 2 (règle anti `no-unused-vars`)** : à cette étape, `airlineService.ts` n'importe QUE le client Supabase. `maskIban` et `decryptIban` ne sont importés qu'en Task 3, avec leur usage. L'en-tête d'import de Task 2 est donc exactement :

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
```

`SupabaseClient` sans paramètre de type suit exactement le patron de `armateurService.ts` (la vue n'est pas dans les types générés — pas de `any` explicite).

- [ ] **Step 4: Lancer → succès**

Run: `cd frontend && npx vitest run src/services/airlineService.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Vérifier tsc + lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/services/airlineService.ts`
Expected: aucune erreur (aucun import inutilisé).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/airlineService.ts frontend/src/services/airlineService.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(airlines): service listAirlinesCockpit sur la vue de recouvrement"
```

---

### Task 3: Service — `getAirlineDetail` (fiche, IBAN masqué serveur, garde aviation)

**Files:**
- Modify: `frontend/src/services/airlineService.ts`
- Modify: `frontend/src/services/airlineService.test.ts`

**Interfaces:**
- Consumes: `listAirlinesCockpit` file (Task 2) ; `decryptIban` de `./kycService` ; `maskIban` de `./armateurService`.
- Produces: `type AirlineAircraftRow`, `AirlineProformaRow`, `AirlinePaymentRow`, `AirlineReminderRow`, `AirlineDetail` ; `getAirlineDetail(db, id, canViewBilling): Promise<AirlineDetail | null>`.

- [ ] **Step 1: Écrire les tests (échouants)**

Ajouter à `frontend/src/services/airlineService.test.ts` :

```ts
import { getAirlineDetail } from './airlineService';

function detailDb(shipownerRow: Record<string, unknown> | null) {
    // Chaîne pour la requête shipowners : .select().eq().not().maybeSingle()
    const soChain: Record<string, unknown> = {
        select: vi.fn(() => soChain),
        eq: vi.fn(() => soChain),
        not: vi.fn(() => soChain),
        maybeSingle: vi.fn(() => Promise.resolve({ data: shipownerRow, error: null })),
    };
    // Chaîne générique pour aircraft/transactions/payments/collection_reminders
    const listChain = () => {
        const c: Record<string, unknown> = {
            select: vi.fn(() => c), eq: vi.fn(() => c), in: vi.fn(() => c),
            order: vi.fn(() => Promise.resolve({ data: [], error: null })),
        };
        // certaines requêtes terminent sur .eq()/.in() sans .order() → rendre thenable
        (c as { then?: unknown }).then = undefined;
        return c;
    };
    const db = {
        from: vi.fn((t: string) => (t === 'shipowners' ? soChain : listChain())),
    } as unknown as SupabaseClient;
    return { db, soChain };
}

describe('getAirlineDetail', () => {
    it('renvoie null si la ligne n’est pas une compagnie aviation (garde iata_code IS NOT NULL)', async () => {
        const { db, soChain } = detailDb(null);
        const res = await getAirlineDetail(db, 'x', true);
        expect(res).toBeNull();
        expect(soChain.not).toHaveBeenCalledWith('iata_code', 'is', null);
    });

    it('n’expose pas d’IBAN quand canViewBilling=false', async () => {
        const { db } = detailDb({
            id: 'a-1', name: 'Demo Airways', iata_code: 'DA', account_state: 'GHOST',
            is_ofac_sdn: false, is_un_prohibited: false, iban: 'ENCRYPTED',
        });
        const res = await getAirlineDetail(db, 'a-1', false);
        expect(res).not.toBeNull();
        expect(res?.iban_masked).toBeNull();
    });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd frontend && npx vitest run src/services/airlineService.test.ts`
Expected: FAIL (`getAirlineDetail` non exporté).

- [ ] **Step 3: Implémenter**

Dans `frontend/src/services/airlineService.ts`, ajouter les imports en tête :

```ts
import { decryptIban } from './kycService';
import { maskIban } from './armateurService';
```

Puis, à la fin du fichier :

```ts
export interface AirlineAircraftRow {
    id: string;
    registration: string | null;
    icao_type: string | null;
    icao24: string | null;
    mtow_kg: number | null;
    compliance_status: string;
}

export interface AirlineProformaRow {
    id: string;
    invoice_ref: string | null;
    created_at: string;
    tax_amount_usd: number;
    partial_paid_usd: number;
    status: string;
    content_hash: string | null;
    verify_signature: string | null;
}

export interface AirlinePaymentRow {
    id: string;
    amount_usd_minor: number;
    created_at: string;
    rail: string;
    external_reference: string | null;
    status: string;
}

export interface AirlineReminderRow {
    id: string;
    tier: string;
    sent_at: string;
    debtor_response_type: string;
    escalated_bailiff: boolean;
}

export interface AirlineDetail {
    id: string;
    name: string;
    aliases: string[];
    country_code: string | null;
    address: string | null;
    official_email: string | null;
    official_email_source: string | null;
    ops_email: string | null;
    finance_email: string | null;
    phone_e164: string | null;
    preferred_language: string | null;
    iata_code: string | null;
    icao_code: string | null;
    hub_code: string | null;
    aoc_number: string | null;
    applicable_modes: string[];
    equasis_id: string | null;
    notes: string | null;
    is_ofac_sdn: boolean;
    is_un_prohibited: boolean;
    account_state: string;
    kyc_level_b_completed_at: string | null;
    kyc_level_c_completed_at: string | null;
    billing_legal_name: string | null;
    billing_city: string | null;
    billing_country_code: string | null;
    vat_number: string | null;
    iban_masked: string | null;
    swift_bic: string | null;
    bank_name: string | null;
    aircraft: AirlineAircraftRow[];
    proformas: AirlineProformaRow[];
    payments: AirlinePaymentRow[];
    reminders: AirlineReminderRow[];
}

export async function getAirlineDetail(
    db: SupabaseClient,
    id: string,
    canViewBilling: boolean,
): Promise<AirlineDetail | null> {
    // Garde aviation : iata_code IS NOT NULL. Une ligne maritime → null → notFound côté page.
    const { data: s } = await db
        .from('shipowners')
        .select('*')
        .eq('id', id)
        .not('iata_code', 'is', null)
        .maybeSingle();
    if (!s) return null;

    const [aircraftRes, txRes] = await Promise.all([
        db.from('aircraft').select('id, registration, icao_type, icao24, mtow_kg, compliance_status').eq('operator_id', id),
        db.from('transactions')
          .select('id, invoice_ref, created_at, tax_amount_usd, partial_paid_usd, status, content_hash, verify_signature')
          .eq('shipowner_id', id).eq('document_type', 'PROFORMA').eq('mode', 'AIR')
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

    const row = s as Record<string, unknown>;
    const str = (k: string) => (row[k] as string | null) ?? null;

    let iban_masked: string | null = null;
    if (canViewBilling && typeof row.iban === 'string' && row.iban) {
        try {
            iban_masked = maskIban(await decryptIban(row.iban));
        } catch {
            iban_masked = null;
        }
    }

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
        iata_code: str('iata_code'),
        icao_code: str('icao_code'),
        hub_code: str('hub_code'),
        aoc_number: str('aoc_number'),
        applicable_modes: (row.applicable_modes as string[] | null) ?? [],
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
        iban_masked,
        swift_bic: str('swift_bic'),
        bank_name: str('bank_name'),
        aircraft: (aircraftRes.data ?? []).map((a) => ({
            id: a.id as string,
            registration: (a.registration as string | null) ?? null,
            icao_type: (a.icao_type as string | null) ?? null,
            icao24: (a.icao24 as string | null) ?? null,
            mtow_kg: a.mtow_kg == null ? null : Number(a.mtow_kg),
            compliance_status: a.compliance_status as string,
        })),
        proformas: (txRes.data ?? []).map((t) => ({
            id: t.id as string, invoice_ref: (t.invoice_ref as string | null) ?? null,
            created_at: t.created_at as string, tax_amount_usd: Number(t.tax_amount_usd),
            partial_paid_usd: Number(t.partial_paid_usd ?? 0), status: t.status as string,
            content_hash: (t.content_hash as string | null) ?? null,
            verify_signature: (t.verify_signature as string | null) ?? null,
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

- [ ] **Step 4: Lancer → succès**

Run: `cd frontend && npx vitest run src/services/airlineService.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: tsc + lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/services/airlineService.ts`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/airlineService.ts frontend/src/services/airlineService.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(airlines): getAirlineDetail (identité, flotte, proformas AIR, paiements, relances)"
```

---

### Task 4: Page liste + `AirlinesCockpit` + `airlineFilters`

**Files:**
- Create: `frontend/src/app/(dashboard)/admin/airlines/page.tsx`
- Create: `frontend/src/app/(dashboard)/admin/airlines/AirlinesCockpit.tsx`
- Create: `frontend/src/app/(dashboard)/admin/airlines/airlineFilters.ts`
- Create: `frontend/src/app/(dashboard)/admin/airlines/airlineFilters.test.ts`

**Interfaces:**
- Consumes: `listAirlinesCockpit`, `AirlineCockpitRow` (Task 2) ; `inviteShipowner`, `updateArmateurEmail` (existants) ; composants Os*.
- Produces: page `/admin/airlines`, composant `AirlinesCockpit`, `filterAirlines(rows, state)`.

**Référence de calque (à lire) :** `frontend/src/app/(dashboard)/admin/armateurs/page.tsx`, `.../armateurs/ArmateursCockpit.tsx`, `.../armateurs/armateurFilters.ts` + `.test.ts`.

- [ ] **Step 1: Écrire `airlineFilters.ts` + test (échouant d'abord)**

Créer `frontend/src/app/(dashboard)/admin/airlines/airlineFilters.test.ts` en calquant `armateurFilters.test.ts`, avec l'adaptation : le type de ligne est `AirlineCockpitRow`, et la recherche texte doit matcher **nom OU iata_code OU icao_code** (au lieu de nom/imo_company_no). Cas de test :

```ts
import { describe, it, expect } from 'vitest';
import { filterAirlines, type AirlineFilterState } from './airlineFilters';
import type { AirlineCockpitRow } from '@/services/airlineService';

const base: AirlineCockpitRow = {
    id: '1', name: 'Demo Airways', country_code: 'SO', account_state: 'ACTIVE',
    is_ofac_sdn: false, is_un_prohibited: false, sanctioned: false, official_email: null,
    iata_code: 'DA', icao_code: 'DMO', hub_code: 'HGA', aoc_number: 'AOC-1',
    proforma_count: 2, total_invoiced_usd: 100, total_paid_usd: 40, total_outstanding_usd: 60,
};
const rows: AirlineCockpitRow[] = [
    base,
    { ...base, id: '2', name: 'Sanctioned Air', iata_code: 'SX', icao_code: 'SNX', is_ofac_sdn: true, sanctioned: true, total_outstanding_usd: 0 },
];
const empty: AirlineFilterState = { status: '', sanctions: '', country: '', search: '', dueOnly: false };

describe('filterAirlines', () => {
    it('sans filtre renvoie tout', () => { expect(filterAirlines(rows, empty)).toHaveLength(2); });
    it('sanctions=OFAC ne garde que les OFAC', () => {
        expect(filterAirlines(rows, { ...empty, sanctions: 'OFAC' }).map((r) => r.id)).toEqual(['2']);
    });
    it('dû>0 exclut les compagnies à jour', () => {
        expect(filterAirlines(rows, { ...empty, dueOnly: true }).map((r) => r.id)).toEqual(['1']);
    });
    it('recherche par IATA retrouve la ligne', () => {
        expect(filterAirlines(rows, { ...empty, search: 'sx' }).map((r) => r.id)).toEqual(['2']);
    });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd frontend && npx vitest run "src/app/(dashboard)/admin/airlines/airlineFilters.test.ts"`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter `airlineFilters.ts`**

Calquer `armateurFilters.ts`. Type d'état identique (`status`, `sanctions` ∈ `''|'OFAC'|'UN'|'clean'`, `country`, `search`, `dueOnly`). Adapter la logique de recherche pour matcher `name`, `iata_code`, `icao_code` (insensible à la casse) :

```ts
import type { AirlineCockpitRow } from '@/services/airlineService';

export interface AirlineFilterState {
    status: string;
    sanctions: string; // '' | 'OFAC' | 'UN' | 'clean'
    country: string;
    search: string;
    dueOnly: boolean;
}

export function filterAirlines(rows: AirlineCockpitRow[], state: AirlineFilterState): AirlineCockpitRow[] {
    const q = state.search.trim().toLowerCase();
    return rows.filter((r) => {
        if (state.status && r.account_state !== state.status) return false;
        if (state.sanctions === 'OFAC' && !r.is_ofac_sdn) return false;
        if (state.sanctions === 'UN' && !r.is_un_prohibited) return false;
        if (state.sanctions === 'clean' && r.sanctioned) return false;
        if (state.country && r.country_code !== state.country) return false;
        if (state.dueOnly && r.total_outstanding_usd <= 0) return false;
        if (q) {
            const hay = `${r.name} ${r.iata_code ?? ''} ${r.icao_code ?? ''}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
}
```

- [ ] **Step 4: Lancer → succès**

Run: `cd frontend && npx vitest run "src/app/(dashboard)/admin/airlines/airlineFilters.test.ts"`
Expected: PASS (4 tests).

- [ ] **Step 5: Écrire `page.tsx`**

Calquer `armateurs/page.tsx`, en remplaçant : `listArmateursCockpit`→`listAirlinesCockpit`, `ArmateursCockpit`→`AirlinesCockpit`, namespace i18n `AdminArmateurs`→`AdminAirlines`. Code :

```tsx
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { listAirlinesCockpit } from '@/services/airlineService';
import { AirlinesCockpit } from './AirlinesCockpit';

export const dynamic = 'force-dynamic';

export default async function AirlinesPage() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    if (!profile || !['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'].includes(profile.role)) redirect('/dashboard');

    const rows = await listAirlinesCockpit(supabase);
    const t = await getTranslations('AdminAirlines');
    return (
        <div className="px-6 py-4">
            <h1 className="text-2xl font-semibold mb-2 text-[var(--os-text-primary)]">{t('title')}</h1>
            <p className="text-[var(--os-text-muted)] mb-6 text-sm">{t('subtitle')}</p>
            <AirlinesCockpit rows={rows} canInvite={profile.role === 'SUPERADMIN'} />
        </div>
    );
}
```

- [ ] **Step 6: Écrire `AirlinesCockpit.tsx`**

Calquer `armateurs/ArmateursCockpit.tsx` (lire ce fichier et reproduire sa structure : état de filtres, barre `OsSelect`/`OsInput`, `OsTable`, dialogues Radix inviter/éditer-email, `useTranslations('AdminAirlines')`, `useRouter`). Deltas exacts :
- Type de lignes : `AirlineCockpitRow` (import de `@/services/airlineService`) ; filtre : `filterAirlines`/`AirlineFilterState`.
- Colonnes `OsTable` : **Compagnie** (name) · **IATA** (iata_code) · **ICAO** (icao_code) · **Pays** (country_code) · **Statut** (OsBadge account_state) · **Sanctions** (OsBadge `variant="critical"` label OFAC/UN si flag, sinon rien) · **Pro-formas** (proforma_count) · **Facturé** (total_invoiced_usd) · **Payé** (total_paid_usd) · **Dû** (total_outstanding_usd, surligné si >0) · actions.
- Placeholder de recherche : « Nom, IATA ou ICAO ».
- Clic ligne (`onRowClick`) → `router.push('/admin/airlines/' + row.id)`.
- Dialogues : réutiliser `inviteShipowner` (bouton désactivé si `row.sanctioned`) et `updateArmateurEmail` (édition email), exactement comme `ArmateursCockpit.tsx` (mêmes imports d'action). Les libellés via `t(...)` du namespace `AdminAirlines`.
- Le filtre « pays » se peuple à partir des `country_code` distincts des `rows` (comme armateurs).

Vérifier les signatures Os* réelles (identiques à celles utilisées dans `ArmateursCockpit.tsx`).

- [ ] **Step 7: tsc + lint + tests**

Run: `cd frontend && npx tsc --noEmit && npx eslint "src/app/(dashboard)/admin/airlines/page.tsx" "src/app/(dashboard)/admin/airlines/AirlinesCockpit.tsx" "src/app/(dashboard)/admin/airlines/airlineFilters.ts" && npx vitest run "src/app/(dashboard)/admin/airlines/airlineFilters.test.ts"`
Expected: aucune erreur ; 4 tests verts. (Les clés i18n `AdminAirlines` seront posées en Task 6 — normal qu'elles manquent encore.)

- [ ] **Step 8: Commit**

```bash
git add "frontend/src/app/(dashboard)/admin/airlines/page.tsx" "frontend/src/app/(dashboard)/admin/airlines/AirlinesCockpit.tsx" "frontend/src/app/(dashboard)/admin/airlines/airlineFilters.ts" "frontend/src/app/(dashboard)/admin/airlines/airlineFilters.test.ts"
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(airlines): page liste cockpit + filtres + actions invite/email"
```

---

### Task 5: Fiche `[id]` — `page.tsx` + `AirlineDetail.tsx`

**Files:**
- Create: `frontend/src/app/(dashboard)/admin/airlines/[id]/page.tsx`
- Create: `frontend/src/app/(dashboard)/admin/airlines/[id]/AirlineDetail.tsx`

**Interfaces:**
- Consumes: `getAirlineDetail`, `AirlineDetail` (Task 3) ; composants Os*.

**Référence de calque :** `frontend/src/app/(dashboard)/admin/armateurs/[id]/page.tsx` et `.../[id]/ArmateurDetail.tsx`.

- [ ] **Step 1: Écrire `[id]/page.tsx`**

Calquer `armateurs/[id]/page.tsx`. Code :

```tsx
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAirlineDetail } from '@/services/airlineService';
import { AirlineDetail } from './AirlineDetail';

export const dynamic = 'force-dynamic';

export default async function AirlineDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    if (!profile || !['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'].includes(profile.role)) redirect('/dashboard');

    const canViewBilling = ['SUPERADMIN', 'FINANCE_ADMIN'].includes(profile.role);
    const detail = await getAirlineDetail(supabase, id, canViewBilling);
    if (!detail) notFound();

    return <AirlineDetail detail={detail} canInvite={profile.role === 'SUPERADMIN'} />;
}
```

- [ ] **Step 2: Écrire `[id]/AirlineDetail.tsx`**

Calquer `armateurs/[id]/ArmateurDetail.tsx` (lire ce fichier). Reproduire la structure de sections `OsCard` + bandeau sanctions, `useTranslations('AdminAirlines')`. Deltas exacts :
- Prop : `detail: AirlineDetail`.
- **Identité** : afficher IATA (`iata_code`), ICAO (`icao_code`), hub (`hub_code`), AOC (`aoc_number`), modes (`applicable_modes.join(', ')`), + official/ops/finance email, pays, adresse, alias, phone, langue, notes. (Remplace les champs maritime imo_company_no/equasis par iata/icao/hub/aoc.)
- **KYC** : identique armateurs (account_state, kyc B/C, billing, `iban_masked`, swift_bic, bank_name). Afficher la ligne IBAN seulement si `detail.iban_masked` non nul.
- **Flotte** (remplace « Navires ») : `OsTable` sur `detail.aircraft` — colonnes registration, icao_type, icao24, mtow_kg, compliance_status.
- **Pro-formas** : `OsTable` sur `detail.proformas` — référence, date, montant, statut, dû (tax−partial), liens « vérifier » (`/verify/[ref]?h=&s=`) + « PDF » (`/api/invoices/[ref]/download`) rendus **uniquement si** `invoice_ref && content_hash && verify_signature`.
- **Paiements** : `OsTable` sur `detail.payments`.
- **Relances** : timeline `detail.reminders` (lecture seule).
- **Actions** : bouton Éditer email (dialogue → `updateArmateurEmail`) + Inviter (dialogue → `inviteShipowner`, désactivé si `detail.is_ofac_sdn || detail.is_un_prohibited`), comme dans `ArmateurDetail.tsx`.
- Bandeau rouge si `detail.is_ofac_sdn || detail.is_un_prohibited`.

- [ ] **Step 3: tsc + lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint "src/app/(dashboard)/admin/airlines/[id]/page.tsx" "src/app/(dashboard)/admin/airlines/[id]/AirlineDetail.tsx"`
Expected: aucune erreur. (i18n en Task 6.)

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/(dashboard)/admin/airlines/[id]/page.tsx" "frontend/src/app/(dashboard)/admin/airlines/[id]/AirlineDetail.tsx"
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(airlines): fiche détaillée [id] (identité aviation, KYC, flotte, proformas AIR)"
```

---

### Task 6: i18n `AdminAirlines` (6 locales) + nav + RBAC

**Files:**
- Modify: `frontend/messages/{en,fr,so,pt,ar,sw}.json`
- Modify: `frontend/src/lib/rbac.ts`
- Modify: `frontend/src/components/dashboard/layout/DashboardSidebar.tsx`

**Interfaces:**
- Consumes: toutes les clés `t('…')` référencées dans `AirlinesCockpit.tsx` / `AirlineDetail.tsx` (namespace `AdminAirlines`) ; `Dashboard.nav_airlines`.
- Produces: namespace `AdminAirlines` (6 locales), clé `Dashboard.nav_airlines`, permission RBAC `airlines`, entrée de nav.

- [ ] **Step 1: Recenser les clés utilisées**

Run: `cd frontend && grep -ohE "t\('([a-zA-Z0-9_]+)'\)" "src/app/(dashboard)/admin/airlines/AirlinesCockpit.tsx" "src/app/(dashboard)/admin/airlines/[id]/AirlineDetail.tsx" | sort -u`
Lister toutes les clés `AdminAirlines` à définir. (Elles reprennent l'ensemble des clés du namespace `AdminArmateurs` — mêmes libellés, plus les libellés aviation IATA/ICAO/hub/AOC/flotte.)

- [ ] **Step 2: Ajouter le namespace `AdminAirlines` dans en.json**

Reprendre le bloc `AdminArmateurs` de `frontend/messages/en.json` comme base, le dupliquer sous la clé `AdminAirlines`, et adapter les libellés aviation : `title` "Airlines", `subtitle` sur les compagnies aériennes, colonnes `col_iata` "IATA", `col_icao` "ICAO", section flotte `fleet` "Fleet" + `aircraft_registration`/`aircraft_type`/`aircraft_icao24`/`aircraft_mtow`/`aircraft_compliance`, identité `iata`/`icao`/`hub`/`aoc`/`applicable_modes`. **Toute clé `t('X')` recensée en Step 1 DOIT exister.** Ajouter `"nav_airlines": "Airlines"` dans l'objet `Dashboard`.

- [ ] **Step 3: Répliquer/traduire dans fr, so, pt, ar, sw**

Ajouter le bloc `AdminAirlines` + `Dashboard.nav_airlines` traduits dans les 5 autres locales (fr : `title` "Compagnies aériennes", `col_iata` "IATA", `col_icao` "OACI", `fleet` "Flotte", `nav_airlines` "Compagnies" ; traduire les autres en cohérence avec le bloc `AdminArmateurs` existant de chaque locale). Parité stricte des clés avec en.json.

- [ ] **Step 4: Valider JSON + parité**

Run: `cd frontend && for f in en fr so pt ar sw; do node -e "JSON.parse(require('fs').readFileSync('messages/'+'$f'+'.json','utf8'));console.log('$f ok')"; done`
Puis vérifier la parité des clés `AdminAirlines` (en vs 5 autres) + présence de `Dashboard.nav_airlines` dans les 6, via un script node.
Expected: `en ok`…`sw ok` + parité OK.

- [ ] **Step 5: RBAC + nav**

Dans `frontend/src/lib/rbac.ts`, dans `NAV_PERMISSIONS`, ajouter (près de `'jurisdictions'`) :

```ts
    'airlines': [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN, UserRole.PORT_OFFICER],
```

Dans `frontend/src/components/dashboard/layout/DashboardSidebar.tsx`, dans le tableau des items (section `admin`), ajouter (icône : réutiliser une icône aviation déjà importée si dispo — sinon `Plane` de `lucide-react`, à importer) :

```tsx
    { key: 'airlines', icon: <Plane className="w-5 h-5" />, href: '/admin/airlines', labelKey: 'nav_airlines', section: 'admin' },
```

(Si `Plane` n'est pas importé, l'ajouter à l'import `lucide-react` en tête du fichier. Ne pas dupliquer un import existant.)

- [ ] **Step 6: tsc + lint + suite service**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/lib/rbac.ts "src/components/dashboard/layout/DashboardSidebar.tsx" && npx vitest run src/services/airlineService.test.ts`
Expected: aucune erreur ; 4 tests verts.

- [ ] **Step 7: Commit**

```bash
git add frontend/messages/en.json frontend/messages/fr.json frontend/messages/so.json frontend/messages/pt.json frontend/messages/ar.json frontend/messages/sw.json frontend/src/lib/rbac.ts "frontend/src/components/dashboard/layout/DashboardSidebar.tsx"
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(airlines): i18n AdminAirlines (6 locales) + navigation + permission RBAC"
```

---

## Notes finales (revue de branche)

- **IBAN** masqué côté serveur, gaté `canViewBilling` — le chiffré ne traverse jamais (leçon #92, intégrée dès Task 3).
- **Garde aviation** : `getAirlineDetail` filtre `iata_code IS NOT NULL` → une ligne maritime → `null` → `notFound()`.
- **Dépendance de branche** : `feat/admin-airlines` part de `feat/admin-armateurs` (réutilise `maskIban`, `updateArmateurEmail`, `inviteShipowner`, composants de référence). **Merge #92 avant cette PR.**
- **Migration 097** (pas 096) pour éviter la collision develop avec la mig 096 (#93).
- **Lecture seule** sauf actions invite/edit-email existantes.
- Clé nav `airlines` distincte des clés `invoices`/`armateurs` ; hors `MONEY_RAIL_KEYS`.
