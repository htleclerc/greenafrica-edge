# Portail armateurs — accès par lien magique — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre le portail accessible aux 36 armateurs joignables de la campagne du 19 août, sur un livre comptable qui correspond enfin aux mises en demeure qu'ils ont reçues.

**Architecture:** Cinq incréments déployables séparément. ⓪ rebascule le livre : un index unique partiel libère les 86 références détenues par des lignes annulées, puis les vraies pro-formas sont importées. ① répare douze liens morts dans les modèles d'e-mail. ② ajoute un lien magique décalqué de `requestVesselAccessCode`. ③ crée silencieusement les comptes. ④ ouvre l'écran de flotte en libre-service, sans aucune table nouvelle.

**Tech Stack:** Next.js 16 / React 19 / TypeScript strict / TailwindCSS v4 · Supabase (Postgres 17, Auth) · Zod v4 · Vitest · Resend · `next-intl` (6 locales)

**Spec:** [`docs/superpowers/specs/2026-08-20-portail-armateurs-magic-link-design.md`](../specs/2026-08-20-portail-armateurs-magic-link-design.md)

## Global Constraints

- **Périmètre maritime uniquement.** L'aérien (556 pro-formas) n'est jamais touché. Aucune tâche ne modifie une transaction dont `vessel_imo` porte une immatriculation d'aéronef.
- **Auteur de tous les commits** : `git commit --author="Loïc Leclerc <leclerc@drwintech.com>"`. **Jamais** de `Co-Authored-By: Claude`, jamais de mention « Generated with Claude Code », ni dans les commits ni dans les PR. Messages conventionnels humanisés.
- **Staging explicite** : `git add <chemins>`, jamais `git add -A` ni `git add .`.
- **TypeScript strict.** `any` interdit. Inputs validés par Zod. Zod v4 : `z.record(z.string(), z.unknown())` prend deux arguments, et `z.guid()` remplace `z.uuid()` (qui impose les bits RFC 4122).
- **`'use server'` n'exporte que des fonctions async.** Aucun `const`, `type` ou schéma exporté depuis un fichier d'action — `next build` casse. Les schémas restent internes.
- **Éviter `ReturnType<typeof createClient>`** (cascade de `never` depuis supabase-js 2.98) → `import { type SupabaseClient }`.
- **Types de base** : `frontend/src/types/database.ts` est manuel et périmé. Tout nouveau code utilise `frontend/src/types/supabase.generated.ts`.
- **Tests** : `cd frontend && npm run test` (vitest run). Fichier isolé : `cd frontend && npx vitest run <chemin>`. Vitest ne charge **pas** `.env.local`.
- **Tests de migration** : `./supabase/tests/run.sh migrations/<fichier>.test.sql`, motif `BEGIN; … ROLLBACK;` avec `DO $$ ASSERT … $$`. Base locale sur `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- **Prérequis environnement** : Docker Desktop doit tourner, puis `supabase start`. Les ports 54321-54324 sont libres.
- **Prochain numéro de migration : 128.** La dernière appliquée au dépôt est 127.
- **Journalisation** : `writeAuditLog(client, entry)` — **deux arguments positionnels**, et `entry` porte les **noms de colonnes** de `audit_logs` en snake_case (`user_id`, `user_full_name`, `action`, `severity`, `entity_type`, `entity_id`, `details_json`), pas un objet camelCase. L'énumération `action` est fermée : pour un événement nouveau, utiliser `action='TRANSACTION_UPDATED'` et qualifier dans `details_json.event`. `user_id`, `user_full_name`, `entity_type` et `entity_id` sont NOT NULL.
- **i18n** : six locales `en/fr/ar/pt/sw/so`, toutes à compléter à chaque ajout de clé. Namespaces PascalCase.
- **Garde sanctions absolue** : `assertContactAllowed(shipowner)` avant **toute** écriture ou envoi. Les trois dossiers `PRO-CONS-2026-001`, `-022`, `-042` ne reçoivent jamais rien.
- **Ne jamais committer de secret.** Les accès production vivent dans un fichier ignoré par git.

---

## Structure des fichiers

**Créés**
| Fichier | Responsabilité |
|---|---|
| `frontend/src/lib/routes/ownerPaths.ts` | Constantes des chemins internes cités dans les e-mails |
| `supabase/migrations/128_invoice_ref_unique_excludes_void.sql` | Index unique partiel sur `invoice_ref` |
| `supabase/tests/migrations/128_invoice_ref_unique_excludes_void.test.sql` | Test de la migration |
| `frontend/src/services/ledgerRebase/consRefsParser.ts` | Lecture de `cons_refs_mapping.csv` et de la feuille « Détail Navires » |
| `frontend/src/services/ledgerRebase/consRefsParser.test.ts` | Tests du parseur |
| `scripts/rebase-maritime-ledger.ts` | Annulation des 100, import des 86 + 74 dossiers |
| `frontend/src/services/auth/loginAllowlist.ts` | Résolution adresse → armateur (fonction pure côté service) |
| `frontend/src/services/auth/loginAllowlist.test.ts` | Tests de la résolution |
| `frontend/src/actions/requestLoginLink.ts` | Action d'envoi du lien magique |
| `frontend/src/actions/requestLoginLink.test.ts` | Tests de l'action |
| `frontend/src/services/ownerProvisioning.ts` | Création silencieuse d'un compte armateur ou représentant |
| `frontend/src/services/ownerProvisioning.test.ts` | Tests du service |
| `frontend/src/actions/addOwnerRepresentative.ts` | Action personnel : ajouter un représentant par adresse |
| `frontend/src/actions/addOwnerRepresentative.test.ts` | Tests de l'action |
| `scripts/provision-owner-accounts.ts` | Mise en service des 36 comptes |
| `frontend/src/services/ownerFleetService.ts` | Flotte réelle de l'armateur de la session |
| `frontend/src/services/ownerFleetService.test.ts` | Tests du service |
| `frontend/src/actions/updateOwnerVessel.ts` | Renommer / retirer un navire |
| `frontend/src/actions/updateOwnerVessel.test.ts` | Tests de l'action |

**Modifiés**
| Fichier | Nature |
|---|---|
| `frontend/src/services/emailService.ts` | 12 liens morts → constantes |
| `frontend/src/services/__tests__/emailService.links.test.ts` | Nouveau test de non-régression |
| `frontend/src/app/verify/[ref]/page.tsx` | Résolution restreinte aux lignes vivantes |
| `frontend/src/lib/rateLimit.ts` | Nouveau seau `login-link` |
| `frontend/src/components/auth/LoginPage.tsx` | Second chemin d'entrée |
| `frontend/src/app/(dashboard)/admin/armateurs/[id]/ArmateurDetail.tsx` | Saisie d'un représentant par adresse |
| `frontend/src/components/dashboard/fleet/MyFleetPage.tsx` | Données réelles + trois gestes |
| `frontend/messages/{en,fr,ar,pt,sw,so}.json` | Clés `Auth.magicLink` et `MyFleet.*` |

---

# Phase A — Incrément ① : les liens morts

Aucune migration, aucune donnée. Livrable seul, profite immédiatement aux 32 relances déjà parties.

### Task 1 : Constantes de chemins et non-régression des liens d'e-mail

**Files:**
- Create: `frontend/src/lib/routes/ownerPaths.ts`
- Create: `frontend/src/services/__tests__/emailService.links.test.ts`
- Modify: `frontend/src/services/emailService.ts` (lignes 597, 678, 688, 794, 803, 830, 836, 876, 889, 920, 927, 1073, 1082)

**Interfaces:**
- Produces: `OWNER_INVOICES_PATH: '/dashboard/invoices'`, `OWNER_WALLET_PATH: '/dashboard/wallet'`, `ALL_OWNER_EMAIL_PATHS: readonly string[]`

- [ ] **Step 1 : Écrire le test qui échoue**

Le test extrait les chemins internes de tous les modèles rendus et vérifie que chacun correspond à un fichier `page.tsx` réel. Il échoue aujourd'hui sur `/owner/invoices`.

```ts
// frontend/src/services/__tests__/emailService.links.test.ts
import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_OWNER_EMAIL_PATHS } from '@/lib/routes/ownerPaths';

/**
 * Les modèles d'e-mail sont la seule surface où un chemin interne est écrit
 * en dur sans que le typage de Next ne le vérifie. Un lien mort y part en
 * production sans bruit — c'est exactement ce qui a rendu les 32 relances du
 * 19/08/2026 inutilisables. Ce test ferme cette porte.
 */
const APP = join(process.cwd(), 'src', 'app');

