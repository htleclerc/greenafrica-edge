# Sprint 1 — Onboarding armateurs : fondations DB + import données réelles

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Étendre le schéma Supabase existant (migrations 092+) pour accueillir le portefeuille réel Green-Gate (20 armateurs + 6 compagnies aériennes + 100 navires + 100 voyages + 458 pro-formas + 40 relances + 3 paiements), purger les données de démo, importer les 7 seeds, et sécuriser tout contact sortant par un garde sanctions OFAC/UN.

**Architecture:** On NE crée PAS de tables parallèles `armateurs`/`proformas` (le schéma existant prime) : les seeds sont **mappés** sur `shipowners` (armateurs ET compagnies aériennes — entité opérateur généralisée), `vessels`, `aircraft` (synthétiques par compagnie×type), `arrival_alerts` (voyages maritimes), `transactions` (pro-formas, `document_type='PROFORMA'`), `payments`. Seuls ajouts : colonnes sanctions/onboarding sur `shipowners`, colonnes seed sur `vessels`, nouvelle table `collection_reminders` (relances J+15/J+30/J+45 post-émission, distincte du ledger NET-30 `collections_event`). Import via script service-role idempotent (clé `seed_ref`/`invoice_ref`), dry-run par défaut.

**Tech Stack:** Supabase (migrations SQL + supabase-js service-role), TypeScript strict, Zod 4, Vitest. Pas de Prisma, pas de NextAuth, pas de shadcn.

## Global Constraints

