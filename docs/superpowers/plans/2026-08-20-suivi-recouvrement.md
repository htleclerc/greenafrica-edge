# Poste de suivi du recouvrement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner au gestionnaire du recouvrement un tableau de bord des règlements, des fiches armateurs éditables et un canal de relance manuelle, sans toucher au moteur de relance automatique.

**Architecture:** Trois lots séquentiels, du plus inoffensif au plus engageant. Lot 1 = lecture pure (deux vues SQL `security_invoker`, tri générique dans `OsTable`, écran `/admin/reglements`). Lot 2 = édition de fiche (colonne `billing_cc_emails`, action de mise à jour des contacts, représentants). Lot 3 = envois sortants (palier `MANUAL` hors rampe, relance unitaire, récap consolidé). Rien ne sort de la plateforme avant le lot 3.

**Tech Stack:** Next.js 15 (App Router, Server Actions), TypeScript strict, Supabase (Postgres + RLS `security_invoker`), Zod, vitest, Playwright, next-intl (6 locales), Tailwind + composants maison `Os*`.

**Spec:** `docs/superpowers/specs/2026-08-20-suivi-recouvrement-design.md`

## Global Constraints

- **Rôle porteur : `FINANCE_ADMIN`.** Aucune policy RLS n'est écrite dans ce chantier. `MANAGER` n'est ouvert nulle part.
- **Gardes de rôle des server actions :** `['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN']`, identiques à `escalateCollection`.
- **Garde de rôle des écrans money-rail** (`/admin/reglements`) : `['FINANCE_ADMIN', 'SUPERADMIN']`.
- **Périmètre données :** `document_type = 'PROFORMA'` ET `mode = 'MARITIME'`, partout.
- **Statuts ouverts :** `PENDING`, `OVERDUE`, `PARTIALLY_PAID`. L'énumération complète est `PAID, PENDING, OVERDUE, EXEMPT, DISPUTED, CREDIT_NOTE_ISSUED, VOID, PARTIALLY_PAID`.
- **TypeScript strict, `any` interdit.** Les vues absentes de `supabase.generated.ts` utilisent `type Client = SupabaseClient<any>` avec `// eslint-disable-next-line @typescript-eslint/no-explicit-any`, comme `collectionAdminService.ts:7`.
- **PostgREST renvoie `NUMERIC`/`BIGINT` en `string`** — toute valeur numérique lue d'une vue passe par `Number(...)`.
- **Chaque migration porte un commentaire `-- DOWN:`** en fin de fichier (convention maison, visible dans toutes les migrations existantes).
- **Migrations déployées par CI** via `supabase db push --db-url` (`.github/workflows/deploy-staging.yml:46`). Elles ne sont jamais appliquées à la main.
- **i18n : 6 locales obligatoires** — `messages/{fr,en,ar,pt,so,sw}.json`. Toute clé ajoutée l'est dans les six.
- **Commits :** auteur `Loïc Leclerc <leclerc@drwintech.com>`, messages conventionnels humanisés, staging explicite par chemins. Jamais de co-auteur IA.
- **Tests :** `npm test` (vitest run) depuis `frontend/`.

---

# LOT 1 — Socle de lecture

### Task 1: Migration 121 — vues d'agrégation

**Files:**
- Create: `supabase/migrations/121_reglements_dashboard.sql`

**Interfaces:**
- Produces: vue `public.v_reglements_dashboard` (une ligne par juridiction) ; `public.v_armateur_recouvrement` enrichie de 5 colonnes en fin.

- [ ] **Step 1: Écrire la migration**

Créer `supabase/migrations/121_reglements_dashboard.sql`. `CREATE OR REPLACE VIEW` ne peut qu'**ajouter des colonnes en fin** : les 13 colonnes existantes de `v_armateur_recouvrement` (mig 095) sont recopiées **à l'identique, dans le même ordre**, les 5 nouvelles viennent après.

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 121 : tableau de bord des règlements + enrichissement du cockpit
--
-- v_reglements_dashboard : une ligne par juridiction, fenêtres calendaires UTC.
-- v_armateur_recouvrement : +5 colonnes (retard, échéance, dernière relance).
-- Les deux en security_invoker → héritent de la RLS de transactions/payments/
-- shipowners. Aucune policy à écrire.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_reglements_dashboard
WITH (security_invoker = true) AS
SELECT
  j.id AS jurisdiction_id,

  (SELECT COALESCE(SUM(t.tax_amount_usd), 0) FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.created_at >= date_trunc('day', now()))                   AS invoiced_today_usd,
  (SELECT COUNT(*) FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.created_at >= date_trunc('day', now()))                   AS invoiced_today_count,
  (SELECT COALESCE(SUM(t.tax_amount_usd), 0) FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.created_at >= date_trunc('week', now()))                  AS invoiced_week_usd,
  (SELECT COUNT(*) FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.created_at >= date_trunc('week', now()))                  AS invoiced_week_count,
  (SELECT COALESCE(SUM(t.tax_amount_usd), 0) FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.created_at >= date_trunc('month', now()))                 AS invoiced_month_usd,
  (SELECT COUNT(*) FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.created_at >= date_trunc('month', now()))                 AS invoiced_month_count,

  -- Encaissé = créances éteintes. Les alimentations de wallet non affectées à une
  -- facture (payments.transaction_id IS NULL) sont volontairement hors périmètre.
  -- Les règlements par wallet, eux, produisent bien une ligne payments (mig 059).
  (SELECT COALESCE(SUM(p.amount_usd_minor), 0) / 100.0 FROM public.payments p
     JOIN public.transactions t ON t.id = p.transaction_id
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND p.status = 'CONFIRMED'
      AND p.confirmed_at >= date_trunc('day', now()))                 AS collected_today_usd,
  (SELECT COUNT(*) FROM public.payments p
     JOIN public.transactions t ON t.id = p.transaction_id
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND p.status = 'CONFIRMED'
      AND p.confirmed_at >= date_trunc('day', now()))                 AS collected_today_count,
  (SELECT COALESCE(SUM(p.amount_usd_minor), 0) / 100.0 FROM public.payments p
     JOIN public.transactions t ON t.id = p.transaction_id
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND p.status = 'CONFIRMED'
      AND p.confirmed_at >= date_trunc('week', now()))                AS collected_week_usd,
  (SELECT COUNT(*) FROM public.payments p
     JOIN public.transactions t ON t.id = p.transaction_id
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND p.status = 'CONFIRMED'
      AND p.confirmed_at >= date_trunc('week', now()))                AS collected_week_count,
  (SELECT COALESCE(SUM(p.amount_usd_minor), 0) / 100.0 FROM public.payments p
     JOIN public.transactions t ON t.id = p.transaction_id
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND p.status = 'CONFIRMED'
      AND p.confirmed_at >= date_trunc('month', now()))               AS collected_month_usd,
  (SELECT COUNT(*) FROM public.payments p
     JOIN public.transactions t ON t.id = p.transaction_id
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND p.status = 'CONFIRMED'
      AND p.confirmed_at >= date_trunc('month', now()))               AS collected_month_count,

  (SELECT COALESCE(SUM(t.tax_amount_usd - COALESCE(t.partial_paid_usd, 0)), 0)
     FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.status IN ('PENDING','OVERDUE','PARTIALLY_PAID'))         AS total_outstanding_usd,
  (SELECT COALESCE(SUM(t.tax_amount_usd - COALESCE(t.partial_paid_usd, 0)), 0)
     FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.status IN ('PENDING','OVERDUE','PARTIALLY_PAID')
      AND t.due_date < now())                                         AS overdue_usd,
  (SELECT COUNT(*) FROM public.transactions t
    WHERE t.jurisdiction_id = j.id AND t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.status IN ('PENDING','OVERDUE','PARTIALLY_PAID')
      AND t.due_date < now())                                         AS overdue_count
FROM public.jurisdictions j;

COMMENT ON VIEW public.v_reglements_dashboard IS
  'Tableau de bord recouvrement maritime : facturé/encaissé par fenêtre calendaire UTC + encours. security_invoker.';

GRANT SELECT ON public.v_reglements_dashboard TO authenticated, service_role;

-- ── v_armateur_recouvrement : +5 colonnes EN FIN (mig 095 recopiée à l'identique)
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
  ), 0)                                                                 AS total_outstanding_usd,
  -- ── nouvelles colonnes (mig 121) ──────────────────────────────────────────
  COUNT(t.id) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.status IN ('PENDING','OVERDUE','PARTIALLY_PAID') AND t.due_date < now()
  )                                                                     AS overdue_count,
  MIN(t.due_date) FILTER (
    WHERE t.document_type = 'PROFORMA' AND t.mode = 'MARITIME'
      AND t.status IN ('PENDING','OVERDUE','PARTIALLY_PAID')
  )                                                                     AS next_due_date,
  r.last_auto_tier,
  r.last_reminder_at,
  r.latest_response_type
FROM public.shipowners s
LEFT JOIN public.transactions t ON t.shipowner_id = s.id
LEFT JOIN LATERAL (
  SELECT
    (array_agg(cr.tier ORDER BY cr.sent_at DESC)
       FILTER (WHERE cr.tier::text IN ('J3','J7','J15','J30','J45','BAILIFF','JUDICIAL')))[1] AS last_auto_tier,
    max(cr.sent_at)                                                                            AS last_reminder_at,
    (array_agg(cr.debtor_response_type ORDER BY cr.debtor_response_at DESC NULLS LAST)
       FILTER (WHERE cr.debtor_response_type <> 'SILENT'))[1]                                  AS latest_response_type
  FROM public.collection_reminders cr
  JOIN public.transactions t2 ON t2.id = cr.transaction_id
  WHERE t2.shipowner_id = s.id
) r ON TRUE
WHERE s.iata_code IS NULL
GROUP BY s.id, r.last_auto_tier, r.last_reminder_at, r.latest_response_type;

COMMENT ON VIEW public.v_armateur_recouvrement IS
  'Cockpit admin armateurs : agrégats facturé/payé/dû + état de relance (mig 121). security_invoker.';

GRANT SELECT ON public.v_armateur_recouvrement TO authenticated, service_role;

-- DOWN:
-- DROP VIEW IF EXISTS public.v_reglements_dashboard;
-- (restaurer v_armateur_recouvrement dans sa forme mig 095)
```

Le `FILTER` sur `last_auto_tier` liste les paliers de la rampe **en dur** plutôt que d'exclure `'MANUAL'` : à ce stade la valeur `MANUAL` n'existe pas encore dans l'enum (elle arrive en mig 123), et une référence littérale à une valeur inexistante ferait échouer la migration.

- [ ] **Step 2: Vérifier la syntaxe SQL**

Le dépôt n'a pas de stack Supabase locale utilisable (ports occupés, cf. mémoire projet). Relire la migration en vérifiant point par point :
- toutes les colonnes de la mig 095 sont présentes, dans le même ordre, avant les nouvelles ;
- chaque sous-requête scalaire est bien parenthésée et se termine par un alias `AS` ;
- le `GROUP BY` liste `s.id` plus les trois colonnes issues du `LATERAL` ;
- le fichier se termine par le bloc `-- DOWN:`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/121_reglements_dashboard.sql
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(recouvrement): vue du tableau de bord et enrichissement du cockpit armateurs"
```

---

### Task 2: Tri générique — `OsTable` + `useClientSort`

**Files:**
- Modify: `frontend/src/components/ui/OsTable.tsx`
- Create: `frontend/src/hooks/useClientSort.ts`
- Create: `frontend/src/hooks/useClientSort.test.ts`

**Interfaces:**
- Produces: `OsColumn<T>` gagne `sortable?: boolean` et `sortValue?: (row: T) => string | number | null` ; `OsTableProps<T>` gagne `sort?: OsSort | null` et `onSortChange?: (next: OsSort) => void` ; `export type OsSort = { key: string; dir: 'asc' | 'desc' }` ; `useClientSort<T>(rows, columns)` → `{ sort, onSortChange, sortedRows }`.
- **Toutes les nouvelles props sont optionnelles** — les 23 consommateurs existants d'`OsTable` compilent sans changement.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/src/hooks/useClientSort.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { compareValues } from './useClientSort';