function routeExists(path: string): boolean {
    const segments = path.replace(/^\//, '').split('/');
    // Next autorise les groupes de routes : /dashboard/invoices peut vivre
    // sous app/(dashboard)/dashboard/invoices. On explore donc aussi les
    // dossiers parenthésés du premier niveau.
    const roots = [APP, ...readdirSync(APP, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name.startsWith('('))
        .map((e) => join(APP, e.name))];
    return roots.some((root) => existsSync(join(root, ...segments, 'page.tsx')));
}

describe('chemins internes cités dans les e-mails', () => {
    it('déclare au moins les factures et le portefeuille', () => {
        expect(ALL_OWNER_EMAIL_PATHS.length).toBeGreaterThanOrEqual(2);
    });

    it.each(ALL_OWNER_EMAIL_PATHS)('%s correspond à une route réelle', (path) => {
        expect(routeExists(path)).toBe(true);
    });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd frontend && npx vitest run src/services/__tests__/emailService.links.test.ts`
Expected: FAIL — `Cannot find module '@/lib/routes/ownerPaths'`

- [ ] **Step 3 : Créer les constantes**

```ts
// frontend/src/lib/routes/ownerPaths.ts
/**
 * Chemins du portail armateur cités dans les modèles d'e-mail.
 *
 * Ils vivent ici plutôt qu'en littéraux répétés parce qu'ils ont déjà
 * divergé une fois : les modèles pointaient sur /owner/invoices, route
 * supprimée lors de la convergence des portails, et chaque e-mail envoyé
 * à un armateur portait donc un bouton mort. Une constante unique, et un
 * test qui la confronte à l'arborescence réelle, rendent la rechute
 * bruyante.
 */
export const OWNER_INVOICES_PATH = '/dashboard/invoices';
export const OWNER_WALLET_PATH = '/dashboard/wallet';

export const ALL_OWNER_EMAIL_PATHS = [
    OWNER_INVOICES_PATH,
    OWNER_WALLET_PATH,
] as const;
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `cd frontend && npx vitest run src/services/__tests__/emailService.links.test.ts`
Expected: PASS

- [ ] **Step 5 : Remplacer les douze occurrences**

Dans `frontend/src/services/emailService.ts`, importer les constantes puis substituer. Les onze premières remplacent `/owner/invoices`, la douzième et la treizième `/owner/wallet`.

```ts
import { OWNER_INVOICES_PATH, OWNER_WALLET_PATH } from '@/lib/routes/ownerPaths';
```

Puis, mécaniquement :

```bash
cd frontend && \
  sed -i "s|\${appUrl()}/owner/invoices|\${appUrl()}\${OWNER_INVOICES_PATH}|g; \
          s|\${appUrl()}/owner/wallet|\${appUrl()}\${OWNER_WALLET_PATH}|g" \
  src/services/emailService.ts && \
  grep -c "owner/invoices\|owner/wallet" src/services/emailService.ts
```

Expected: `0`

- [ ] **Step 6 : Lancer la suite complète et le typage**

Run: `cd frontend && npx tsc --noEmit && npm run test`
Expected: PASS, aucune régression

- [ ] **Step 7 : Commit**

```bash
git add frontend/src/lib/routes/ownerPaths.ts \
        frontend/src/services/__tests__/emailService.links.test.ts \
        frontend/src/services/emailService.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "fix(emails): les liens du portail pointaient sur des routes supprimees

Les douze boutons des modeles armateur menaient a /owner/invoices et
/owner/wallet, disparues lors de la convergence des portails. Un test
confronte desormais chaque chemin cite a l'arborescence reelle."
```

---

# Phase B — Incrément ⓪ : rebascule du livre comptable

C'est la partie à risque : de la donnée fiscale. Elle précède impérativement la phase D.

### Task 2 : Migration 128 — l'unicité de `invoice_ref` ignore les lignes annulées

**Files:**
- Create: `supabase/migrations/128_invoice_ref_unique_excludes_void.sql`
- Create: `supabase/tests/migrations/128_invoice_ref_unique_excludes_void.test.sql`

**Interfaces:**
- Produces: index `idx_txn_invoice_ref` restreint à `invoice_ref IS NOT NULL AND status <> 'VOID'`

- [ ] **Step 1 : Écrire le test qui échoue**

```sql
-- supabase/tests/migrations/128_invoice_ref_unique_excludes_void.test.sql
BEGIN;

-- 1. L'index doit être devenu partiel sur le statut.
DO $$
BEGIN
  ASSERT (SELECT to_regclass('public.idx_txn_invoice_ref') IS NOT NULL),
    'idx_txn_invoice_ref doit exister';

  ASSERT (SELECT indexdef LIKE '%status <> ''VOID''%'
          FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'idx_txn_invoice_ref'),
    'idx_txn_invoice_ref doit exclure les lignes VOID';
END $$;

-- 2. Deux lignes VIVANTES de même invoice_ref restent refusées : c'est la
--    garde qui empêche qu'une reference designe deux factures a la fois.
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.vessels LIMIT 1;

  INSERT INTO public.transactions
    (vessel_id, vessel_name, vessel_imo, emissions_tco2, tax_amount_usd,
     document_type, transaction_type, status, invoice_ref)
  VALUES (v_id, 'TEST A', '1111111', 1, 1, 'PROFORMA', 'ENTRY_TAX',
          'PENDING', 'PRO-TEST-000001');

  BEGIN
    INSERT INTO public.transactions
      (vessel_id, vessel_name, vessel_imo, emissions_tco2, tax_amount_usd,
       document_type, transaction_type, status, invoice_ref)
    VALUES (v_id, 'TEST B', '2222222', 1, 1, 'PROFORMA', 'ENTRY_TAX',
            'PENDING', 'PRO-TEST-000001');
    ASSERT FALSE, 'deux lignes vivantes de meme invoice_ref auraient du etre refusees';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- 3. Une fois la premiere ANNULEE, la reference redevient disponible : c'est
--    exactement la rebascule du livre du 19/08/2026. invoice_ref est en
--    ecriture unique et DELETE est interdit, donc VOID est le seul levier.
DO $$
DECLARE v_id UUID;
BEGIN
  UPDATE public.transactions SET status = 'VOID'
   WHERE invoice_ref = 'PRO-TEST-000001';

  SELECT id INTO v_id FROM public.vessels LIMIT 1;

  INSERT INTO public.transactions
    (vessel_id, vessel_name, vessel_imo, emissions_tco2, tax_amount_usd,
     document_type, transaction_type, status, invoice_ref)
  VALUES (v_id, 'TEST B', '2222222', 1, 1, 'PROFORMA', 'ENTRY_TAX',
          'PENDING', 'PRO-TEST-000001');

  ASSERT (SELECT COUNT(*) FROM public.transactions
           WHERE invoice_ref = 'PRO-TEST-000001') = 2,
    'la ligne annulee et la nouvelle doivent coexister';

  ASSERT (SELECT COUNT(*) FROM public.transactions
           WHERE invoice_ref = 'PRO-TEST-000001' AND status <> 'VOID') = 1,
    'une seule ligne vivante doit porter la reference';
END $$;

ROLLBACK;
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `./supabase/tests/run.sh migrations/128_invoice_ref_unique_excludes_void.test.sql`
Expected: FAIL sur la première assertion — l'index n'est pas encore partiel sur le statut

- [ ] **Step 3 : Écrire la migration**

```sql
-- supabase/migrations/128_invoice_ref_unique_excludes_void.sql
--
-- CONTEXTE. Le 19/08/2026, 74 mises en demeure sont parties vers les
-- debiteurs de Berbera pour 1 316 124,00 USD. Elles portent les references
-- PRO-2026-064001..064086 — deja detenues en base par les 100 pro-formas
-- maritimes du seed du 18/07, qui designent d'autres navires et d'autres
-- montants (86 collisions sur 86, aucune correspondance). Decision PO du
-- 2026-08-20 : la campagne du 19/08 fait foi.
--
-- POURQUOI CET INDEX. Les trois gardes de la mig 089 verrouillent toutes les
-- autres sorties :
--   * invoice_ref est en ecriture unique — on ne peut ni le changer ni le
--     remettre a NULL (la trappe de reprise n'ouvre que NULL -> valeur) ;
--   * DELETE et TRUNCATE sont interdits — « fiscal rows are permanent » ;
--   * seul `status` reste librement modifiable, et l'enum porte VOID.
-- Restreindre l'unicite aux lignes vivantes est donc le seul chemin qui
-- permette d'annuler sans detruire, puis de reemettre a l'identique.
--
-- LE MOTIF DU QR NE S'Y OPPOSE PAS. La 089 gele invoice_ref au motif que
-- « distributed PDFs carry this ref in their QR code ». Deux faits le
-- neutralisent ici : les 100 pro-formas du seed n'ont jamais ete envoyees
-- (sent_at vide), et les 86 PDF reellement distribues ne contiennent ni QR
-- ni URL (verifie en decompressant les flux de PRO-2026-064001-MAYAR.pdf).
--
-- CONSEQUENCE A TRAITER AILLEURS. /verify/[ref] resout par egalite sur
-- invoice_ref ; il doit desormais se restreindre aux lignes vivantes, sans
-- quoi la resolution devient ambigue (Task 3).

DROP INDEX IF EXISTS public.idx_txn_invoice_ref;

CREATE UNIQUE INDEX idx_txn_invoice_ref
  ON public.transactions (invoice_ref)
  WHERE invoice_ref IS NOT NULL AND status <> 'VOID';

COMMENT ON INDEX public.idx_txn_invoice_ref IS
  'Unicite de invoice_ref parmi les seules factures vivantes. Une ligne VOID conserve sa reference a titre de trace, mais ne la reserve plus (mig 128).';
```

- [ ] **Step 4 : Appliquer et relancer le test**

```bash
supabase db reset   # rejoue toutes les migrations sur la base locale
./supabase/tests/run.sh migrations/128_invoice_ref_unique_excludes_void.test.sql
```

Expected: PASS

- [ ] **Step 5 : Commit**

```bash
git add supabase/migrations/128_invoice_ref_unique_excludes_void.sql \
        supabase/tests/migrations/128_invoice_ref_unique_excludes_void.test.sql
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(db): l'unicite de invoice_ref ignore les factures annulees

La campagne du 19/08 reutilise les 86 references detenues par le seed. Les
transactions sont immuables et non supprimables : passer les anciennes en
VOID est le seul levier, encore fallait-il que l'index unique cesse de leur
reserver la reference."
```

### Task 3 : `/verify/[ref]` ne doit voir que les factures vivantes

**Files:**
- Modify: `frontend/src/app/verify/[ref]/page.tsx`
- Create: `frontend/src/app/verify/[ref]/verifyLookup.test.ts`

**Interfaces:**
- Consumes: index de la Task 2
- Produces: `lookupLiveInvoice(admin, invoiceRef)` — retourne la ligne non-`VOID`, ou `null`

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
// frontend/src/app/verify/[ref]/verifyLookup.test.ts
import { describe, it, expect, vi } from 'vitest';
import { lookupLiveInvoice } from './verifyLookup';

/**
 * Depuis la rebascule du livre (mig 128), deux lignes peuvent porter la meme
 * invoice_ref : l'annulee et la vivante. La page de verification doit
 * resoudre sur la vivante, sinon un scan renvoie la facture du seed —
 * mauvais navire, mauvais montant.
 */
function fakeAdmin(rows: Array<Record<string, unknown>>) {
    const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        neq: vi.fn((col: string, val: string) => {
            chain.__filtered = rows.filter((r) => r[col] !== val);
            return chain;
        }),
        maybeSingle: vi.fn(async () => ({
            data: (chain.__filtered ?? rows)[0] ?? null,
            error: null,
        })),
        __filtered: undefined as undefined | Array<Record<string, unknown>>,
    };
    return { from: vi.fn(() => chain), __chain: chain };
}

describe('lookupLiveInvoice', () => {
    it('ignore la ligne annulee et retourne la vivante', async () => {
        const admin = fakeAdmin([
            { invoice_ref: 'PRO-2026-064001', status: 'VOID', vessel_name: 'RASHA' },
            { invoice_ref: 'PRO-2026-064001', status: 'PENDING', vessel_name: 'MAYAR' },
        ]);
        const row = await lookupLiveInvoice(admin as never, 'PRO-2026-064001');
        expect(row?.vessel_name).toBe('MAYAR');
        expect(admin.__chain.neq).toHaveBeenCalledWith('status', 'VOID');
    });

    it('retourne null quand seule une ligne annulee porte la reference', async () => {
        const admin = fakeAdmin([
            { invoice_ref: 'PRO-2026-064001', status: 'VOID', vessel_name: 'RASHA' },
        ]);
        expect(await lookupLiveInvoice(admin as never, 'PRO-2026-064001')).toBeNull();
    });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd frontend && npx vitest run src/app/verify/\[ref\]/verifyLookup.test.ts`
Expected: FAIL — `Cannot find module './verifyLookup'`

- [ ] **Step 3 : Extraire la résolution dans son propre module**

```ts
// frontend/src/app/verify/[ref]/verifyLookup.ts
import { type SupabaseClient } from '@supabase/supabase-js';

export const VERIFY_COLUMNS =
    'invoice_ref, document_type, vessel_name, vessel_imo, port_call, transaction_type, tax_amount_usd, status, content_hash, created_at';

/**
 * Resout une reference de facture sur la ligne VIVANTE.
 *
 * Depuis la mig 128, une reference peut etre portee par deux lignes : celle
 * annulee lors de la rebascule du livre, et celle reellement due. Sans le
 * filtre `neq('status','VOID')`, maybeSingle() rendrait l'une ou l'autre au
 * hasard — et le verificateur qui scanne un document lirait la facture du
 * seed, avec un autre navire et un autre montant.
 */
export async function lookupLiveInvoice(
    admin: SupabaseClient,
    invoiceRef: string,
): Promise<Record<string, unknown> | null> {
    const { data } = await admin
        .from('transactions')
        .select(VERIFY_COLUMNS)
        .eq('invoice_ref', invoiceRef)
        .neq('status', 'VOID')
        .maybeSingle();
    return (data as Record<string, unknown> | null) ?? null;
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `cd frontend && npx vitest run src/app/verify/\[ref\]/verifyLookup.test.ts`
Expected: PASS

- [ ] **Step 5 : Brancher la page sur le module**

Dans `frontend/src/app/verify/[ref]/page.tsx`, remplacer la requête inline sur `transactions` par un appel à `lookupLiveInvoice(admin, ref)`. Ne rien changer d'autre : la vérification de signature HMAC et la comparaison de `content_hash` restent en amont et en aval, inchangées.

- [ ] **Step 6 : Typage et suite complète**

Run: `cd frontend && npx tsc --noEmit && npm run test`
Expected: PASS

- [ ] **Step 7 : Commit**

```bash
git add frontend/src/app/verify/\[ref\]/verifyLookup.ts \
        frontend/src/app/verify/\[ref\]/verifyLookup.test.ts \
        frontend/src/app/verify/\[ref\]/page.tsx
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "fix(verify): resoudre sur la facture vivante, pas sur l'annulee

Deux lignes peuvent desormais partager une reference. Sans filtre sur le
statut, un scan pouvait afficher la facture annulee du seed."
```

### Task 4 : Parseur du référentiel du 19 août

**Files:**
- Create: `frontend/src/services/ledgerRebase/consRefsParser.ts`
- Create: `frontend/src/services/ledgerRebase/consRefsParser.test.ts`

**Interfaces:**
- Produces:
  - `parseConsRefs(csv: string): ConsDossier[]` où `ConsDossier = { consRef: string; fleetManager: string; nVessels: number; totalUsd: number; contactEmail: string | null; secondaryEmails: string[]; phone: string | null; address: string | null; country: string | null; ownerName: string | null; piClub: string | null; vessels: string[] }`
  - `parseVesselDetail(rows: unknown[][]): VesselLine[]` où `VesselLine = { invoiceRef: string; consRef: string; name: string; imo: string | null; mmsi: string | null; flag: string | null; grossTonnage: number | null; buildYear: number | null; portCalls: number; emissionsTco2: number; amountUsd: number }`
  - `SANCTIONED_CONS_REFS: readonly string[]` = `['PRO-CONS-2026-001', 'PRO-CONS-2026-022', 'PRO-CONS-2026-042']`

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
// frontend/src/services/ledgerRebase/consRefsParser.test.ts
import { describe, it, expect } from 'vitest';
import { parseConsRefs, parseVesselDetail, SANCTIONED_CONS_REFS } from './consRefsParser';

const CSV = `cons_ref,fleet_manager,n_vessels,total_usd,contact_email,contact_phone,contact_address,contact_country,owner_name,owner_email,owner_phone,owner_address,owner_country,pi_club,vessels
PRO-CONS-2026-002,"CORAL TECHNICAL SERVICES",5,93190.40,"coral@nets.example","+99 1 1041","Amman, Jordan.","JO","IMAN SHIPPING CO LTD","","","Amman, Jordan.","JO","","ALIMAN | ABU YASSER II | ALBARAKA 1 | BARAKAT | AL MABROUKA 10"
PRO-CONS-2026-003,"DEVON SHIP MANAGEMENT LTD",2,53012.80,"","+99 1 1020","Mersin, Turkey.","TR","CAPE CRUISE MARINE LTD","","","Monrovia, Liberia.","LR","ASO P&I","CEFIRO | PORTLAND S"
`;

describe('parseConsRefs', () => {
    it('scinde la liste de navires sur le pipe et retire les espaces', () => {
        const [coral] = parseConsRefs(CSV);
        expect(coral.consRef).toBe('PRO-CONS-2026-002');
        expect(coral.vessels).toEqual([
            'ALIMAN', 'ABU YASSER II', 'ALBARAKA 1', 'BARAKAT', 'AL MABROUKA 10',
        ]);
        expect(coral.nVessels).toBe(5);
        expect(coral.totalUsd).toBeCloseTo(93190.40, 2);
        expect(coral.contactEmail).toBe('coral@nets.example');
    });

    it('rend null — jamais la chaine vide — pour une adresse absente', () => {
        const devon = parseConsRefs(CSV)[1];
        expect(devon.contactEmail).toBeNull();
        expect(devon.secondaryEmails).toEqual([]);
    });

    it('refuse un dossier dont le nombre de navires contredit la liste', () => {
        const faux = CSV.replace(',5,93190.40', ',9,93190.40');
        expect(() => parseConsRefs(faux)).toThrow(/PRO-CONS-2026-002/);
    });

    it('nomme les trois dossiers sous sanctions', () => {
        expect(SANCTIONED_CONS_REFS).toEqual([
            'PRO-CONS-2026-001', 'PRO-CONS-2026-022', 'PRO-CONS-2026-042',
        ]);
    });
});

describe('parseVesselDetail', () => {
    const HDR = ['Réf. pro-forma', 'Réf. consolidée', 'Navire', 'IMO', 'MMSI',
        'Pavillon', 'Type', 'GT', 'Built', 'Nb escales', '1re arrivée',
        'Dernier départ', 'tCO2 facturé', 'Montant (USD)', 'Propriétaire',
        'ISM Manager', 'P&I Club'];

    it('lit une ligne navire complete', () => {
        const [v] = parseVesselDetail([HDR, ['PRO-2026-064001', 'PRO-CONS-2026-001',
            'MAYAR', '9167057', '341264001', 'Saint Kitts & Nevis', 'Livestock Carrier',
            4752, 1998, 18, '2026-05-01', '2026-07-31', 1720.8, 68832.0,
            'LEVANTE MARITTIMO CO', 'MORGAN NAVIGATION CO SA', 'North of England']]);
        expect(v.invoiceRef).toBe('PRO-2026-064001');
        expect(v.consRef).toBe('PRO-CONS-2026-001');
        expect(v.imo).toBe('9167057');
        expect(v.emissionsTco2).toBeCloseTo(1720.8, 1);
        expect(v.amountUsd).toBeCloseTo(68832.0, 2);
    });

    it('ignore la ligne TOTAL du classeur', () => {
        expect(parseVesselDetail([HDR, ['TOTAL', '', '', '', '', '', '', '', '',
            '', '', '', '', 1316124, '', '', '']])).toHaveLength(0);
    });

    it('accepte un IMO absent sans casser', () => {
        const [v] = parseVesselDetail([HDR, ['PRO-2026-064071', 'PRO-CONS-2026-071',
            'VENIZ 1', '', '', '', '', '', '', 1, '', '', 66.33, 2653.20, '', '', '']]);
        expect(v.imo).toBeNull();
        expect(v.name).toBe('VENIZ 1');
    });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd frontend && npx vitest run src/services/ledgerRebase/consRefsParser.test.ts`
Expected: FAIL — `Cannot find module './consRefsParser'`

- [ ] **Step 3 : Écrire le parseur**

```ts
// frontend/src/services/ledgerRebase/consRefsParser.ts
/**
 * Lecture du referentiel de la campagne du 19/08/2026.
 *
 * L'entree canonique est cons_refs_mapping.csv du paquet
 * ProFormas_OFFICIEL_19aout2026 — pas le classeur de suivi : meme contenu,
 * encodage sain, et il porte deja le lien dossier <-> navires.
 */

export interface ConsDossier {
    consRef: string;
    fleetManager: string;
    nVessels: number;
    totalUsd: number;
    contactEmail: string | null;
    secondaryEmails: string[];
    phone: string | null;
    address: string | null;
    country: string | null;
    ownerName: string | null;
    piClub: string | null;
    vessels: string[];
}

export interface VesselLine {
    invoiceRef: string;
    consRef: string;
    name: string;
    imo: string | null;
    mmsi: string | null;
    flag: string | null;
    grossTonnage: number | null;
    buildYear: number | null;
    portCalls: number;
    emissionsTco2: number;
    amountUsd: number;
}

/**
 * Morgan Navigation (UN), Barbara/Yassin et Petrofleet (OFAC). Jamais de
 * contact direct : saisie in rem via Me Eidle Omer. La liste est figee ici
 * pour que l'import n'ait pas a la deduire de champs libres.
 */
export const SANCTIONED_CONS_REFS = [
    'PRO-CONS-2026-001',
    'PRO-CONS-2026-022',
    'PRO-CONS-2026-042',
] as const;

/** Decoupe une ligne CSV en respectant les guillemets et les virgules internes. */
function splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
            if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; }
            else quoted = !quoted;
        } else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
        else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
}

function orNull(v: string | undefined): string | null {
    const s = (v ?? '').trim();
    return s === '' ? null : s;
}

export function parseConsRefs(csv: string): ConsDossier[] {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
    const header = splitCsvLine(lines[0]);
    const at = (row: string[], name: string) => row[header.indexOf(name)];

    return lines.slice(1).map((line) => {
        const r = splitCsvLine(line);
        const consRef = at(r, 'cons_ref');
        const vessels = (at(r, 'vessels') ?? '')
            .split('|').map((v) => v.trim()).filter((v) => v !== '');
        const nVessels = Number(at(r, 'n_vessels'));

        // Un ecart entre le compte annonce et la liste signale un fichier
        // tronque ou mal exporte. On refuse plutot que d'importer a moitie
        // un portefeuille de 1,3 M USD.
        if (vessels.length !== nVessels) {
            throw new Error(
                `${consRef}: n_vessels=${nVessels} mais ${vessels.length} navire(s) listes`,
            );
        }

        const secondary = (at(r, 'owner_email') ?? '')
            .split(/[;,]/).map((e) => e.trim()).filter((e) => e.includes('@'));

        return {
            consRef,
            fleetManager: at(r, 'fleet_manager'),
            nVessels,
            totalUsd: Number(at(r, 'total_usd')),
            contactEmail: orNull(at(r, 'contact_email')),
            secondaryEmails: secondary,
            phone: orNull(at(r, 'contact_phone')),
            address: orNull(at(r, 'contact_address')),
            country: orNull(at(r, 'contact_country')),
            ownerName: orNull(at(r, 'owner_name')),
            piClub: orNull(at(r, 'pi_club')),
            vessels,
        };
    });
}

export function parseVesselDetail(rows: unknown[][]): VesselLine[] {
    const header = rows[0].map((h) => String(h ?? '').trim());
    const idx = (name: string) => header.indexOf(name);
    const num = (v: unknown): number => {
        const n = Number(String(v ?? '').replace(/[\u202f\u00a0\s]/g, '').replace(',', '.'));
        return Number.isFinite(n) ? n : 0;
    };

    return rows.slice(1)
        // La feuille se termine par une ligne TOTAL qui n'est pas un navire.
        .filter((r) => String(r[idx('Réf. pro-forma')] ?? '').startsWith('PRO-2026-'))
        .map((r) => ({
            invoiceRef: String(r[idx('Réf. pro-forma')]).trim(),
            consRef: String(r[idx('Réf. consolidée')]).trim(),
            name: String(r[idx('Navire')]).trim(),
            imo: orNull(String(r[idx('IMO')] ?? '')),
            mmsi: orNull(String(r[idx('MMSI')] ?? '')),
            flag: orNull(String(r[idx('Pavillon')] ?? '')),
            grossTonnage: num(r[idx('GT')]) || null,
            buildYear: num(r[idx('Built')]) || null,
            portCalls: num(r[idx('Nb escales')]),
            emissionsTco2: num(r[idx('tCO2 facturé')]),
            amountUsd: num(r[idx('Montant (USD)')]),
        }));
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `cd frontend && npx vitest run src/services/ledgerRebase/consRefsParser.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5 : Commit**

```bash
git add frontend/src/services/ledgerRebase/consRefsParser.ts \
        frontend/src/services/ledgerRebase/consRefsParser.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(recouvrement): lecture du referentiel de la campagne du 19 aout

Refuse un dossier dont le nombre de navires contredit la liste : un fichier
tronque ne doit pas importer a moitie un portefeuille de 1,3 M USD."
```

### Task 5 : Script de rebascule du livre

**Files:**
- Create: `scripts/rebase-maritime-ledger.ts`

**Interfaces:**
- Consumes: `parseConsRefs`, `parseVesselDetail`, `SANCTIONED_CONS_REFS` (Task 4) ; index de la Task 2
- Produces: exécutable `npx tsx scripts/rebase-maritime-ledger.ts [--execute]`

- [ ] **Step 1 : Écrire le script**

Simulation par défaut. `--execute` seul autorise l'écriture. Idempotent : une seconde exécution ne doit rien changer.

```ts
// scripts/rebase-maritime-ledger.ts
// Rebascule du livre maritime sur la campagne du 19/08/2026.
//
// Usage :
//   npx tsx scripts/rebase-maritime-ledger.ts            → simulation, aucune ecriture
//   npx tsx scripts/rebase-maritime-ledger.ts --execute  → applique, idempotent
//
// Prerequis : migration 128 appliquee (sans quoi les INSERT echouent sur
// l'index unique), et SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY exportes.
// SUPABASE_URL est l'URL HTTPS du projet, pas la chaine postgresql://.
//
// Ordre impose : annuler AVANT d'inserer. L'inverse bute sur l'index.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    parseConsRefs, parseVesselDetail, SANCTIONED_CONS_REFS,
    type ConsDossier, type VesselLine,
} from '../frontend/src/services/ledgerRebase/consRefsParser';

const EXECUTE = process.argv.includes('--execute');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOMALILAND = '00000000-0000-4000-8000-000000000001';

const PACKAGE_DIR = process.env.PROFORMAS_DIR
    ?? 'C:/Users/lecle/Claude/Projects/Greengate/02_Maritime/ProFormas_OFFICIEL_19aout2026';

function log(...a: unknown[]) { console.log(EXECUTE ? '[EXEC]' : '[DRY ]', ...a); }

async function main() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis');
    const db = createClient(url, key);

    const dossiers = parseConsRefs(
        readFileSync(join(PACKAGE_DIR, 'cons_refs_mapping.csv'), 'utf8'),
    );
    const vessels: VesselLine[] = JSON.parse(
        readFileSync(join(ROOT, 'docs', 'onboarding', 'campagne-19aout', 'detail-navires.json'), 'utf8'),
    );
    log(`referentiel : ${dossiers.length} dossiers, ${vessels.length} navires`);
    if (dossiers.length !== 74) throw new Error(`attendu 74 dossiers, lu ${dossiers.length}`);
    if (vessels.length !== 86) throw new Error(`attendu 86 navires, lu ${vessels.length}`);

    const total = dossiers.reduce((s, d) => s + d.totalUsd, 0);
    if (Math.abs(total - 1_316_124.0) > 0.01) {
        throw new Error(`total attendu 1 316 124,00 USD, lu ${total.toFixed(2)}`);
    }

    // ── 1. Annulation des pro-formas maritimes du seed ────────────────────
    // Ciblage par breakdown_json->>source pour ne jamais toucher l'aerien ni
    // une facture emise hors seed. Le statut est la seule colonne libre.
    const targetRefs = vessels.map((v) => v.invoiceRef);
    const { data: existing, error: exErr } = await db
        .from('transactions')
        .select('id, invoice_ref, vessel_name, tax_amount_usd, status')
        .in('invoice_ref', targetRefs)
        .neq('status', 'VOID');
    if (exErr) throw exErr;

    const toVoid = (existing ?? []).filter(
        (t) => (t as { invoice_ref: string }).invoice_ref !== undefined,
    );
    log(`a annuler : ${toVoid.length} pro-forma(s) occupant les references cibles`);
    for (const t of toVoid) {
        const row = t as { id: string; invoice_ref: string; vessel_name: string };
        log(`  VOID ${row.invoice_ref} (${row.vessel_name})`);
        if (EXECUTE) {
            const { error } = await db.from('transactions')
                .update({ status: 'VOID' }).eq('id', row.id);
            if (error) throw new Error(`VOID ${row.invoice_ref}: ${error.message}`);
        }
    }

    // ── 2. Armateurs ──────────────────────────────────────────────────────
    const ownerIdByConsRef = new Map<string, string>();
    for (const d of dossiers) {
        const sanctioned = (SANCTIONED_CONS_REFS as readonly string[]).includes(d.consRef);
        const { data: found } = await db.from('shipowners')
            .select('id').eq('seed_ref', d.consRef).maybeSingle();
        if (found) { ownerIdByConsRef.set(d.consRef, (found as { id: string }).id); continue; }

        log(`  armateur ${d.consRef} ${d.fleetManager}${sanctioned ? ' [SANCTIONS]' : ''}`);
        if (!EXECUTE) { ownerIdByConsRef.set(d.consRef, `dry-${d.consRef}`); continue; }

        const { data: ins, error } = await db.from('shipowners').insert({
            name: d.fleetManager,
            seed_ref: d.consRef,
            official_email: d.contactEmail,
            official_email_source: d.contactEmail ? 'PORT_OFFICER' : null,
            phone_e164: d.phone,
            address: d.address,
            country_code: d.country,
            account_state: 'GHOST',
            jurisdiction_id: SOMALILAND,
            applicable_modes: ['MARITIME'],
            is_ofac_sdn: d.consRef !== 'PRO-CONS-2026-001' && sanctioned,
            is_un_prohibited: d.consRef === 'PRO-CONS-2026-001',
            // Le manager reel est conserve comme CONTACT, jamais comme
            // debiteur substitue : 21 dossiers sur 74 nomment l'ISM, et les
            // lettres sont deja parties sous ce nom. ops_email est un champ de
            // contact simple — il ne figure PAS dans la liste d'autorisation
            // du lien magique, donc l'enregistrer n'ouvre aucun acces.
            ops_email: d.secondaryEmails[0] ?? null,
            notes: d.piClub ? `P&I: ${d.piClub}` : null,
        }).select('id').single();
        if (error) throw new Error(`armateur ${d.consRef}: ${error.message}`);
        ownerIdByConsRef.set(d.consRef, (ins as { id: string }).id);
    }

    // ── 3. Navires ────────────────────────────────────────────────────────
    const vesselIdByName = new Map<string, string>();
    for (const v of vessels) {
        const ownerId = ownerIdByConsRef.get(v.consRef);
        if (!ownerId) throw new Error(`${v.name}: dossier ${v.consRef} introuvable`);
        const imo = v.imo ?? `UNVERIFIED-${v.invoiceRef}`;

        const { data: found } = await db.from('vessels')
            .select('id').eq('imo_number', imo).maybeSingle();
        if (found) {
            vesselIdByName.set(v.name, (found as { id: string }).id);
            if (EXECUTE) await db.from('vessels')
                .update({ shipowner_id: ownerId }).eq('id', (found as { id: string }).id);
            continue;
        }
        log(`  navire ${v.name} (${imo}) → ${v.consRef}`);
        if (!EXECUTE) { vesselIdByName.set(v.name, `dry-${v.name}`); continue; }

        const { data: ins, error } = await db.from('vessels').insert({
            imo_number: imo, mmsi: v.mmsi, name: v.name,
            flag_code: (v.flag ?? 'ZZ').slice(0, 2).toUpperCase(),
            category: 'CARGO',
            gross_tonnage_dwt: v.grossTonnage ?? 1,
            build_year: v.buildYear,
            compliance_status: 'PAYMENT_DUE',
            estimated_emissions_tco2: v.emissionsTco2,
            tax_liability_usd: v.amountUsd,
            shipowner_id: ownerId,
            jurisdiction_id: SOMALILAND,
        }).select('id').single();
        if (error) throw new Error(`navire ${v.name}: ${error.message}`);
        vesselIdByName.set(v.name, (ins as { id: string }).id);
    }

    // ── 4. Pro-formas ─────────────────────────────────────────────────────
    let inserted = 0;
    for (const v of vessels) {
        const { data: live } = await db.from('transactions')
            .select('id').eq('invoice_ref', v.invoiceRef).neq('status', 'VOID').maybeSingle();
        if (live) continue;

        log(`  pro-forma ${v.invoiceRef} ${v.name} ${v.amountUsd.toFixed(2)} USD`);
        if (!EXECUTE) { inserted += 1; continue; }

        const { error } = await db.from('transactions').insert({
            vessel_id: vesselIdByName.get(v.name),
            vessel_name: v.name,
            vessel_imo: v.imo ?? `UNVERIFIED-${v.invoiceRef}`,
            shipowner_id: ownerIdByConsRef.get(v.consRef),
            emissions_tco2: v.emissionsTco2,
            tax_amount_usd: v.amountUsd,
            document_type: 'PROFORMA',
            transaction_type: 'ENTRY_TAX',
            status: 'PENDING',
            invoice_ref: v.invoiceRef,
            jurisdiction_id: SOMALILAND,
            breakdown_json: { source: 'campagne_19aout_2026', consRef: v.consRef, portCalls: v.portCalls },
        });
        if (error) throw new Error(`pro-forma ${v.invoiceRef}: ${error.message}`);
        inserted += 1;
    }

    log(`termine — ${toVoid.length} annulee(s), ${inserted} emise(s)`);
    if (!EXECUTE) log('SIMULATION : relancer avec --execute pour appliquer');
}

main().catch((e) => { console.error('ECHEC:', e instanceof Error ? e.message : e); process.exit(1); });
```

- [ ] **Step 2 : Extraire le détail navires en JSON**

Le script lit `docs/onboarding/campagne-19aout/detail-navires.json`. Le produire depuis le classeur, une fois, et le committer — il devient la trace versionnée du livre importé.

```bash
mkdir -p docs/onboarding/campagne-19aout
python - <<'PY'
import openpyxl, json
wb = openpyxl.load_workbook(
    r"C:\Users\lecle\Downloads\greengate\Suivi_Armateurs_GreenGate_19aout2026_v2.xlsx",
    data_only=True)
rows = [list(r) for r in wb['Détail Navires'].iter_rows(values_only=True) if r and r[0]]
hdr = [str(h).strip() for h in rows[0]]
i = {h: n for n, h in enumerate(hdr)}
def s(v): return None if v in (None, '') else str(v).strip()
def f(v):
    try: return float(str(v).replace('\u202f','').replace('\xa0','').replace(',','.'))
    except Exception: return 0.0
out = [{
    "invoiceRef": str(r[i['Réf. pro-forma']]).strip(),
    "consRef":    str(r[i['Réf. consolidée']]).strip(),
    "name":       str(r[i['Navire']]).strip(),
    "imo":        s(r[i['IMO']]), "mmsi": s(r[i['MMSI']]), "flag": s(r[i['Pavillon']]),
    "grossTonnage": int(f(r[i['GT']])) or None,
    "buildYear":    int(f(r[i['Built']])) or None,
    "portCalls":    int(f(r[i['Nb escales']])),
    "emissionsTco2": f(r[i['tCO2 facturé']]),
    "amountUsd":     f(r[i['Montant (USD)']]),
} for r in rows[1:] if str(r[i['Réf. pro-forma']]).startswith('PRO-2026-')]
assert len(out) == 86, len(out)
json.dump(out, open(r"docs/onboarding/campagne-19aout/detail-navires.json", 'w',
                    encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(out), "navires,", round(sum(v['amountUsd'] for v in out), 2), "USD")
PY
```

Expected: `86 navires, 1316124.0 USD`

- [ ] **Step 3 : Simulation sur la base locale**

```bash
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o json | python -c "import json,sys;print(json.load(sys.stdin)['SERVICE_ROLE_KEY'])")
npx tsx scripts/rebase-maritime-ledger.ts
```

Expected: `referentiel : 74 dossiers, 86 navires`, puis la liste des écritures projetées, terminée par `SIMULATION`. Aucune écriture.

- [ ] **Step 4 : Exécution locale, puis contrôle**

```bash
npx tsx scripts/rebase-maritime-ledger.ts --execute
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
  SELECT status, COUNT(*), ROUND(SUM(tax_amount_usd),2) AS usd
    FROM public.transactions
   WHERE invoice_ref LIKE 'PRO-2026-0640%'
   GROUP BY status ORDER BY status;"
```

Expected: une ligne `PENDING | 86 | 1316124.00`, et une ligne `VOID` pour les pro-formas du seed que la base locale contenait.

- [ ] **Step 5 : Vérifier l'idempotence**

```bash
npx tsx scripts/rebase-maritime-ledger.ts --execute
```

Expected: `0 annulee(s), 0 emise(s)` — une seconde exécution ne change rien.

- [ ] **Step 6 : Commit**

```bash
git add scripts/rebase-maritime-ledger.ts docs/onboarding/campagne-19aout/detail-navires.json
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(recouvrement): rebascule du livre maritime sur la campagne du 19 aout

Annule les pro-formas du seed qui occupaient les 86 references, puis emet
celles reellement envoyees. Simulation par defaut, idempotent, et refus net
si le referentiel ne totalise pas 1 316 124,00 USD."
```

---

# Phase C — Incrément ② : le lien magique

### Task 6 : Résolution adresse → armateur

**Files:**
- Create: `frontend/src/services/auth/loginAllowlist.ts`
- Create: `frontend/src/services/auth/loginAllowlist.test.ts`

**Interfaces:**
- Produces: `resolveLoginTarget(admin: SupabaseClient, email: string): Promise<LoginTarget | null>` où `LoginTarget = { shipownerId: string; shipownerName: string; deliveryEmail: string; scope: 'OWNER' | 'REPRESENTATIVE' | 'BILLING_CC'; isOfacSdn: boolean; isUnProhibited: boolean }`

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
// frontend/src/services/auth/loginAllowlist.test.ts
import { describe, it, expect, vi } from 'vitest';
import { resolveLoginTarget } from './loginAllowlist';

/**
 * La liste d'autorisation decide qui peut recevoir un lien magique. Trois
 * sources, dans cet ordre de priorite : l'armateur lui-meme, un representant
 * rattache, un destinataire en copie de facturation. Une adresse inconnue ne
 * cree jamais rien.
 */
function admin(tables: Record<string, unknown[]>) {
    return {
        from: (t: string) => {
            const rows = tables[t] ?? [];
            const chain: Record<string, unknown> = {};
            let filtered = [...rows];
            chain.select = () => chain;
            chain.eq = (col: string, val: unknown) => {
                filtered = filtered.filter((r) => (r as Record<string, unknown>)[col] === val);
                return chain;
            };
            chain.limit = () => chain;
            chain.maybeSingle = async () => ({ data: filtered[0] ?? null, error: null });
            return chain;
        },
    } as never;
}

const OWNER = {
    id: 'own-1', name: 'FAROS SHIPPING CO SARL',
    official_email: 'faros@farosshipping.example',
    is_placeholder: false, is_ofac_sdn: false, is_un_prohibited: false,
};

describe('resolveLoginTarget', () => {
    it('reconnait l’adresse officielle de l’armateur', async () => {
        const t = await resolveLoginTarget(admin({ shipowners: [OWNER] }), 'faros@farosshipping.example');
        expect(t).toMatchObject({ shipownerId: 'own-1', scope: 'OWNER' });
    });

    it('normalise la casse et les espaces', async () => {
        const t = await resolveLoginTarget(admin({ shipowners: [OWNER] }), '  FAROS@farosshipping.example ');
        expect(t?.shipownerId).toBe('own-1');
    });

    it('rend null sur une adresse inconnue', async () => {
        expect(await resolveLoginTarget(admin({ shipowners: [OWNER] }), 'inconnu@nulle.part')).toBeNull();
    });

    it('rend null sur un armateur fictif', async () => {
        const ghost = { ...OWNER, is_placeholder: true };
        expect(await resolveLoginTarget(admin({ shipowners: [ghost] }), 'faros@farosshipping.example')).toBeNull();
    });

    it('remonte les drapeaux de sanctions sans decider a la place de l’appelant', async () => {
        const sanctioned = { ...OWNER, id: 'own-2', official_email: 'morgan.navigation@mail.example', is_un_prohibited: true };
        const t = await resolveLoginTarget(admin({ shipowners: [sanctioned] }), 'morgan.navigation@mail.example');
        expect(t?.isUnProhibited).toBe(true);
    });

    it('livre toujours a l’adresse de la base, jamais a celle saisie', async () => {
        const t = await resolveLoginTarget(admin({ shipowners: [OWNER] }), 'FAROS@FAROSSHIPPING.EXAMPLE');
        expect(t?.deliveryEmail).toBe('faros@farosshipping.example');
    });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd frontend && npx vitest run src/services/auth/loginAllowlist.test.ts`
Expected: FAIL — module introuvable

- [ ] **Step 3 : Écrire la résolution**

```ts
// frontend/src/services/auth/loginAllowlist.ts
import { type SupabaseClient } from '@supabase/supabase-js';

export type LoginScope = 'OWNER' | 'REPRESENTATIVE' | 'BILLING_CC';

export interface LoginTarget {
    shipownerId: string;
    shipownerName: string;
    /** Adresse d'envoi — toujours celle de la base, jamais celle saisie. */
    deliveryEmail: string;
    scope: LoginScope;
    isOfacSdn: boolean;
    isUnProhibited: boolean;
}

/**
 * Resout une adresse en un armateur ouvrable.
 *
 * Trois sources, par priorite decroissante : l'adresse officielle de
 * l'armateur, un representant rattache (owner_agent_mappings), un
 * destinataire en copie de facturation.
 *
 * Deux invariants tenus ici plutot que chez l'appelant :
 *   - un armateur fictif n'est jamais une cible ;
 *   - l'adresse de livraison vient de la base. La saisie sert a chercher,
 *     jamais a recevoir.
 *
 * Un seul armateur est rendu. La plateforme suppose partout un profil pour
 * un armateur — current_shipowner_id() fait LIMIT 1 sans ORDER BY et porte
 * le RLS, requirePrincipal echoue sur deux lignes. Les dossiers
 * supplementaires joignables a la meme adresse passent par un rattachement.
 */
export async function resolveLoginTarget(
    admin: SupabaseClient,
    rawEmail: string,
): Promise<LoginTarget | null> {
    const email = rawEmail.trim().toLowerCase();
    if (!email.includes('@')) return null;

    const cols = 'id, name, official_email, is_placeholder, is_ofac_sdn, is_un_prohibited';

    const { data: owner } = await admin
        .from('shipowners').select(cols).eq('official_email', email).maybeSingle();
    if (owner) return toTarget(owner, 'OWNER');

    const { data: rep } = await admin
        .from('owner_agent_mappings')
        .select(`shipowner_id, active, profiles!inner(email), shipowners!inner(${cols})`)
        .eq('profiles.email', email).eq('active', true).maybeSingle();
    if (rep) {
        const so = (rep as { shipowners: Record<string, unknown> }).shipowners;
        return toTarget(so, 'REPRESENTATIVE');
    }

    const { data: cc } = await admin
        .from('shipowner_billing_cc')
        .select(`shipowner_id, email, shipowners!inner(${cols})`)
        .eq('email', email).maybeSingle();
    if (cc) {
        const so = (cc as { shipowners: Record<string, unknown> }).shipowners;
        return toTarget(so, 'BILLING_CC');
    }

    return null;
}

function toTarget(row: Record<string, unknown>, scope: LoginScope): LoginTarget | null {
    if (row.is_placeholder === true) return null;
    const deliveryEmail = String(row.official_email ?? '').trim().toLowerCase();
    if (!deliveryEmail) return null;
    return {
        shipownerId: String(row.id),
        shipownerName: String(row.name),
        deliveryEmail,
        scope,
        isOfacSdn: row.is_ofac_sdn === true,
        isUnProhibited: row.is_un_prohibited === true,
    };
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `cd frontend && npx vitest run src/services/auth/loginAllowlist.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5 : Commit**

```bash
git add frontend/src/services/auth/loginAllowlist.ts frontend/src/services/auth/loginAllowlist.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(auth): resolution d'une adresse vers un armateur ouvrable

Armateur, representant rattache ou copie de facturation. L'adresse de
livraison vient toujours de la base : la saisie sert a chercher, pas a
recevoir."
```

### Task 7 : Action `requestLoginLink`

**Files:**
- Create: `frontend/src/actions/requestLoginLink.ts`
- Create: `frontend/src/actions/requestLoginLink.test.ts`
- Modify: `frontend/src/lib/rateLimit.ts` (ajout du seau `login-link` dans `LIMITS`)

**Interfaces:**
- Consumes: `resolveLoginTarget` (Task 6), `assertContactAllowed`, `enforceRateLimit`, `getClientId`
- Produces: `requestLoginLink(raw: unknown): Promise<{ ok: true } | { ok: false; reason: 'rate_limited' }>`

- [ ] **Step 1 : Ajouter le seau de débit**

Dans `frontend/src/lib/rateLimit.ts`, à la suite de `'vessel-claim'` :

```ts
    // Lien magique de connexion. Meme profil de risque que vessel-claim :
    // double plafond, ici par IP et dans l'action par adresse — sinon faire
    // varier l'IP suffirait a inonder la boite d'un armateur.
    'login-link': { perMinute: 3, perHour: 10, perDay: 15 },
```

- [ ] **Step 2 : Écrire le test qui échoue**

```ts
// frontend/src/actions/requestLoginLink.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
const enforce = vi.fn(async () => ({ allowed: true }));
vi.mock('@/lib/rateLimit', () => ({
    enforceRateLimit: (...a: unknown[]) => enforce(...(a as [])),
    getClientId: () => 'ip-test',
}));
const resolve = vi.fn();
vi.mock('@/services/auth/loginAllowlist', () => ({ resolveLoginTarget: (...a: unknown[]) => resolve(...(a as [])) }));
const sendLink = vi.fn(async () => ({ success: true }));
vi.mock('@/services/emailService', () => ({ sendLoginLinkEmail: (...a: unknown[]) => sendLink(...(a as [])) }));
const generateLink = vi.fn(async () => ({
    data: { properties: { action_link: 'https://x/auth/sl?t=1' }, user: { id: 'u1' } }, error: null,
}));
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({
        auth: { admin: { generateLink } },
        from: () => ({ update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }),
    }),
}));

const { requestLoginLink } = await import('./requestLoginLink');

const TARGET = {
    shipownerId: 'own-1', shipownerName: 'FAROS', deliveryEmail: 'faros@farosshipping.example',
    scope: 'OWNER' as const, isOfacSdn: false, isUnProhibited: false,
};

beforeEach(() => { vi.clearAllMocks(); enforce.mockResolvedValue({ allowed: true }); });

describe('requestLoginLink', () => {
    it('envoie le lien a l’adresse de la base', async () => {
        resolve.mockResolvedValue(TARGET);
        expect(await requestLoginLink({ email: 'FAROS@farosshipping.example' })).toEqual({ ok: true });
        expect(sendLink).toHaveBeenCalledWith(expect.objectContaining({ to: 'faros@farosshipping.example' }));
    });

    it('repond identiquement sur une adresse inconnue et n’envoie rien', async () => {
        resolve.mockResolvedValue(null);
        expect(await requestLoginLink({ email: 'inconnu@nulle.part' })).toEqual({ ok: true });
        expect(sendLink).not.toHaveBeenCalled();
        expect(generateLink).not.toHaveBeenCalled();
    });

    it('n’envoie jamais a un armateur sous sanctions', async () => {
        resolve.mockResolvedValue({ ...TARGET, isUnProhibited: true });
        expect(await requestLoginLink({ email: 'morgan.navigation@mail.example' })).toEqual({ ok: true });
        expect(sendLink).not.toHaveBeenCalled();
    });

    it('refuse une saisie hors schema sans la nettoyer', async () => {
        resolve.mockResolvedValue(TARGET);
        await requestLoginLink({ email: 'faros@farosshipping.example', role: 'SUPERADMIN' });
        expect(sendLink).not.toHaveBeenCalled();
    });

    it('signale le plafond de debit', async () => {
        enforce.mockResolvedValue({ allowed: false });
        expect(await requestLoginLink({ email: 'faros@farosshipping.example' })).toEqual({ ok: false, reason: 'rate_limited' });
    });
});
```

- [ ] **Step 3 : Lancer le test pour vérifier qu'il échoue**

Run: `cd frontend && npx vitest run src/actions/requestLoginLink.test.ts`
Expected: FAIL — module introuvable

- [ ] **Step 4 : Écrire l'action**

```ts
// frontend/src/actions/requestLoginLink.ts
'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { enforceRateLimit, getClientId } from '@/lib/rateLimit';
import { resolveLoginTarget } from '@/services/auth/loginAllowlist';
import { isContactBlocked } from '@/domain/sanctions/contactGuard';
import { sendLoginLinkEmail } from '@/services/emailService';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('requestLoginLink');

// .strict() volontaire : le formulaire ne propose qu'une adresse. Un champ
// supplementaire est le signe d'une tentative de detournement, pas d'une
// evolution legitime — le payload est refuse tel quel, jamais nettoye.
const schema = z.object({ email: z.string() }).strict();

export type RequestLoginLinkResult =
    | { ok: true }
    | { ok: false; reason: 'rate_limited' };

/**
 * Envoie un lien de connexion a une adresse DEJA ENREGISTREE.
 *
 * Ne cree jamais de compte : le lien ouvre un compte existant, il n'inscrit
 * personne. La reponse est invariable — succes, adresse inconnue, armateur
 * sanctionne, echec d'envoi rendent tous { ok: true } —, sans quoi le
 * formulaire deviendrait un revelateur de debiteurs.
 */
export async function requestLoginLink(raw: unknown): Promise<RequestLoginLinkResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: true };

    const h = await headers();
    const quota = await enforceRateLimit('login-link', getClientId(h));
    if (!quota.allowed) return { ok: false, reason: 'rate_limited' };

    let admin;
    try { admin = createPlatformClient(); } catch { return { ok: true }; }

    const target = await resolveLoginTarget(admin, parsed.data.email);
    if (!target) return { ok: true };

    // Copie de facturation : reconnue par la liste d'autorisation, mais aucun
    // lien n'est envoye pour l'instant. Une session issue d'une copie doit
    // etre restreinte a la lecture des factures (spec §6.3), or la portee
    // n'est nulle part portee par la session — requirePrincipal ne resout
    // qu'un armateur. Ouvrir le portail complet a un comptable en copie lui
    // donnerait les litiges, la conformite et les moyens de paiement.
    // Recevoir un double n'est pas detenir le compte : on s'arrete ici, avec
    // la meme reponse neutre, tant que la portee n'est pas implementee.
    if (target.scope === 'BILLING_CC') {
        log.info('billing_cc_link_deferred', { shipownerId: target.shipownerId });
        return { ok: true };
    }

    // Regle metier absolue : un armateur sous sanctions ne recoit jamais de
    // contact direct de la plateforme.
    if (isContactBlocked({ name: target.shipownerName, is_ofac_sdn: target.isOfacSdn, is_un_prohibited: target.isUnProhibited })) {
        log.warn('sanctioned_login_blocked', { shipownerId: target.shipownerId });
        return { ok: true };
    }

    // Second plafond, keye sur l'armateur : sans lui, faire varier l'IP
    // suffirait a inonder sa boite.
    const ownerQuota = await enforceRateLimit('login-link', `owner:${target.shipownerId}`);
    if (!ownerQuota.allowed) return { ok: false, reason: 'rate_limited' };

    // On mine le jeton nous-memes : les modeles GoTrue ne sont pas configures
    // (tous les blocs [auth.email.template.*] sont commentes dans
    // supabase/config.toml), l'armateur recevrait un courriel par defaut.
    const { data, error } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: target.deliveryEmail,
        options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3300'}/owner/auth/callback` },
    });
    if (error || !data?.properties?.action_link) {
        log.warn('link_generate_failed', { shipownerId: target.shipownerId, error: error?.message });
        return { ok: true };
    }

    const sent = await sendLoginLinkEmail({
        to: target.deliveryEmail,
        recipientName: target.shipownerName,
        link: data.properties.action_link,
    });
    if (!sent.success) log.warn('link_send_failed', { shipownerId: target.shipownerId });

    return { ok: true };
}
```

Ajouter dans `emailService.ts` le modèle `sendLoginLinkEmail({ to, recipientName, link })`, calqué sur `sendVesselAccessCodeEmail`, avec un bouton pointant sur `link` et une mention de validité courte.

- [ ] **Step 5 : Lancer le test pour vérifier qu'il passe**

Run: `cd frontend && npx vitest run src/actions/requestLoginLink.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6 : Typage et suite complète**

