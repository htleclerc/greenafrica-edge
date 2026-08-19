# Émission unifiée des documents fiscaux — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire qu'une pro-forma émise automatiquement soit un document de plein droit — archivé sous une nomenclature unique, envoyé aux bons destinataires, vérifiable par son QR et téléchargeable depuis le portail armateur.

**Architecture:** `issueInvoiceDocument` devient l'unique émetteur de document fiscal. `proformaPipelineService` lui délègue tout ce qui relève du document (référence, hash, signature, rendu, upload, persistance, audit, e-mail) et ne conserve que son métier (détection, calcul CO₂, tarif, insertion, transition d'alerte). Les décisions sensibles — où le document est rangé, à qui il part — sont prises par le service et non par l'appelant.

**Tech Stack:** Next.js 15 / TypeScript strict / Supabase (PostgREST + Storage) / jsPDF / Resend / Vitest.

**Spec:** [2026-07-24-emission-unifiee-documents-design.md](../specs/2026-07-24-emission-unifiee-documents-design.md)

## Global Constraints

- TypeScript strict, `any` interdit (CLAUDE.md).
- Commits atomiques, conventionnels, **humanisés**, auteur `Loic Leclerc <leclerc@drwintech.com>` via `git commit --author=`. Jamais de `Co-Authored-By: Claude` ni de mention « Generated with Claude Code ».
- Staging explicite : `git add <paths>`, jamais `-A` ni `.`.
- Format de référence : `{PRO|INV}-YYYY-WW-<8 hex d'UUID><4 hex d'entropie>`. `YYYY` = **année civile** de `transactions.created_at`. `WW` = **semaine ISO 8601** de `created_at`, deux chiffres.
- Nomenclature de stockage : `<jurisdiction.code>/<proformas|invoices>/<YYYY>/<MM>/<REF>.pdf`, année et mois issus de `created_at`.
- `invoice_ref`, `content_hash`, `verify_signature` sont **first-write-only** en base ([mig 089](../../../supabase/migrations/089_greengate_transactions_immutable.sql)). Ne jamais les réécrire. `invoice_pdf_url` est libre.
- Les tests tournent depuis `frontend/` : `npx vitest run <chemin>`.
- Aucun commit ne doit dégrader le baseline lint (157 problèmes / 62 erreurs préexistants sur `develop`).

---

### Task 1 : Références datées et nomenclature par juridiction

Deux fonctions pures. Elles portent toutes les règles de nommage, donc elles se testent sans base ni réseau.

**Files:**
- Modify: `frontend/src/services/invoiceIssuanceService.ts` (remplace `mintInvoiceRef` et `buildStoragePath`)
- Test: `frontend/src/services/invoiceIssuanceService.naming.test.ts` (créer)

**Interfaces:**
- Consumes: `InvoiceMode` depuis `./invoiceService`.
- Produces:
  - `isoWeekNumber(date: Date): number`
  - `mintInvoiceRef(transactionId: string, mode: InvoiceMode, createdAt: Date): string`
  - `buildStoragePath(input: { jurisdictionCode: string; mode: InvoiceMode; createdAt: Date; invoiceRef: string }): string`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/src/services/invoiceIssuanceService.naming.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { isoWeekNumber, mintInvoiceRef, buildStoragePath } from './invoiceIssuanceService';
import { parseInvoiceRef } from './invoiceService';

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const TXN = '81be7109-0cca-4dc8-a077-eda4f4011570';

describe('isoWeekNumber', () => {
    // Valeurs calculées selon ISO 8601 : la semaine 1 est celle qui contient
    // le premier jeudi de l'année.
    it.each([
        ['2026-01-01', 1],   // jeudi — semaine 1
        ['2026-04-26', 17],
        ['2026-07-24', 30],
        ['2026-12-28', 53],  // 2026 est une année à 53 semaines
        ['2026-12-31', 53],
        ['2027-01-01', 53],  // vendredi — appartient encore à la semaine ISO 53 de 2026
        ['2027-01-03', 53],
        ['2027-01-04', 1],   // lundi — première semaine ISO de 2027
        ['2024-12-30', 1],   // lundi — première semaine ISO de 2025
        ['2025-01-01', 1],
    ])('%s tombe en semaine %i', (iso, expected) => {
        expect(isoWeekNumber(at(iso))).toBe(expected);
    });
});

describe('mintInvoiceRef', () => {
    it('produit PRO-<année civile>-<semaine ISO>-<12 hex> pour une pro-forma', () => {
        expect(mintInvoiceRef(TXN, 'proforma', at('2026-07-24')))
            .toMatch(/^PRO-2026-30-81be7109[0-9a-f]{4}$/);
    });

    it('produit le préfixe INV pour une facture', () => {
        expect(mintInvoiceRef(TXN, 'invoice', at('2026-07-24')))
            .toMatch(/^INV-2026-30-81be7109[0-9a-f]{4}$/);
    });

    it('pade la semaine sur deux chiffres', () => {
        expect(mintInvoiceRef(TXN, 'proforma', at('2026-01-01'))).toContain('-2026-01-');
    });

    // L'année reste l'année CIVILE, jamais l'année ISO : elle doit rester alignée
    // avec le dossier de stockage. Aux bornes, on accepte donc de lire une semaine
    // 53 dans une référence 2027.
    it('garde l\'année civile même quand la semaine ISO appartient à l\'année précédente', () => {
        expect(mintInvoiceRef(TXN, 'proforma', at('2027-01-01'))).toMatch(/^PRO-2027-53-/);
    });

    it('garde l\'année civile même quand la semaine ISO appartient à l\'année suivante', () => {
        expect(mintInvoiceRef(TXN, 'proforma', at('2024-12-30'))).toMatch(/^PRO-2024-01-/);
    });

    it('dérive la date du paramètre et non de l\'horloge', () => {
        // Une créance de 2019 rattrapée aujourd'hui garde sa date d'origine.
        expect(mintInvoiceRef(TXN, 'proforma', at('2019-03-04'))).toMatch(/^PRO-2019-10-/);
    });

    it('reste lisible par parseInvoiceRef', () => {
        const ref = mintInvoiceRef(TXN, 'proforma', at('2026-07-24'));
        expect(parseInvoiceRef(ref)).toMatchObject({ type: 'PRO', year: 2026 });
    });

    it('varie d\'un appel à l\'autre pour rendre l\'énumération infaisable', () => {
        const refs = new Set(
            Array.from({ length: 50 }, () => mintInvoiceRef(TXN, 'proforma', at('2026-07-24'))),
        );
        expect(refs.size).toBeGreaterThan(1);
    });
});