describe('compareValues', () => {
    it('ordonne les nombres croissant puis décroissant', () => {
        expect(compareValues(1, 2, 'asc')).toBeLessThan(0);
        expect(compareValues(1, 2, 'desc')).toBeGreaterThan(0);
    });

    it('ordonne les chaînes sans tenir compte de la casse', () => {
        expect(compareValues('alpha', 'Beta', 'asc')).toBeLessThan(0);
    });

    it('place null en fin QUEL QUE SOIT le sens', () => {
        // Un armateur sans échéance ne doit jamais remonter en tête d'un tri
        // décroissant sur l'échéance : l'absence de donnée n'est pas une valeur.
        expect(compareValues(null, 5, 'asc')).toBeGreaterThan(0);
        expect(compareValues(null, 5, 'desc')).toBeGreaterThan(0);
        expect(compareValues(5, null, 'desc')).toBeLessThan(0);
    });

    it('renvoie 0 sur deux null', () => {
        expect(compareValues(null, null, 'asc')).toBe(0);
    });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `cd frontend && npx vitest run src/hooks/useClientSort.test.ts`
Expected: FAIL — `Failed to resolve import "./useClientSort"`.

- [ ] **Step 3: Écrire le hook**

Créer `frontend/src/hooks/useClientSort.ts` :

```ts
import * as React from 'react';
import type { OsColumn, OsSort } from '@/components/ui/OsTable';

/**
 * Comparateur de tri client. `null` est toujours relégué en fin, dans les deux
 * sens : une donnée absente n'est pas une valeur extrême, et la voir occuper la
 * tête d'un tri décroissant induirait le lecteur en erreur.
 */
export function compareValues(
    a: string | number | null,
    b: string | number | null,
    dir: 'asc' | 'desc',
): number {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    const raw = typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
    return dir === 'asc' ? raw : -raw;
}

/**
 * Tri en mémoire pour les écrans qui chargent l'intégralité de leurs lignes.
 * Les écrans paginés côté serveur ne doivent PAS l'utiliser : ils ne trieraient
 * que la page affichée.
 */
export function useClientSort<T>(rows: T[], columns: OsColumn<T>[]): {
    sort: OsSort | null;
    onSortChange: (next: OsSort) => void;
    sortedRows: T[];
} {
    const [sort, setSort] = React.useState<OsSort | null>(null);
    // Typage explicite : `setSort` seul serait un Dispatch<SetStateAction<…>>,
    // assignable mais déroutant à la lecture des appelants.
    const onSortChange = React.useCallback((next: OsSort) => setSort(next), []);

    const sortedRows = React.useMemo(() => {
        if (!sort) return rows;
        const col = columns.find((c) => c.key === sort.key);
        if (!col?.sortValue) return rows;
        const get = col.sortValue;
        return [...rows].sort((x, y) => compareValues(get(x), get(y), sort.dir));
    }, [rows, columns, sort]);

    return { sort, onSortChange, sortedRows };
}
```

- [ ] **Step 4: Lancer le test pour le voir passer**

Run: `cd frontend && npx vitest run src/hooks/useClientSort.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Rendre `OsTable` triable**

Dans `frontend/src/components/ui/OsTable.tsx`, ajouter le type `OsSort`, les deux champs d'`OsColumn`, les deux props d'`OsTableProps`, et remplacer le `<th>` par un en-tête cliquable **uniquement** quand `col.sortable && onSortChange` :

```tsx
export type OsSort = { key: string; dir: 'asc' | 'desc' };

export interface OsColumn<T> {
    key: string;
    header: string;
    render: (row: T) => React.ReactNode;
    className?: string;
    /** Rend l'en-tête cliquable. Sans `sortValue`, seul un tri contrôlé fonctionne. */
    sortable?: boolean;
    /** Clé de tri pour le tri client (`useClientSort`). */
    sortValue?: (row: T) => string | number | null;
}
```

Dans `OsTableProps<T>`, ajouter `sort?: OsSort | null;` et `onSortChange?: (next: OsSort) => void;`, puis dans la signature de la fonction `OsTable`, ajouter `sort = null, onSortChange`.

Remplacer le corps du `<th>` par :

```tsx
{columns.map((col) => {
    const active = sort?.key === col.key;
    const interactive = col.sortable && !!onSortChange;
    return (
        <th
            key={col.key}
            aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
            className={`px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] ${col.className ?? ''}`}
        >
            {interactive ? (
                <button
                    type="button"
                    onClick={() => onSortChange({
                        key: col.key,
                        dir: active && sort.dir === 'asc' ? 'desc' : 'asc',
                    })}
                    className="inline-flex items-center gap-1 uppercase tracking-widest hover:text-[var(--os-text-primary)] transition-colors"
                >
                    {col.header}
                    <span aria-hidden className={active ? 'opacity-100' : 'opacity-30'}>
                        {active && sort.dir === 'desc' ? '↓' : '↑'}
                    </span>
                </button>
            ) : col.header}
        </th>
    );
})}
```

`OsTable` **ne trie jamais lui-même** : il rend l'affordance et remonte l'intention. La politique de tri appartient à l'écran, parce qu'elle diffère selon qu'il pagine ou non.

- [ ] **Step 6: Vérifier la non-régression des 23 consommateurs**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: compilation propre, suite verte. Aucun appelant existant ne passe `sort`/`onSortChange` : leurs en-têtes restent inertes.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ui/OsTable.tsx frontend/src/hooks/useClientSort.ts frontend/src/hooks/useClientSort.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(ui): tri optionnel des colonnes OsTable"
```

---

### Task 3: Tri client sur `/admin/armateurs`

**Files:**
- Modify: `frontend/src/app/(dashboard)/admin/armateurs/ArmateursCockpit.tsx`
- Modify: `frontend/src/services/armateurService.ts`
- Modify: `frontend/src/services/armateurService.test.ts`
- Modify: `messages/{fr,en,ar,pt,so,sw}.json`

**Interfaces:**
- Consumes: `useClientSort` (Task 2), colonnes de la mig 121 (Task 1).
- Produces: `ArmateurCockpitRow` gagne `overdue_count: number`, `next_due_date: string | null`, `last_auto_tier: string | null`, `last_reminder_at: string | null`, `latest_response_type: string | null`.

- [ ] **Step 1: Écrire le test qui échoue**

Dans `frontend/src/services/armateurService.test.ts`, ajouter au bloc de `listArmateursCockpit` :

```ts
it('normalise les nouvelles colonnes de relance (mig 121)', async () => {
    const { db } = makeDb([{
        id: 'own-1', name: 'ACME', account_state: 'ACTIVE',
        is_ofac_sdn: false, is_un_prohibited: false, sanctioned: false,
        proforma_count: '3', total_invoiced_usd: '900', total_paid_usd: '100',
        total_outstanding_usd: '800',
        overdue_count: '2', next_due_date: '2026-09-01T00:00:00Z',
        last_auto_tier: 'J15', last_reminder_at: '2026-08-18T09:00:00Z',
        latest_response_type: 'PAYMENT_PROMISE',
    }]);
    const rows = await listArmateursCockpit(db);
    // PostgREST renvoie les BIGINT en string — la normalisation est le contrat.
    expect(rows[0].overdue_count).toBe(2);
    expect(rows[0].next_due_date).toBe('2026-09-01T00:00:00Z');
    expect(rows[0].last_auto_tier).toBe('J15');
    expect(rows[0].latest_response_type).toBe('PAYMENT_PROMISE');
});

it('retombe sur des valeurs neutres quand aucune relance n_a eu lieu', async () => {
    const { db } = makeDb([{
        id: 'own-2', name: 'BETA', account_state: 'GHOST',
        is_ofac_sdn: false, is_un_prohibited: false, sanctioned: false,
        proforma_count: '0', total_invoiced_usd: '0', total_paid_usd: '0',
        total_outstanding_usd: '0', overdue_count: '0',
        next_due_date: null, last_auto_tier: null, last_reminder_at: null,
        latest_response_type: null,
    }]);
    const rows = await listArmateursCockpit(db);
    expect(rows[0].overdue_count).toBe(0);
    expect(rows[0].next_due_date).toBeNull();
    expect(rows[0].last_auto_tier).toBeNull();
});
```

Si `makeDb` n'existe pas encore dans ce fichier, le reprendre du patron de `collectionAdminService.test.ts:57` en supprimant `range` (`listArmateursCockpit` termine sur `.order()`) :

```ts
function makeDb(rows: Record<string, unknown>[]) {
    const calls: { method: string; args: unknown[] }[] = [];
    const builder: Record<string, unknown> = {};
    builder.select = (...args: unknown[]) => { calls.push({ method: 'select', args }); return builder; };
    builder.order = (...args: unknown[]) => {
        calls.push({ method: 'order', args });
        return Promise.resolve({ data: rows, error: null });
    };
    const db = { from: (t: string) => { calls.push({ method: 'from', args: [t] }); return builder; } };
    return { db: db as never, calls };
}
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `cd frontend && npx vitest run src/services/armateurService.test.ts`
Expected: FAIL — `expected undefined to be 2`.

- [ ] **Step 3: Étendre le service**

Dans `frontend/src/services/armateurService.ts`, ajouter les 5 champs à `ArmateurCockpitRow` et à l'objet retourné par `listArmateursCockpit` :

```ts
overdue_count: Number(r.overdue_count ?? 0),
next_due_date: (r.next_due_date as string | null) ?? null,
last_auto_tier: (r.last_auto_tier as string | null) ?? null,
last_reminder_at: (r.last_reminder_at as string | null) ?? null,
latest_response_type: (r.latest_response_type as string | null) ?? null,
```

- [ ] **Step 4: Lancer le test pour le voir passer**

Run: `cd frontend && npx vitest run src/services/armateurService.test.ts`
Expected: PASS.

- [ ] **Step 5: Câbler le tri et les colonnes dans le cockpit**

Dans `ArmateursCockpit.tsx` :

```tsx
import { useClientSort } from '@/hooks/useClientSort';
// ...
const visible = React.useMemo(() => filterArmateurs(rows, filters), [rows, filters]);
const { sort, onSortChange, sortedRows } = useClientSort(visible, columns);
```

`columns` doit être déclaré **avant** l'appel au hook, et mémoïsé avec `React.useMemo(() => [...], [t])` pour ne pas recalculer le tri à chaque rendu.

Ajouter `sortable: true` + `sortValue` sur les colonnes utiles :

```tsx
{ key: 'name', header: t('col.name'), sortable: true, sortValue: (r) => r.name, render: /* inchangé */ },
{ key: 'proformas', /* ... */ sortable: true, sortValue: (r) => r.proforma_count },
{ key: 'invoiced', /* ... */ sortable: true, sortValue: (r) => r.total_invoiced_usd },
{ key: 'paid', /* ... */ sortable: true, sortValue: (r) => r.total_paid_usd },
{ key: 'outstanding', /* ... */ sortable: true, sortValue: (r) => r.total_outstanding_usd },
```

Ajouter deux colonnes, avant `actions` :

```tsx
{
    key: 'overdue',
    header: t('col.overdue'),
    className: 'text-right',
    sortable: true,
    sortValue: (r) => r.overdue_count,
    render: (r) => r.overdue_count > 0
        ? <OsBadge variant="overdue" label={String(r.overdue_count)} />
        : <span className="text-xs text-[var(--os-text-muted)]">—</span>,
},
{
    key: 'lastReminder',
    header: t('col.lastReminder'),
    sortable: true,
    sortValue: (r) => r.last_reminder_at,
    render: (r) => (
        <div className="flex items-center gap-1.5">
            {r.last_auto_tier && <OsBadge variant="warning" label={r.last_auto_tier} size="sm" />}
            <span className="text-xs text-[var(--os-text-muted)]">
                {r.last_reminder_at ? new Date(r.last_reminder_at).toLocaleDateString() : '—'}
            </span>
        </div>
    ),
},
```

Passer `rows={sortedRows}`, `sort={sort}` et `onSortChange={onSortChange}` à `<OsTable>`.

- [ ] **Step 6: Ajouter les clés i18n dans les 6 locales**

Dans le namespace `AdminArmateurs` de `messages/{fr,en,ar,pt,so,sw}.json`, ajouter `col.overdue` et `col.lastReminder`.

FR : `"overdue": "En retard"`, `"lastReminder": "Dernière relance"`.
EN : `"overdue": "Overdue"`, `"lastReminder": "Last reminder"`.
Pour ar/pt/so/sw, suivre la baseline de traduction automatique déjà en place (mémoire projet : à relire par un natif ultérieurement).

- [ ] **Step 7: Vérifier**

Run: `cd frontend && npx tsc --noEmit && npm test && npm run lint`
Expected: tout vert.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/services/armateurService.ts frontend/src/services/armateurService.test.ts "frontend/src/app/(dashboard)/admin/armateurs/ArmateursCockpit.tsx" frontend/messages
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(armateurs): colonnes retard et derniere relance, tableau triable"
```

---

### Task 4: Tri serveur sur `/admin/collections` et `/admin/invoices`

**Files:**
- Modify: `frontend/src/services/collectionAdminService.ts`
- Modify: `frontend/src/services/collectionAdminService.test.ts`
- Modify: `frontend/src/services/invoiceAdminService.ts`
- Modify: `frontend/src/services/invoiceAdminService.test.ts`
- Modify: `frontend/src/app/(dashboard)/admin/collections/CollectionsAdminList.tsx`
- Modify: `frontend/src/app/(dashboard)/admin/invoices/InvoicesAdminList.tsx`

**Interfaces:**
- Consumes: `OsSort` (Task 2).
- Produces: `CollectionAdminFilters` et `InvoiceAdminFilters` gagnent `sortKey?: string` et `sortDir?: 'asc' | 'desc'` ; `COLLECTION_SORT_KEYS` et `INVOICE_SORT_KEYS` exportés.

- [ ] **Step 1: Écrire le test qui échoue**

Dans `frontend/src/services/collectionAdminService.test.ts` :

```ts
it('trie sur une clé autorisée', async () => {
    const { db, calls } = makeDb([], 0);
    await listCollectionsAdmin(db, {
        page: 1, pageSize: 25, sortKey: 'outstanding_usd', sortDir: 'asc',
    });
    const orderCalls = calls.filter((c) => c.method === 'order');
    expect(orderCalls[0]).toEqual({ method: 'order', args: ['outstanding_usd', { ascending: true }] });
    // départage déterministe conservé
    expect(orderCalls[1]).toEqual({ method: 'order', args: ['transaction_id', { ascending: true }] });
});

it('ignore une clé de tri hors liste blanche', async () => {
    // Sans liste blanche, la chaîne partirait telle quelle dans .order() —
    // c'est le seul endroit où une entrée utilisateur touche la requête.
    const { db, calls } = makeDb([], 0);
    await listCollectionsAdmin(db, {
        page: 1, pageSize: 25, sortKey: 'tax_amount_usd; DROP TABLE', sortDir: 'asc',
    });
    const orderCalls = calls.filter((c) => c.method === 'order');
    expect(orderCalls[0]).toEqual({ method: 'order', args: ['latest_sent_at', { ascending: false }] });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `cd frontend && npx vitest run src/services/collectionAdminService.test.ts`
Expected: FAIL sur le premier `expect`.

- [ ] **Step 3: Implémenter le tri validé**

Dans `collectionAdminService.ts` :

```ts
/** Colonnes triables. Toute clé absente d'ici retombe sur l'ordre par défaut. */
export const COLLECTION_SORT_KEYS = [
    'debtor_name', 'invoice_ref', 'outstanding_usd', 'status',
    'latest_tier', 'latest_sent_at', 'reminder_count',
] as const;
```

Ajouter au `filtersSchema` :

```ts
sortKey: z.enum(COLLECTION_SORT_KEYS).optional().catch(undefined),
sortDir: z.enum(['asc', 'desc']).optional().catch(undefined),
```

et à `parseCollectionFilters` : `sortKey: first(sp.sortKey), sortDir: first(sp.sortDir),`.

Dans `listCollectionsAdmin`, remplacer le premier `.order(...)` par :

```ts
const sortKey = f.sortKey ?? 'latest_sent_at';
const ascending = f.sortKey ? f.sortDir !== 'desc' : false;
const { data, count, error } = await q
    .order(sortKey, { ascending })
    .order('transaction_id', { ascending: true })
    .range(offset, offset + f.pageSize - 1);
```

Le `z.enum` fait office de liste blanche : une clé hors énumération est ramenée à `undefined` par `.catch()`, donc à l'ordre par défaut.

- [ ] **Step 4: Lancer le test pour le voir passer**

Run: `cd frontend && npx vitest run src/services/collectionAdminService.test.ts`
Expected: PASS.

- [ ] **Step 5: Faire de même pour `invoiceAdminService`**

Dans `frontend/src/services/invoiceAdminService.ts` :

```ts
/** Colonnes triables. Toute clé absente d'ici retombe sur l'ordre par défaut. */
export const INVOICE_SORT_KEYS = [
    'invoice_ref', 'debtor_name', 'created_at', 'tax_amount_usd',
    'status', 'jurisdiction_name', 'document_type',
] as const;
```

Ajouter au schéma de filtres :

```ts
sortKey: z.enum(INVOICE_SORT_KEYS).optional().catch(undefined),
sortDir: z.enum(['asc', 'desc']).optional().catch(undefined),
```

et à `parseInvoiceFilters` : `sortKey: first(searchParams.sortKey), sortDir: first(searchParams.sortDir),`.

Dans `listInvoicesAdmin`, remplacer l'appel `.order(...)` existant par :

```ts
const sortKey = filters.sortKey ?? 'created_at';
const ascending = filters.sortKey ? filters.sortDir !== 'desc' : false;
// ... puis, sur la requête :
    .order(sortKey, { ascending })
    .order('id', { ascending: true })   // départage déterministe des égalités
```

⚠️ Relire l'ordre par défaut réellement présent dans `listInvoicesAdmin` avant de le remplacer, et le conserver comme repli exact — si le service trie déjà sur autre chose que `created_at` desc, c'est cette valeur qui devient le repli, pas `created_at`.

Ajouter dans `frontend/src/services/invoiceAdminService.test.ts` les deux mêmes tests que pour les collections :

```ts
it('trie sur une clé autorisée', async () => {
    const { db, calls } = makeDb([], 0);
    await listInvoicesAdmin(db, { page: 1, pageSize: 25, sortKey: 'tax_amount_usd', sortDir: 'asc' });
    const orderCalls = calls.filter((c) => c.method === 'order');
    expect(orderCalls[0]).toEqual({ method: 'order', args: ['tax_amount_usd', { ascending: true }] });
});

it('ignore une clé de tri hors liste blanche', async () => {
    const { db, calls } = makeDb([], 0);
    await listInvoicesAdmin(db, { page: 1, pageSize: 25, sortKey: 'evil; DROP TABLE', sortDir: 'asc' });
    const orderCalls = calls.filter((c) => c.method === 'order');
    expect(orderCalls[0].args[0]).toBe('created_at');
});
```

- [ ] **Step 6: Câbler les deux écrans sur l'URL**

Dans `CollectionsAdminList.tsx` puis `InvoicesAdminList.tsx` :

```tsx
const sort = filters.sortKey ? { key: filters.sortKey, dir: filters.sortDir ?? 'asc' } : null;
const onSortChange = (next: { key: string; dir: 'asc' | 'desc' }) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('sortKey', next.key);
    params.set('sortDir', next.dir);
    params.delete('page'); // un changement de tri renvoie en page 1
    router.push(`?${params.toString()}`);
};
```

Passer `sort` et `onSortChange` à `<OsTable>`, et marquer `sortable: true` sur les colonnes dont la `key` figure dans la liste blanche correspondante. **Ne pas** ajouter de `sortValue` : ces écrans sont paginés serveur, un tri client n'y trierait que la page affichée.

⚠️ La `key` de colonne côté UI doit être **exactement** la clé de la liste blanche (ex. `key: 'outstanding'` devient `key: 'outstanding_usd'`). Sans quoi le clic enverrait une clé rejetée et le tri paraîtrait inopérant.

- [ ] **Step 7: Corriger le filtre de statut de `/admin/invoices`**

Dans `InvoicesAdminList.tsx:29`, remplacer :

```tsx
const STATUSES = ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED'] as const;
```

par les valeurs réelles de l'énumération `transaction_status` :

```tsx
const STATUSES = ['PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'DISPUTED', 'VOID'] as const;
```

`PARTIAL` et `CANCELLED` n'existent pas dans l'enum : le service les passait tels quels à `.eq('status', …)`, donc ces deux filtres ne pouvaient rien rendre.

- [ ] **Step 8: Vérifier**

Run: `cd frontend && npx tsc --noEmit && npm test && npm run lint`

- [ ] **Step 9: Commit**

```bash
git add frontend/src/services/collectionAdminService.ts frontend/src/services/collectionAdminService.test.ts frontend/src/services/invoiceAdminService.ts frontend/src/services/invoiceAdminService.test.ts "frontend/src/app/(dashboard)/admin/collections/CollectionsAdminList.tsx" "frontend/src/app/(dashboard)/admin/invoices/InvoicesAdminList.tsx"
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(admin): tri serveur des ecrans collections et factures

Corrige au passage le filtre de statut des factures, qui proposait
PARTIAL et CANCELLED — deux valeurs absentes de l'enum."
```

---

### Task 5: Écran `/admin/reglements`

**Files:**
- Create: `frontend/src/services/reglementsService.ts`
- Create: `frontend/src/services/reglementsService.test.ts`
- Create: `frontend/src/app/(dashboard)/admin/reglements/page.tsx`
- Create: `frontend/src/app/(dashboard)/admin/reglements/ReglementsDashboard.tsx`
- Modify: `frontend/src/lib/rbac.ts`
- Modify: `frontend/src/components/dashboard/layout/DashboardSidebar.tsx`
- Modify: `messages/{fr,en,ar,pt,so,sw}.json`

**Interfaces:**
- Consumes: `v_reglements_dashboard` et `v_armateur_recouvrement` (Task 1), `listArmateursCockpit` (Task 3), `useClientSort` (Task 2).
- Produces: `getReglementsSummary(db): Promise<ReglementsSummary>` avec `ReglementsSummary = { invoicedToday: Bucket; invoicedWeek: Bucket; invoicedMonth: Bucket; collectedToday: Bucket; collectedWeek: Bucket; collectedMonth: Bucket; totalOutstandingUsd: number; overdueUsd: number; overdueCount: number }` et `Bucket = { usd: number; count: number }`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/src/services/reglementsService.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { getReglementsSummary } from './reglementsService';

function makeDb(rows: Record<string, unknown>[]) {
    const builder: Record<string, unknown> = {};
    builder.select = () => Promise.resolve({ data: rows, error: null });
    return { from: () => builder } as never;
}

describe('getReglementsSummary', () => {
    it('normalise les chaînes PostgREST en nombres', async () => {
        const s = await getReglementsSummary(makeDb([{
            jurisdiction_id: 'j1',
            invoiced_today_usd: '42100.50', invoiced_today_count: '3',
            invoiced_week_usd: '0', invoiced_week_count: '0',
            invoiced_month_usd: '0', invoiced_month_count: '0',
            collected_today_usd: '18500', collected_today_count: '2',
            collected_week_usd: '0', collected_week_count: '0',
            collected_month_usd: '0', collected_month_count: '0',
            total_outstanding_usd: '1630200', overdue_usd: '947300', overdue_count: '88',
        }]));
        expect(s.invoicedToday).toEqual({ usd: 42100.5, count: 3 });
        expect(s.collectedToday).toEqual({ usd: 18500, count: 2 });
        expect(s.overdueCount).toBe(88);
    });

    it('additionne les juridictions visibles', async () => {
        // Un SUPERADMIN voit plusieurs juridictions : le tableau de bord
        // présente un total consolidé, pas la première ligne venue.
        const row = (id: string, usd: string) => ({
            jurisdiction_id: id,
            invoiced_today_usd: usd, invoiced_today_count: '1',
            invoiced_week_usd: '0', invoiced_week_count: '0',
            invoiced_month_usd: '0', invoiced_month_count: '0',
            collected_today_usd: '0', collected_today_count: '0',
            collected_week_usd: '0', collected_week_count: '0',
            collected_month_usd: '0', collected_month_count: '0',
            total_outstanding_usd: '0', overdue_usd: '0', overdue_count: '0',
        });
        const s = await getReglementsSummary(makeDb([row('j1', '100'), row('j2', '250')]));
        expect(s.invoicedToday).toEqual({ usd: 350, count: 2 });
    });

    it('renvoie des zéros quand la vue ne rend aucune ligne', async () => {
        const s = await getReglementsSummary(makeDb([]));
        expect(s.invoicedToday).toEqual({ usd: 0, count: 0 });
        expect(s.totalOutstandingUsd).toBe(0);
    });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `cd frontend && npx vitest run src/services/reglementsService.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Écrire le service**

Créer `frontend/src/services/reglementsService.ts` :

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

// La vue n'est pas dans supabase.generated.ts (même patron que collectionAdminService).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

export interface Bucket { usd: number; count: number }

export interface ReglementsSummary {
    invoicedToday: Bucket; invoicedWeek: Bucket; invoicedMonth: Bucket;
    collectedToday: Bucket; collectedWeek: Bucket; collectedMonth: Bucket;
    totalOutstandingUsd: number;
    overdueUsd: number;
    overdueCount: number;
}

const ZERO: Bucket = { usd: 0, count: 0 };

/**
 * Agrège les lignes de v_reglements_dashboard visibles par l'appelant.
 * La RLS ne rend que les juridictions autorisées ; un SUPERADMIN multi-pays
 * en voit plusieurs, et le tableau de bord présente leur total.
 */
export async function getReglementsSummary(db: Client): Promise<ReglementsSummary> {
    const { data, error } = await db.from('v_reglements_dashboard').select('*');
    if (error) throw new Error(`getReglementsSummary: ${error.message}`);
    const rows = (data ?? []) as Record<string, unknown>[];

    const bucket = (usdKey: string, countKey: string): Bucket => ({
        usd: rows.reduce((s, r) => s + Number(r[usdKey] ?? 0), 0),
        count: rows.reduce((s, r) => s + Number(r[countKey] ?? 0), 0),
    });

    return {
        invoicedToday: rows.length ? bucket('invoiced_today_usd', 'invoiced_today_count') : ZERO,
        invoicedWeek: rows.length ? bucket('invoiced_week_usd', 'invoiced_week_count') : ZERO,
        invoicedMonth: rows.length ? bucket('invoiced_month_usd', 'invoiced_month_count') : ZERO,
        collectedToday: rows.length ? bucket('collected_today_usd', 'collected_today_count') : ZERO,
        collectedWeek: rows.length ? bucket('collected_week_usd', 'collected_week_count') : ZERO,
        collectedMonth: rows.length ? bucket('collected_month_usd', 'collected_month_count') : ZERO,
        totalOutstandingUsd: rows.reduce((s, r) => s + Number(r.total_outstanding_usd ?? 0), 0),
        overdueUsd: rows.reduce((s, r) => s + Number(r.overdue_usd ?? 0), 0),
        overdueCount: rows.reduce((s, r) => s + Number(r.overdue_count ?? 0), 0),
    };
}
```

- [ ] **Step 4: Lancer le test pour le voir passer**

Run: `cd frontend && npx vitest run src/services/reglementsService.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Écrire la page serveur**

Créer `frontend/src/app/(dashboard)/admin/reglements/page.tsx`, sur le patron exact de `admin/armateurs/page.tsx` mais avec la garde money-rail :

```tsx
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getReglementsSummary } from '@/services/reglementsService';
import { listArmateursCockpit } from '@/services/armateurService';
import { ReglementsDashboard } from './ReglementsDashboard';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['FINANCE_ADMIN', 'SUPERADMIN'];

export default async function ReglementsPage() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    if (!profile || !ALLOWED_ROLES.includes(profile.role)) redirect('/dashboard');

    const [summary, owners] = await Promise.all([
        getReglementsSummary(supabase),
        listArmateursCockpit(supabase),
    ]);
    const t = await getTranslations('AdminReglements');

    return (
        <div className="px-6 py-4">
            <h1 className="text-2xl font-semibold mb-2 text-[var(--os-text-primary)]">{t('title')}</h1>
            <p className="text-[var(--os-text-muted)] mb-6 text-sm">{t('subtitle')}</p>
            <ReglementsDashboard
                summary={summary}
                owners={owners.filter((o) => o.overdue_count > 0)}
            />
        </div>
    );
}
```

- [ ] **Step 6: Écrire le composant client**

Créer `frontend/src/app/(dashboard)/admin/reglements/ReglementsDashboard.tsx` :

```tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { OsCard, OsCardHeader } from '@/components/ui/OsCard';
import { OsTable, type OsColumn } from '@/components/ui/OsTable';
import { OsBadge } from '@/components/ui/OsBadge';
import { useClientSort } from '@/hooks/useClientSort';
import type { ReglementsSummary, Bucket } from '@/services/reglementsService';
import type { ArmateurCockpitRow } from '@/services/armateurService';

interface Props { summary: ReglementsSummary; owners: ArmateurCockpitRow[] }

const usd = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export function ReglementsDashboard({ summary, owners }: Props) {
    const t = useTranslations('AdminReglements');
    const router = useRouter();

    const windows: { label: string; invoiced: Bucket; collected: Bucket }[] = [
        { label: t('today'), invoiced: summary.invoicedToday, collected: summary.collectedToday },
        { label: t('week'),  invoiced: summary.invoicedWeek,  collected: summary.collectedWeek },
        { label: t('month'), invoiced: summary.invoicedMonth, collected: summary.collectedMonth },
    ];

    const columns: OsColumn<ArmateurCockpitRow>[] = React.useMemo(() => [
        {
            key: 'owner', header: t('col.owner'), sortable: true, sortValue: (o) => o.name,
            render: (o) => <span className="font-medium text-[var(--os-text-primary)]">{o.name}</span>,
        },
        {
            key: 'outstanding', header: t('col.outstanding'), className: 'text-right',
            sortable: true, sortValue: (o) => o.total_outstanding_usd,
            render: (o) => <span className="text-xs tabular-nums font-semibold">{usd(o.total_outstanding_usd)}</span>,
        },
        {
            key: 'overdue', header: t('col.overdue'), className: 'text-right',
            sortable: true, sortValue: (o) => o.overdue_count,
            render: (o) => <OsBadge variant="overdue" label={String(o.overdue_count)} />,
        },
        {
            key: 'tier', header: t('col.tier'),
            sortable: true, sortValue: (o) => o.last_auto_tier,
            render: (o) => o.last_auto_tier
                ? <OsBadge variant="warning" label={o.last_auto_tier} />
                : <span className="text-xs text-[var(--os-text-muted)]">—</span>,
        },
        {
            key: 'lastReminder', header: t('col.lastReminder'),
            sortable: true, sortValue: (o) => o.last_reminder_at,
            render: (o) => (
                <span className="text-xs text-[var(--os-text-muted)]">
                    {o.last_reminder_at ? new Date(o.last_reminder_at).toLocaleDateString() : '—'}
                </span>
            ),
        },
    ], [t]);

    const { sort, onSortChange, sortedRows } = useClientSort(owners, columns);

    return (
        <div className="flex flex-col gap-4">
            <OsCard>
                <OsCardHeader title={t('flowTitle')} subtitle={t('utcNote')} />
                <div className="grid grid-cols-[auto_1fr_1fr] gap-x-8 gap-y-3 text-sm">
                    <span />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] text-right">{t('invoiced')}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)] text-right">{t('collected')}</span>
                    {windows.map((w) => (
                        <React.Fragment key={w.label}>
                            <span className="text-[var(--os-text-secondary)]">{w.label}</span>
                            <span className="text-right tabular-nums">
                                {usd(w.invoiced.usd)}
                                <span className="ml-1.5 text-xs text-[var(--os-text-muted)]">({w.invoiced.count})</span>
                            </span>
                            <span className="text-right tabular-nums">
                                {usd(w.collected.usd)}
                                <span className="ml-1.5 text-xs text-[var(--os-text-muted)]">({w.collected.count})</span>
                            </span>
                        </React.Fragment>
                    ))}
                </div>
            </OsCard>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <OsCard>
                    <OsCardHeader title={t('totalOutstanding')} />
                    <p className="text-2xl font-bold tabular-nums text-[var(--os-text-primary)]">
                        {usd(summary.totalOutstandingUsd)}
                    </p>
                </OsCard>
                <OsCard>
                    <OsCardHeader title={t('overdue')} />
                    <p className="text-2xl font-bold tabular-nums text-[#EF4444]">{usd(summary.overdueUsd)}</p>
                    <p className="text-xs text-[var(--os-text-muted)] mt-1">
                        {t('overdueCount', { count: summary.overdueCount })}
                    </p>
                </OsCard>
            </div>

            <OsCard>
                <OsCardHeader title={t('toChase')} />
                <OsTable
                    columns={columns}
                    rows={sortedRows}
                    sort={sort}
                    onSortChange={onSortChange}
                    keyExtractor={(o) => o.id}
                    emptyMessage={t('empty')}
                    onRowClick={(o) => router.push('/admin/armateurs/' + o.id)}
                />
            </OsCard>
        </div>
    );
}
```

⚠️ Vérifier la signature réelle d'`OsCardHeader` avant usage (`grep -n "OsCardHeader" -A 6 frontend/src/components/ui/OsCard.tsx`) : si elle n'accepte pas `subtitle`, mettre la mention UTC dans un `<p>` sous l'en-tête.

- [ ] **Step 7: Ouvrir la route dans la nav et le RBAC**

Dans `frontend/src/lib/rbac.ts` :
- ajouter à `NAV_PERMISSIONS` : `'reglements': [UserRole.FINANCE_ADMIN, UserRole.SUPERADMIN],`
- ajouter `'reglements'` à `MONEY_RAIL_KEYS` — l'écran expose des totaux d'encaissement, il doit tomber sous le refus par défaut des clés inconnues ;
- mettre à jour le tableau ASCII de la matrice en tête de fichier (ligne `reglements`, section money rail).

Dans `DashboardSidebar.tsx`, ajouter à `NAV_ITEMS`, dans la section `admin`, juste avant `admin-invoices` :

```tsx
{ key: 'reglements', icon: <Banknote className="w-5 h-5" />, href: '/admin/reglements', labelKey: 'nav_reglements', section: 'admin' },
```

`Banknote` est déjà importé (utilisé par `cash-desk`).

- [ ] **Step 8: Ajouter les clés i18n dans les 6 locales**

Nouveau namespace `AdminReglements` : `title`, `subtitle`, `flowTitle`, `utcNote`, `today`, `week`, `month`, `invoiced`, `collected`, `totalOutstanding`, `overdue`, `overdueCount`, `toChase`, `col.owner`, `col.outstanding`, `col.overdue`, `col.tier`, `col.lastReminder`, `empty`. Plus la clé de nav `nav_reglements`, dans le namespace déjà utilisé par la sidebar (le repérer avec `grep -n "nav_admin_collections" messages/fr.json`).

`overdueCount` prend un paramètre : FR `"{count} factures en retard"`, EN `"{count} invoices overdue"`.

- [ ] **Step 9: Vérifier**

Run: `cd frontend && npx tsc --noEmit && npm test && npm run lint`

- [ ] **Step 10: Commit**

```bash
git add frontend/src/services/reglementsService.ts frontend/src/services/reglementsService.test.ts "frontend/src/app/(dashboard)/admin/reglements" frontend/src/lib/rbac.ts frontend/src/components/dashboard/layout/DashboardSidebar.tsx frontend/messages
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(recouvrement): tableau de bord des reglements"
```

---

# LOT 2 — Fiche armateur

### Task 6: Copies par armateur dans la cascade d'envoi

**Files:**
- Create: `supabase/migrations/122_shipowner_billing_cc.sql`
- Modify: `frontend/src/services/invoiceIssuanceService.ts`
- Modify: `frontend/src/services/invoiceIssuanceService.recipients.test.ts`
- Modify: `frontend/src/app/api/cron/collection-reminders/route.ts`
- Modify: `frontend/src/actions/escalateCollection.ts`

**Interfaces:**
- Produces: colonne `shipowners.billing_cc_emails TEXT[] NOT NULL DEFAULT '{}'` ; `InvoiceRecipientsInput` gagne `ownerCcEmails: string[]`.

- [ ] **Step 1: Écrire la migration**

Créer `supabase/migrations/122_shipowner_billing_cc.sql` :

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 122 : copies de facturation propres à l'armateur
--
-- Le destinataire principal reste official_email. Ces adresses viennent en
-- copie seulement. Défaut '{}' → aucun e-mail sortant ne change au déploiement.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.shipowners
  ADD COLUMN IF NOT EXISTS billing_cc_emails TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.shipowners.billing_cc_emails IS
  'Copies propres à l''armateur sur factures et relances. Destinataire principal = official_email.';

-- DOWN:
-- ALTER TABLE public.shipowners DROP COLUMN IF EXISTS billing_cc_emails;
```

- [ ] **Step 2: Écrire le test qui échoue**

Dans `frontend/src/services/invoiceIssuanceService.recipients.test.ts`, ajouter `ownerCcEmails: [] as string[]` à l'objet `base`, puis :

```ts
it("ajoute les copies propres à l'armateur, après l'agent", () => {
    expect(resolveInvoiceRecipients({
        ...base,
        shipownerBillingEmail: 'billing@armateur.com',
        agentEmail: 'agent@port.com',
        ownerCcEmails: ['finance@armateur.com', 'ops@armateur.com'],
        jurisdictionCcEmails: ['finance@somaliland.gov'],
    })).toEqual({
        to: 'billing@armateur.com',
        cc: ['agent@port.com', 'finance@armateur.com', 'ops@armateur.com', 'finance@somaliland.gov'],
    });
});

it('ne duplique pas une copie déjà destinataire principal', () => {
    expect(resolveInvoiceRecipients({
        ...base,
        shipownerBillingEmail: 'billing@armateur.com',
        ownerCcEmails: ['BILLING@armateur.com'],
    })).toEqual({ to: 'billing@armateur.com', cc: [] });
});
```

- [ ] **Step 3: Lancer le test pour le voir échouer**

Run: `cd frontend && npx vitest run src/services/invoiceIssuanceService.recipients.test.ts`
Expected: FAIL — la première assertion ne voit pas les copies armateur.

- [ ] **Step 4: Étendre la cascade**

Dans `invoiceIssuanceService.ts`, ajouter à `InvoiceRecipientsInput` :

```ts
/** Copies propres à l'armateur (shipowners.billing_cc_emails). */
ownerCcEmails: string[];
```

et insérer dans `candidates`, entre l'agent et les copies de juridiction :

```ts
const candidates = [
    cleanEmail(input.agentEmail),
    ...input.ownerCcEmails.map(cleanEmail),
    ...input.jurisdictionCcEmails.map(cleanEmail),
    cleanEmail(input.platformCcEmail),
];
```

Le dédoublonnage insensible à la casse déjà en place couvre le second test.

- [ ] **Step 5: Lancer le test pour le voir passer**

Run: `cd frontend && npx vitest run src/services/invoiceIssuanceService.recipients.test.ts`
Expected: PASS.

- [ ] **Step 6: Mettre à jour les trois appelants**

`ownerCcEmails` est **obligatoire** : le compilateur signale les trois sites.

1. `invoiceIssuanceService.ts` — élargir le `select` sur `shipowners` (ligne ~512) de `'official_email'` à `'official_email, billing_cc_emails'`, puis passer `ownerCcEmails: (shipowner?.billing_cc_emails as string[] | null) ?? []`.
2. `frontend/src/app/api/cron/collection-reminders/route.ts:111` — même élargissement du `select`, même passage.
3. `frontend/src/actions/escalateCollection.ts` — le `select` imbriqué sur `shipowner` récupère déjà `official_email` ; y ajouter `billing_cc_emails` et passer `ownerCcEmails: owner?.billing_cc_emails ?? []`.

- [ ] **Step 7: Vérifier**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: tout vert. Les suites d'`escalateCollection` et du cron ne changent pas de comportement (tableau vide = inerte).

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/122_shipowner_billing_cc.sql frontend/src/services/invoiceIssuanceService.ts frontend/src/services/invoiceIssuanceService.recipients.test.ts frontend/src/app/api/cron/collection-reminders/route.ts frontend/src/actions/escalateCollection.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(armateurs): copies de facturation propres a l'armateur"
```

---

### Task 7: Action `updateArmateurContacts`

**Files:**
- Create: `frontend/src/actions/updateArmateurContacts.ts`
- Create: `frontend/src/actions/updateArmateurContacts.test.ts`
- Delete: `frontend/src/actions/updateArmateurEmail.ts`

**Interfaces:**
- Consumes: `billing_cc_emails` (Task 6), `upsertShipownerEmail` (existant).
- Produces: `updateArmateurContacts(raw: unknown): Promise<{ ok: true } | { ok: false; reason: string }>` ; `normalizeCcEmails(list: string[], primary: string): string[]` (pure, exportée pour test).
- Remplace `updateArmateurEmail`, importée par `ArmateursCockpit.tsx` et `ArmateurDetail.tsx` (mis à jour en Task 8).

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/src/actions/updateArmateurContacts.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { normalizeCcEmails, MAX_CC_EMAILS } from './updateArmateurContacts';

describe('normalizeCcEmails', () => {
    it('met en minuscules, élague et déduplique', () => {
        expect(normalizeCcEmails(['  A@x.com ', 'a@X.com', 'b@x.com'], 'main@x.com'))
            .toEqual(['a@x.com', 'b@x.com']);
    });

    it("retire l'adresse déjà destinataire principal", () => {
        // Sans ce retrait, l'armateur recevrait deux fois le même e-mail.
        expect(normalizeCcEmails(['Main@x.com', 'b@x.com'], 'main@x.com')).toEqual(['b@x.com']);
    });

    it('écarte les entrées vides', () => {
        expect(normalizeCcEmails(['', '   ', 'b@x.com'], 'main@x.com')).toEqual(['b@x.com']);
    });

    it('plafonne la liste', () => {
        // Une liste de copie n'est pas une liste de diffusion.
        const many = Array.from({ length: MAX_CC_EMAILS + 5 }, (_, i) => `u${i}@x.com`);
        expect(normalizeCcEmails(many, 'main@x.com')).toHaveLength(MAX_CC_EMAILS);
    });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `cd frontend && npx vitest run src/actions/updateArmateurContacts.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Écrire l'action**

Créer `frontend/src/actions/updateArmateurContacts.ts` en repartant **intégralement** des gardes de `updateArmateurEmail.ts` (auth, rôle, résolution de la juridiction du shipowner via `createPlatformClient`, refus si `getServerJurisdictionId()` diffère pour un non-SUPERADMIN, écriture via `createTenantClient`).

```ts
'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient, createTenantClient } from '@/lib/supabase/tenant';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';
import { upsertShipownerEmail } from '@/services/shipownerService';

export const MAX_CC_EMAILS = 10;

const ALLOWED_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'] as const;

const schema = z.object({
    shipownerId: z.string().uuid(),
    officialEmail: z.email(),
    billingCcEmails: z.array(z.email()).default([]),
    opsEmail: z.email().nullable().default(null),
    financeEmail: z.email().nullable().default(null),
    phoneE164: z.string().trim().max(20).nullable().default(null),
    address: z.string().trim().max(500).nullable().default(null),
    preferredLanguage: z.string().trim().max(10).nullable().default(null),
    notes: z.string().trim().max(2000).nullable().default(null),
});

/**
 * Normalise la liste de copies : minuscules, élagage, déduplication, retrait de
 * l'adresse principale (sinon l'armateur recevrait deux fois le même e-mail),
 * et plafond — une liste de copie n'est pas une liste de diffusion.
 */
export function normalizeCcEmails(list: string[], primary: string): string[] {
    const seen = new Set<string>([primary.trim().toLowerCase()]);
    const out: string[] = [];
    for (const raw of list) {
        const email = raw.trim().toLowerCase();
        if (!email || seen.has(email)) continue;
        seen.add(email);
        out.push(email);
        if (out.length >= MAX_CC_EMAILS) break;
    }
    return out;
}

export type UpdateArmateurContactsResult = { ok: true } | { ok: false; reason: string };

export async function updateArmateurContacts(raw: unknown): Promise<UpdateArmateurContactsResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }
    const input = parsed.data;

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles').select('role, full_name').eq('id', auth.user.id).single();
    if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
        return { ok: false, reason: 'insufficient role' };
    }

    const platform = createPlatformClient();
    const { data: owner, error: ownerErr } = await platform
        .from('shipowners').select('id, jurisdiction_id').eq('id', input.shipownerId).single();
    if (ownerErr || !owner) return { ok: false, reason: 'shipowner not found' };

    const jurisdictionId = (owner as { jurisdiction_id: string }).jurisdiction_id;
    if (profile.role !== 'SUPERADMIN') {
        const adminJurisdictionId = await getServerJurisdictionId();
        if (adminJurisdictionId !== jurisdictionId) {
            return { ok: false, reason: 'forbidden: shipowner belongs to another jurisdiction' };
        }
    }

    const officialEmail = input.officialEmail.trim().toLowerCase();
    const admin = createTenantClient(jurisdictionId);

    try {
        // L'e-mail officiel passe TOUJOURS par upsertShipownerEmail : c'est lui qui
        // porte la comparaison de tiers de confiance. Un staff écrit en PORT_OFFICER
        // (confiance 3, la plus haute) — jamais refusé silencieusement.
        await upsertShipownerEmail(admin, input.shipownerId, officialEmail, 'PORT_OFFICER');

        const { error: updErr } = await admin.from('shipowners').update({
            billing_cc_emails: normalizeCcEmails(input.billingCcEmails, officialEmail),
            ops_email: input.opsEmail,
            finance_email: input.financeEmail,
            phone_e164: input.phoneE164,
            address: input.address,
            preferred_language: input.preferredLanguage,
            notes: input.notes,
        }).eq('id', input.shipownerId);
        if (updErr) return { ok: false, reason: updErr.message };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : 'update failed' };
    }

    // Trace les CHAMPS modifiés, pas leurs valeurs : ce sont des données personnelles.
    await platform.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: profile.full_name ?? auth.user.email ?? 'Staff',
        action: 'SHIPOWNER_UPDATED', severity: 'INFO',
        entity_type: 'Shipowner', entity_id: input.shipownerId,
        jurisdiction_id: jurisdictionId,
        details_json: { event: 'CONTACTS_UPDATED', fields: Object.keys(input).filter((k) => k !== 'shipownerId') },
    });

    revalidatePath('/admin/armateurs');
    revalidatePath(`/admin/armateurs/${input.shipownerId}`);
    return { ok: true };
}
```

⚠️ Vérifier que `'SHIPOWNER_UPDATED'` existe bien dans l'énumération `audit_action` avant de committer :
`grep -rn "SHIPOWNER_UPDATED" supabase/migrations/`. Si absent, utiliser la valeur générique déjà employée par `escalateCollection` (`'TRANSACTION_UPDATED'` y est utilisée pour une transaction) — chercher l'équivalent armateur avec `grep -rn "CREATE TYPE public.audit_action" -A 30 supabase/migrations/` et prendre une valeur existante. **Ne pas ajouter de valeur d'enum ici** : ce serait une migration non prévue au plan.

- [ ] **Step 4: Lancer le test pour le voir passer**

Run: `cd frontend && npx vitest run src/actions/updateArmateurContacts.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Supprimer l'ancienne action**