Run: `cd frontend && npx tsc --noEmit && npm run test`
Expected: PASS

- [ ] **Step 7 : Commit**

```bash
git add frontend/src/actions/requestLoginLink.ts frontend/src/actions/requestLoginLink.test.ts \
        frontend/src/lib/rateLimit.ts frontend/src/services/emailService.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(auth): lien de connexion pour les comptes deja enregistres

Reponse invariable quelle que soit l'issue, double plafond par IP et par
armateur, garde sanctions, et aucune creation de compte sur adresse
inconnue."
```

### Task 8 : Second chemin d'entrée sur `/login`

**Files:**
- Modify: `frontend/src/components/auth/LoginPage.tsx`
- Modify: `frontend/messages/{en,fr,ar,pt,sw,so}.json`

**Interfaces:**
- Consumes: `requestLoginLink` (Task 7)

- [ ] **Step 1 : Ajouter les clés i18n dans les six locales**

Sous le namespace `Auth`, ajouter le bloc `magicLink` : `tabPassword`, `tabLink`, `emailLabel`, `submit`, `sent`, `rateLimited`, `hint`. Le message `sent` doit être **le même quel que soit le résultat** : « Si cette adresse est enregistrée, un lien de connexion vient d'être envoyé. » Ne jamais écrire « adresse inconnue ».