describe('buildStoragePath', () => {
    it('range une pro-forma sous <code>/proformas/<année>/<mois>', () => {
        expect(buildStoragePath({
            jurisdictionCode: 'SO',
            mode: 'proforma',
            createdAt: at('2026-07-24'),
            invoiceRef: 'PRO-2026-30-81be71091a2b',
        })).toBe('SO/proformas/2026/07/PRO-2026-30-81be71091a2b.pdf');
    });

    it('range une facture sous <code>/invoices/<année>/<mois>', () => {
        expect(buildStoragePath({
            jurisdictionCode: 'DJ',
            mode: 'invoice',
            createdAt: at('2026-11-03'),
            invoiceRef: 'INV-2026-45-200000007b95',
        })).toBe('DJ/invoices/2026/11/INV-2026-45-200000007b95.pdf');
    });

    // Les références déjà émises sont gelées en base et ne portent pas de semaine.
    // Elles doivent malgré tout se ranger correctement.
    it('range une référence héritée sans segment de semaine', () => {
        expect(buildStoragePath({
            jurisdictionCode: 'SO',
            mode: 'invoice',
            createdAt: at('2026-03-09'),
            invoiceRef: 'INV-2026-200000007b95',
        })).toBe('SO/invoices/2026/03/INV-2026-200000007b95.pdf');
    });

    it('pade le mois sur deux chiffres', () => {
        expect(buildStoragePath({
            jurisdictionCode: 'SO',
            mode: 'proforma',
            createdAt: at('2026-01-05'),
            invoiceRef: 'PRO-2026-02-aaaabbbbcccc',
        })).toContain('/2026/01/');
    });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd frontend && npx vitest run src/services/invoiceIssuanceService.naming.test.ts`
Expected: FAIL — `isoWeekNumber` n'est pas exporté, et `mintInvoiceRef` / `buildStoragePath` ont l'ancienne signature.

- [ ] **Step 3 : Implémenter**

Dans `frontend/src/services/invoiceIssuanceService.ts`, remplacer les blocs `mintInvoiceRef` et `buildStoragePath` existants par :

```ts
/**
 * Numéro de semaine ISO 8601 (1-53). La semaine 1 est celle qui contient le
 * premier jeudi de l'année ; on décale donc la date au jeudi de sa semaine
 * avant de compter. Calcul en UTC pour qu'un changement d'heure locale ne
 * fasse pas basculer un document d'une semaine à l'autre.
 */
export function isoWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayOfWeek = d.getUTCDay() || 7;          // lundi = 1 … dimanche = 7
    d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);  // jeudi de la semaine courante
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/**
 * Référence canonique : {PRO|INV}-YYYY-WW-<8 hex d'UUID><4 hex d'entropie>.
 *
 * L'année et la semaine décrivent la CRÉANCE (`createdAt`), pas l'instant de
 * l'émission — sans quoi un rattrapage tardif daterait le document du jour du
 * rattrapage. L'année est l'année civile et non l'année ISO, pour rester
 * alignée avec le dossier de stockage ; aux trois derniers jours de décembre,
 * on peut donc lire une semaine 53 dans une référence de l'année suivante.
 *
 * Les 12 hex finaux (8 d'UUID + 4 d'entropie) rendent l'énumération infaisable
 * même sans la couche HMAC : 2^48 combinaisons.
 */
export function mintInvoiceRef(transactionId: string, mode: InvoiceMode, createdAt: Date): string {
    const year = createdAt.getUTCFullYear();
    const week = String(isoWeekNumber(createdAt)).padStart(2, '0');
    const uuidSeg = transactionId.split('-')[0].toLowerCase();
    const entropy = Math.floor(Math.random() * 0xFFFF).toString(16).padStart(4, '0');
    const refPrefix = mode === 'invoice' ? 'INV' : 'PRO';
    return `${refPrefix}-${year}-${week}-${uuidSeg}${entropy}`;
}

/**
 * Chemin de l'objet dans le bucket privé `documents` :
 *   <jurisdiction.code>/<proformas|invoices>/<YYYY>/<MM>/<REF>.pdf
 *
 * Le préfixe par État sert l'isolation multi-tenant ; le découpage année/mois
 * sert l'archivage et la purge par période. La référence passée peut être une
 * référence héritée sans segment de semaine : le chemin ne la reformate pas.
 */
export function buildStoragePath(input: {
    jurisdictionCode: string;
    mode: InvoiceMode;
    createdAt: Date;
    invoiceRef: string;
}): string {
    const folder = input.mode === 'invoice' ? 'invoices' : 'proformas';
    const year = input.createdAt.getUTCFullYear();
    const month = String(input.createdAt.getUTCMonth() + 1).padStart(2, '0');
    return `${input.jurisdictionCode}/${folder}/${year}/${month}/${input.invoiceRef}.pdf`;
}
```

- [ ] **Step 4 : Adapter les appelants pour que le fichier compile**

Dans la même fonction `issueInvoiceDocument`, remplacer l'appel existant :

```ts
const invoiceRef = tx.invoice_ref || mintInvoiceRef(tx.id, mode, new Date().getFullYear());
```

par :

```ts
const createdAt = new Date(tx.created_at);
const invoiceRef = tx.invoice_ref || mintInvoiceRef(tx.id, mode, createdAt);
```

et laisser temporairement l'appel à `buildStoragePath` en erreur de compilation — il est câblé en Task 5. Pour garder le dépôt compilable entre les deux, poser provisoirement :

```ts
const storagePath = buildStoragePath({
    jurisdictionCode: 'SO',   // câblé sur la juridiction réelle en Task 5
    mode,
    createdAt,
    invoiceRef,
});
```

- [ ] **Step 5 : Lancer les tests**

Run: `cd frontend && npx vitest run src/services/invoiceIssuanceService.naming.test.ts src/app/api/invoices/generate/route.test.ts`
Expected: PASS — 21 tests de nommage + 14 de la route.

- [ ] **Step 6 : Vérifier la compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune sortie.

- [ ] **Step 7 : Commit**

```bash
git add frontend/src/services/invoiceIssuanceService.ts frontend/src/services/invoiceIssuanceService.naming.test.ts
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(invoices): date les références par semaine ISO et range les PDF par juridiction"
```

---

### Task 2 : Résolution des destinataires

Fonction pure isolant la règle métier la plus susceptible d'évoluer : qui reçoit un document fiscal.

**Files:**
- Modify: `frontend/src/services/invoiceIssuanceService.ts`
- Test: `frontend/src/services/invoiceIssuanceService.recipients.test.ts` (créer)

**Interfaces:**
- Produces: `resolveInvoiceRecipients(input: InvoiceRecipientsInput): { to: string; cc: string[] } | null`, avec
  `InvoiceRecipientsInput = { shipownerBillingEmail: string | null; agentEmail: string | null; vesselOwnerEmail: string | null; jurisdictionCcEmails: string[]; platformCcEmail: string | null }`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/src/services/invoiceIssuanceService.recipients.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { resolveInvoiceRecipients } from './invoiceIssuanceService';

const base = {
    shipownerBillingEmail: null,
    agentEmail: null,
    vesselOwnerEmail: null,
    jurisdictionCcEmails: [] as string[],
    platformCcEmail: null,
};

describe('resolveInvoiceRecipients — cascade du destinataire principal', () => {
    it('privilégie le contact de facturation de l\'armateur', () => {
        expect(resolveInvoiceRecipients({
            ...base,
            shipownerBillingEmail: 'billing@armateur.com',
            agentEmail: 'agent@port.com',
            vesselOwnerEmail: 'owner@fleet.com',
        })).toEqual({ to: 'billing@armateur.com', cc: ['agent@port.com'] });
    });

    it('retombe sur l\'agent quand l\'armateur n\'a pas de contact', () => {
        expect(resolveInvoiceRecipients({
            ...base,
            agentEmail: 'agent@port.com',
            vesselOwnerEmail: 'owner@fleet.com',
        })).toEqual({ to: 'agent@port.com', cc: [] });
    });

    it('retombe sur le propriétaire du navire en dernier recours', () => {
        expect(resolveInvoiceRecipients({ ...base, vesselOwnerEmail: 'owner@fleet.com' }))
            .toEqual({ to: 'owner@fleet.com', cc: [] });
    });

    it('renvoie null quand personne n\'est joignable', () => {
        expect(resolveInvoiceRecipients(base)).toBeNull();
    });

    it('ignore les chaînes vides et les espaces', () => {
        expect(resolveInvoiceRecipients({
            ...base,
            shipownerBillingEmail: '   ',
            agentEmail: 'agent@port.com',
        })).toEqual({ to: 'agent@port.com', cc: [] });
    });
});

describe('resolveInvoiceRecipients — copies', () => {
    it('ajoute les copies de la juridiction et de la plateforme', () => {
        expect(resolveInvoiceRecipients({
            ...base,
            shipownerBillingEmail: 'billing@armateur.com',
            agentEmail: 'agent@port.com',
            jurisdictionCcEmails: ['finance@somaliland.gov'],
            platformCcEmail: 'archive@greengate.africa',
        })).toEqual({
            to: 'billing@armateur.com',
            cc: ['agent@port.com', 'finance@somaliland.gov', 'archive@greengate.africa'],
        });
    });

    it('ne met pas le destinataire principal en copie de lui-même', () => {
        expect(resolveInvoiceRecipients({
            ...base,
            shipownerBillingEmail: 'agent@port.com',
            agentEmail: 'agent@port.com',
        })).toEqual({ to: 'agent@port.com', cc: [] });
    });

    it('dédoublonne sans tenir compte de la casse', () => {
        expect(resolveInvoiceRecipients({
            ...base,
            shipownerBillingEmail: 'Billing@Armateur.com',
            agentEmail: 'BILLING@armateur.COM',
            jurisdictionCcEmails: ['finance@so.gov', 'Finance@SO.gov'],
            platformCcEmail: 'finance@so.gov',
        })).toEqual({ to: 'Billing@Armateur.com', cc: ['finance@so.gov'] });
    });

    it('n\'envoie rien quand seules des copies sont renseignées', () => {
        expect(resolveInvoiceRecipients({
            ...base,
            jurisdictionCcEmails: ['finance@so.gov'],
            platformCcEmail: 'archive@greengate.africa',
        })).toBeNull();
    });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd frontend && npx vitest run src/services/invoiceIssuanceService.recipients.test.ts`
Expected: FAIL — `resolveInvoiceRecipients` n'existe pas.

- [ ] **Step 3 : Implémenter**

Ajouter dans `frontend/src/services/invoiceIssuanceService.ts`, sous `buildStoragePath` :

```ts
export interface InvoiceRecipientsInput {
    /** Contact de facturation déclaré par l'armateur (shipowners.official_email). */
    shipownerBillingEmail: string | null;
    /** Agent maritime rattaché à la transaction. */
    agentEmail: string | null;
    /** Propriétaire du navire (vessels.owner_id → profiles.email). */
    vesselOwnerEmail: string | null;
    /** Copies propres à l'État émetteur (jurisdictions.billing_cc_emails). */
    jurisdictionCcEmails: string[];
    /** Copie plateforme unique (PLATFORM_BILLING_CC). */
    platformCcEmail: string | null;
}

const cleanEmail = (value: string | null | undefined): string | null => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
};

/**
 * Détermine qui reçoit un document fiscal.
 *
 * Destinataire principal en cascade : contact de facturation de l'armateur →
 * agent maritime → propriétaire du navire. L'agent passe en copie s'il n'est
 * pas déjà le destinataire principal, puis viennent les copies de l'État
 * émetteur et celle de la plateforme.
 *
 * Renvoie `null` quand aucun destinataire principal n'est joignable : une
 * créance existe indépendamment de la joignabilité de son débiteur, et il
 * serait absurde d'envoyer un document uniquement à ses propres archives.
 *
 * Le dédoublonnage est insensible à la casse mais préserve la casse d'origine
 * de la première occurrence : certains serveurs traitent la partie locale
 * comme sensible à la casse.
 */
export function resolveInvoiceRecipients(
    input: InvoiceRecipientsInput,
): { to: string; cc: string[] } | null {
    const to = cleanEmail(input.shipownerBillingEmail)
        ?? cleanEmail(input.agentEmail)
        ?? cleanEmail(input.vesselOwnerEmail);
    if (!to) return null;

    const seen = new Set<string>([to.toLowerCase()]);
    const cc: string[] = [];
    const candidates = [
        cleanEmail(input.agentEmail),
        ...input.jurisdictionCcEmails.map(cleanEmail),
        cleanEmail(input.platformCcEmail),
    ];
    for (const candidate of candidates) {
        if (!candidate) continue;
        const key = candidate.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        cc.push(candidate);
    }

    return { to, cc };
}
```

- [ ] **Step 4 : Lancer les tests**

Run: `cd frontend && npx vitest run src/services/invoiceIssuanceService.recipients.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5 : Commit**

```bash
git add frontend/src/services/invoiceIssuanceService.ts frontend/src/services/invoiceIssuanceService.recipients.test.ts
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(invoices): résout les destinataires d'un document en cascade avec copies"
```

---

### Task 3 : Copies par juridiction en base

**Files:**
- Create: `supabase/migrations/109_jurisdictions_billing_cc.sql`
- Modify: `frontend/src/lib/jurisdictionName.ts`
- Test: `frontend/src/lib/jurisdictionName.test.ts` (créer si absent, sinon étendre)

**Interfaces:**
- Consumes: table `jurisdictions` (`id`, `code`, `name`).
- Produces: `fetchJurisdictionMeta(client, jurisdictionId): Promise<{ code: string; name: string; billingCcEmails: string[] }>`. `fetchJurisdictionName` reste exportée et devient un adaptateur.

- [ ] **Step 1 : Écrire la migration**

Créer `supabase/migrations/109_jurisdictions_billing_cc.sql` :

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 109: jurisdictions.billing_cc_emails
--
-- Adresses mises en copie de tout document fiscal émis par cet État (pro-forma,
-- facture). Distinct de PLATFORM_BILLING_CC, la copie plateforme unique portée
-- par l'environnement : ici, chaque autorité portuaire gère sa propre liste et
-- ne voit pas celle des autres.
--
-- Volontairement PAS dans app_config : sa RLS est USING (true) (mig 009), une
-- boîte interne y serait lisible par n'importe qui, y compris anonyme.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.jurisdictions
  ADD COLUMN IF NOT EXISTS billing_cc_emails TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.jurisdictions.billing_cc_emails IS
  'Adresses en copie systématique des documents fiscaux émis par cette juridiction. Voir resolveInvoiceRecipients.';

-- DOWN:
-- ALTER TABLE public.jurisdictions DROP COLUMN IF EXISTS billing_cc_emails;
```

- [ ] **Step 2 : Vérifier la RLS de `jurisdictions` avant d'appliquer**

Run: `node scripts/db-query.mjs "SELECT policyname, cmd, roles::text, qual FROM pg_policies WHERE tablename = 'jurisdictions'"`

Lire la sortie. **Si une politique `SELECT` expose la table aux armateurs** (rôle `authenticated` sans restriction de rôle), la colonne serait lisible par un débiteur. Dans ce cas, ajouter à la migration une vue restreinte ou une politique colonne — et le signaler dans le rapport de tâche plutôt que de passer outre.

- [ ] **Step 3 : Appliquer la migration**

Run: `node scripts/db-migrate.mjs`
Expected: `109_jurisdictions_billing_cc.sql` appliquée sans erreur.

Vérifier : `node scripts/db-query.mjs "SELECT code, billing_cc_emails FROM jurisdictions ORDER BY code"`
Expected: deux lignes, `DJ` et `SO`, `billing_cc_emails` à `{}`.

- [ ] **Step 4 : Écrire le test qui échoue**

Créer `frontend/src/lib/jurisdictionName.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { fetchJurisdictionMeta, fetchJurisdictionName, _clearCacheForTest } from './jurisdictionName';
import type { SupabaseClient } from '@supabase/supabase-js';

function clientReturning(row: Record<string, unknown> | null, error: unknown = null) {
    return {
        from: () => ({
            select: () => ({
                eq: () => ({
                    maybeSingle: async () => ({ data: row, error }),
                }),
            }),
        }),
    } as unknown as SupabaseClient;
}

beforeEach(() => _clearCacheForTest());

describe('fetchJurisdictionMeta', () => {
    it('renvoie le code, le nom et les copies de la juridiction', async () => {
        const client = clientReturning({
            code: 'DJ',
            name: 'Republic of Djibouti',
            billing_cc_emails: ['finance@dj.gov'],
        });
        await expect(fetchJurisdictionMeta(client, 'jur-dj')).resolves.toEqual({
            code: 'DJ',
            name: 'Republic of Djibouti',
            billingCcEmails: ['finance@dj.gov'],
        });
    });

    it('normalise une liste de copies absente en tableau vide', async () => {
        const client = clientReturning({ code: 'SO', name: 'Republic of Somaliland', billing_cc_emails: null });
        const meta = await fetchJurisdictionMeta(client, 'jur-so');
        expect(meta.billingCcEmails).toEqual([]);
    });

    // Les lignes antérieures au multi-tenant (W2) n'ont pas de jurisdiction_id.
    it('retombe sur le Somaliland quand aucune juridiction n\'est fournie', async () => {
        const meta = await fetchJurisdictionMeta(clientReturning(null), null);
        expect(meta).toEqual({ code: 'SO', name: 'Republic of Somaliland', billingCcEmails: [] });
    });

    it('retombe sur le Somaliland quand la requête échoue', async () => {
        const meta = await fetchJurisdictionMeta(clientReturning(null, { message: 'boom' }), 'jur-x');
        expect(meta.code).toBe('SO');
    });
});

describe('fetchJurisdictionName', () => {
    it('reste compatible avec ses appelants existants', async () => {
        const client = clientReturning({ code: 'DJ', name: 'Republic of Djibouti', billing_cc_emails: [] });
        await expect(fetchJurisdictionName(client, 'jur-dj')).resolves.toBe('Republic of Djibouti');
    });
});
```

- [ ] **Step 5 : Lancer le test pour vérifier qu'il échoue**

Run: `cd frontend && npx vitest run src/lib/jurisdictionName.test.ts`
Expected: FAIL — `fetchJurisdictionMeta` n'est pas exporté.

- [ ] **Step 6 : Implémenter**

Remplacer le contenu de `frontend/src/lib/jurisdictionName.ts` par :

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

// Repli hérité, utilisé quand jurisdiction_id est absent (lignes antérieures à
// W2) ou quand la lecture échoue. Jamais atteint pour une transaction
// correctement estampillée (W2+).
const LEGACY_FALLBACK: JurisdictionMeta = {
    code: 'SO',
    name: 'Republic of Somaliland',
    billingCcEmails: [],
};

export interface JurisdictionMeta {
    /** Code court ISO-like ('SO', 'DJ'), utilisé comme préfixe de stockage. */
    code: string;
    /** Nom souverain imprimé sur les documents. */
    name: string;
    /** Adresses en copie de tout document émis par cet État. */
    billingCcEmails: string[];
}

// Cache mémoire de 60 s. La table jurisdictions est minuscule et sur le chemin
// chaud (chaque génération de PDF la lit), un aller-retour par identifiant et
// par minute reste largement acceptable.
const cache = new Map<string, { meta: JurisdictionMeta; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

/**
 * Résout le code, le nom souverain et les copies d'une juridiction.
 * Retombe sur LEGACY_FALLBACK si l'identifiant est absent, la ligne
 * introuvable, ou la requête en échec.
 */
export async function fetchJurisdictionMeta(
    client: SupabaseClient,
    jurisdictionId: string | null | undefined,
): Promise<JurisdictionMeta> {
    if (!jurisdictionId) return LEGACY_FALLBACK;

    const now = Date.now();
    const cached = cache.get(jurisdictionId);
    if (cached && cached.expiresAt > now) return cached.meta;

    const { data, error } = await client
        .from('jurisdictions')
        .select('code, name, billing_cc_emails')
        .eq('id', jurisdictionId)
        .maybeSingle();

    if (error || !data?.name || !data?.code) return LEGACY_FALLBACK;

    const meta: JurisdictionMeta = {
        code: data.code as string,
        name: data.name as string,
        billingCcEmails: (data.billing_cc_emails as string[] | null) ?? [],
    };
    cache.set(jurisdictionId, { meta, expiresAt: now + CACHE_TTL_MS });
    return meta;
}

/** Adaptateur pour les appelants qui n'ont besoin que du nom souverain. */
export async function fetchJurisdictionName(
    client: SupabaseClient,
    jurisdictionId: string | null | undefined,
): Promise<string> {
    return (await fetchJurisdictionMeta(client, jurisdictionId)).name;
}

/** Exposé pour les tests uniquement — vide le cache en mémoire. */
export function _clearCacheForTest(): void {
    cache.clear();
}
```

- [ ] **Step 7 : Lancer les tests, y compris les appelants existants de `fetchJurisdictionName`**

Run: `cd frontend && npx vitest run src/lib/jurisdictionName.test.ts src/app/api/invoices/generate/route.test.ts`
Expected: PASS.

- [ ] **Step 8 : Commit**

```bash
git add supabase/migrations/109_jurisdictions_billing_cc.sql frontend/src/lib/jurisdictionName.ts frontend/src/lib/jurisdictionName.test.ts
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(jurisdictions): ajoute les adresses en copie des documents fiscaux par État"
```

---

### Task 4 : Copies et souverain correct dans l'e-mail

`sendInvoiceEmail` ne sait pas mettre en copie, et son corps annonce « Republic of Somaliland » en dur — une facture djiboutienne nomme donc le mauvais État. On corrige les deux, puisque c'est ce chemin qu'on câble.

**Files:**
- Modify: `frontend/src/services/emailService.ts`
- Test: `frontend/src/services/emailService.invoice.test.ts` (créer)

**Interfaces:**
- Produces: `InvoiceEmailParams` gagne `cc?: string[]` et `jurisdictionName: string`.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/src/services/emailService.invoice.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();
vi.mock('resend', () => ({
    Resend: class { emails = { send: sendMock }; },
}));

const params = {
    to: 'billing@armateur.com',
    recipientName: 'Demo Armateur',
    vesselName: 'GG DEMO PIONEER',
    invoiceRef: 'PRO-2026-30-81be71091a2b',
    amountUsd: 11492,
    dueDate: '23 August 2026',
    mode: 'proforma' as const,
    badge: 'TO PAY' as const,
    pdfBuffer: new Uint8Array([1, 2, 3]),
    verifyUrl: 'https://greengate.africa/verify/PRO-2026-30-81be71091a2b',
    jurisdictionName: 'Republic of Djibouti',
};

beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
    process.env.RESEND_API_KEY = 'test-key';
});

describe('sendInvoiceEmail', () => {
    it('transmet les copies à Resend', async () => {
        const { sendInvoiceEmail } = await import('./emailService');
        await sendInvoiceEmail({ ...params, cc: ['agent@port.com', 'finance@dj.gov'] });
        expect(sendMock).toHaveBeenCalledWith(
            expect.objectContaining({ cc: ['agent@port.com', 'finance@dj.gov'] }),
        );
    });

    it('omet le champ cc quand il n\'y a aucune copie', async () => {
        const { sendInvoiceEmail } = await import('./emailService');
        await sendInvoiceEmail(params);
        expect(sendMock.mock.calls[0][0].cc).toBeUndefined();
    });

    // RÉGRESSION — le corps annonçait « Republic of Somaliland » en dur, ce qui
    // faisait signer une facture djiboutienne par le mauvais État.
    it('nomme l\'État émetteur de la transaction', async () => {
        const { sendInvoiceEmail } = await import('./emailService');
        await sendInvoiceEmail(params);
        const html = sendMock.mock.calls[0][0].html as string;
        expect(html).toContain('Republic of Djibouti');
        expect(html).not.toContain('Republic of Somaliland');
    });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd frontend && npx vitest run src/services/emailService.invoice.test.ts`
Expected: FAIL — `cc` non transmis, et le HTML contient « Republic of Somaliland ».

- [ ] **Step 3 : Ajouter le support des copies au niveau bas**

Dans `frontend/src/services/emailService.ts`, modifier `sendEmail` :

```ts
async function sendEmail(params: {
    to: string | string[];
    cc?: string[];
    subject: string;
    html: string;
    text?: string;
    attachments?: Array<{ filename: string; content: Buffer | Uint8Array | string }>;
}): Promise<EmailResult> {
    try {
        const resend = getResend();
        const result = await resend.emails.send({
            from: fromAddress(),
            to: Array.isArray(params.to) ? params.to : [params.to],
            // Resend rejette un tableau vide : on omet le champ plutôt que de
            // l'envoyer vide.
            ...(params.cc?.length ? { cc: params.cc } : {}),
            subject: params.subject,
            html: params.html,
            text: params.text,
            replyTo: replyTo(),
            attachments: params.attachments?.map((a) => ({
                filename: a.filename,
                content: a.content as Buffer,
            })),
        });
```

Le reste de la fonction est inchangé.

- [ ] **Step 4 : Étendre les paramètres de la facture**

Modifier `InvoiceEmailParams` :

```ts
export interface InvoiceEmailParams {
    to: string;
    /** Copies résolues par resolveInvoiceRecipients. */
    cc?: string[];
    recipientName: string;
    vesselName: string;
    invoiceRef: string;
    amountUsd: number;
    dueDate: string;
    mode: 'proforma' | 'invoice';
    badge: 'TO PAY' | 'PAID' | 'OVERDUE' | 'DISPUTED' | 'EXEMPT';
    pdfBuffer: Uint8Array;
    verifyUrl: string;
    /** Nom souverain de l'État émetteur, résolu depuis la juridiction de la transaction. */
    jurisdictionName: string;
}
```

- [ ] **Step 5 : Nommer le bon État dans le corps et propager les copies**

Dans `sendInvoiceEmail`, remplacer la phrase codée en dur :

```ts
        <p>Please find attached the ${docName.toLowerCase()} for vessel <strong>${escapeHtml(p.vesselName)}</strong>, issued by the Maritime Carbon Tax Authority of the Republic of Somaliland.</p>
```

par :

```ts
        <p>Please find attached the ${docName.toLowerCase()} for vessel <strong>${escapeHtml(p.vesselName)}</strong>, issued by the Maritime Carbon Tax Authority of the ${escapeHtml(p.jurisdictionName)}.</p>
```

Puis, dans l'appel à `sendEmail` en fin de `sendInvoiceEmail`, ajouter `cc: p.cc,` juste après `to: p.to,`.

- [ ] **Step 6 : Lancer les tests**

Run: `cd frontend && npx vitest run src/services/emailService.invoice.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 7 : Corriger les appelants que le champ obligatoire casse**

Run: `cd frontend && npx tsc --noEmit`

`jurisdictionName` étant obligatoire, la compilation signale chaque appelant de `sendInvoiceEmail`. Les câbler est l'objet des Tasks 5 et 6 ; pour garder l'arbre compilable, passer dans chacun la valeur déjà disponible localement — `jurisdictionName` existe déjà comme variable dans `invoiceIssuanceService.issueInvoiceDocument` et dans les deux chemins de `proformaPipelineService`.

Expected après correction : aucune sortie.

- [ ] **Step 8 : Commit**

```bash
git add frontend/src/services/emailService.ts frontend/src/services/emailService.invoice.test.ts frontend/src/services/invoiceIssuanceService.ts frontend/src/services/proformaPipelineService.ts
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "fix(email): met les copies en destinataires et nomme l'État émetteur réel"
```

---

### Task 5 : Câblage complet du service d'émission

Le service prend en charge la juridiction, les destinataires, les lignes personnalisées, et cesse d'avaler un échec de persistance.

**Files:**
- Modify: `frontend/src/services/invoiceIssuanceService.ts`
- Test: `frontend/src/services/invoiceIssuanceService.issue.test.ts` (créer)

**Interfaces:**
- Consumes: `mintInvoiceRef`, `buildStoragePath`, `resolveInvoiceRecipients` (Tasks 1-2) ; `fetchJurisdictionMeta` (Task 3) ; `sendInvoiceEmail` étendu (Task 4).
- Produces: `IssueInvoiceInput` gagne `lineItems?: InvoiceData['lineItems']`, `skipStorage?: boolean`, `skipEmail?: boolean`. `IssueInvoiceResult` en succès gagne `recipients: { to: string; cc: string[] } | null`.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/src/services/invoiceIssuanceService.issue.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { assertLineItemsMatchTotal } from './invoiceIssuanceService';

describe('assertLineItemsMatchTotal', () => {
    const line = (amount: number) => ({
        zone: 'EEZ', days: 1, emissionsTco2: 1, rate: amount, amount,
    });

    it('accepte des lignes dont la somme égale le total', () => {
        expect(() => assertLineItemsMatchTotal([line(100), line(50)], 150)).not.toThrow();
    });

    it('tolère un écart d\'arrondi au cent', () => {
        expect(() => assertLineItemsMatchTotal([line(100.004)], 100)).not.toThrow();
    });

    it('rejette une somme qui contredit le total', () => {
        expect(() => assertLineItemsMatchTotal([line(100)], 150))
            .toThrow(/lineItems sum 100.*does not match tax_amount_usd 150/);
    });

    it('rejette une liste vide', () => {
        expect(() => assertLineItemsMatchTotal([], 150)).toThrow(/at least one line item/);
    });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd frontend && npx vitest run src/services/invoiceIssuanceService.issue.test.ts`
Expected: FAIL — `assertLineItemsMatchTotal` n'existe pas.

- [ ] **Step 3 : Implémenter la validation**

Ajouter dans `frontend/src/services/invoiceIssuanceService.ts` :

```ts
/**
 * Un document fiscal dont le détail contredit le total n'a pas à exister.
 * On tolère un cent d'écart pour absorber les arrondis de représentation en
 * virgule flottante, pas davantage.
 */
export function assertLineItemsMatchTotal(
    lineItems: InvoiceData['lineItems'],
    totalUsd: number,
): void {
    if (!lineItems.length) {
        throw new Error('invoice issuance: lineItems must contain at least one line item');
    }
    const sum = lineItems.reduce((acc, item) => acc + item.amount, 0);
    if (Math.abs(sum - totalUsd) > 0.01) {
        throw new Error(
            `invoice issuance: lineItems sum ${sum} does not match tax_amount_usd ${totalUsd}`,
        );
    }
}
```

- [ ] **Step 4 : Étendre la signature d'entrée**

Dans la même page, ajouter à `IssueInvoiceInput` :

```ts
    /**
     * Lignes de détail personnalisées. Permet au pipeline automatique de
     * conserver son libellé métier. Validées : leur somme doit égaler
     * tax_amount_usd. Par défaut, ligne unique « emissions × taux ».
     */
    lineItems?: InvoiceData['lineItems'];
    /** N'écrit pas dans le bucket. invoice_pdf_url reste NULL. Tests uniquement. */
    skipStorage?: boolean;
    /** N'envoie pas d'e-mail. Tests et rattrapage. */
    skipEmail?: boolean;
```

et à la branche de succès de `IssueInvoiceResult` :

```ts
          /** Destinataires réellement retenus, null si aucun n'était joignable. */
          recipients: { to: string; cc: string[] } | null;
```

- [ ] **Step 5 : Câbler la juridiction et le chemin de stockage**

Dans `issueInvoiceDocument`, remplacer l'appel à `fetchJurisdictionName` :

```ts
    const txRecord = tx as typeof tx & { jurisdiction_id?: string | null };
    const jurisdictionName = await fetchJurisdictionName(admin, txRecord.jurisdiction_id);
```

par :

```ts
    const txRecord = tx as typeof tx & { jurisdiction_id?: string | null };
    const jurisdiction = await fetchJurisdictionMeta(admin, txRecord.jurisdiction_id);
    const jurisdictionName = jurisdiction.name;
```

Adapter l'import en tête de fichier :

```ts
import { fetchJurisdictionMeta } from '../lib/jurisdictionName';
```

Puis remplacer le `buildStoragePath` provisoire posé en Task 1 par :

```ts
    const storagePath = buildStoragePath({
        jurisdictionCode: jurisdiction.code,
        mode,
        createdAt,
        invoiceRef,
    });
```

et supprimer l'ancienne ligne `const storagePath = buildStoragePath(invoiceRef, mode);` si elle subsiste plus bas.

- [ ] **Step 6 : Câbler les lignes de détail**

Remplacer, dans la construction d'`invoiceData` :

```ts
        lineItems: buildLineItems(emissionsTco2, effectiveRate, totalUsd),
```

par un calcul préalable, juste avant la déclaration d'`invoiceData` :

```ts
    const lineItems = input.lineItems ?? buildLineItems(emissionsTco2, effectiveRate, totalUsd);
    try {
        assertLineItemsMatchTotal(lineItems, totalUsd);
    } catch (err) {
        return {
            ok: false,
            status: 400,
            error: err instanceof Error ? err.message : 'invalid lineItems',
        };
    }
```

puis, dans `invoiceData`, utiliser `lineItems,`.

- [ ] **Step 7 : Rendre l'échec de persistance bloquant**

Remplacer le bloc de persistance :

```ts
    if (txUpdateErr) {
        console.error('[Invoice issuance] Transaction update failed:', txUpdateErr.message);
    }
```

par :

```ts
    if (txUpdateErr) {
        // Bloquant par conception : un PDF présent dans le bucket dont la
        // référence n'est pas en base est invisible depuis l'application — le
        // portail et /verify résolvent tous deux par invoice_ref. Mieux vaut
        // échouer et rejouer que produire un document fantôme.
        console.error('[Invoice issuance] Transaction update failed:', txUpdateErr.message);
        return {
            ok: false,
            status: 500,
            error: `Persisting invoice reference failed: ${txUpdateErr.message}`,
        };
    }
```

- [ ] **Step 8 : Câbler les destinataires et l'upload conditionnel**

Remplacer le bloc `if (sendEmail && vesselOwnerEmail) { … }` par :

```ts
    const { data: shipowner } = txRecord.shipowner_id
        ? await admin
            .from('shipowners')
            .select('official_email')
            .eq('id', txRecord.shipowner_id)
            .maybeSingle()
        : { data: null };

    const { data: agentProfile } = txRecord.agent_profile_id
        ? await admin
            .from('profiles')
            .select('email')
            .eq('id', txRecord.agent_profile_id)
            .maybeSingle()
        : { data: null };

    const recipients = resolveInvoiceRecipients({
        shipownerBillingEmail: (shipowner?.official_email as string | null) ?? null,
        agentEmail: (agentProfile?.email as string | null) ?? null,
        vesselOwnerEmail,
        jurisdictionCcEmails: jurisdiction.billingCcEmails,
        platformCcEmail: process.env.PLATFORM_BILLING_CC ?? null,
    });

    let emailResult: IssueInvoiceEmailResult = { success: false, skipped: !sendEmail };
    if (sendEmail && recipients) {
        emailResult = await sendInvoiceEmail({
            to: recipients.to,
            cc: recipients.cc,
            recipientName: ownerName,
            vesselName: tx.vessel_name,
            invoiceRef,
            amountUsd: totalUsd,
            dueDate,
            mode,
            badge,
            pdfBuffer,
            verifyUrl,
            jurisdictionName,
        });
        if (!emailResult.success) {
            console.error('[Invoice issuance] Email failed:', emailResult.error);
        }
    } else if (sendEmail) {
        // La créance existe indépendamment de la joignabilité du débiteur.
        emailResult = { success: false, error: 'no reachable recipient' };
    }
```

Ajouter en tête de la sélection de la transaction les deux colonnes nécessaires : dans le `.select(...)`, ajouter `shipowner_id, agent_profile_id` à la liste.

Étendre le `select` du chargement transaction en conséquence, et déclarer le type élargi :

```ts
    const txRecord = tx as typeof tx & {
        jurisdiction_id?: string | null;
        shipowner_id?: string | null;
        agent_profile_id?: string | null;
    };
```

Entourer l'upload de `if (!input.skipStorage)` et n'écrire `invoice_pdf_url` que dans ce cas.

- [ ] **Step 9 : Tracer les destinataires réels dans l'audit**

Dans l'insertion `INVOICE_SENT`, remplacer :

```ts
                recipientEmail: vesselOwnerEmail,
                recipientName: ownerName,
```

par :

```ts
                recipientEmail: recipients?.to ?? null,
                recipientCc: recipients?.cc ?? [],
                recipientName: ownerName,
```

et ajouter `recipients` au retour de succès de la fonction.

- [ ] **Step 10 : Lancer les tests**

Run: `cd frontend && npx vitest run src/services/ src/app/api/invoices/`
Expected: PASS.

- [ ] **Step 11 : Vérifier la compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune sortie.

- [ ] **Step 12 : Commit**

```bash
git add frontend/src/services/invoiceIssuanceService.ts frontend/src/services/invoiceIssuanceService.issue.test.ts
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(invoices): résout juridiction et destinataires à l'émission, échoue si la référence ne se persiste pas"
```

---

### Task 6 : Le pipeline automatique délègue

**Files:**
- Modify: `frontend/src/services/proformaPipelineService.ts` (chemin maritime ~258-386, chemin aérien ~520-630)
- Test: `frontend/src/services/proformaPipelineService.test.ts`, `.maritime.test.ts`, `.air.test.ts` (adapter les attentes)

**Interfaces:**
- Consumes: `issueInvoiceDocument` avec `lineItems`, `skipStorage`, `skipEmail` (Task 5).

- [ ] **Step 1 : Lire les tests existants avant de toucher au service**

Run: `cd frontend && npx vitest run src/services/proformaPipelineService.test.ts src/services/proformaPipelineService.maritime.test.ts src/services/proformaPipelineService.air.test.ts`
Expected: PASS. Noter le nombre de tests — il sert de référence pour la suite.

Lire ensuite ce que ces tests affirment sur `invoice_ref`, `invoice_pdf_url` et l'envoi d'e-mail : ce sont les attentes à faire évoluer, pas à supprimer.

- [ ] **Step 2 : Écrire le test de régression qui échoue**

Ajouter à `frontend/src/services/proformaPipelineService.maritime.test.ts` :

```ts
// RÉGRESSION (2026-07-24) — le pipeline rendait le PDF et l'envoyait, mais ne
// persistait ni invoice_ref ni content_hash. Comme /verify et la route de
// téléchargement résolvent tous deux par invoice_ref, le QR imprimé était mort
// et le portail armateur n'avait pas de quoi construire un lien : le document
// existait dans le bucket et nulle part dans l'application.
it('persiste référence, hash et signature en même temps que le PDF', async () => {
    const { transactionId } = await runMaritimeFixture();
    const row = await fetchTransaction(transactionId);
    expect(row.invoice_ref).toMatch(/^PRO-\d{4}-\d{2}-[0-9a-f]{12}$/);
    expect(row.content_hash).toHaveLength(64);
    expect(row.verify_signature).toHaveLength(64);
    expect(row.invoice_pdf_url).toMatch(/^SO\/proformas\/\d{4}\/\d{2}\/PRO-/);
});
```

Adapter `runMaritimeFixture` / `fetchTransaction` aux utilitaires réellement présents dans ce fichier de tests — les noms ci-dessus décrivent l'intention, la forme exacte dépend des doublures déjà en place.

- [ ] **Step 3 : Lancer pour vérifier l'échec**

Run: `cd frontend && npx vitest run src/services/proformaPipelineService.maritime.test.ts`
Expected: FAIL — `invoice_ref` vaut `null`.

- [ ] **Step 4 : Remplacer le bloc d'émission du chemin maritime**

Supprimer, dans `runProformaPipeline`, tout ce qui va du calcul de `invoiceRef` (« The auto-trigger on transactions generates `ref` … ») jusqu'à la fin du bloc « 7. Persist pdf_url » — soit les sections 3bis à 7 actuelles : dérivation de la référence, `canonicalFields`, `contentHash`, `signature`, `verifyUrl`, `invoiceData`, `generateInvoicePdf`, upload, `sendInvoiceEmail`, mise à jour de `invoice_pdf_url`.

Les remplacer par :

```ts
  // ── 4. Émission du document ─────────────────────────────────────────────
  // Le pipeline ne rend plus le PDF lui-même : référence, hash, signature,
  // rendu, upload, persistance, audit et e-mail sont l'affaire du service
  // d'émission, partagé avec /api/invoices/generate. Entretenir une seconde
  // copie ici est exactement ce qui avait fait diverger les deux formats de
  // référence et les deux nomenclatures de stockage.
  const issuer = await resolveIssuingActor(db, alert.jurisdiction_id);
  const issued = await issueInvoiceDocument({
    admin: db,
    transactionId: txn.id,
    jurisdictionId: alert.jurisdiction_id ?? '',
    actor: issuer,
    origin: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3300',
    sendEmail: !input.dryRunEmail,
    skipStorage: input.dryRunStorage,
    lineItems: [
      {
        zone: 'EEZ',
        days: 1,
        emissionsTco2: tax.tco2,
        rate: tax.breakdown.rate_usd_per_tco2,
        amount: tax.usd_amount,
        description: 'Carbon Emissions Tax (pro-forma estimate, IMO Cubic Law)',
        qtyDisplay: `${tax.tco2.toFixed(2)} tCO2`,
        rateDisplay: `$${tax.breakdown.rate_usd_per_tco2.toFixed(2)}/t`,
      },
    ],
  });
  if (!issued.ok) {
    return { ok: false, reason: `issuance: ${issued.error}` };
  }
```

Ajouter l'import en tête de fichier :

```ts
import { issueInvoiceDocument } from './invoiceIssuanceService';
```

et retirer de l'import depuis `./invoiceService` les symboles devenus inutilisés (`generateInvoicePdf`, `hashInvoiceFields`, `signInvoiceRef`, `buildVerifyUrl`), ainsi que l'import de `sendInvoiceEmail` s'il n'est plus référencé.

- [ ] **Step 5 : Ajouter la résolution de l'acteur d'audit**

`audit_logs.user_id` est `NOT NULL REFERENCES profiles(id)`, on ne peut donc pas inventer d'identifiant système. Ajouter en haut de `proformaPipelineService.ts` :

```ts
/** Rôles habilités à émettre un document fiscal, du plus autoritaire au moins. */
const ISSUING_ROLES = ['SUPERADMIN', 'FINANCE_ADMIN', 'PORT_OFFICER'];

/**
 * Le pipeline s'exécute sans utilisateur connecté, mais l'audit exige un
 * profil réel. On retient le profil staff le plus autoritaire disponible
 * plutôt que d'inventer un identifiant qui violerait la clé étrangère.
 */
async function resolveIssuingActor(
  db: SupabaseClient,
  jurisdictionId: string | null | undefined,
): Promise<{ id: string; fullName: string }> {
  const { data } = await db
    .from('profiles')
    .select('id, full_name, email, role')
    .in('role', ISSUING_ROLES)
    .limit(50);
  const rows = (data ?? []) as { id: string; full_name: string | null; email: string | null; role: string }[];
  if (!rows.length) {
    throw new Error(
      `proformaPipeline: no staff profile (${ISSUING_ROLES.join(', ')}) available to issue documents`
      + (jurisdictionId ? ` for jurisdiction ${jurisdictionId}` : ''),
    );
  }
  const chosen = [...rows].sort(
    (a, b) => ISSUING_ROLES.indexOf(a.role) - ISSUING_ROLES.indexOf(b.role),
  )[0];
  return { id: chosen.id, fullName: chosen.full_name || chosen.email || 'Automated pipeline' };
}
```

- [ ] **Step 6 : Appliquer le même remplacement au chemin aérien**

Dans `runAirProforma`, remplacer le bloc équivalent (dérivation de référence, hash, signature, `invoiceData`, rendu, upload, mise à jour) par le même appel à `issueInvoiceDocument`, avec les lignes propres à l'aviation reprises telles qu'elles figurent aujourd'hui dans son `invoiceData.lineItems`. Le chemin aérien insère déjà `invoice_ref` à la création : **retirer cette colonne de l'insert**, la référence étant désormais mintée par le service — sinon `mintInvoiceRef` ne s'appliquera jamais et l'ancien format survivra côté aviation.

- [ ] **Step 7 : Lancer toute la suite du pipeline**

Run: `cd frontend && npx vitest run src/services/proformaPipelineService.test.ts src/services/proformaPipelineService.maritime.test.ts src/services/proformaPipelineService.air.test.ts`
Expected: PASS, avec au moins autant de tests qu'à l'étape 1.

- [ ] **Step 8 : Vérifier la compilation et le lint**

Run: `cd frontend && npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: `tsc` silencieux ; total lint inchangé (157 problèmes / 62 erreurs).

- [ ] **Step 9 : Commit**

```bash
git add frontend/src/services/proformaPipelineService.ts frontend/src/services/proformaPipelineService.maritime.test.ts frontend/src/services/proformaPipelineService.air.test.ts frontend/src/services/proformaPipelineService.test.ts
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "fix(pipeline): émet les pro-formas automatiques via le service partagé"
```

---

### Task 7 : Migration du stockage existant

**Files:**
- Create: `scripts/migrate-document-storage.ts`

**Interfaces:**
- Consumes: `buildStoragePath` (Task 1), `fetchJurisdictionMeta` (Task 3).

- [ ] **Step 1 : Écrire le script**

Créer `scripts/migrate-document-storage.ts` :

```ts
// scripts/migrate-document-storage.ts
// Déplace les objets du bucket `documents` vers la nomenclature par juridiction :
//   invoices/proforma-<REF>.pdf → <code>/proformas/<YYYY>/<MM>/<REF>.pdf
//
// Copie → vérifie → supprime : tant que la lecture de la destination n'a pas
// réussi, la source reste en place et l'opération est réversible. invoice_pdf_url
// est réécrit ensuite (colonne libre, mig 089) ; invoice_ref n'est jamais touché,
// il est gelé et les PDF distribués le portent dans leur QR.
//
// Usage :
//   npx tsx scripts/migrate-document-storage.ts             → dry-run
//   npx tsx scripts/migrate-document-storage.ts --execute   → déplace

import { createClient } from '@supabase/supabase-js';
import { buildStoragePath } from '../frontend/src/services/invoiceIssuanceService';
import { fetchJurisdictionMeta } from '../frontend/src/lib/jurisdictionName';

process.loadEnvFile(new URL('../frontend/.env.local', import.meta.url));

const EXECUTE = process.argv.includes('--execute');
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('❌ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

interface Row {
    id: string;
    invoice_ref: string | null;
    invoice_pdf_url: string | null;
    status: string;
    created_at: string;
    jurisdiction_id: string | null;
}

async function main() {
    const { data, error } = await supabase
        .from('transactions')
        .select('id, invoice_ref, invoice_pdf_url, status, created_at, jurisdiction_id')
        .not('invoice_pdf_url', 'is', null);
    if (error) throw new Error(`transactions lookup failed: ${error.message}`);

    const rows = (data ?? []) as Row[];
    let moved = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
        const from = row.invoice_pdf_url!;
        // Les anciennes lignes stockaient une URL publique complète, pas un chemin.
        if (from.startsWith('http')) {
            console.log(`   ⏭️  ${row.id} — URL publique héritée, ignorée : ${from}`);
            skipped++;
            continue;
        }
        if (!row.invoice_ref) {
            console.log(`   ⏭️  ${row.id} — sans invoice_ref, relève du script d'émission`);
            skipped++;
            continue;
        }

        const jurisdiction = await fetchJurisdictionMeta(supabase, row.jurisdiction_id);
        const mode = row.invoice_ref.startsWith('INV') ? 'invoice' : 'proforma';
        const to = buildStoragePath({
            jurisdictionCode: jurisdiction.code,
            mode,
            createdAt: new Date(row.created_at),
            invoiceRef: row.invoice_ref,
        });

        if (from === to) { skipped++; continue; }
        console.log(`   ${EXECUTE ? '📦' : '🔍'} ${from}\n      → ${to}`);
        if (!EXECUTE) { moved++; continue; }

        const { error: copyErr } = await supabase.storage.from('documents').copy(from, to);
        if (copyErr) {
            console.error(`   ❌ copie échouée : ${copyErr.message}`);
            failed++;
            continue;
        }
        // Vérifier que la destination est lisible AVANT de supprimer la source.
        const { error: readErr } = await supabase.storage.from('documents').createSignedUrl(to, 60);
        if (readErr) {
            console.error(`   ❌ destination illisible, source conservée : ${readErr.message}`);
            failed++;
            continue;
        }
        const { error: updErr } = await supabase
            .from('transactions').update({ invoice_pdf_url: to }).eq('id', row.id);
        if (updErr) {
            console.error(`   ❌ mise à jour échouée, source conservée : ${updErr.message}`);
            failed++;
            continue;
        }
        await supabase.storage.from('documents').remove([from]);
        moved++;
    }

    console.log(`\n${EXECUTE ? '✅' : '🔍'} ${moved} objet(s) ${EXECUTE ? 'déplacés' : 'à déplacer'}, ${skipped} ignoré(s)${failed ? `, ❌ ${failed} en échec` : ''}.`);
    if (!EXECUTE) console.log('   Relancez avec --execute pour agir.');
    if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error('❌ Fatal:', e?.message ?? e); process.exit(1); });
```

- [ ] **Step 2 : Lancer en dry-run**

Run: `npx tsx scripts/migrate-document-storage.ts`
Expected: la liste des déplacements prévus, aucun write. Les objets sans `invoice_ref` et l'URL publique héritée de `MAERSK SEALAND` apparaissent comme ignorés.

- [ ] **Step 3 : Commit (sans exécuter)**

L'exécution touche un environnement partagé et relève d'une décision du PO — voir la section « Bascule » en fin de plan.

```bash
git add scripts/migrate-document-storage.ts
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "chore(storage): script de bascule des documents vers la nomenclature par juridiction"
```

---

### Task 8 : Vérification d'ensemble

- [ ] **Step 1 : Suite complète**

Run: `cd frontend && npx vitest run`
Expected: 0 échec. Le total doit dépasser le baseline de 1019 tests passés.

- [ ] **Step 2 : Typage**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune sortie.

- [ ] **Step 3 : Lint non dégradé**

Run: `cd frontend && npm run lint 2>&1 | tail -3`
Expected: `✖ 157 problems (62 errors, 95 warnings)` — identique au baseline `develop`. Toute erreur supplémentaire dans un fichier touché doit être corrigée.

- [ ] **Step 4 : Invariant de cohérence en base**

Run: `node scripts/db-query.mjs "SELECT count(*) FROM transactions WHERE invoice_pdf_url IS NOT NULL AND content_hash IS NULL"`
Expected: le compte ne doit pas avoir augmenté par rapport au relevé pris avant la Task 1. Les lignes préexistantes relèvent du rattrapage, pas de ce plan.

---

## Bascule (décision PO, hors exécution automatique)

Trois opérations touchent l'environnement partagé et ne doivent pas être lancées sans accord explicite :

1. **`INVOICE_SIGNING_SECRET` dans `frontend/.env.local`** — préalable à tout. `verify_signature` est first-write-only : émettre avec le repli de développement grave une signature que l'environnement déployé ne saura pas vérifier. La valeur se lit sur Vercel, projet `solidetechnology/greengate`.
2. **`npx tsx scripts/migrate-document-storage.ts --execute`** — déplace les 7 objets existants.
3. **`npx tsx scripts/issue-invoice-documents.ts --execute --origin https://greengate.africa`** — émet les documents des 6 transactions qui n'en ont pas.

Après bascule, contrôler dans le portail armateur que les pro-formas démo affichent un lien PDF, et que le QR d'un document fraîchement émis résout sur `/verify`.

## Chantiers suivants

**B — moteur de relance et traçabilité.** `collection_reminders` existe avec ses paliers J15/J30/J45 mais n'est alimentée que par le seed ; le cron J+3/J+7 de la mig 065 n'écrit que des notifications in-app, sans e-mail ni trace. Les deux mécanismes sont à fusionner, avec un écran staff d'historique et la saisie de la réponse du débiteur.

**C — relevé de compte mensuel.** Produit en début de mois sur le mois écoulé, affichant le solde dû. Version informative en phase 1 ; la pro-forma consolidée payable est une phase 2 distincte.

**Dette relevée en chemin.** `reconcilePipelineService` écrit lui aussi `invoice_pdf_url` et rouvrira le même défaut s'il sert sans être aligné sur le service d'émission. Les documents et e-mails restent produits en anglais alors que le portail gère sept langues. Deux reçus (`RCT-2026-65E28CEB`, `RCT-2026-81BE7109`) existent pour des pro-formas `PENDING`, ce qui n'a pas de sens métier.