```bash
git rm frontend/src/actions/updateArmateurEmail.ts
```

La compilation va casser sur `ArmateursCockpit.tsx` et `ArmateurDetail.tsx` : c'est attendu, la Task 8 les reprend. Pour garder l'arbre compilable entre les deux tâches, remplacer dans `ArmateursCockpit.tsx` l'import et l'appel par `updateArmateurContacts({ shipownerId, officialEmail: emailValue, billingCcEmails: [] })` — la boîte de dialogue d'édition rapide du cockpit ne gère que l'e-mail principal, et c'est très bien ainsi : l'édition complète vit dans la fiche.

- [ ] **Step 6: Vérifier**

Run: `cd frontend && npx tsc --noEmit && npm test && npm run lint`

- [ ] **Step 7: Commit**

```bash
git add frontend/src/actions/updateArmateurContacts.ts frontend/src/actions/updateArmateurContacts.test.ts "frontend/src/app/(dashboard)/admin/armateurs/ArmateursCockpit.tsx"
git rm --cached frontend/src/actions/updateArmateurEmail.ts 2>/dev/null || true
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(armateurs): edition des contacts et des copies de facturation"
```

---

### Task 8: Fiche armateur — contacts éditables, totaux, échéances

**Files:**
- Modify: `frontend/src/services/armateurService.ts`
- Modify: `frontend/src/services/armateurService.test.ts`
- Modify: `frontend/src/app/(dashboard)/admin/armateurs/[id]/ArmateurDetail.tsx`
- Modify: `messages/{fr,en,ar,pt,so,sw}.json`