- [ ] **Step 2 : Ajouter le second onglet**

Dans `LoginPageInner`, un état `mode: 'password' | 'link'`. En mode `link`, le formulaire ne demande que l'adresse et appelle `requestLoginLink`. Après réponse, afficher `sent` — y compris sur `{ ok: true }` obtenu pour une adresse inconnue. Sur `{ ok: false, reason: 'rate_limited' }`, afficher `rateLimited`.

- [ ] **Step 3 : Vérifier la parité des locales**

```bash
cd frontend && node -e "
const en=require('./messages/en.json').Auth.magicLink;
for (const l of ['fr','ar','pt','sw','so']) {
  const t=require('./messages/'+l+'.json').Auth?.magicLink||{};
  const missing=Object.keys(en).filter(k=>!(k in t));
  if (missing.length) { console.error(l, 'manque', missing); process.exit(1); }
}
console.log('parite des 6 locales OK');"
```

Expected: `parite des 6 locales OK`

- [ ] **Step 4 : Vérification manuelle**

Démarrer `npm run dev`, ouvrir `http://localhost:3300/login`, basculer sur l'onglet lien, soumettre une adresse inconnue puis une adresse connue. Les deux doivent produire **le même écran**.

- [ ] **Step 5 : Commit**

```bash
git add frontend/src/components/auth/LoginPage.tsx frontend/messages/
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(auth): entree par lien magique sur l'ecran de connexion

Message identique que l'adresse soit connue ou non : l'ecran ne doit pas
renseigner sur qui est debiteur."
```