- TypeScript strict — **JAMAIS `any`** (utiliser `unknown` + narrowing ou types précis).
- Validation **Zod** obligatoire sur toute donnée externe (les 7 fichiers JSON seeds).
- Tests Vitest pour tout nouveau code ; test OFAC bloquant **obligatoire**.
- Commits : auteur `Loic Leclerc <leclerc@drwintech.com>`, messages conventionnels humanisés, **JAMAIS** de trailer `Co-Authored-By: Claude` ni « Generated with Claude Code », staging explicite par chemins (jamais `git add -A`).
- Jamais de push direct sur `main` ; branche de travail : `feat/onboarding-fondations-db`.
- Style migrations : `NNN_description.sql` séquentiel (next = **092**), bannière `─────`, ADDITIVE, `IF NOT EXISTS`, RLS systématique, `GRANT ... TO service_role`, commentaire `-- DOWN:` final.
- Juridiction Somaliland (seed existant) : `'00000000-0000-4000-8000-00000000534f'`.
- Montants `payments` en **minor units** (`BIGINT`, cents) ; montants `transactions` en `NUMERIC` USD.
- `transactions.due_date` est une colonne **GENERATED** dérivée de `created_at` (J+30 Africa/Mogadishu) → l'import DOIT poser `created_at = date_emission` explicitement.
- Contrainte `transactions_asset_per_mode` : `mode='AIR'` ⇒ `aircraft_id NOT NULL` ; sinon `vessel_id NOT NULL`.
- Total attendu après import : **USD 2 604 886.34** (1 889 653.34 maritime + 715 233.00 aviation — c'est la somme réelle des seeds ; le chiffre 2 750 890 du brief inclut 198 vols de mai absents du package).
- Armateurs sous sanctions (jamais d'invitation/email) : `arm-007` (IRISL), `arm-012` (Petrofleet) — OFAC SDN ; `arm-013` (Morgan Navigation) — UN prohibited.
- Le run réel contre l'hébergé prod (`dyjolepwxxsedwngkfox`) n'est PAS dans ce plan : exécution locale + staging seulement ; la bascule prod = décision PO explicite.

## Fichiers créés/modifiés (vue d'ensemble)

| Fichier | Rôle |
|---|---|
| `supabase/migrations/092_shipowner_onboarding_sanctions.sql` | Colonnes sanctions + onboarding + aviation sur `shipowners` |
| `supabase/migrations/093_vessels_seed_extensions.sql` | Colonnes seed sur `vessels` + assouplissement NOT NULL |
| `supabase/migrations/094_collection_reminders.sql` | Table relances J+15/J+30/J+45 + RLS |
| `frontend/src/domain/sanctions/contactGuard.ts` | Garde sanctions (throw si OFAC/UN) |
| `frontend/src/domain/sanctions/contactGuard.test.ts` | Tests du garde |
| `frontend/src/services/onboardingImport/seedSchemas.ts` | Schémas Zod des 7 seeds |
| `frontend/src/services/onboardingImport/mappers.ts` | Mappers purs seed → lignes DB |
| `frontend/src/services/onboardingImport/mappers.test.ts` | Tests des mappers |
| `scripts/seed-onboarding.ts` | Script d'import (purge + upserts + vérification) |
| `frontend/src/actions/inviteShipowner.ts` (modif) | Câblage du garde sanctions |
| `frontend/src/types/supabase.generated.ts` | Types générés par la CLI Supabase |

---

### Task 1: Migration 092 — sanctions + onboarding sur `shipowners`

**Files:**
- Create: `supabase/migrations/092_shipowner_onboarding_sanctions.sql`

**Interfaces:**
- Produces: colonnes `shipowners.is_ofac_sdn BOOLEAN`, `is_un_prohibited BOOLEAN`, `sanction_notes TEXT`, `aliases TEXT[]`, `equasis_id TEXT`, `ops_email TEXT`, `finance_email TEXT`, `iata_code TEXT`, `icao_code TEXT`, `hub_code TEXT`, `notes TEXT`, `seed_ref TEXT UNIQUE` — consommées par les Tasks 4, 5, 6, 7.

- [ ] **Step 1: Écrire la migration**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 092: Onboarding armateurs — sanctions OFAC/UN + métadonnées seed
--
-- Package d'intégration docs/onboarding/ (Green-Gate v2, 13 juillet 2026).
-- ADDITIVE : étend shipowners (l'entité opérateur généralisée maritime+air)
-- au lieu de créer des tables parallèles armateurs/compagnies_aeriennes.
--   • is_ofac_sdn / is_un_prohibited : blocage absolu de tout contact sortant
--     (garde applicative domain/sanctions/contactGuard.ts + audit_logs).
--   • iata_code / icao_code / hub_code : identité compagnie aérienne
--     (mirroir de imo_company_no / aoc_number pour le mode AIR).
--   • seed_ref : clé d'idempotence de l'import (arm-XXX / avi-XXX).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.shipowners
  ADD COLUMN IF NOT EXISTS is_ofac_sdn      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_un_prohibited BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sanction_notes   TEXT,
  ADD COLUMN IF NOT EXISTS aliases          TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS equasis_id       TEXT,
  ADD COLUMN IF NOT EXISTS ops_email        TEXT,
  ADD COLUMN IF NOT EXISTS finance_email    TEXT,
  ADD COLUMN IF NOT EXISTS iata_code        TEXT,
  ADD COLUMN IF NOT EXISTS icao_code        TEXT,
  ADD COLUMN IF NOT EXISTS hub_code         TEXT,
  ADD COLUMN IF NOT EXISTS notes            TEXT,
  ADD COLUMN IF NOT EXISTS seed_ref         TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipowners_seed_ref
  ON public.shipowners(seed_ref) WHERE seed_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipowners_iata
  ON public.shipowners(iata_code) WHERE iata_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shipowners_sanctioned
  ON public.shipowners(id) WHERE is_ofac_sdn OR is_un_prohibited;

COMMENT ON COLUMN public.shipowners.is_ofac_sdn IS
  'OFAC SDN list hit. TRUE ⇒ AUCUN contact direct (email/invite) — procédure in rem via Bailiff uniquement. Enforced par domain/sanctions/contactGuard.ts.';
COMMENT ON COLUMN public.shipowners.is_un_prohibited IS
  'UN sanctions list hit. TRUE ⇒ AUCUN contact direct — notification consulaire uniquement.';
COMMENT ON COLUMN public.shipowners.seed_ref IS
  'Référence du package onboarding_armateurs (arm-XXX / avi-XXX). Clé d''idempotence de scripts/seed-onboarding.ts.';

-- DOWN:
-- ALTER TABLE public.shipowners DROP COLUMN IF EXISTS is_ofac_sdn, DROP COLUMN IF EXISTS is_un_prohibited,
--   DROP COLUMN IF EXISTS sanction_notes, DROP COLUMN IF EXISTS aliases, DROP COLUMN IF EXISTS equasis_id,
--   DROP COLUMN IF EXISTS ops_email, DROP COLUMN IF EXISTS finance_email, DROP COLUMN IF EXISTS iata_code,
--   DROP COLUMN IF EXISTS icao_code, DROP COLUMN IF EXISTS hub_code, DROP COLUMN IF EXISTS notes,
--   DROP COLUMN IF EXISTS seed_ref;
```

- [ ] **Step 2: Appliquer sur le stack local et vérifier**

Run (depuis la racine repo) : `npx supabase db reset`
Expected : toutes les migrations 001→094 passent sans erreur (si 093/094 pas encore écrites, 001→092).
Puis : `npx supabase db execute --sql "SELECT column_name FROM information_schema.columns WHERE table_name='shipowners' AND column_name IN ('is_ofac_sdn','seed_ref','iata_code')"` → 3 lignes.
(Si `db execute` n'existe pas dans cette version CLI : `docker exec supabase_db_africgreen psql -U postgres -c "..."` ou psql sur `127.0.0.1:54322`.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/092_shipowner_onboarding_sanctions.sql
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(db): colonnes sanctions OFAC/UN et identité aviation sur shipowners"
```

---

### Task 2: Migration 093 — extensions seed sur `vessels`

**Files:**
- Create: `supabase/migrations/093_vessels_seed_extensions.sql`

**Interfaces:**
- Produces: colonnes `vessels.vessel_subtype TEXT`, `dwt INTEGER`, `build_year INTEGER`, `previous_names TEXT[]`, `wave_tag TEXT`, `seed_ref TEXT UNIQUE` ; `mmsi`, `call_sign`, `engine_power_kw`, `design_speed_knots` deviennent NULLABLE. Consommées par Task 6.

- [ ] **Step 1: Écrire la migration**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 093: Vessels — extensions package onboarding + NOT NULL relaxés
--
-- Les 100 navires du package (source Equasis/VesselFinder) n'ont ni call_sign
-- ni engine_power ni design_speed. Ces colonnes datent de la mig 003 (démo AIS) ;
-- on les rend nullables plutôt que d'inventer des valeurs sentinelles.
-- vessel_subtype préserve le type source ("Livestock Carrier"…) quand l'enum
-- vessel_category (003) ne le couvre pas.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.vessels
  ALTER COLUMN mmsi DROP NOT NULL,
  ALTER COLUMN call_sign DROP NOT NULL,
  ALTER COLUMN engine_power_kw DROP NOT NULL,
  ALTER COLUMN design_speed_knots DROP NOT NULL;

ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS vessel_subtype  TEXT,
  ADD COLUMN IF NOT EXISTS dwt             INTEGER,
  ADD COLUMN IF NOT EXISTS build_year      INTEGER,
  ADD COLUMN IF NOT EXISTS previous_names  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS wave_tag        TEXT,
  ADD COLUMN IF NOT EXISTS seed_ref        TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vessels_seed_ref
  ON public.vessels(seed_ref) WHERE seed_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vessels_wave ON public.vessels(wave_tag)
  WHERE wave_tag IS NOT NULL;

COMMENT ON COLUMN public.vessels.vessel_subtype IS
  'Type source du package onboarding (ex. "Livestock Carrier") — plus fin que l''enum vessel_category.';

-- DOWN:
-- ALTER TABLE public.vessels DROP COLUMN IF EXISTS vessel_subtype, DROP COLUMN IF EXISTS dwt,
--   DROP COLUMN IF EXISTS build_year, DROP COLUMN IF EXISTS previous_names,
--   DROP COLUMN IF EXISTS wave_tag, DROP COLUMN IF EXISTS seed_ref;
-- (les NOT NULL ne sont pas restaurés — des lignes NULL existeraient)
```

- [ ] **Step 2: Appliquer et vérifier**

Run : `npx supabase db reset`
Expected : OK. Vérif : `SELECT is_nullable FROM information_schema.columns WHERE table_name='vessels' AND column_name='call_sign'` → `YES`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/093_vessels_seed_extensions.sql
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(db): colonnes seed onboarding sur vessels, champs AIS optionnels"
```

---

### Task 3: Migration 094 — table `collection_reminders` (relances J+15/J+30/J+45)

**Files:**
- Create: `supabase/migrations/094_collection_reminders.sql`

**Interfaces:**
- Produces: table `public.collection_reminders(id UUID PK, transaction_id UUID FK→transactions, tier public.reminder_tier, sent_at TIMESTAMPTZ, sent_email TEXT, cc_emails TEXT[], template_used TEXT, debtor_response_at TIMESTAMPTZ, debtor_response_type public.debtor_response_type, escalated_bailiff BOOLEAN, seed_ref TEXT UNIQUE, created_at)` — consommée par Task 6 (import) et par le Sprint 3 (cron relances).

- [ ] **Step 1: Écrire la migration**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 094: collection_reminders — relances post-émission J+15/J+30/J+45
--
-- Distinct de collections_event (mig 022) : collections_event est le ledger
-- hash-chaîné NET-30 (échéancier AVANT échéance J+5/J+15/J+25) ; cette table
-- trace le cycle de recouvrement Green-Gate APRÈS émission de la pro-forma
-- (J+15 amicale, J+30 mise en demeure, J+45 notice bailiff CC Eidle Advocats),
-- avec la réponse du débiteur. Spec : docs/onboarding/RECOUVREMENT_AUTOMATIQUE.md.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.reminder_tier AS ENUM ('J15', 'J30', 'J45', 'BAILIFF', 'JUDICIAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.debtor_response_type AS ENUM
    ('SILENT', 'ACKNOWLEDGE', 'DISPUTE', 'PAYMENT_PROMISE', 'PARTIAL_PAYMENT', 'PAID', 'REFUSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.collection_reminders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id       UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  tier                 public.reminder_tier NOT NULL,
  sent_at              TIMESTAMPTZ NOT NULL,
  sent_email           TEXT NOT NULL,
  cc_emails            TEXT[] NOT NULL DEFAULT '{}',
  template_used        TEXT NOT NULL,
  debtor_response_at   TIMESTAMPTZ,
  debtor_response_type public.debtor_response_type NOT NULL DEFAULT 'SILENT',
  escalated_bailiff    BOOLEAN NOT NULL DEFAULT FALSE,
  seed_ref             TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creminders_transaction
  ON public.collection_reminders(transaction_id);
CREATE INDEX IF NOT EXISTS idx_creminders_tier ON public.collection_reminders(tier);
CREATE UNIQUE INDEX IF NOT EXISTS idx_creminders_seed_ref
  ON public.collection_reminders(seed_ref) WHERE seed_ref IS NOT NULL;
-- Idempotence du futur cron : une seule relance par (transaction, tier)
CREATE UNIQUE INDEX IF NOT EXISTS idx_creminders_txn_tier
  ON public.collection_reminders(transaction_id, tier);

ALTER TABLE public.collection_reminders ENABLE ROW LEVEL SECURITY;

-- Staff : admins/officers de la juridiction (pattern mig 073/074)
DROP POLICY IF EXISTS "staff manage collection reminders" ON public.collection_reminders;
CREATE POLICY "staff manage collection reminders"
  ON public.collection_reminders FOR ALL
  USING (public.is_admin_or_officer())
  WITH CHECK (public.is_admin_or_officer());

-- Débiteur : lecture de ses propres relances via la transaction
DROP POLICY IF EXISTS "shipowners read own reminders" ON public.collection_reminders;
CREATE POLICY "shipowners read own reminders"
  ON public.collection_reminders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      JOIN public.shipowners s ON s.id = t.shipowner_id
      WHERE t.id = collection_reminders.transaction_id
        AND s.profile_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collection_reminders TO service_role;

-- DOWN:
-- DROP TABLE IF EXISTS public.collection_reminders;
-- DROP TYPE IF EXISTS public.debtor_response_type; DROP TYPE IF EXISTS public.reminder_tier;
```

- [ ] **Step 2: Appliquer et vérifier**

Run : `npx supabase db reset` → OK, puis vérifier que la table existe et que RLS est activé :
`SELECT relrowsecurity FROM pg_class WHERE relname='collection_reminders'` → `t`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/094_collection_reminders.sql
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(db): table collection_reminders pour le cycle J+15/J+30/J+45"
```

---

### Task 4: Garde sanctions `contactGuard` (TDD)

**Files:**
- Create: `frontend/src/domain/sanctions/contactGuard.ts`
- Test: `frontend/src/domain/sanctions/contactGuard.test.ts`

**Interfaces:**
- Produces:
  - `class SanctionedContactError extends Error { readonly code: 'OFAC_SDN' | 'UN_PROHIBITED'; readonly shipownerName: string }`
  - `interface SanctionFlags { is_ofac_sdn: boolean; is_un_prohibited: boolean; name: string }`
  - `function assertContactAllowed(shipowner: SanctionFlags): void` — throw `SanctionedContactError` si un flag est vrai, sinon no-op.
  - `function isContactBlocked(shipowner: SanctionFlags): boolean`
- Consumed by: Task 5 (inviteShipowner), Sprint 3 (envoi pro-formas/relances).

- [ ] **Step 1: Écrire les tests qui échouent**

```typescript
// frontend/src/domain/sanctions/contactGuard.test.ts
import { describe, it, expect } from 'vitest';
import {
    assertContactAllowed,
    isContactBlocked,
    SanctionedContactError,
} from './contactGuard';

describe('contactGuard', () => {
    const clean = { is_ofac_sdn: false, is_un_prohibited: false, name: 'H&P Ship Management Ltd' };
    const ofac = { is_ofac_sdn: true, is_un_prohibited: false, name: 'IRISL Group / Valfajr Shipping' };
    const un = { is_ofac_sdn: false, is_un_prohibited: true, name: 'Morgan Navigation SA' };

    it('OFAC armateur cannot receive email', () => {
        expect(() => assertContactAllowed(ofac)).toThrow(SanctionedContactError);
        try {
            assertContactAllowed(ofac);
        } catch (e) {
            expect(e).toBeInstanceOf(SanctionedContactError);
            expect((e as SanctionedContactError).code).toBe('OFAC_SDN');
            expect((e as SanctionedContactError).shipownerName).toBe(ofac.name);
        }
    });

    it('UN prohibited armateur cannot receive email', () => {
        expect(() => assertContactAllowed(un)).toThrow(SanctionedContactError);
        try {
            assertContactAllowed(un);
        } catch (e) {
            expect((e as SanctionedContactError).code).toBe('UN_PROHIBITED');
        }
    });

    it('does not throw for a clean armateur', () => {
        expect(() => assertContactAllowed(clean)).not.toThrow();
        expect(isContactBlocked(clean)).toBe(false);
        expect(isContactBlocked(ofac)).toBe(true);
        expect(isContactBlocked(un)).toBe(true);
    });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run (depuis `frontend/`) : `npm run test -- run src/domain/sanctions/contactGuard.test.ts`
Expected : FAIL — module `./contactGuard` introuvable.

- [ ] **Step 3: Implémenter**

```typescript
// frontend/src/domain/sanctions/contactGuard.ts
/**
 * Garde sanctions internationales — règle métier ABSOLUE Green-Gate.
 *
 * Aucun contact commercial direct (email, invitation portail, relance) ne doit
 * jamais atteindre un débiteur sous sanctions :
 *  - OFAC SDN  → procédure in rem uniquement (Bailiff Eidle Omer, Hargeisa)
 *  - UN prohibited → notification consulaire uniquement
 *
 * Chaque appelant DOIT invoquer assertContactAllowed() avant tout envoi sortant
 * et logger le refus dans audit_logs (fait par l'appelant, qui a le contexte user).
 */

export interface SanctionFlags {
    is_ofac_sdn: boolean;
    is_un_prohibited: boolean;
    name: string;
}

export type SanctionCode = 'OFAC_SDN' | 'UN_PROHIBITED';

export class SanctionedContactError extends Error {
    readonly code: SanctionCode;
    readonly shipownerName: string;

    constructor(code: SanctionCode, shipownerName: string) {
        super(
            code === 'OFAC_SDN'
                ? `Contact interdit : ${shipownerName} est sur la liste OFAC SDN (procédure in rem uniquement)`
                : `Contact interdit : ${shipownerName} est sous sanctions UN (notification consulaire uniquement)`,
        );
        this.name = 'SanctionedContactError';
        this.code = code;
        this.shipownerName = shipownerName;
    }
}

export function isContactBlocked(shipowner: SanctionFlags): boolean {
    return shipowner.is_ofac_sdn || shipowner.is_un_prohibited;
}

export function assertContactAllowed(shipowner: SanctionFlags): void {
    if (shipowner.is_ofac_sdn) {
        throw new SanctionedContactError('OFAC_SDN', shipowner.name);
    }
    if (shipowner.is_un_prohibited) {
        throw new SanctionedContactError('UN_PROHIBITED', shipowner.name);
    }
}
```

- [ ] **Step 4: Vérifier le succès**

Run : `npm run test -- run src/domain/sanctions/contactGuard.test.ts`
Expected : PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/domain/sanctions/contactGuard.ts frontend/src/domain/sanctions/contactGuard.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(sanctions): garde OFAC/UN bloquant tout contact sortant"
```

---

### Task 5: Câbler le garde sanctions dans `inviteShipowner`

**Files:**
- Modify: `frontend/src/actions/inviteShipowner.ts`

**Interfaces:**
- Consumes: `assertContactAllowed`, `isContactBlocked`, `SanctionedContactError` (Task 4) ; colonnes `is_ofac_sdn`, `is_un_prohibited` (Task 1).
- Produces: `inviteShipowner` retourne `{ ok: false, reason: 'sanctioned: ...' }` pour un armateur bloqué et insère une ligne `audit_logs` (action `EXEMPTION_GRANTED` n'est pas le bon enum — utiliser `action: 'TRANSACTION_UPDATED'`? NON : utiliser `severity: 'CRITICAL'` + l'action existante la plus proche. **Décision** : `action: 'USER_CREATED'` est trompeur ; l'enum `audit_action` (mig 003+016) ne contient pas de valeur sanctions. Insérer avec `action: 'INVOICE_SENT'` serait faux aussi → la migration 092 n'ajoute PAS de valeur d'enum ; on logge donc via `details_json` sur l'action existante **`TRANSACTION_UPDATED`** avec `details_json.kind = 'SANCTIONS_CONTACT_BLOCKED'`. Si le reviewer préfère, une valeur d'enum `SANCTIONS_BLOCKED` peut être ajoutée en 092 — voir Step 1 note.)

**Note de conception (à trancher à l'implémentation, défaut ci-dessous) :** ajouter la valeur d'enum est plus propre. Ajouter à la FIN de la migration 092 (Task 1) :
```sql
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'SANCTIONS_CONTACT_BLOCKED';
```
et utiliser `action: 'SANCTIONS_CONTACT_BLOCKED'` ci-dessous. C'est le défaut retenu.

- [ ] **Step 1: Modifier l'action**

Dans `frontend/src/actions/inviteShipowner.ts`, à l'endroit où la ligne `shipowners` est chargée (étape 1 du flow existant), étendre le `select` pour inclure les nouveaux flags et appeler le garde **avant** l'émission de l'invitation Supabase :

```typescript
import { assertContactAllowed, SanctionedContactError } from '@/domain/sanctions/contactGuard';

// ... dans le flow, après chargement de la ligne shipowner (ajouter les colonnes au select) :
//    .select('id, name, account_state, official_email, profile_id, is_ofac_sdn, is_un_prohibited')

try {
    assertContactAllowed({
        is_ofac_sdn: shipowner.is_ofac_sdn,
        is_un_prohibited: shipowner.is_un_prohibited,
        name: shipowner.name,
    });
} catch (e) {
    if (e instanceof SanctionedContactError) {
        await platform.from('audit_logs').insert({
            user_id: auth.user.id,
            user_full_name: profile.full_name ?? auth.user.email ?? 'unknown',
            action: 'SANCTIONS_CONTACT_BLOCKED',
            severity: 'CRITICAL',
            entity_type: 'shipowner',
            entity_id: shipowner.id,
            details_json: { code: e.code, attempted: 'PORTAL_INVITE', email: parsed.data.email },
        });
        return { ok: false, reason: `sanctioned: ${e.message}` };
    }
    throw e;
}
```

(Adapter les noms de variables locales — `platform` / `admin` — à ceux réellement présents dans le fichier ; le client service-role y existe déjà pour l'upsert profiles. `user_full_name` : reprendre la donnée déjà chargée par l'action si présente, sinon `auth.user.email ?? 'unknown'`.)

- [ ] **Step 2: Vérifier types + lint + tests existants**

Run (depuis `frontend/`) : `npx tsc --noEmit && npm run lint && npm run test -- run src/actions`
Expected : 0 erreur TS, lint OK, tests existants inchangés. (Le test d'intégration complet de l'action nécessite le stack Supabase local — les tests unitaires du garde couvrent la logique ; si un test d'intégration `inviteShipowner.test.ts` existe déjà, l'étendre avec un cas armateur `is_ofac_sdn=true` → `{ok:false, reason: /sanctioned/}`.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/actions/inviteShipowner.ts supabase/migrations/092_shipowner_onboarding_sanctions.sql
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(sanctions): blocage des invitations aux armateurs OFAC/UN + audit"
```

---

### Task 6: Schémas Zod + mappers seeds → schéma existant (TDD)

**Files:**
- Create: `frontend/src/services/onboardingImport/seedSchemas.ts`
- Create: `frontend/src/services/onboardingImport/mappers.ts`
- Test: `frontend/src/services/onboardingImport/mappers.test.ts`

**Interfaces:**
- Produces (consommé par Task 7) :
  - `armateursFileSchema`, `compagniesFileSchema`, `naviresFileSchema`, `voyagesFileSchema`, `proformasFileSchema`, `relancesFileSchema`, `paiementsFileSchema` (Zod, `.parse()` sur le JSON brut)
  - `mapArmateurToShipowner(a: SeedArmateur): ShipownerInsert`
  - `mapCompagnieToShipowner(c: SeedCompagnie): ShipownerInsert`
  - `mapNavireToVessel(n: SeedNavire, shipownerIdBySeedRef: Map<string, string>): VesselInsert`
  - `mapVesselCategory(typeNavire: string): DbVesselCategory` (fallback `'CARGO'`)
  - `parseSeedDate(s: string): string` (accepte `DD/MM/YYYY` et ISO → retourne `YYYY-MM-DD`)
  - `mapProformaMaritime(p, ctx): TransactionInsert` — `ctx = { vesselIdBySeedRef, shipownerIdBySeedRef, voyageBySeedRef }`
  - `mapProformaAviation(p, ctx): TransactionInsert` — `ctx = { aircraftIdByKey, shipownerIdBySeedRef }` ; clé aircraft = `` `${compagnie_id}/${vol_details.aircraft}` ``
  - `mapRelance(r, txnIdByInvoiceRef: Map<string, string>): CollectionReminderInsert`
  - `mapPaiement(p, txnIdByInvoiceRef: Map<string, string>, confirmedBy: string): PaymentInsert`
  - Les types `*Insert` sont des `interface` locales alignées sur les colonnes DB (pas de `any`), exportées.

**Règles de mapping (source de vérité pour l'implémentation) :**

| Seed | Cible | Détails |
|---|---|---|
| `armateurs[]` | `shipowners` | `seed_ref=id`, `name=nom_legal`, `country_code=pays_hq`, `address=adresse_hq`, `official_email=email_principal` (null si absent), `ops_email=email_ops`, `phone_e164=telephone`, `aliases`, `equasis_id`, `notes`, `is_ofac_sdn`, `is_un_prohibited`, `account_state='GHOST'` (toujours — l'invitation est un acte admin explicite post-import) |
| `compagnies[]` | `shipowners` | `seed_ref=id`, `name=nom_legal`, `country_code=pays_hq`, `iata_code`, `icao_code`, `hub_code=hub_principal`, `ops_email=email_ops`, `finance_email=email_finance`, `official_email=email_ops`, `notes`, `account_state='GHOST'` ; ignorer `vols_realises_2026`, `usd_realises_2026`, `flotte_a_hga` |
| `navires[]` | `vessels` | `seed_ref=id`, `imo_number=imo`, `name=nom`, `mmsi` (null si `"—"`), `flag_code=pavillon` (null si non-ISO2 → mais colonne NOT NULL CHAR(2) : si invalide, `'XX'`), `category=mapVesselCategory(type_navire)`, `vessel_subtype=type_navire`, `gross_tonnage_dwt=gt`, `dwt`, `build_year=annee_construction`, `previous_names`, `wave_tag`, `shipowner_id` résolu via `armateur_id`→`seed_ref` |
| `voyages[]` | — | PAS de table dédiée : les métriques du voyage vont dans `transactions.breakdown_json.voyage` de la pro-forma maritime correspondante (relation 1:1 dans les seeds via `proformas.voyage_ids[0]`). Pas d'`arrival_alerts` historiques (state machine réservée au flux AIS live). |
| `proformas[]` type MARITIME | `transactions` | `invoice_ref=reference`, `transaction_type='ENTRY_TAX'`, `document_type='PROFORMA'`, `mode='MARITIME'`, `vessel_id` résolu, `vessel_name`/`vessel_imo` du navire, `shipowner_id` résolu, `emissions_tco2=voyage.co2_facturable_tco2`, `tax_amount_usd=total_usd`, `rate_usd_per_tco2=40`, `status='PENDING'`, `collections_status='CURRENT'`, `created_at=date_emission` (⇒ due_date générée correcte), `breakdown_json={ source:'onboarding_seed_v2', wave_tag, voyage:{...} }` |
| `proformas[]` type AVIATION | `transactions` | idem mais `mode='AIR'`, `aircraft_id` (aircraft synthétique par clé `compagnie/type`, cf. Task 7), `vessel_id=null`, `vessel_name=vol_details.flight_no`, `vessel_imo=vol_details.aircraft`, `emissions_tco2=vol_details.co2_voyage_tco2 * vol_details.rfi`, `breakdown_json={ source:'onboarding_seed_v2', vol: vol_details }` |
| `relances[]` | `collection_reminders` | `seed_ref=id`, `transaction_id` résolu via `proforma_id`→`invoice_ref` (mapping seed id `pf-mar-064001`→ref `PRO-2026-064001` : construire `txnIdByInvoiceRef` à partir des proformas importées, indexé par **seed id**), `tier`, `sent_at`, `sent_email`, `cc_emails`, `template_used`, `debtor_response_at=armateur_response_at`, `debtor_response_type=armateur_response_type`, `escalated_bailiff` |
| `paiements[]` | `payments` | `transaction_id` résolu via `proforma_id`, `shipowner_id` de la transaction, `amount_minor=Math.round(montant_usd*100)`, `currency='USD'`, `amount_usd_minor=idem`, `fx_rate=1`, `rail='WIRE_TRANSFER'`, `rail_details={ reference_bancaire, banque_emettrice, notes }`, `external_reference=reference_bancaire`, `status='CONFIRMED'`, `confirmed_by=confirmedBy`, `confirmed_at=date_recu`, `declared_by=confirmedBy` |

`mapVesselCategory` :
```typescript
const CATEGORY_MAP: Record<string, DbVesselCategory> = {
    'Bulk Carrier': 'BULK_CARRIER',
    'Container Ship': 'CONTAINER',
    'General Cargo': 'CARGO',
    'Cargo': 'CARGO',
    'Chemical Tanker': 'TANKER',
    'Chemical/Oil Tanker': 'TANKER',
    'Oil Tanker': 'TANKER',
    'Livestock Carrier': 'CARGO',
    'Tug': 'CARGO',
    'Offshore Tug/Supply': 'CARGO',
    'Landing Craft': 'CARGO',
};
export function mapVesselCategory(t: string): DbVesselCategory {
    return CATEGORY_MAP[t] ?? 'CARGO';
}
```
(⚠️ vérifier les valeurs exactes de l'enum `vessel_category` dans `supabase/migrations/003_core_domain_tables.sql` avant d'écrire le map — `CONTAINER` vs `CONTAINER_SHIP`.)

- [ ] **Step 1: Écrire les tests qui échouent** — cas minimum :

```typescript
// frontend/src/services/onboardingImport/mappers.test.ts
import { describe, it, expect } from 'vitest';
import {
    parseSeedDate, mapVesselCategory, mapArmateurToShipowner,
    mapCompagnieToShipowner, mapProformaAviation,
} from './mappers';

describe('onboardingImport mappers', () => {
    it('parseSeedDate accepte DD/MM/YYYY et ISO', () => {
        expect(parseSeedDate('26/04/2026')).toBe('2026-04-26');
        expect(parseSeedDate('2026-06-01')).toBe('2026-06-01');
    });

    it('mapVesselCategory couvre les 11 types du seed avec fallback CARGO', () => {
        expect(mapVesselCategory('Bulk Carrier')).toBe('BULK_CARRIER');
        expect(mapVesselCategory('Livestock Carrier')).toBe('CARGO');
        expect(mapVesselCategory('Type Inconnu')).toBe('CARGO');
    });

    it('armateur OFAC garde ses flags et reste GHOST', () => {
        const row = mapArmateurToShipowner({
            id: 'arm-007', nom_legal: 'IRISL Group / Valfajr Shipping', alias: [],
            pays_hq: 'IR', adresse_hq: null, email_principal: 'commercial@irisl.net',
            email_ops: null, telephone: null, is_ofac_sdn: true, is_un_prohibited: false,
            verification_status: 'BLOCKED', onboarding_stage: 'BLOCKED_OFAC',
            equasis_id: null, notes: null,
        });
        expect(row.is_ofac_sdn).toBe(true);
        expect(row.account_state).toBe('GHOST');
        expect(row.seed_ref).toBe('arm-007');
    });

    it('compagnie aérienne mappe IATA/hub sur shipowners', () => {
        const row = mapCompagnieToShipowner({
            id: 'avi-002', nom_legal: 'FlyDubai', iata_code: 'FZ', icao_code: 'FDB',
            hub_principal: 'DXB', pays_hq: 'AE', email_ops: 'ops@flydubai.com',
            email_finance: 'finance@flydubai.com', onboarding_stage: 'PENDING_INVITE', notes: null,
        });
        expect(row.iata_code).toBe('FZ');
        expect(row.hub_code).toBe('DXB');
    });

    it('pro-forma aviation → transaction mode AIR avec CO2eq RFI', () => {
        const txn = mapProformaAviation(
            {
                id: 'pf-avi-0001', reference: 'AVI-2026-0001', type: 'AVIATION',
                compagnie_id: 'avi-001',
                vol_details: { flight_no: 'ET-309', route: 'ADD-HGA', aircraft: 'B737-800', pax: 145, co2_voyage_tco2: 3.5, rfi: 2.0 },
                total_usd: 3040, total_paye_usd: 0, outstanding_usd: 3040,
                date_emission: '2026-06-01', date_echeance: '2026-07-01',
                payment_status: 'PENDING', pdf_url: null, sent_at: null, sent_method: null, is_erratum: false,
            },
            {
                aircraftIdByKey: new Map([['avi-001/B737-800', 'aaaaaaaa-0000-4000-8000-000000000001']]),
                shipownerIdBySeedRef: new Map([['avi-001', 'bbbbbbbb-0000-4000-8000-000000000001']]),
            },
        );
        expect(txn.mode).toBe('AIR');
        expect(txn.aircraft_id).toBe('aaaaaaaa-0000-4000-8000-000000000001');
        expect(txn.vessel_id).toBeNull();
        expect(txn.emissions_tco2).toBeCloseTo(7.0);
        expect(txn.tax_amount_usd).toBe(3040);
        expect(txn.invoice_ref).toBe('AVI-2026-0001');
        expect(txn.created_at).toBe('2026-06-01');
    });
});
```

- [ ] **Step 2: Vérifier l'échec** — `npm run test -- run src/services/onboardingImport/mappers.test.ts` → FAIL (module absent).

- [ ] **Step 3: Implémenter `seedSchemas.ts` puis `mappers.ts`** selon le tableau de mapping ci-dessus. Schémas Zod : un `z.object` par entité + wrapper fichier `z.object({ count: z.number(), armateurs: z.array(armateurSchema) })` etc. — champs inconnus tolérés (`.loose()` ou lister tous). Tous les types dérivés via `z.infer`. Aucun `any`.

- [ ] **Step 4: Vérifier le succès** — `npm run test -- run src/services/onboardingImport` → PASS. Puis `npx tsc --noEmit` → 0 erreur.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/onboardingImport/
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(onboarding): schémas Zod et mappers des seeds vers le schéma GreenGate"
```

---

### Task 7: Script d'import `scripts/seed-onboarding.ts` (purge + upserts + vérification)

**Files:**
- Create: `scripts/seed-onboarding.ts`
- Create: `frontend/src/types/supabase.generated.ts` (généré, pas écrit à la main)

**Interfaces:**
- Consumes: schémas + mappers (Task 6), colonnes 092/093, table 094.
- Produces: base locale peuplée ; sortie console avec les compteurs et la somme de contrôle.

**Comportement :**
- Env requis : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SEED_ADMIN_PROFILE_ID` (profil SUPERADMIN existant — utilisé pour `payments.confirmed_by/declared_by`).
- `--dry-run` par défaut (parse + map + compteurs, zéro write). `--execute` pour écrire.
- `--purge` : suppression préalable des données de démo, UNIQUEMENT si `PURGE_CONFIRM=TABLE_RASE` dans l'env. Ordre FK : `collection_reminders` → `wallet_ledger` → `refunds` → `payment_proofs` → `payments` → `transactions` → `arrival_alerts` → `vessel_positions` → `aircraft_positions` → `vessels` → `aircraft` → `wallets` → `shipowners`. **Ne touche PAS** : `profiles`, `jurisdictions`, `tariffs`, `methodologies`, `emission_factors`, `air_emission_factors`, `app_config`, `audit_logs`.
- Ordre d'import : shipowners (armateurs + compagnies) → vessels → aircraft synthétiques → transactions maritimes → transactions aviation → collection_reminders → payments (+ recalcul `partial_paid_usd` et `status` de la transaction payée : 3 985.12 + autres sur `PRO-2026-064001`? — appliquer chaque paiement à sa transaction : `partial_paid_usd += montant`, `status` reste `PENDING` si partiel).
- Idempotence : `upsert(..., { onConflict: 'seed_ref' })` pour shipowners/vessels/reminders ; `onConflict: 'invoice_ref'` pour transactions ; paiements : skip si `external_reference` déjà présent.
- Aircraft synthétiques : une ligne par clé distincte `` `${compagnie_id}/${vol_details.aircraft}` `` → `{ registration: null, icao_type: vol_details.aircraft, operator_id: shipownerId, jurisdiction_id: default }`. Réutiliser si déjà présents (lookup par `operator_id + icao_type`).
- Vérification finale (mode `--execute`) : requêtes de contrôle et **échec du script** (exit 1) si écart :
  - `shipowners` importés = 26 ; `vessels` = 100 ; `transactions` PROFORMA = 458 (100 MARITIME + 358 AIR) ;
  - `SUM(tax_amount_usd)` = **2 604 886.34** (tolérance ±0.01) ;
  - `collection_reminders` = 40 ; `payments` = 3, somme **12 055.57 USD** ;
  - 3 shipowners avec `is_ofac_sdn OR is_un_prohibited`.

- [ ] **Step 1: Générer les types Supabase**

Run : `npx supabase gen types typescript --local > frontend/src/types/supabase.generated.ts`
(Nécessite les migrations 092-094 appliquées — `npx supabase db reset` au préalable. Ne PAS toucher `frontend/src/types/database.ts` existant : le fichier généré est utilisé par le nouveau code uniquement.)

- [ ] **Step 2: Écrire le script**

Squelette (compléter avec les mappers de Task 6) :

```typescript
// scripts/seed-onboarding.ts
// Import du package onboarding_armateurs (docs/onboarding/seeds) dans Supabase.
// Usage :
//   npx tsx scripts/seed-onboarding.ts                → dry-run (aucun write)
//   npx tsx scripts/seed-onboarding.ts --execute      → import idempotent
//   PURGE_CONFIRM=TABLE_RASE npx tsx scripts/seed-onboarding.ts --execute --purge
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    armateursFileSchema, compagniesFileSchema, naviresFileSchema, voyagesFileSchema,
    proformasFileSchema, relancesFileSchema, paiementsFileSchema,
} from '../frontend/src/services/onboardingImport/seedSchemas';
import {
    mapArmateurToShipowner, mapCompagnieToShipowner, mapNavireToVessel,
    mapProformaMaritime, mapProformaAviation, mapRelance, mapPaiement,
} from '../frontend/src/services/onboardingImport/mappers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEEDS = join(ROOT, 'docs', 'onboarding', 'seeds');
const EXECUTE = process.argv.includes('--execute');
const PURGE = process.argv.includes('--purge');

function env(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`env ${name} manquante`);
    return v;
}

function loadJson(file: string): unknown {
    return JSON.parse(readFileSync(join(SEEDS, file), 'utf-8'));
}

async function main(): Promise<void> {
    // 1. Parse + validation Zod des 7 seeds (échoue AVANT tout write)
    const armateurs = armateursFileSchema.parse(loadJson('01_armateurs.json')).armateurs;
    const navires = naviresFileSchema.parse(loadJson('02_navires.json')).navires;
    const voyages = voyagesFileSchema.parse(loadJson('03_voyages.json')).voyages;
    const proformas = proformasFileSchema.parse(loadJson('04_proformas.json')).proformas;
    const relances = relancesFileSchema.parse(loadJson('05_relances.json')).relances;
    const paiements = paiementsFileSchema.parse(loadJson('06_paiements.json')).paiements;
    const compagnies = compagniesFileSchema.parse(loadJson('07_compagnies_aeriennes.json')).compagnies;

    const totalUsd = proformas.reduce((s, p) => s + p.total_usd, 0);
    console.log(`Seeds OK : ${armateurs.length} armateurs, ${compagnies.length} compagnies, ` +
        `${navires.length} navires, ${voyages.length} voyages, ${proformas.length} pro-formas, ` +
        `${relances.length} relances, ${paiements.length} paiements — total USD ${totalUsd.toFixed(2)}`);

    if (!EXECUTE) { console.log('Dry-run : aucun write. Relancer avec --execute.'); return; }

    const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
    const confirmedBy = env('SEED_ADMIN_PROFILE_ID');

    if (PURGE) {
        if (process.env.PURGE_CONFIRM !== 'TABLE_RASE') {
            throw new Error('--purge exige PURGE_CONFIRM=TABLE_RASE');
        }
        // ordre FK — voir plan ; throw à la première erreur
        for (const table of ['collection_reminders', 'wallet_ledger', 'refunds', 'payment_proofs',
            'payments', 'transactions', 'arrival_alerts', 'vessel_positions',
            'aircraft_positions', 'vessels', 'aircraft', 'wallets', 'shipowners'] as const) {
            const { error } = await db.from(table).delete().not('id', 'is', null);
            if (error) throw new Error(`purge ${table}: ${error.message}`);
            console.log(`purge ${table} OK`);
        }
    }

    // 2. Shipowners (armateurs + compagnies) — upsert par seed_ref
    // 3. Vessels — upsert par seed_ref (résolution shipowner via Map seed_ref→uuid)
    // 4. Aircraft synthétiques par (compagnie, icao_type)
    // 5. Transactions maritimes (join voyage 1:1 via proforma.voyage_ids[0]) puis aviation
    // 6. collection_reminders, puis payments + application sur la transaction
    // 7. Vérification finale (compteurs + somme) — exit 1 si écart
    // ... (implémentation avec les mappers, chaque étape logge son compteur)
}

main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
});
```

Notes d'implémentation obligatoires :
- Batching des inserts par 200 lignes (`.upsert(rows.slice(i, i+200))`) — 458 transactions passent en 3 batchs.
- Après upsert des shipowners, relire `id, seed_ref` pour construire `shipownerIdBySeedRef` ; idem vessels et transactions (`id, invoice_ref`).
- `voyageBySeedRef` : indexer les voyages par `id` ; la pro-forma maritime référence `voyage_ids[0]`.
- Les 69 pro-formas `DRAFT` du seed s'importent comme `PENDING` avec `proforma_sent_at=null` (le modèle existant n'a pas de statut DRAFT ; l'envoi réel viendra au Sprint 3).
- `created_at` : passer explicitement `p.date_emission` (colonne acceptée à l'insert, vérifié : pas de trigger l'écrasant).

- [ ] **Step 3: Tester le script en dry-run**

Run : `npx tsx scripts/seed-onboarding.ts`
Expected : `Seeds OK : 20 armateurs, 6 compagnies, 100 navires, 100 voyages, 458 pro-formas, 40 relances, 3 paiements — total USD 2604886.34` puis `Dry-run : aucun write.`

- [ ] **Step 4: Exécuter contre le stack local**

Run :
```bash
npx supabase db reset
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<clé locale> \
SEED_ADMIN_PROFILE_ID=<uuid profil superadmin local> \
npx tsx scripts/seed-onboarding.ts --execute
```
Expected : compteurs 26 / 100 / 458 / 40 / 3, somme 2 604 886.34, exit 0. Relancer une 2ᵉ fois → mêmes compteurs (idempotence, aucun doublon).

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-onboarding.ts frontend/src/types/supabase.generated.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(onboarding): script d'import idempotent des 7 seeds du portefeuille réel"
```

---

### Task 8: Vérification de bout en bout + garde-fous finaux

**Files:**
- Modify: `frontend/src/services/onboardingImport/mappers.test.ts` (test d'intégrité sur les seeds réels)

**Interfaces:**
- Consumes: tout ce qui précède.

- [ ] **Step 1: Test d'intégrité sur les fichiers seeds réels** (pur, sans DB — lit `docs/onboarding/seeds/`) :

```typescript
// à ajouter dans mappers.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { proformasFileSchema, armateursFileSchema } from './seedSchemas';

const SEEDS = join(__dirname, '../../../../docs/onboarding/seeds');

describe('seeds réels — intégrité', () => {
    it('les 458 pro-formas totalisent USD 2 604 886.34', () => {
        const raw: unknown = JSON.parse(readFileSync(join(SEEDS, '04_proformas.json'), 'utf-8'));
        const { proformas } = proformasFileSchema.parse(raw);
        expect(proformas).toHaveLength(458);
        const total = proformas.reduce((s, p) => s + p.total_usd, 0);
        expect(total).toBeCloseTo(2604886.34, 2);
    });

    it('exactement 3 armateurs sous sanctions, tous sans invitation possible', () => {
        const raw: unknown = JSON.parse(readFileSync(join(SEEDS, '01_armateurs.json'), 'utf-8'));
        const { armateurs } = armateursFileSchema.parse(raw);
        const blocked = armateurs.filter((a) => a.is_ofac_sdn || a.is_un_prohibited);
        expect(blocked.map((a) => a.id).sort()).toEqual(['arm-007', 'arm-012', 'arm-013']);
    });
});
```

(Si `__dirname` indisponible sous vitest ESM : utiliser `new URL('../../../../docs/onboarding/seeds', import.meta.url)`.)

- [ ] **Step 2: Suite complète**

Run (depuis `frontend/`) : `npx tsc --noEmit && npm run lint && npm run test -- run`
Expected : 0 erreur TS, lint clean, tous les tests passent (existants + nouveaux).

- [ ] **Step 3: Commit + point de démo Sprint 1**

```bash
git add frontend/src/services/onboardingImport/mappers.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "test(onboarding): intégrité du portefeuille seeds (total, sanctions)"
```

Démo Sprint 1 (à présenter au PO avant tout run staging/prod) :
1. `npx tsx scripts/seed-onboarding.ts` (dry-run) → compteurs.
2. Run local `--execute` → requête KPI : `SELECT mode, count(*), sum(tax_amount_usd) FROM transactions WHERE document_type='PROFORMA' GROUP BY mode;` → MARITIME 100 / 1 889 653.34 · AIR 358 / 715 233.00.
3. Tentative d'invitation d'`IRISL` via `inviteShipowner` → refus `sanctioned:` + ligne `audit_logs` CRITICAL.
4. Décision PO : purge + import sur l'hébergé (hors périmètre de ce plan).

---

## Self-Review (fait à l'écriture)

- **Couverture** : migrations (T1-T3), purge+import 7 seeds (T7), RLS (T3 ; 092/093 héritent des policies existantes de shipowners/vessels), types générés (T7-S1), garde OFAC + test obligatoire (T4-T5), vérification chiffres (T7-S4, T8). Les invitations en masse et l'UI admin (édition email + bouton inviter) sont au Sprint 2 ; bank_statement/unmatched_payment/generated_report aux Sprints 3-4 conformément au brief.
- **Écarts assumés vs brief** (validés par l'analyse du 2026-07-17) : pas de tables `armateurs`/`proformas` françaises ; total 2 604 886.34 (somme réelle des seeds) ; pas d'`arrival_alerts` historiques ; comptes armateurs créés `GHOST` puis invités explicitement par l'admin (jamais de mot de passe généré — lien d'invitation Supabase).
- **Types cohérents** : `SanctionFlags`/`assertContactAllowed` identiques en T4/T5 ; `*Insert`/Maps identiques en T6/T7 ; `seed_ref` partout comme clé d'idempotence.