**Interfaces:**
- Consumes: `updateArmateurContacts` (Task 7), `useClientSort` (Task 2), colonnes mig 121 (Task 1).
- Produces: `ArmateurDetail` gagne `billing_cc_emails: string[]` et `totals: { invoicedUsd, paidUsd, outstandingUsd, overdueCount, nextDueDate }` ; `ArmateurProformaRow` gagne `due_date: string | null` et `collections_status: string | null`.

- [ ] **Step 1: Écrire le test qui échoue**

Dans `frontend/src/services/armateurService.test.ts`, ajouter au bloc `getArmateurDetail` un test vérifiant que `due_date` et `collections_status` sont remontés sur les pro-formas et que `totals` est calculé. Mocker la ligne `v_armateur_recouvrement` pour l'armateur.

```ts
it('remonte échéance, statut de recouvrement et totaux de compte', async () => {
    // due_date et collections_status existent depuis la mig 022 mais
    // n'étaient jamais lus — c'est la régression que ce test verrouille.
    const detail = await getArmateurDetail(dbWith({
        shipowner: { id: 'own-1', name: 'ACME', account_state: 'ACTIVE', billing_cc_emails: ['f@x.com'] },
        transactions: [{
            id: 'tx1', invoice_ref: 'INV-1', created_at: '2026-07-01T00:00:00Z',
            tax_amount_usd: '500', partial_paid_usd: '100', status: 'OVERDUE',
            due_date: '2026-07-31T00:00:00Z', collections_status: 'OVERDUE',
        }],
        recouvrement: {
            total_invoiced_usd: '500', total_paid_usd: '100', total_outstanding_usd: '400',
            overdue_count: '1', next_due_date: '2026-07-31T00:00:00Z',
        },
    }), 'own-1', true);
    expect(detail?.proformas[0].due_date).toBe('2026-07-31T00:00:00Z');
    expect(detail?.proformas[0].collections_status).toBe('OVERDUE');
    expect(detail?.totals).toMatchObject({ outstandingUsd: 400, overdueCount: 1 });
    expect(detail?.billing_cc_emails).toEqual(['f@x.com']);
});
```