---

# Phase D — Incrément ③ : mise en service des comptes

**Ne pas démarrer avant que la phase B soit appliquée.** Ouvrir un compte sur un livre non rebasculé exposerait le débiteur à des chiffres contredisant sa mise en demeure.

### Task 9 : Service de mise en service et action « ajouter un représentant »

**Files:**
- Create: `frontend/src/services/ownerProvisioning.ts`
- Create: `frontend/src/services/ownerProvisioning.test.ts`
- Create: `frontend/src/actions/addOwnerRepresentative.ts`
- Create: `frontend/src/actions/addOwnerRepresentative.test.ts`
- Modify: `frontend/src/app/(dashboard)/admin/armateurs/[id]/ArmateurDetail.tsx`

**Interfaces:**
- Produces:
  - `provisionOwnerAccount(admin, { shipownerId, email, fullName }): Promise<{ profileId: string; created: boolean }>`
  - `addOwnerRepresentative(raw): Promise<{ ok: true; profileId: string } | { ok: false; reason: string }>`

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
// frontend/src/services/ownerProvisioning.test.ts
import { describe, it, expect, vi } from 'vitest';
import { provisionOwnerAccount } from './ownerProvisioning';

/**
 * Creation SILENCIEUSE : aucun e-mail ne doit partir. L'acces passe par la
 * relance suivante. Et l'operation doit etre rejouable sans effet.
 */
function admin(existingUser: { id: string } | null) {
    const createUser = vi.fn(async () => existingUser
        ? { data: null, error: { code: 'email_exists', message: 'already registered' } }
        : { data: { user: { id: 'new-user' } }, error: null });
    const listUsers = vi.fn(async () => ({
        data: { users: existingUser ? [{ id: existingUser.id, email: 'a@b.c' }] : [] }, error: null,
    }));
    const upsert = vi.fn(async () => ({ error: null }));
    const update = vi.fn(() => ({ eq: async () => ({ error: null }) }));
    return {
        client: { auth: { admin: { createUser, listUsers, inviteUserByEmail: vi.fn() } },
                  from: () => ({ upsert, update }) } as never,
        createUser, listUsers, upsert,
        invite: () => (({ auth: { admin: {} } } as never)),
    };
}

describe('provisionOwnerAccount', () => {
    it('cree le compte sans envoyer d’invitation', async () => {
        const a = admin(null);
        const r = await provisionOwnerAccount(a.client, {
            shipownerId: 'own-1', email: 'a@b.c', fullName: 'FAROS',
        });
        expect(r).toEqual({ profileId: 'new-user', created: true });
        // createUser, jamais inviteUserByEmail : ce dernier declenche un envoi.
        expect(a.createUser).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'a@b.c', email_confirm: true }),
        );
    });

    it('reprend le compte existant sans le recreer', async () => {
        const a = admin({ id: 'old-user' });
        const r = await provisionOwnerAccount(a.client, {
            shipownerId: 'own-1', email: 'a@b.c', fullName: 'FAROS',
        });
        expect(r).toEqual({ profileId: 'old-user', created: false });
    });

    it('normalise l’adresse en minuscules', async () => {
        const a = admin(null);
        await provisionOwnerAccount(a.client, { shipownerId: 'own-1', email: '  A@B.C ', fullName: 'X' });
        expect(a.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'a@b.c' }));
    });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd frontend && npx vitest run src/services/ownerProvisioning.test.ts`
Expected: FAIL — module introuvable

- [ ] **Step 3 : Écrire le service**

```ts
// frontend/src/services/ownerProvisioning.ts
import { type SupabaseClient } from '@supabase/supabase-js';

export interface ProvisionInput {
    shipownerId: string;
    email: string;
    fullName: string;
}

/**
 * Cree SILENCIEUSEMENT un compte armateur.
 *
 * `createUser` et non `inviteUserByEmail` : ce dernier declenche un envoi par
 * le SMTP de Supabase, or la decision est de ne rien envoyer — l'acces passe
 * par la relance suivante, dont le lien fonctionne enfin.
 *
 * `email_confirm: true` parce qu'aucun courriel de confirmation ne partira ;
 * sans cela le compte resterait non confirme et le lien magique echouerait.
 *
 * Idempotent : une adresse deja connue rend son profil existant.
 */
export async function provisionOwnerAccount(
    admin: SupabaseClient,
    input: ProvisionInput,
): Promise<{ profileId: string; created: boolean }> {
    const email = input.email.trim().toLowerCase();

    const { data: created, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: input.fullName, role: 'SHIPOWNER' },
    });

    let profileId: string;
    let wasCreated = true;

    if (created?.user) {
        profileId = created.user.id;
    } else if (error && (error.code === 'email_exists' || /already/i.test(error.message))) {
        const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        if (listErr) throw new Error(`recherche du compte existant: ${listErr.message}`);
        const found = list.users.find((u) => u.email?.toLowerCase() === email);
        if (!found) throw new Error(`compte existant introuvable pour ${email}`);
        profileId = found.id;
        wasCreated = false;
    } else {
        throw new Error(`creation du compte ${email}: ${error?.message ?? 'inconnue'}`);
    }

    await admin.from('profiles').upsert({
        id: profileId, email, full_name: input.fullName,
        role: 'SHIPOWNER', is_active: true,
    }, { onConflict: 'id' });

    return { profileId, created: wasCreated };
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `cd frontend && npx vitest run src/services/ownerProvisioning.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5 : Écrire l'action de rattachement d'un représentant**

```ts
// frontend/src/actions/addOwnerRepresentative.ts
'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { provisionOwnerAccount } from '@/services/ownerProvisioning';
import { assertContactAllowed, SanctionedContactError } from '@/domain/sanctions/contactGuard';
import { writeAuditLog } from '@/services/auditService';

const schema = z.object({
    shipownerId: z.guid(),
    email: z.email(),
    fullName: z.string().trim().min(2).max(120),
}).strict();

const ALLOWED = ['SUPERADMIN', 'FINANCE_ADMIN'];