`dbWith` est un faux **distinct** de `makeDb` (Task 3) : `makeDb` sert `listArmateursCockpit`, qui n'interroge qu'une table, alors que `getArmateurDetail` en interroge six. `dbWith` doit router `from('shipowners')`, `from('vessels')`, `from('transactions')`, `from('payments')`, `from('collection_reminders')` et `from('v_armateur_recouvrement')` vers des jeux distincts. S'il existe déjà un faux multi-tables dans ce fichier, l'étendre au lieu d'en créer un second.

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `cd frontend && npx vitest run src/services/armateurService.test.ts`
Expected: FAIL — `due_date` indéfini.

- [ ] **Step 3: Étendre `getArmateurDetail`**

- Ajouter `due_date, collections_status` au `select` sur `transactions` et les deux champs à `ArmateurProformaRow` + au mapping.
- Ajouter `billing_cc_emails: (row.billing_cc_emails as string[] | null) ?? []`.
- Ajouter une requête `v_armateur_recouvrement` (dans le `Promise.all` existant) et en dériver `totals`, avec un repli à zéro si la ligne est absente.

- [ ] **Step 4: Lancer le test pour le voir passer**

Run: `cd frontend && npx vitest run src/services/armateurService.test.ts`
Expected: PASS.

- [ ] **Step 5: Refondre la fiche**