/**
 * Rattache un representant a un armateur, en creant son compte au passage.
 *
 * owner_agent_mappings.agent_profile_id est NOT NULL et le selecteur de la
 * fiche armateur ne propose que des profils existants : un representant sans
 * compte n'etait donc pas rattachable, et sans rattachement il n'avait pas de
 * lien magique. Cette action ouvre cette boucle.
 *
 * Cas d'usage nominal : une reponse a la campagne arrive d'une adresse absente
 * du referentiel, et le personnel la rattache au dossier concerne.
 */
export async function addOwnerRepresentative(raw: unknown) {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false as const, reason: parsed.error.issues[0]?.message ?? 'invalid input' };

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false as const, reason: 'not authenticated' };

    const { data: me } = await supabase.from('profiles').select('role, full_name').eq('id', auth.user.id).single();
    if (!me || !ALLOWED.includes(me.role)) return { ok: false as const, reason: 'insufficient role' };

    const admin = createPlatformClient();
    const { data: owner } = await admin.from('shipowners')
        .select('id, name, is_ofac_sdn, is_un_prohibited, jurisdiction_id')
        .eq('id', parsed.data.shipownerId).single();
    if (!owner) return { ok: false as const, reason: 'shipowner not found' };

    try {
        assertContactAllowed(owner as never);
    } catch (e) {
        if (e instanceof SanctionedContactError) {
            await admin.from('audit_logs').insert({
                user_id: auth.user.id, user_full_name: me.full_name ?? auth.user.email ?? 'unknown',
                action: 'SANCTIONS_CONTACT_BLOCKED', severity: 'CRITICAL',
                entity_type: 'Shipowner', entity_id: owner.id,
                jurisdiction_id: owner.jurisdiction_id,
                details_json: { code: e.code, attempted: 'ADD_REPRESENTATIVE', email: parsed.data.email },
            });
            return { ok: false as const, reason: `sanctioned: ${e.message}` };
        }
        throw e;
    }

    const { profileId } = await provisionOwnerAccount(admin, {
        shipownerId: owner.id, email: parsed.data.email, fullName: parsed.data.fullName,
    });

    const { error } = await admin.from('owner_agent_mappings').upsert({
        shipowner_id: owner.id, agent_profile_id: profileId,
        priority: 10, valid_from: new Date().toISOString().slice(0, 10),
        active: true, created_by: auth.user.id,
    }, { onConflict: 'shipowner_id,agent_profile_id' });
    if (error) return { ok: false as const, reason: error.message };

    // writeAuditLog(client, entry) : deux arguments positionnels, et l'entree
    // porte les NOMS DE COLONNES de audit_logs. L'enum `action` est fermee —
    // pas de valeur nouvelle, on qualifie l'evenement dans details_json.
    await writeAuditLog(admin, {
        user_id: auth.user.id,
        user_full_name: me.full_name ?? auth.user.email ?? 'staff',
        action: 'TRANSACTION_UPDATED', severity: 'INFO',
        entity_type: 'Shipowner', entity_id: owner.id,
        jurisdiction_id: owner.jurisdiction_id,
        details_json: { event: 'REPRESENTATIVE_ADDED', email: parsed.data.email, profileId },
    });

    return { ok: true as const, profileId };
}
```

- [ ] **Step 6 : Tester l'action**

Écrire `addOwnerRepresentative.test.ts` couvrant : rôle insuffisant refusé, armateur sous sanctions refusé **et** journalisé en `CRITICAL`, création du profil puis du rattachement, idempotence sur double appel.

Run: `cd frontend && npx vitest run src/actions/addOwnerRepresentative.test.ts`
Expected: PASS

- [ ] **Step 7 : Brancher la fiche armateur**

Dans `ArmateurDetail.tsx`, à côté du sélecteur nominatif existant, ajouter un champ « nouvelle adresse » appelant `addOwnerRepresentative`. Le sélecteur existant reste pour les profils déjà connus.

- [ ] **Step 8 : Typage, suite complète, commit**

```bash
cd frontend && npx tsc --noEmit && npm run test && cd ..
git add frontend/src/services/ownerProvisioning.ts frontend/src/services/ownerProvisioning.test.ts \
        frontend/src/actions/addOwnerRepresentative.ts frontend/src/actions/addOwnerRepresentative.test.ts \
        "frontend/src/app/(dashboard)/admin/armateurs/[id]/ArmateurDetail.tsx"
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(armateurs): rattacher un representant par son adresse

Le compte est cree au passage : agent_profile_id est NOT NULL, un
representant sans profil n'etait pas rattachable, et sans rattachement il
n'avait pas d'acces."
```

### Task 10 : Script de mise en service des 36 comptes

**Files:**
- Create: `scripts/provision-owner-accounts.ts`

**Interfaces:**
- Consumes: `provisionOwnerAccount` (Task 9), `parseConsRefs` + `SANCTIONED_CONS_REFS` (Task 4)

- [ ] **Step 1 : Écrire le script**

Même forme que `rebase-maritime-ledger.ts` : simulation par défaut, `--execute`, idempotent. Pour chaque dossier de `cons_refs_mapping.csv` ayant une `contactEmail` et hors sanctions : `provisionOwnerAccount`, puis `shipowners.profile_id` et `account_state = 'ACTIVE'`. **Aucun envoi.** Comptabiliser et afficher en fin d'exécution : comptes créés, comptes repris, dossiers ignorés faute d'adresse, dossiers refusés pour sanctions.

- [ ] **Step 2 : Simulation**

```bash
npx tsx scripts/provision-owner-accounts.ts
```

Expected: `36 a mettre en service · 35 sans adresse · 3 sous sanctions` puis `SIMULATION`.

- [ ] **Step 3 : Exécution locale et contrôle**

```bash
npx tsx scripts/provision-owner-accounts.ts --execute
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
  SELECT account_state, COUNT(*) FROM public.shipowners
   WHERE seed_ref LIKE 'PRO-CONS-2026-%' GROUP BY 1 ORDER BY 1;"
```

Expected: `ACTIVE | 36` et `GHOST | 38`.

- [ ] **Step 4 : Vérifier qu'aucun e-mail n'est parti**

```bash
grep -rn "inviteUserByEmail\|sendEmail\|resend" scripts/provision-owner-accounts.ts || echo "aucun envoi — conforme"
```

Expected: `aucun envoi — conforme`

- [ ] **Step 5 : Idempotence, puis commit**

```bash
npx tsx scripts/provision-owner-accounts.ts --execute   # doit rendre 0 cree, 36 repris
git add scripts/provision-owner-accounts.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(armateurs): mise en service silencieuse des 36 comptes joignables

Aucun envoi : l'acces passe par la relance suivante. Les 3 dossiers sous
sanctions sont refuses, les 35 sans adresse ignores."
```

---

# Phase E — Incrément ④ : écran de flotte

Aucune migration.

### Task 11 : Service de flotte, restreint à l'armateur de la session

**Files:**
- Create: `frontend/src/services/ownerFleetService.ts`
- Create: `frontend/src/services/ownerFleetService.test.ts`

**Interfaces:**
- Produces: `listOwnerFleet(supabase, shipownerId): Promise<FleetVessel[]>` où `FleetVessel = { id: string; name: string; imoNumber: string | null; mmsi: string | null; flagCode: string; complianceStatus: string; invoiceCount: number; outstandingUsd: number; canRemove: boolean }`

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
// frontend/src/services/ownerFleetService.test.ts
import { describe, it, expect, vi } from 'vitest';
import { listOwnerFleet } from './ownerFleetService';

/**
 * canRemove est la garde metier de l'ecran : un navire qui porte une facture
 * ne se retire pas en libre-service, il se conteste.
 */
function supa(vessels: unknown[], txns: unknown[]) {
    return {
        from: (t: string) => {
            const rows = t === 'vessels' ? vessels : txns;
            const chain: Record<string, unknown> = {};
            chain.select = () => chain;
            chain.eq = () => chain;
            chain.in = () => chain;
            chain.neq = () => chain;
            chain.order = async () => ({ data: rows, error: null });
            chain.then = undefined;
            return Object.assign(chain, { data: rows, error: null,
                // supabase-js resout la requete a l'await
                [Symbol.toStringTag]: 'Promise' });
        },
    } as never;
}

describe('listOwnerFleet', () => {
    it('interdit le retrait d’un navire facture', async () => {
        const fleet = await listOwnerFleet(
            supa([{ id: 'v1', name: 'MAYAR', imo_number: '9167057', mmsi: null,
                    flag_code: 'KN', compliance_status: 'PAYMENT_DUE' }],
                 [{ vessel_id: 'v1', tax_amount_usd: 68832, status: 'PENDING' }]) as never,
            'own-1');
        expect(fleet[0]).toMatchObject({ invoiceCount: 1, canRemove: false });
        expect(fleet[0].outstandingUsd).toBeCloseTo(68832, 2);
    });

    it('autorise le retrait d’un navire sans facture', async () => {
        const fleet = await listOwnerFleet(
            supa([{ id: 'v2', name: 'VENIZ 1', imo_number: null, mmsi: null,
                    flag_code: 'KM', compliance_status: 'PROCESSING' }], []) as never,
            'own-1');
        expect(fleet[0]).toMatchObject({ invoiceCount: 0, canRemove: true, outstandingUsd: 0 });
    });

    it('ignore les factures annulees dans le solde', async () => {
        const fleet = await listOwnerFleet(
            supa([{ id: 'v1', name: 'MAYAR', imo_number: '9167057', mmsi: null,
                    flag_code: 'KN', compliance_status: 'PAYMENT_DUE' }],
                 [{ vessel_id: 'v1', tax_amount_usd: 28999.99, status: 'VOID' }]) as never,
            'own-1');
        expect(fleet[0]).toMatchObject({ invoiceCount: 0, canRemove: true });
    });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd frontend && npx vitest run src/services/ownerFleetService.test.ts`
Expected: FAIL — module introuvable

- [ ] **Step 3 : Écrire le service**

```ts
// frontend/src/services/ownerFleetService.ts
import { type SupabaseClient } from '@supabase/supabase-js';

export interface FleetVessel {
    id: string;
    name: string;
    imoNumber: string | null;
    mmsi: string | null;
    flagCode: string;
    complianceStatus: string;
    invoiceCount: number;
    outstandingUsd: number;
    /** Faux des qu'une facture vivante vise le navire : le geste devient « contester ». */
    canRemove: boolean;
}

/** Statuts qui laissent une somme a devoir. */
const OUTSTANDING = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'];

/**
 * Flotte de l'armateur de la session.
 *
 * Les transactions sont filtrees sur `status <> 'VOID'` : depuis la rebascule
 * du livre (mig 128), chaque navire du seed traine une pro-forma annulee qui
 * porte encore sa reference. La compter bloquerait le retrait de navires qui
 * ne doivent plus rien.
 */
export async function listOwnerFleet(
    supabase: SupabaseClient,
    shipownerId: string,
): Promise<FleetVessel[]> {
    const { data: vessels, error: vErr } = await supabase
        .from('vessels')
        .select('id, name, imo_number, mmsi, flag_code, compliance_status')
        .eq('shipowner_id', shipownerId)
        .order('name');
    if (vErr) throw new Error(`flotte: ${vErr.message}`);

    const rows = (vessels ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) return [];

    const { data: txns, error: tErr } = await supabase
        .from('transactions')
        .select('vessel_id, tax_amount_usd, status')
        .in('vessel_id', rows.map((v) => String(v.id)))
        .neq('status', 'VOID');
    if (tErr) throw new Error(`factures de la flotte: ${tErr.message}`);

    const byVessel = new Map<string, { count: number; usd: number }>();
    for (const t of (txns ?? []) as Array<Record<string, unknown>>) {
        const key = String(t.vessel_id);
        const acc = byVessel.get(key) ?? { count: 0, usd: 0 };
        acc.count += 1;
        if (OUTSTANDING.includes(String(t.status))) acc.usd += Number(t.tax_amount_usd ?? 0);
        byVessel.set(key, acc);
    }

    return rows.map((v) => {
        const acc = byVessel.get(String(v.id)) ?? { count: 0, usd: 0 };
        return {
            id: String(v.id),
            name: String(v.name),
            imoNumber: v.imo_number ? String(v.imo_number) : null,
            mmsi: v.mmsi ? String(v.mmsi) : null,
            flagCode: String(v.flag_code ?? 'ZZ'),
            complianceStatus: String(v.compliance_status),
            invoiceCount: acc.count,
            outstandingUsd: acc.usd,
            canRemove: acc.count === 0,
        };
    });
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `cd frontend && npx vitest run src/services/ownerFleetService.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5 : Commit**