Dans `ArmateurDetail.tsx` :

1. **Carte totaux** en tête (après le bandeau de sanctions) : facturé / payé / dû / en retard / prochaine échéance, en réutilisant le composant `Field` déjà défini en bas du fichier.
2. **Carte contacts éditable** : remplacer la boîte de dialogue « modifier l'e-mail » par un formulaire couvrant `officialEmail`, `billingCcEmails` (liste avec ajout/retrait), `opsEmail`, `financeEmail`, `phoneE164`, `address`, `preferredLanguage`, `notes`. Étiqueter explicitement : `officialEmail` = « destinataire des factures et relances » ; `opsEmail`/`financeEmail` = « information seulement, non utilisés pour l'envoi ». Soumission via `updateArmateurContacts` dans un `useTransition`, puis `router.refresh()`.
3. **Tableau des pro-formas** : ajouter une colonne « échéance » (`due_date`, badge `overdue` si `collections_status === 'OVERDUE'`) et une colonne « âge » en jours ; marquer `sortable: true` + `sortValue` sur date, montant, dû et échéance ; brancher `useClientSort`.
4. **Tableaux paiements et navires** : `sortable` + `sortValue` sur les colonnes chiffrées et de date, même branchement.

- [ ] **Step 6: Ajouter les clés i18n dans les 6 locales**

Dans `AdminArmateurs` : `detail.totalsTitle`, `detail.invoiced`, `detail.paid`, `detail.outstanding`, `detail.overdueCount`, `detail.nextDueDate`, `detail.contactsTitle`, `detail.billingCc`, `detail.billingCcHint`, `detail.addCc`, `detail.infoOnlyHint`, `col.dueDate`, `col.age`.

- [ ] **Step 7: Vérifier**

Run: `cd frontend && npx tsc --noEmit && npm test && npm run lint`

- [ ] **Step 8: Commit**

```bash
git add frontend/src/services/armateurService.ts frontend/src/services/armateurService.test.ts "frontend/src/app/(dashboard)/admin/armateurs/[id]/ArmateurDetail.tsx" frontend/messages
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(armateurs): totaux de compte, echeances et contacts editables sur la fiche"
```

---

### Task 9: Représentants dans la fiche

**Files:**
- Modify: `frontend/src/services/armateurService.ts`
- Modify: `frontend/src/services/armateurService.test.ts`
- Modify: `frontend/src/app/(dashboard)/admin/armateurs/[id]/ArmateurDetail.tsx`
- Modify: `messages/{fr,en,ar,pt,so,sw}.json`

**Interfaces:**
- Consumes: `createOwnerAgentMapping`, `deactivateOwnerAgentMapping` (existants).
- Produces: `ArmateurDetail` gagne `representatives: ArmateurRepresentativeRow[]` avec `{ id, profile_id, full_name, email, priority, active, valid_from, valid_until }`.

- [ ] **Step 1: Écrire le test qui échoue**

```ts
it('remonte les représentants actifs par priorité croissante', async () => {
    const detail = await getArmateurDetail(dbWith({
        shipowner: { id: 'own-1', name: 'ACME', account_state: 'ACTIVE' },
        mappings: [
            { id: 'm2', agent_profile_id: 'p2', priority: 200, active: true,
              valid_from: '2026-01-01', valid_until: null,
              profiles: { full_name: 'Second', email: 'b@x.com' } },
            { id: 'm1', agent_profile_id: 'p1', priority: 100, active: true,
              valid_from: '2026-01-01', valid_until: null,
              profiles: { full_name: 'Premier', email: 'a@x.com' } },
        ],
    }), 'own-1', true);
    // La priorité la plus basse est le contact principal : c'est lui qui part
    // en copie des factures via la cascade d'envoi.
    expect(detail?.representatives.map((r) => r.full_name)).toEqual(['Premier', 'Second']);
    expect(detail?.representatives[0].email).toBe('a@x.com');
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `cd frontend && npx vitest run src/services/armateurService.test.ts`
Expected: FAIL — `representatives` indéfini.

- [ ] **Step 3: Étendre le service**

Ajouter au `Promise.all` :

```ts
db.from('owner_agent_mappings')
  .select('id, agent_profile_id, priority, active, valid_from, valid_until, profiles!inner(full_name, email)')
  .eq('shipowner_id', id)
  .order('priority', { ascending: true }),
```

et mapper vers `ArmateurRepresentativeRow`. PostgREST peut renvoyer la relation `profiles` en objet **ou** en tableau selon la cardinalité inférée : normaliser avec le patron déjà employé dans `escalateCollection.ts:84` — `const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;`.

- [ ] **Step 4: Lancer le test pour le voir passer**

Run: `cd frontend && npx vitest run src/services/armateurService.test.ts`
Expected: PASS.

- [ ] **Step 5: Ajouter la carte « Représentants »**

Dans `ArmateurDetail.tsx`, une `OsCard` avec un `OsTable` : nom, e-mail, priorité, période de validité, statut. Le premier représentant actif porte une mention « reçoit copie des factures » — c'est ce que fait la cascade d'envoi, et le gestionnaire doit pouvoir le constater.

Boutons : rattacher (via `createOwnerAgentMapping`) et révoquer (via `deactivateOwnerAgentMapping`), plus un lien vers `/admin/owner-agent-mappings` pour la gestion de masse.

- [ ] **Step 6: Ajouter les clés i18n dans les 6 locales**

`detail.representativesTitle`, `detail.noRepresentatives`, `detail.repPrimary`, `detail.repAttach`, `detail.repRevoke`, `detail.repManageAll`, `col.priority`, `col.validity`.

- [ ] **Step 7: Vérifier**

Run: `cd frontend && npx tsc --noEmit && npm test && npm run lint`

- [ ] **Step 8: Commit**

```bash
git add frontend/src/services/armateurService.ts frontend/src/services/armateurService.test.ts "frontend/src/app/(dashboard)/admin/armateurs/[id]/ArmateurDetail.tsx" frontend/messages
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(armateurs): representants visibles et rattachables depuis la fiche"
```

---

# LOT 3 — Envois

### Task 10: Migrations 123 et 124 — palier `MANUAL`

**Files:**
- Create: `supabase/migrations/123_reminder_tier_manual.sql`
- Create: `supabase/migrations/124_manual_reminders_index_and_view.sql`

**Interfaces:**
- Produces: valeur d'enum `reminder_tier.MANUAL` ; `idx_creminders_txn_tier` devient partiel ; `v_collection_admin` gagne `manual_count` et `last_manual_at`, et son `latest_tier` ignore `MANUAL`.

⚠️ **Deux fichiers, jamais un seul.** `ALTER TYPE ... ADD VALUE` ne peut pas cohabiter avec un **usage** de la valeur dans la même transaction. L'index partiel et la vue référencent littéralement `'MANUAL'`. Les fusionner casse le déploiement. Le patron est documenté dans la mig 110.

- [ ] **Step 1: Écrire la migration 123**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 123 : palier de relance MANUAL — la valeur d'enum, SEULE.
--
-- Les usages (index partiel, vue) vivent en 124 : ADD VALUE ne peut pas
-- cohabiter avec un usage de la valeur dans la même transaction.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TYPE public.reminder_tier ADD VALUE IF NOT EXISTS 'MANUAL';

-- DOWN: aucun — Postgres ne supporte pas DROP VALUE sur un enum.
```

- [ ] **Step 2: Écrire la migration 124**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 124 : usages du palier MANUAL.
--
-- L'unicité (transaction_id, tier) porte l'idempotence du cron : elle reste
-- entière sur les paliers automatiques et ne s'applique pas aux relances
-- manuelles, répétables par nature.
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS public.idx_creminders_txn_tier;
CREATE UNIQUE INDEX IF NOT EXISTS idx_creminders_txn_tier
  ON public.collection_reminders(transaction_id, tier)
  WHERE tier <> 'MANUAL';

CREATE INDEX IF NOT EXISTS idx_creminders_manual
  ON public.collection_reminders(transaction_id, sent_at DESC)
  WHERE tier = 'MANUAL';

-- v_collection_admin v2 : latest_tier redevient le dernier palier LÉGAL.
-- Sans ce filtre, une relance manuelle du jour afficherait « MANUAL » à la
-- place de « J15 » et masquerait où en est réellement la rampe.
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
  cr.latest_response_at,
  cr.manual_count,
  cr.last_manual_at
FROM public.transactions t
JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE r.tier <> 'MANUAL')                                    AS reminder_count,
    (array_agg(r.tier ORDER BY r.sent_at DESC)
       FILTER (WHERE r.tier <> 'MANUAL'))[1]                                      AS latest_tier,
    max(r.sent_at) FILTER (WHERE r.tier <> 'MANUAL')                              AS latest_sent_at,
    (array_agg(r.debtor_response_type ORDER BY r.sent_at DESC))[1]                AS latest_response_type,
    (array_agg(r.debtor_response_at   ORDER BY r.sent_at DESC))[1]                AS latest_response_at,
    count(*) FILTER (WHERE r.tier = 'MANUAL')                                     AS manual_count,
    max(r.sent_at) FILTER (WHERE r.tier = 'MANUAL')                               AS last_manual_at
  FROM public.collection_reminders r
  WHERE r.transaction_id = t.id
) cr ON cr.reminder_count > 0 OR cr.manual_count > 0
LEFT JOIN public.shipowners   s ON s.id = t.shipowner_id
LEFT JOIN public.jurisdictions j ON j.id = t.jurisdiction_id;

GRANT SELECT ON public.v_collection_admin TO authenticated, service_role;

-- DOWN: restaurer v_collection_admin dans sa forme mig 111 et recréer
-- idx_creminders_txn_tier sans clause WHERE.
```

Le `ON cr.reminder_count > 0 OR cr.manual_count > 0` est un élargissement volontaire : une créance relancée **uniquement** à la main doit apparaître sur l'écran collections. Sans ce `OR`, elle en serait absente alors même qu'un gestionnaire vient d'agir dessus.

- [ ] **Step 3: Relire les deux fichiers**

Vérifier que 123 ne contient **que** l'`ALTER TYPE`, que 124 ne contient **aucun** `ALTER TYPE`, et que les 17 colonnes de la vue mig 111 sont présentes dans le même ordre avant les 2 nouvelles.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/123_reminder_tier_manual.sql supabase/migrations/124_manual_reminders_index_and_view.sql
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(recouvrement): palier de relance MANUAL hors rampe"
```

---

### Task 11: Action `sendManualReminder`

**Files:**
- Create: `frontend/src/actions/sendManualReminder.ts`
- Create: `frontend/src/actions/sendManualReminder.test.ts`
- Modify: `frontend/src/services/emailService.ts`
- Modify: `frontend/src/services/emailService.reminder.test.ts`

**Interfaces:**
- Consumes: `resolveInvoiceRecipients` avec `ownerCcEmails` (Task 6), palier `MANUAL` (Task 10).
- Produces: `sendManualReminder(raw: unknown): Promise<{ ok: true } | { ok: false; reason: string }>` ; `ProformaReminderParams` gagne `pdfBuffer?: Uint8Array`.

- [ ] **Step 1: Écrire le test qui échoue (pièce jointe optionnelle)**

Dans `frontend/src/services/emailService.reminder.test.ts` :

```ts
it('joint le PDF quand il est fourni', async () => {
    const sent = await captureSend(() => sendProformaReminderEmail({
        to: 'a@x.com', recipientName: 'ACME', invoiceRef: 'INV-1',
        amountUsd: 500, ageDays: 12, pdfBuffer: new Uint8Array([1, 2, 3]),
    }));
    expect(sent.attachments).toHaveLength(1);
});

it("n'envoie aucune pièce jointe quand le PDF est absent", async () => {
    // Un rappel de courtoisie n'est pas une notice légale : l'absence de PDF
    // ne doit pas bloquer l'envoi.
    const sent = await captureSend(() => sendProformaReminderEmail({
        to: 'a@x.com', recipientName: 'ACME', invoiceRef: 'INV-1',
        amountUsd: 500, ageDays: 12,
    }));
    expect(sent.attachments).toBeUndefined();
});
```

Reprendre le mécanisme de capture déjà utilisé dans ce fichier pour les autres assertions d'envoi (mock du transport). S'il n'existe pas, le calquer sur `emailService.escalation.test.ts`, qui teste déjà un envoi avec pièce jointe.

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `cd frontend && npx vitest run src/services/emailService.reminder.test.ts`
Expected: FAIL — `pdfBuffer` n'est pas dans le type.

- [ ] **Step 3: Rendre la pièce jointe optionnelle**

Dans `emailService.ts`, ajouter à `ProformaReminderParams` :

```ts
/** PDF de la pro-forma, joint quand il est disponible. Absent = envoi quand même. */
pdfBuffer?: Uint8Array;
```

et dans `sendProformaReminderEmail`, passer à `sendEmail` :

```ts
attachments: p.pdfBuffer
    ? [{ filename: `${p.invoiceRef}.pdf`, content: Buffer.from(p.pdfBuffer) }]
    : undefined,
```

en calquant la forme exacte de `attachments` sur `sendCollectionEscalationEmail`, qui en produit déjà.

- [ ] **Step 4: Lancer le test pour le voir passer**

Run: `cd frontend && npx vitest run src/services/emailService.reminder.test.ts`
Expected: PASS.

- [ ] **Step 5: Écrire l'action**

Créer `frontend/src/actions/sendManualReminder.ts`, structuré **exactement** comme `escalateCollection.ts` (mêmes gardes, même ordre des étapes), avec ces différences assumées :

- statut accepté : `PENDING | OVERDUE | PARTIALLY_PAID` (au lieu de la rampe) ;
- vérification `document_type === 'PROFORMA' && mode === 'MARITIME'` ;
- **pas** de contrôle de rampe — c'est tout l'intérêt du palier `MANUAL` ;
- PDF **optionnel** : si `invoice_pdf_url` est absent ou le téléchargement échoue, on envoie sans pièce jointe au lieu d'abandonner ;
- appel : `sendProformaReminderEmail({ to, cc, recipientName, invoiceRef, amountUsd, ageDays, pdfBuffer })` **sans `tier`** — la fonction retombe alors sur son ton courtois générique, exactement le registre voulu pour un geste humain hors procédure ;
- échec d'envoi ⇒ `return { ok: false, reason }` **sans aucune écriture** ;
- succès ⇒ `audit_logs` (`severity: 'INFO'`, `details_json.event = 'MANUAL_REMINDER_SENT'`) puis insert `collection_reminders` :

```ts
await platform.from('collection_reminders').insert({
    transaction_id: transactionId,
    tier: 'MANUAL',
    sent_at: new Date().toISOString(),
    sent_email: recipients.to,
    cc_emails: recipients.cc,
    template_used: 'manual_reminder',
    escalated_bailiff: false,
    debtor_response_type: 'SILENT',
});
```

`ageDays` se calcule comme dans `statementService.ts:31` :
`Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000))`.

- [ ] **Step 6: Écrire les tests de l'action**

Créer `frontend/src/actions/sendManualReminder.test.ts` en calquant `escalateCollection.test.ts`. Cas obligatoires :