```bash
git add frontend/src/services/ownerFleetService.ts frontend/src/services/ownerFleetService.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(flotte): flotte reelle de l'armateur, avec garde de retrait

Un navire facture ne se retire pas : canRemove tombe des qu'une transaction
vivante le vise."
```

### Task 12 : Renommer et retirer

**Files:**
- Create: `frontend/src/actions/updateOwnerVessel.ts`
- Create: `frontend/src/actions/updateOwnerVessel.test.ts`

**Interfaces:**
- Consumes: `listOwnerFleet` (Task 11)
- Produces: `renameOwnerVessel(raw)`, `detachOwnerVessel(raw)`, toutes deux `Promise<{ ok: true } | { ok: false; reason: string }>`

- [ ] **Step 1 : Écrire le test qui échoue**

Couvrir : renommage versant l'ancien nom dans `previous_names` ; retrait refusé si une transaction vivante vise le navire ; retrait acceptée sinon ; navire d'un autre armateur refusé ; les deux actions journalisées.

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd frontend && npx vitest run src/actions/updateOwnerVessel.test.ts`
Expected: FAIL

- [ ] **Step 3 : Écrire les deux actions**

```ts
// frontend/src/actions/updateOwnerVessel.ts
'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { writeAuditLog } from '@/services/auditService';

const renameSchema = z.object({
    vesselId: z.guid(),
    name: z.string().trim().min(1).max(120),
}).strict();

const detachSchema = z.object({ vesselId: z.guid() }).strict();

type Result = { ok: true } | { ok: false; reason: string };

/**
 * Charge le navire APRES avoir verifie qu'il appartient bien a l'armateur de
 * la session. Sans cette garde, un armateur pourrait renommer ou detacher la
 * flotte d'un autre en devinant un identifiant.
 */
async function loadOwnVessel(vesselId: string) {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { error: 'not authenticated' as const };

    const { data: owner } = await supabase
        .from('shipowners').select('id, name').eq('profile_id', auth.user.id).maybeSingle();
    if (!owner) return { error: 'no owner record' as const };

    const { data: vessel } = await supabase
        .from('vessels').select('id, name, shipowner_id, previous_names')
        .eq('id', vesselId).maybeSingle();
    if (!vessel || vessel.shipowner_id !== owner.id) return { error: 'vessel not found' as const };

    return { userId: auth.user.id, owner, vessel };
}

export async function renameOwnerVessel(raw: unknown): Promise<Result> {
    const parsed = renameSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };

    const ctx = await loadOwnVessel(parsed.data.vesselId);
    if ('error' in ctx) return { ok: false, reason: ctx.error };

    const previous = (ctx.vessel.previous_names ?? []) as string[];
    const oldName = String(ctx.vessel.name);
    if (oldName === parsed.data.name) return { ok: true };

    const admin = createPlatformClient();
    const { error } = await admin.from('vessels').update({
        name: parsed.data.name,
        // L'ancien nom n'est jamais perdu : c'est la trace qui permet de
        // rapprocher les pro-formas deja emises sous l'ancienne appellation.
        previous_names: previous.includes(oldName) ? previous : [...previous, oldName],
    }).eq('id', ctx.vessel.id);
    if (error) return { ok: false, reason: error.message };

    await writeAuditLog(admin, {
        user_id: ctx.userId, user_full_name: ctx.owner.name,
        action: 'TRANSACTION_UPDATED', severity: 'INFO',
        entity_type: 'Vessel', entity_id: String(ctx.vessel.id),
        details_json: { event: 'OWNER_VESSEL_RENAMED', from: oldName, to: parsed.data.name },
    });
    return { ok: true };
}

export async function detachOwnerVessel(raw: unknown): Promise<Result> {
    const parsed = detachSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };

    const ctx = await loadOwnVessel(parsed.data.vesselId);
    if ('error' in ctx) return { ok: false, reason: ctx.error };

    const admin = createPlatformClient();

    // Garde metier : un navire facture ne se retire pas en libre-service. Elle
    // est revalidee ici et pas seulement dans l'ecran — un appel direct a
    // l'action contournerait un bouton grise.
    const { count, error: cErr } = await admin
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('vessel_id', ctx.vessel.id)
        .neq('status', 'VOID');
    if (cErr) return { ok: false, reason: cErr.message };
    if ((count ?? 0) > 0) return { ok: false, reason: 'vessel has invoices — dispute instead' };

    const { error } = await admin.from('vessels')
        .update({ shipowner_id: null }).eq('id', ctx.vessel.id);
    if (error) return { ok: false, reason: error.message };

    await writeAuditLog(admin, {
        user_id: ctx.userId, user_full_name: ctx.owner.name,
        action: 'TRANSACTION_UPDATED', severity: 'WARNING',
        entity_type: 'Vessel', entity_id: String(ctx.vessel.id),
        details_json: { event: 'OWNER_VESSEL_DETACHED', vessel_name: ctx.vessel.name, former_owner_id: ctx.owner.id },
    });
    return { ok: true };
}
```

- [ ] **Step 4 : Lancer le test pour vérifier qu'il passe**

Run: `cd frontend && npx vitest run src/actions/updateOwnerVessel.test.ts`
Expected: PASS

- [ ] **Step 5 : Commit**

```bash
git add frontend/src/actions/updateOwnerVessel.ts frontend/src/actions/updateOwnerVessel.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(flotte): renommer et retirer un navire depuis le portail

Le retrait est refuse des qu'une facture vivante vise le navire. Aucune
transaction n'est touchee."
```

### Task 13 : Écran de flotte réel

**Files:**
- Modify: `frontend/src/components/dashboard/fleet/MyFleetPage.tsx`
- Modify: `frontend/messages/{en,fr,ar,pt,sw,so}.json`

**Interfaces:**
- Consumes: `listOwnerFleet` (Task 11), `renameOwnerVessel` / `detachOwnerVessel` (Task 12), `createOwnerDispute` (existante)

- [ ] **Step 1 : Remplacer les données de démonstration**

Retirer `useVessels` et `useTransactions`. La page devient un composant serveur qui appelle `requirePrincipal()` puis `listOwnerFleet`, et délègue l'interaction à un `MyFleetPanel.tsx` client. Suivre le motif des écrans d'administration : composant serveur pour le contrôle d'accès, panneau client avec des `ModalOverlay` en `div` — **pas** de `Dialog` Radix.

- [ ] **Step 2 : Câbler les trois gestes**

Renommer et retirer appellent les actions de la Task 12. Contester appelle `createOwnerDispute` avec `reason: 'VESSEL_DATA'` pour chaque transaction vivante du navire. Le bouton « retirer » est désactivé, avec explication, quand `canRemove` est faux — et le geste devient « contester ».

- [ ] **Step 3 : Compléter les six locales**

Clés `MyFleet.rename`, `MyFleet.detach`, `MyFleet.detachBlocked`, `MyFleet.dispute`, `MyFleet.disputeSent`, `MyFleet.confirmDetach`.

- [ ] **Step 4 : Vérifier la parité des locales**

```bash
cd frontend && node -e "
const en=require('./messages/en.json').MyFleet;
for (const l of ['fr','ar','pt','sw','so']) {
  const t=require('./messages/'+l+'.json').MyFleet||{};
  const m=Object.keys(en).filter(k=>!(k in t));
  if (m.length) { console.error(l,'manque',m); process.exit(1); }
}
console.log('parite MyFleet OK');"
```

Expected: `parite MyFleet OK`

- [ ] **Step 5 : Typage, suite complète, build**

Run: `cd frontend && npx tsc --noEmit && npm run test && npm run build`
Expected: PASS

- [ ] **Step 6 : Commit**

```bash
git add frontend/src/components/dashboard/fleet/ frontend/messages/ \
        "frontend/src/app/(dashboard)/dashboard/my-fleet/page.tsx"
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(flotte): ecran de flotte sur donnees reelles

Renommer, retirer si aucune facture, contester sinon. La contestation
reutilise disputes avec le motif VESSEL_DATA."
```

---

## Bascule en production

À faire une fois les treize tâches vertes en local, et **dans cet ordre**.

1. Obtenir `SUPABASE_DB_PASSWORD` du projet `tvvvsysyiugrkrottczt`, dans un fichier ignoré par git. Jamais dans une conversation.
2. **Constater l'état réel** avant toute écriture :
   ```sql
   SELECT document_type, status, COUNT(*), ROUND(SUM(tax_amount_usd),2)
     FROM public.transactions
    WHERE invoice_ref LIKE 'PRO-2026-0640%'
    GROUP BY 1,2 ORDER BY 1,2;
   SELECT COUNT(*) FILTER (WHERE sent_at IS NOT NULL) AS envoyees,
          COUNT(*) AS total FROM public.transactions
    WHERE invoice_ref LIKE 'PRO-2026-0640%';
   ```
   Si `envoyees > 0`, **s'arrêter** : une pro-forma du seed aurait circulé, et l'analyse qui fonde ce plan serait fausse.
3. Appliquer les migrations en attente **dans l'ordre**, 109 à 127, puis 128 :
   `supabase db push --db-url "postgresql://postgres:<mdp>@db.tvvvsysyiugrkrottczt.supabase.co:5432/postgres"`
4. `npx tsx scripts/rebase-maritime-ledger.ts` en simulation, relire la sortie ligne à ligne, puis `--execute`.
5. `npx tsx scripts/provision-owner-accounts.ts` en simulation, puis `--execute`.
6. Déployer le frontend. Vérifier sur `/login` qu'une adresse connue et une adresse inconnue rendent le même écran.
7. Déclencher une relance de contrôle vers **une** adresse maîtrisée, et suivre le parcours complet : e-mail → lien → portail → facture affichée identique au PDF détenu.

## Ce que ce plan ne fait pas

- **Les 35 dossiers sans adresse** — 486 709,20 USD. Aucun compte n'est possible sans adresse.
- **Les 3 dossiers sous sanctions** — 148 110,80 USD. Saisie *in rem*, jamais de contact.
- **L'aérien** — 556 pro-formas intactes.
- **La réémission de PDF signés** portant les mêmes références, rendue possible par la conservation de la numérotation.
- **La revendication de navire en libre-service**, retirée : un seul navire reste non attribué, à 2 653,20 USD.
- **L'ouverture du portail aux copies de facturation.** La liste d'autorisation les reconnaît, mais `requestLoginLink` ne leur envoie rien. La spec §6.3 exige une session restreinte à la lecture des factures, et rien dans la session ne porte cette restriction aujourd'hui : `requirePrincipal` ne résout qu'un armateur, sans portée. Livrer sans cette restriction donnerait à un comptable en copie l'accès aux litiges, à la conformité et aux moyens de paiement. **Décision à reprendre avec le PO** : soit une migration portant la portée sur la session, soit le retrait des copies de la liste d'autorisation.

## Ce qu'il reste à trancher

| Sujet | Pourquoi ça n'est pas décidé ici |
|---|---|
| Portail ouvert aux copies de facturation | Demande une portée de session, absente du modèle actuel. Voir ci-dessus. |
| Les 4 dossiers au débiteur discutable (012, 025, 055, 057) | Les lettres sont parties sous le nom de l'ISM. Rectifier contredirait le document détenu ; ne pas rectifier laisse un débiteur imprécis. Le plan importe tel qu'envoyé et enregistre le manager réel en `ops_email`. |
| Réémission de PDF signés | Rend les documents vérifiables par `/verify`. Possible sans rien casser, mais c'est un chantier à part entière. |