1. rôle insuffisant ⇒ `{ ok: false }` ;
2. transaction d'une autre juridiction, appelant non-SUPERADMIN ⇒ refus ;
3. statut `PAID` ⇒ refus explicite ;
4. aucun destinataire joignable ⇒ refus, **aucun** insert (c'est le cas de `arm-014`, 83 pro-formas sans `official_email`) ;
5. échec d'envoi ⇒ **aucune** ligne `collection_reminders` ;
6. succès ⇒ une ligne `tier: 'MANUAL'`, `template_used: 'manual_reminder'` ;
7. **deux envois successifs sur la même facture ⇒ deux lignes** (l'index partiel de la mig 124 ne bloque pas) ;
8. PDF absent ⇒ envoi effectué sans pièce jointe, pas de refus.

- [ ] **Step 7: Écrire le test de non-régression de la rampe**

Dans `frontend/src/services/collectionReminderService.test.ts` :

```ts
it("une relance MANUAL ne consomme aucun palier de la rampe", () => {
    // Le cron filtre sentTiers sur une liste blanche : MANUAL en est écarté
    // d'office. Ce test verrouille cette immunité.
    expect(dueTier({
        status: 'OVERDUE', ageDays: 20,
        sentTiers: ['J3', 'J7'],       // MANUAL n'entre jamais dans ce tableau
        latestResponse: null, latestResponseAt: null, now: new Date(),
    })).toBe('J15');
});
```

- [ ] **Step 8: Lancer la suite**

Run: `cd frontend && npx tsc --noEmit && npm test && npm run lint`

- [ ] **Step 9: Commit**

```bash
git add frontend/src/actions/sendManualReminder.ts frontend/src/actions/sendManualReminder.test.ts frontend/src/services/emailService.ts frontend/src/services/emailService.reminder.test.ts frontend/src/services/collectionReminderService.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(recouvrement): relance manuelle d'une facture"
```

---

### Task 12: Action `sendConsolidatedRecap`

**Files:**
- Create: `frontend/src/actions/sendConsolidatedRecap.ts`
- Create: `frontend/src/actions/sendConsolidatedRecap.test.ts`
- Modify: `frontend/src/services/statementService.ts`
- Modify: `frontend/src/services/statementService.test.ts`
- Modify: `frontend/src/services/emailService.ts`
- Create: `frontend/src/services/emailService.recap.test.ts`

**Interfaces:**
- Consumes: `composeOwnerStatement` (existant), le générateur PDF de relevé (existant), palier `MANUAL` (Task 10).
- Produces: `currentMonthBounds(now: Date): { periodStart: Date; periodEnd: Date; label: string }` ; `sendCollectionRecapEmail(p: CollectionRecapParams): Promise<EmailResult>` ; `sendConsolidatedRecap(raw: unknown)`.

- [ ] **Step 1: Écrire le test qui échoue**

Dans `frontend/src/services/statementService.test.ts` :

```ts
import { currentMonthBounds } from './statementService';

describe('currentMonthBounds', () => {
    it('borne le mois EN COURS, du 1er à maintenant', () => {
        // periodBounds() vise le mois ÉCOULÉ et reste réservé au cron mensuel.
        // Un récap envoyé à la main doit refléter le mois en cours.
        const now = new Date('2026-08-20T14:30:00Z');
        const b = currentMonthBounds(now);
        expect(b.periodStart.toISOString()).toBe('2026-08-01T00:00:00.000Z');
        expect(b.periodEnd.toISOString()).toBe('2026-08-20T14:30:00.000Z');
        expect(b.label).toBe('August 2026');
    });

    it('gère le 1er du mois', () => {
        const b = currentMonthBounds(new Date('2026-09-01T00:05:00Z'));
        expect(b.periodStart.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `cd frontend && npx vitest run src/services/statementService.test.ts`
Expected: FAIL — `currentMonthBounds` non exportée.

- [ ] **Step 3: Écrire le helper**

Dans `statementService.ts`, à côté de `periodBounds` :

```ts
/**
 * Bornes du mois EN COURS : [1er du mois, maintenant]. Pour un récap envoyé à la
 * demande. `periodBounds` vise le mois écoulé et reste réservé au cron mensuel.
 */
export function currentMonthBounds(now: Date): { periodStart: Date; periodEnd: Date; label: string } {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const periodStart = new Date(Date.UTC(y, m, 1));
    return { periodStart, periodEnd: new Date(now.getTime()), label: `${MONTHS[m]} ${y}` };
}
```

- [ ] **Step 4: Lancer le test pour le voir passer**

Run: `cd frontend && npx vitest run src/services/statementService.test.ts`
Expected: PASS.

- [ ] **Step 5: Écrire l'e-mail de récapitulatif**

Dans `emailService.ts`, ajouter `CollectionRecapParams` et `sendCollectionRecapEmail`, calqués sur `sendStatementReadyEmail` mais avec un ton recouvrement :

```ts
export interface CollectionRecapParams {
    to: string;
    cc?: string[];
    recipientName: string;
    lines: { invoiceRef: string; vesselName: string; issuedAt: string; ageDays: number; outstandingUsd: number }[];
    totalOutstandingUsd: number;
    jurisdictionName: string;
    pdfBuffer: Uint8Array;
}
```

Le corps liste les factures ouvertes (référence, navire, âge, reste dû), affiche le total, et joint le PDF. Distinct de `sendStatementReadyEmail`, qui annonce un relevé mensuel informatif et renvoie au portail : mélanger les deux brouillerait le message.

Créer `frontend/src/services/emailService.recap.test.ts` : sujet contenant la référence au total, PDF joint, `cc` propagé.

- [ ] **Step 6: Écrire l'action**

Créer `frontend/src/actions/sendConsolidatedRecap.ts` :

1. mêmes gardes que `sendManualReminder`, isolation de juridiction sur la ligne `shipowners` ;
2. `const { periodStart, periodEnd } = currentMonthBounds(now)` puis `composeOwnerStatement(admin, { shipownerId, periodStart, periodEnd, now })` ;
3. `if (result.openLines.length === 0) return { ok: false, reason: 'nothing outstanding' };` — on n'envoie pas un récapitulatif vide ;
4. générer le PDF **en mémoire** avec `generateStatementPdf` (`frontend/src/services/invoiceService.ts:750`), qui prend un `StatementData` (`invoiceService.ts:740`) et rend un `Uint8Array` :

```ts
const pdfBuffer = await generateStatementPdf({
    ownerName: owner.name,
    jurisdiction: jurisdictionName,
    periodLabel: label,
    openLines: result.openLines,
    payments: result.payments,
    totalOutstandingUsd: result.totalOutstandingUsd,
    paymentsInMonthUsd: result.paymentsInMonthUsd,
});
```

**Aucune** écriture dans `owner_statements`, **aucun** objet dans `statements/` ;
5. résoudre les destinataires (cascade + `billing_cc_emails` + CC juridiction + CC plateforme) ; aucun destinataire ⇒ refus ;
6. `sendCollectionRecapEmail` ; échec ⇒ refus **sans écriture** ;
7. succès ⇒ `audit_logs` sur l'armateur, puis **un seul insert groupé** de `collection_reminders` — une ligne par facture incluse, toutes avec le **même** `sentAt` :

```ts
const sentAt = new Date().toISOString();
const rows = openTransactionIds.map((transactionId) => ({
    transaction_id: transactionId,
    tier: 'MANUAL' as const,
    sent_at: sentAt,                 // identique sur toutes les lignes : c'est la clé de regroupement
    sent_email: recipients.to,
    cc_emails: recipients.cc,
    template_used: 'manual_recap',
    escalated_bailiff: false,
    debtor_response_type: 'SILENT' as const,
}));
await platform.from('collection_reminders').insert(rows);
```

`composeOwnerStatement` ne renvoie pas les identifiants de transaction. Ajouter `transactionId: string` à `StatementLine` (`frontend/src/services/invoiceService.ts:734`), ajouter `id` au `select` de `composeOwnerStatement` (`statementService.ts:47`) et le mapper. Une ligne de relevé qui ne sait pas de quelle transaction elle vient est une lacune du modèle, pas une commodité manquante.

⚠️ `generateStatementPdf` itère sur `openLines` : vérifier qu'y ajouter un champ ne casse pas son rendu (il lit des propriétés nommées, pas des positions). Le test `frontend/src/services/statementPdf.test.ts` doit rester vert.

- [ ] **Step 7: Écrire les tests de l'action**

Cas obligatoires : rôle insuffisant ; autre juridiction ; **zéro facture ouverte ⇒ refus** ; aucun destinataire ⇒ refus sans écriture ; échec d'envoi ⇒ aucune écriture ; succès ⇒ N lignes `MANUAL` partageant le même `sent_at` et `template_used: 'manual_recap'` ; **aucune** écriture dans `owner_statements` (assertion explicite — c'est la décision de conception qui protège le relevé mensuel).

- [ ] **Step 8: Vérifier**

Run: `cd frontend && npx tsc --noEmit && npm test && npm run lint`

- [ ] **Step 9: Commit**

```bash
git add frontend/src/actions/sendConsolidatedRecap.ts frontend/src/actions/sendConsolidatedRecap.test.ts frontend/src/services/statementService.ts frontend/src/services/statementService.test.ts frontend/src/services/emailService.ts frontend/src/services/emailService.recap.test.ts frontend/src/services/invoiceService.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(recouvrement): recapitulatif consolide envoye a la demande"
```

---

### Task 13: Surfaces d'appel et regroupement des relances manuelles

**Files:**
- Modify: `frontend/src/app/(dashboard)/admin/armateurs/[id]/ArmateurDetail.tsx`
- Modify: `frontend/src/app/(dashboard)/admin/reglements/ReglementsDashboard.tsx`
- Modify: `frontend/src/app/(dashboard)/admin/collections/CollectionsAdminList.tsx`
- Create: `frontend/src/lib/groupManualReminders.ts`
- Create: `frontend/src/lib/groupManualReminders.test.ts`
- Modify: `messages/{fr,en,ar,pt,so,sw}.json`

**Interfaces:**
- Consumes: `sendManualReminder` (Task 11), `sendConsolidatedRecap` (Task 12).
- Produces: `groupManualReminders(rows)` → replie les lignes `MANUAL` partageant `(sent_at, template_used)` en une entrée `{ kind: 'group', sentAt, templateUsed, count }`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/src/lib/groupManualReminders.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { groupManualReminders } from './groupManualReminders';

describe('groupManualReminders', () => {
    it('replie un récap consolidé en une seule entrée', () => {
        // arm-014 porte 83 pro-formas : un récap y produit 83 lignes, qui
        // noieraient la timeline si on les affichait une par une.
        const rows = Array.from({ length: 83 }, (_, i) => ({
            id: `r${i}`, tier: 'MANUAL', sent_at: '2026-08-20T10:00:00Z',
            template_used: 'manual_recap', debtor_response_type: 'SILENT', escalated_bailiff: false,
        }));
        const out = groupManualReminders(rows);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ kind: 'group', count: 83, templateUsed: 'manual_recap' });
    });

    it('laisse les paliers automatiques intacts', () => {
        const rows = [
            { id: 'a', tier: 'J3', sent_at: '2026-08-01T10:00:00Z', template_used: 'courtesy', debtor_response_type: 'SILENT', escalated_bailiff: false },
            { id: 'b', tier: 'J7', sent_at: '2026-08-05T10:00:00Z', template_used: 'courtesy', debtor_response_type: 'SILENT', escalated_bailiff: false },
        ];
        expect(groupManualReminders(rows)).toHaveLength(2);
    });

    it('ne fusionne pas deux relances manuelles envoyées séparément', () => {
        const rows = [
            { id: 'a', tier: 'MANUAL', sent_at: '2026-08-20T10:00:00Z', template_used: 'manual_reminder', debtor_response_type: 'SILENT', escalated_bailiff: false },
            { id: 'b', tier: 'MANUAL', sent_at: '2026-08-21T10:00:00Z', template_used: 'manual_reminder', debtor_response_type: 'SILENT', escalated_bailiff: false },
        ];
        expect(groupManualReminders(rows)).toHaveLength(2);
    });
});
```

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `cd frontend && npx vitest run src/lib/groupManualReminders.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Écrire le regroupement**

Créer `frontend/src/lib/groupManualReminders.ts`. Signature : `groupManualReminders<T extends { id: string; tier: string; sent_at: string; template_used: string }>(rows: T[]): (({ kind: 'single' } & T) | { kind: 'group'; sentAt: string; templateUsed: string; count: number; id: string })[]`. Grouper uniquement les lignes `tier === 'MANUAL'`, par clé `` `${sent_at}|${template_used}` ``, et ne replier que si `count > 1`. Préserver l'ordre chronologique d'entrée.

- [ ] **Step 4: Lancer le test pour le voir passer**

Run: `cd frontend && npx vitest run src/lib/groupManualReminders.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Brancher les boutons d'envoi**

Chaque surface ouvre une boîte `Dialog` de confirmation rappelant **le destinataire résolu** et **le nombre de factures concernées** avant d'appeler l'action. Un envoi est sortant et irréversible : il ne part jamais sur un clic isolé.

1. `ArmateurDetail.tsx` — bouton « Relancer » par ligne du tableau des pro-formas (`sendManualReminder`) ; bouton « Envoyer le récapitulatif » dans la carte Actions (`sendConsolidatedRecap`). Appliquer `groupManualReminders` à la carte « Relances ».
2. `ReglementsDashboard.tsx` — bouton « Récapitulatif » par ligne du tableau « À relancer ».
3. `CollectionsAdminList.tsx` — bouton « Relancer maintenant » dans le `DetailPanel`, à côté des boutons d'escalade. Appliquer `groupManualReminders` à la timeline.

Chaque appel se fait dans un `useTransition`, affiche l'erreur retournée sous forme lisible, et termine par `router.refresh()` en cas de succès.

- [ ] **Step 6: Ajouter les clés i18n dans les 6 locales**

`AdminArmateurs` : `remind`, `remindConfirmTitle`, `remindConfirmBody`, `sendRecap`, `sendRecapConfirmTitle`, `sendRecapConfirmBody`, `detail.manualGroup` (« Récapitulatif consolidé — {count} factures »).
`AdminCollections` : `remind_now`, `remind_now_confirm`.
`AdminReglements` : `sendRecap`.

- [ ] **Step 7: Vérifier**

Run: `cd frontend && npx tsc --noEmit && npm test && npm run lint && npm run build`
Expected: tout vert, build de production réussi.

- [ ] **Step 8: Commit**

```bash
git add "frontend/src/app/(dashboard)/admin/armateurs/[id]/ArmateurDetail.tsx" "frontend/src/app/(dashboard)/admin/reglements/ReglementsDashboard.tsx" "frontend/src/app/(dashboard)/admin/collections/CollectionsAdminList.tsx" frontend/src/lib/groupManualReminders.ts frontend/src/lib/groupManualReminders.test.ts frontend/messages
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(recouvrement): boutons de relance manuelle et de recapitulatif"
```

---

### Task 14: Couverture E2E

**Files:**
- Create: `frontend/e2e/scenarios/07-recouvrement.spec.ts`

**Interfaces:**
- Consumes: `/admin/armateurs` triable (Task 3), `/admin/reglements` (Task 5).

Couverture volontairement légère : le fond est couvert en unitaire. Ces deux scénarios ne vérifient que ce que l'unitaire ne peut pas voir — que les écrans se chargent réellement et que le clic d'en-tête réordonne le DOM.

- [ ] **Step 1: Écrire le scénario**

Créer `frontend/e2e/scenarios/07-recouvrement.spec.ts`, en reprenant l'authentification de `frontend/e2e/helpers/auth.ts` (lire le fichier pour la signature exacte du helper et le rôle à demander — il faut un `FINANCE_ADMIN` ou `SUPERADMIN`).

```ts
import { test, expect } from '@playwright/test';
// import { loginAs } from '../helpers/auth';  ← nom réel à confirmer dans le helper

test.describe('recouvrement', () => {
    test('le tableau de bord des règlements se charge', async ({ page }) => {
        // await loginAs(page, 'FINANCE_ADMIN');
        await page.goto('/admin/reglements');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        // Le total impayé est rendu : la vue a répondu, la RLS n'a pas tout masqué.
        await expect(page.getByText(/\$/).first()).toBeVisible();
    });

    test('le tri du cockpit armateurs réordonne le tableau', async ({ page }) => {
        // await loginAs(page, 'FINANCE_ADMIN');
        await page.goto('/admin/armateurs');
        const header = page.getByRole('button', { name: /d[ûu]|outstanding/i }).first();
        const firstBefore = await page.locator('tbody tr').first().textContent();
        await header.click();
        await expect(page.locator('thead th[aria-sort]')).toHaveCount(1);
        const firstAfter = await page.locator('tbody tr').first().textContent();
        // L'ordre par défaut est « dû décroissant » : un clic bascule en croissant.
        expect(firstAfter).not.toBe(firstBefore);
    });
});
```

- [ ] **Step 2: Lancer le scénario**

Run: `cd frontend && npx playwright test scenarios/07-recouvrement.spec.ts`
Expected: 2 tests verts.

Si le jeu de données de test ne contient qu'un seul armateur, la seconde assertion est vide de sens : dans ce cas, remplacer l'assertion d'ordre par la seule vérification de `aria-sort` sur l'en-tête cliqué, et le noter en commentaire.

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/scenarios/07-recouvrement.spec.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "test(e2e): chargement du tableau de bord et tri du cockpit armateurs"
```

---

## Bascule (à faire au déploiement, hors plan)

- Appliquer les migrations **dans l'ordre** : 121 → 122 → 123 → 124. Les 123 et 124 doivent rester deux fichiers distincts.
- Renseigner `billing_cc_emails` sur les armateurs qui le justifient (facultatif — défaut vide = comportement inchangé).
- Vérifier après déploiement que `/admin/reglements` affiche des totaux non nuls sur la juridiction Berbera, et que `/admin/collections` continue d'afficher les paliers légaux (et non `MANUAL`) en colonne « palier ».
