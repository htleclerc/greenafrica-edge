# Onboarding paiement armateurs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire l'entonnoir complet qui mène un armateur de l'ouverture de `greengate.africa` au paiement de sa taxe carbone : hero de recherche par IMO/MMSI, consultation publique en teaser sans montant, rattachement par code e-mail, tutoriel public et checklist de progression.

**Architecture:** Une RPC `SECURITY DEFINER` (patron `verify_invoice_lookup`, mig 019/038) est la **seule** voie de lecture publique — sa projection SQL figée empêche structurellement la fuite d'un montant, même si le code applicatif se trompe. La résolution de l'e-mail de l'armateur et l'envoi du code vivent dans des server actions (jamais dans une RPC anon) : le client ne reçoit qu'un indice masqué. La checklist in-app dérive son état des tables réelles, sans colonne de progression.

**Tech Stack:** Next.js 16 (App Router, Server Components), TypeScript strict, next-intl v4, Supabase (Postgres + Auth OTP), Zod v4, Tailwind v4, Vitest, Playwright.

**Spec de référence :** [`docs/superpowers/specs/2026-08-12-onboarding-paiement-armateurs-design.md`](../specs/2026-08-12-onboarding-paiement-armateurs-design.md)

**Branche :** `feat/onboarding-paiement-armateurs` (déjà créée depuis `develop`, spec commité en `d744eff`).

## Global Constraints

- **TypeScript strict. `any` est interdit** (règle projet). Utiliser `unknown` + Zod pour toute entrée non typée.
- **Toute entrée externe est validée par Zod** avant usage.
- **Aucun montant, aucune référence de pro-forma, aucun nom d'armateur, aucun e-mail** ne doit apparaître dans une réponse servie à un visiteur non authentifié. Cette règle prime sur toute considération d'ergonomie.
- **Commits :** auteur `Loïc Leclerc <leclerc@drwintech.com>` via `git commit --author="Loïc Leclerc <leclerc@drwintech.com>"`. **Jamais** de `Co-Authored-By: Claude` ni de mention « Generated with Claude Code ». Messages conventionnels, humanisés. **Staging explicite par chemin** — jamais `git add -A` ni `git add .`.
- **Ne jamais commiter** `AGENTS.md` ni `scripts/invite-superadmin.mjs` : fichiers non suivis présents dans l'arbre, étrangers à ce chantier.
- **Répertoire de travail** des commandes `npm` : `frontend/`.
- **Tests :** `npm run test` (Vitest). Fichiers `*.test.ts(x)` colocalisés à côté de la source.
- **i18n :** 6 locales dans `frontend/messages/` — `fr.json`, `en.json`, `pt.json`, `sw.json`, `ar.json`, `so.json`. **Toute clé ajoutée doit exister dans les 6 fichiers**, sinon next-intl lève à l'exécution. `fr` et `en` rédigées ; `pt`/`sw`/`ar`/`so` en baseline traduite marquée pour relecture native.
- **Migration :** numéro **118**. Les migrations **115, 116, 117 n'ont jamais été exécutées sur l'hébergé** au 2026-08-12 — ne pas supposer la chaîne à jour.
- **Ne pas pousser** (`git push`) sans demande explicite du PO.

---

## Décisions de conception à respecter

Ces points ont été tranchés pendant le brainstorming. Un implémenteur qui les « améliore » casse le design.

1. **Le montant est absent de la réponse serveur**, pas masqué côté client. Ne jamais l'ajouter à la RPC « pour l'avoir sous la main ».
2. **Rate-limité et introuvable rendent exactement la même chose** (même corps, même statut). Toute différenciation transforme le throttling en oracle d'énumération.
3. **Le code part uniquement vers `shipowners.official_email`.** Aucune adresse fournie par le visiteur n'est jamais utilisée pour l'envoi.
4. **Les trois valeurs d'`official_email_source` ouvrent l'accès direct**, `AGENT_CLAIM` compris (décision PO). Le contrôle compensatoire est une ligne d'audit en `WARNING`.
5. **La résolution de l'armateur passe par `transactions.shipowner_id`, pas par `vessels.shipowner_id`** — bien que cette dernière colonne existe (mig 024). Raison : `transactions.shipowner_id` est *first-write-only*, gelée par le trigger de mig 089, donc elle porte l'attribution fiscale faisant foi ; `vessels.shipowner_id` est librement modifiable. Ne pas « simplifier » vers `vessels`.
6. **La checklist est dérivée, jamais persistée.** Aucune colonne de progression, aucun drapeau « tutoriel vu ».

---

## Structure des fichiers

**Créés :**

| Fichier | Responsabilité |
|---|---|
| `supabase/migrations/118_vessel_payment_teaser.sql` | RPC teaser, index `vessels(mmsi)`, colonne `is_placeholder` + backfill |
| `supabase/tests/migrations/118_vessel_payment_teaser.test.sql` | Garde G1 (projection sans montant) et G2 (placeholder non claimable) |
| `frontend/src/lib/vessels/identifier.ts` | Normalisation d'un identifiant saisi → IMO / MMSI / `null`. Pur. |
| `frontend/src/lib/vessels/identifier.test.ts` | |
| `frontend/src/services/vesselTeaserService.ts` | Appel RPC + rate-limit → état d'affichage |
| `frontend/src/services/vesselTeaserService.test.ts` | |
| `frontend/src/lib/vessels/maskEmail.ts` | Indice masqué d'une adresse. Pur. |
| `frontend/src/lib/vessels/maskEmail.test.ts` | |
| `frontend/src/actions/requestVesselAccessCode.ts` | Résolution armateur + gardes + envoi OTP |
| `frontend/src/actions/requestVesselAccessCode.test.ts` | |
| `frontend/src/actions/verifyVesselAccessCode.ts` | `verifyOtp`, liaison profil, activation, audit |
| `frontend/src/actions/verifyVesselAccessCode.test.ts` | |
| `frontend/src/components/pay/VesselLookupForm.tsx` | Champ de recherche partagé hero + `/pay` |
| `frontend/src/components/pay/VesselTeaserCard.tsx` | Rendu des 4 états |
| `frontend/src/app/pay/page.tsx` | Page de consultation (`noindex`) |
| `frontend/src/app/pay/claim/page.tsx` | Rattachement (`noindex`) |
| `frontend/src/components/pay/ClaimByCodePanel.tsx` | Branche A — envoi + saisie du code |
| `frontend/src/components/pay/ClaimByStaffPanel.tsx` | Branche B — formulaire de demande |
| `frontend/src/app/how-to-pay/page.tsx` | Tutoriel public (indexable) |
| `frontend/src/lib/onboarding/paymentChecklist.ts` | Dérivation des 4 items. Pur. |
| `frontend/src/lib/onboarding/paymentChecklist.test.ts` | |
| `frontend/src/components/onboarding/PaymentOnboardingChecklist.tsx` | Bandeau `/dashboard` |
| `frontend/e2e/scenarios/06-onboarding-paiement.spec.ts` | Parcours de bout en bout |

**Modifiés :**

| Fichier | Modification |
|---|---|
| `frontend/src/lib/rateLimit.ts` | +2 clés dans `LimiterKey` et `LIMITS` |
| `frontend/src/components/landing/HeroSection.tsx` | Hero armateur-first |
| `frontend/src/components/owner/pages/OperatorDashboardPage.tsx` | Monte la checklist |
| `frontend/messages/{fr,en,pt,sw,ar,so}.json` | Namespaces `VesselLookup`, `HowToPay`, `PaymentOnboarding` + clés `Landing` |

**Nommage — piège à éviter :** un composant `OnboardingBanner` **existe déjà** (`src/components/dashboard/overview/OnboardingBanner.tsx`, namespace i18n `OnboardingBanner`) et sert le dashboard **staff**. Le nôtre s'appelle `PaymentOnboardingChecklist`, namespace `PaymentOnboarding`. Ne pas réutiliser ni écraser l'existant.

---

## Task 1: Migration 118 — RPC teaser, index MMSI, drapeau placeholder

**Files:**
- Create: `supabase/migrations/118_vessel_payment_teaser.sql`
- Test: `supabase/tests/migrations/118_vessel_payment_teaser.test.sql`

**Interfaces:**
- Consumes: rien.
- Produces: RPC `public.vessel_payment_teaser(p_identifier TEXT)` retournant les colonnes `vessel_name TEXT, imo_number TEXT, port_call TEXT, outstanding_count INT, earliest_due_date TIMESTAMPTZ, has_overdue BOOLEAN, claimable BOOLEAN` ; colonne `public.shipowners.is_placeholder BOOLEAN NOT NULL DEFAULT FALSE`.

- [ ] **Step 1: Écrire la migration**

Créer `supabase/migrations/118_vessel_payment_teaser.sql` :

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 118 : consultation publique par IMO/MMSI (teaser sans montant)
-- Spec : docs/superpowers/specs/2026-08-12-onboarding-paiement-armateurs-design.md
-- ─────────────────────────────────────────────────────────────────────────────

-- vessels n'a d'index que sur imo_number (mig 003). La recherche accepte aussi
-- le MMSI ; sans index, un balayage séquentiel sur un chemin public non
-- authentifié est un levier de déni de service.
CREATE INDEX IF NOT EXISTS idx_vessels_mmsi ON public.vessels(mmsi) WHERE mmsi IS NOT NULL;

-- Marqueur explicite d'armateur de regroupement. Voir G2 dans le spec : ces
-- lignes ne représentent aucune entité réelle et ne doivent jamais ouvrir un
-- accès par code. Aujourd'hui « À identifier » n'a pas d'official_email et se
-- trouve exclu de fait — ce drapeau rend la protection intentionnelle plutôt
-- qu'accidentelle, et la maintient si une adresse de repli y est un jour saisie.
ALTER TABLE public.shipowners
  ADD COLUMN IF NOT EXISTS is_placeholder BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.shipowners.is_placeholder IS
'TRUE pour les armateurs de regroupement ne correspondant à aucune entité réelle
(ex. « À identifier - IMO lookup en cours », seed arm-014 : 83 pro-formas,
1,63 M USD en attente d''appariement). Exclut la ligne du rattachement public
par code — voir vessel_payment_teaser et spec 2026-08-12.';

-- Backfill unique, au moment de la migration, plutôt qu'un filtre par motif
-- rejoué à chaque requête. Le libellé provient du seed 01_armateurs.json
-- (arm-014.nom_legal). Le staff peut ensuite basculer le drapeau à la main.
UPDATE public.shipowners
   SET is_placeholder = TRUE
 WHERE name ILIKE 'À identifier%'
    OR name ILIKE 'A identifier%';

-- Statuts « à régler » : PENDING, PARTIALLY_PAID, OVERDUE.
-- Exclus volontairement : PAID, EXEMPT, VOID, CREDIT_NOTE_ISSUED (rien à devoir)
-- et DISPUTED (avis sous contestation — le compter comme dû contredirait la
-- procédure de contestation publiée sur /legal-basis).
CREATE OR REPLACE FUNCTION public.vessel_payment_teaser(p_identifier TEXT)
RETURNS TABLE (
    vessel_name       TEXT,
    imo_number        TEXT,
    port_call         TEXT,
    outstanding_count INT,
    earliest_due_date TIMESTAMPTZ,
    has_overdue       BOOLEAN,
    claimable         BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH v AS (
        SELECT ve.id, ve.name, ve.imo_number, ve.port_call
        FROM public.vessels ve
        WHERE ve.imo_number = p_identifier
           OR ve.mmsi       = p_identifier
        LIMIT 1
    ),
    t AS (
        SELECT tx.shipowner_id, tx.status, tx.due_date, tx.created_at
        FROM public.transactions tx
        JOIN v ON v.id = tx.vessel_id
        WHERE tx.status IN ('PENDING', 'PARTIALLY_PAID', 'OVERDUE')
    )
    SELECT
        v.name,
        v.imo_number,
        v.port_call,
        (SELECT COUNT(*)::INT FROM t),
        (SELECT MIN(t.due_date) FROM t),
        (SELECT COALESCE(BOOL_OR(t.status = 'OVERDUE'), FALSE) FROM t),
        -- claimable : l'armateur du dernier avis porte-t-il un e-mail
        -- exploitable ? Booléen seul — ni l'adresse ni le nom ne sortent d'ici.
        -- COALESCE : un navire sans avis en attente n'a pas d'armateur résolu
        -- ici ; on renvoie FALSE, jamais NULL, pour que l'appelant n'ait qu'un
        -- seul cas à traiter.
        COALESCE((
            SELECT s.official_email IS NOT NULL
               AND s.official_email <> ''
               AND s.is_placeholder = FALSE
            FROM t
            JOIN public.shipowners s ON s.id = t.shipowner_id
            ORDER BY t.created_at DESC
            LIMIT 1
        ), FALSE)
    FROM v;
$$;

-- Verrou : révoquer d'abord de PUBLIC, n'accorder qu'à anon/authenticated.
REVOKE ALL ON FUNCTION public.vessel_payment_teaser(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vessel_payment_teaser(TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.vessel_payment_teaser(TEXT) IS
'Consultation publique par IMO/MMSI. NE JAMAIS ajouter de montant, de référence
de pro-forma, de nom d''armateur ni d''e-mail à cette projection : elle est
appelée avec la clé anon depuis une page publique, sur un espace d''identifiants
entièrement énumérable. Voir spec 2026-08-12.';

-- ── Rollback ────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.vessel_payment_teaser(TEXT);
-- ALTER TABLE public.shipowners DROP COLUMN IF EXISTS is_placeholder;
-- DROP INDEX IF EXISTS public.idx_vessels_mmsi;
```

- [ ] **Step 2: Écrire le test SQL**

Créer `supabase/tests/migrations/118_vessel_payment_teaser.test.sql` :

```sql
-- Gardes du teaser public : la projection ne fuit rien, et un armateur de
-- regroupement n'ouvre jamais le rattachement par code.
BEGIN;

DO $$
DECLARE
  v_vessel UUID;
  v_owner  UUID;
  v_ghost  UUID;
  r        RECORD;
  n        INT;
BEGIN
  -- ── G1 : la projection ne contient aucun champ financier ni nominatif ──────
  SELECT COUNT(*) INTO n
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'vessel_payment_teaser'
    AND column_name IN (
      'tax_amount_usd', 'amount_usd', 'invoice_ref', 'owner_name',
      'official_email', 'shipowner_id', 'partial_paid_usd'
    );
  ASSERT n = 0,
    'G1 VIOLÉE : vessel_payment_teaser expose un champ financier ou nominatif';

  -- ── Fixture : navire + armateur réel avec e-mail ──────────────────────────
  INSERT INTO public.shipowners (name, account_state, official_email, official_email_source)
  VALUES ('Test Owner Claimable', 'GHOST', 'ops@test-owner.example', 'AGENT_CLAIM')
  RETURNING id INTO v_owner;

  INSERT INTO public.vessels (
    mmsi, imo_number, name, call_sign, flag_code, category,
    gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status, port_call
  ) VALUES ('111000111', '1110001', 'MV TEASER TEST', 'TSR1', 'SO', 'CARGO',
            40000, 15000, 13.0, 'APPROACHING', 'Berbera')
  RETURNING id INTO v_vessel;

  INSERT INTO public.transactions (
    vessel_id, vessel_name, vessel_imo, transaction_type,
    emissions_tco2, tax_amount_usd, status, shipowner_id
  ) VALUES (v_vessel, 'MV TEASER TEST', '1110001', 'CARBON_TAX',
            100.00, 12400.00, 'PENDING', v_owner);

  -- Recherche par IMO
  SELECT * INTO r FROM public.vessel_payment_teaser('1110001');
  ASSERT r.vessel_name = 'MV TEASER TEST', 'le navire doit être trouvé par IMO';
  ASSERT r.outstanding_count = 1, 'un avis PENDING doit être compté';
  ASSERT r.has_overdue = FALSE, 'aucun avis échu attendu';
  ASSERT r.claimable = TRUE, 'AGENT_CLAIM ouvre l''accès direct (décision PO)';

  -- Recherche par MMSI — même résultat
  SELECT * INTO r FROM public.vessel_payment_teaser('111000111');
  ASSERT r.imo_number = '1110001', 'le navire doit être trouvé par MMSI';

  -- ── G2 : un armateur placeholder n'est jamais claimable, MÊME avec e-mail ──
  -- C'est ce cas qui distingue la garde intentionnelle de la coïncidence de
  -- données : on renseigne délibérément une adresse sur le placeholder.
  INSERT INTO public.shipowners (name, account_state, official_email, is_placeholder)
  VALUES ('À identifier - test', 'GHOST', 'fourre-tout@example.org', TRUE)
  RETURNING id INTO v_ghost;

  UPDATE public.transactions SET shipowner_id = v_ghost WHERE vessel_id = v_vessel;

  SELECT * INTO r FROM public.vessel_payment_teaser('1110001');
  ASSERT r.claimable = FALSE,
    'G2 VIOLÉE : un armateur is_placeholder ouvre le rattachement par code';

  -- ── Navire inconnu : zéro ligne ───────────────────────────────────────────
  SELECT COUNT(*) INTO n FROM public.vessel_payment_teaser('0000000');
  ASSERT n = 0, 'un identifiant inconnu doit retourner zéro ligne';

  -- ── Backfill : le placeholder du seed est marqué ──────────────────────────
  SELECT COUNT(*) INTO n
  FROM public.shipowners
  WHERE name ILIKE 'À identifier%' AND is_placeholder = FALSE;
  ASSERT n = 0, 'le backfill a manqué une ligne « À identifier »';

  RAISE NOTICE 'mig 118 : toutes les assertions passent';
END $$;

ROLLBACK;
```

**Note :** `transaction_type` utilise la valeur `'CARBON_TAX'`. Si l'enum `public.transaction_type` ne la contient pas, lire `supabase/migrations/003_core_domain_tables.sql` et prendre la première valeur valide — le test ne porte pas sur ce champ.

- [ ] **Step 3: Appliquer la migration et lancer le test**

```bash
supabase db reset
./supabase/tests/run.sh migrations/118_vessel_payment_teaser.test.sql
```

Attendu : `NOTICE: mig 118 : toutes les assertions passent`, exit 0.

Si `supabase db reset` échoue (stack locale bloquée — gotcha connu du projet), lancer le test contre la base disponible via `SUPABASE_DB_URL` après avoir appliqué 118 seule :
```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/118_vessel_payment_teaser.sql
./supabase/tests/run.sh migrations/118_vessel_payment_teaser.test.sql
```

- [ ] **Step 4: Vérifier le backfill sur données réelles**

```bash
psql "$SUPABASE_DB_URL" -c "SELECT id, name, official_email, is_placeholder FROM public.shipowners WHERE is_placeholder;"
```

Attendu : **au moins une ligne**, celle nommée « À identifier - IMO lookup en cours ».
**Zéro ligne est un échec** : le libellé a changé, la garde G2 serait inopérante. Dans ce cas, identifier la ligne de regroupement (`SELECT id, name FROM shipowners WHERE official_email IS NULL ORDER BY name;`), corriger le `WHERE` du backfill, et relancer.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/118_vessel_payment_teaser.sql supabase/tests/migrations/118_vessel_payment_teaser.test.sql
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(db): migration 118, teaser public par IMO/MMSI sans montant

La projection SQL est figée : la clé anon ne peut pas sur-lire, même si le code
applicatif se trompe. is_placeholder rend intentionnelle l'exclusion de
l'armateur de regroupement, aujourd'hui exclu par le seul hasard d'un e-mail
absent."
```

---

## Task 2: Normalisation de l'identifiant

**Files:**
- Create: `frontend/src/lib/vessels/identifier.ts`
- Test: `frontend/src/lib/vessels/identifier.test.ts`

**Interfaces:**
- Consumes: `isValidImo(imo: string): boolean` depuis `@/services/vesselIdentity/imo` (existant — somme de contrôle IMO).
- Produces:
  ```ts
  export type VesselIdentifier =
      | { kind: 'IMO'; value: string }
      | { kind: 'MMSI'; value: string };
  export function normalizeVesselIdentifier(raw: string): VesselIdentifier | null;
  ```

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/src/lib/vessels/identifier.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { normalizeVesselIdentifier } from './identifier';

describe('normalizeVesselIdentifier', () => {
    it('accepte un IMO nu', () => {
        expect(normalizeVesselIdentifier('9424223')).toEqual({ kind: 'IMO', value: '9424223' });
    });

    it('accepte les formes copiées-collées depuis un PDF ou un site AIS', () => {
        for (const raw of ['IMO 9424223', 'IMO9424223', 'imo-9424223', '  9424223  ', 'IMO: 9424223']) {
            expect(normalizeVesselIdentifier(raw)).toEqual({ kind: 'IMO', value: '9424223' });
        }
    });

    it('accepte un MMSI à 9 chiffres', () => {
        expect(normalizeVesselIdentifier('341581000')).toEqual({ kind: 'MMSI', value: '341581000' });
    });

    it('rejette un IMO dont la somme de contrôle est fausse', () => {
        // 9424224 : dernier chiffre altéré — c'est la seule protection contre
        // une faute de frappe qui pointerait vers le navire d'un tiers.
        expect(normalizeVesselIdentifier('9424224')).toBeNull();
    });

    it('rejette toute longueur autre que 7 ou 9 chiffres', () => {
        for (const raw of ['', '123', '12345678', '1234567890', 'abcdefg']) {
            expect(normalizeVesselIdentifier(raw)).toBeNull();
        }
    });

    it('rejette une saisie sans aucun chiffre plutôt que de la réduire à vide', () => {
        expect(normalizeVesselIdentifier('IMO')).toBeNull();
    });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd frontend && npm run test -- src/lib/vessels/identifier.test.ts
```
Attendu : FAIL — `Failed to resolve import "./identifier"`.

- [ ] **Step 3: Écrire l'implémentation**

Créer `frontend/src/lib/vessels/identifier.ts` :

```ts
import { isValidImo } from '@/services/vesselIdentity/imo';

export type VesselIdentifier =
    | { kind: 'IMO'; value: string }
    | { kind: 'MMSI'; value: string };

/**
 * Normalise ce qu'un armateur colle dans le champ de recherche. Les saisies
 * arrivent d'un e-mail, d'un PDF de pro-forma ou d'un site AIS : « IMO 9424223 »,
 * « imo-9424223 », « 9424223 » désignent le même navire.
 *
 * 7 chiffres → IMO (avec vérification de la somme de contrôle : c'est la seule
 * protection contre une faute de frappe qui afficherait le navire d'un tiers).
 * 9 chiffres → MMSI. Toute autre longueur → null, rejeté sans appel serveur et
 * sans consommer de quota de rate-limit.
 */
export function normalizeVesselIdentifier(raw: string): VesselIdentifier | null {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 7) {
        return isValidImo(digits) ? { kind: 'IMO', value: digits } : null;
    }
    if (digits.length === 9) {
        return { kind: 'MMSI', value: digits };
    }
    return null;
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

```bash
cd frontend && npm run test -- src/lib/vessels/identifier.test.ts
```
Attendu : PASS, 6 tests.

Si `isValidImo` n'est pas exporté depuis `@/services/vesselIdentity/imo`, lire ce fichier et utiliser le nom réel — ne pas réimplémenter la somme de contrôle.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/vessels/identifier.ts frontend/src/lib/vessels/identifier.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(pay): normalise les identifiants de navire saisis

Reprend la somme de contrôle IMO existante plutôt que d'en écrire une seconde."
```

---

## Task 3: Masquage de l'indice e-mail

**Files:**
- Create: `frontend/src/lib/vessels/maskEmail.ts`
- Test: `frontend/src/lib/vessels/maskEmail.test.ts`

**Interfaces:**
- Produces: `export function maskEmailHint(email: string): string;`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/src/lib/vessels/maskEmail.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { maskEmailHint } from './maskEmail';

describe('maskEmailHint', () => {
    it('conserve la première lettre de chaque partie et le TLD', () => {
        expect(maskEmailHint('contact@hornshipping.com')).toBe('c••••t@h••••g.com');
    });

    it('ne restitue jamais le domaine en clair', () => {
        const masked = maskEmailHint('operations@uniseas-shipping.com');
        expect(masked).not.toContain('uniseas');
        expect(masked).not.toContain('operations');
        expect(masked.endsWith('.com')).toBe(true);
    });

    it('gère un sous-domaine sans fuir les niveaux intermédiaires', () => {
        const masked = maskEmailHint('ops@mail.hornshipping.co.uk');
        expect(masked).not.toContain('hornshipping');
        expect(masked).not.toContain('mail');
    });

    it('gère les parties très courtes sans planter ni tout révéler', () => {
        expect(maskEmailHint('a@b.com')).toBe('a@b.com');
        expect(maskEmailHint('ab@cd.com')).toBe('ab@cd.com');
    });

    it('retourne une chaîne neutre pour une entrée qui n''est pas une adresse', () => {
        expect(maskEmailHint('pas-une-adresse')).toBe('•••');
        expect(maskEmailHint('')).toBe('•••');
    });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd frontend && npm run test -- src/lib/vessels/maskEmail.test.ts
```
Attendu : FAIL — module introuvable.

- [ ] **Step 3: Écrire l'implémentation**

Créer `frontend/src/lib/vessels/maskEmail.ts` :

```ts
/**
 * Réduit une adresse à un indice : assez pour que l'armateur sache quelle boîte
 * surveiller, pas assez pour identifier l'entreprise depuis une page publique.
 *
 *   contact@hornshipping.com → c••••t@h••••g.com
 *
 * On conserve la première et la dernière lettre de la partie locale et du nom de
 * domaine, plus le TLD. Les niveaux intermédiaires d'un sous-domaine sont
 * écrasés : « mail.hornshipping.co.uk » ne doit pas laisser filtrer
 * « hornshipping ».
 */
function maskSegment(segment: string): string {
    if (segment.length <= 2) return segment;
    return `${segment[0]}${'•'.repeat(Math.max(segment.length - 2, 1))}${segment[segment.length - 1]}`;
}

export function maskEmailHint(email: string): string {
    const at = email.lastIndexOf('@');
    if (at <= 0 || at === email.length - 1) return '•••';

    const local = email.slice(0, at);
    const domain = email.slice(at + 1);

    const parts = domain.split('.');
    if (parts.length < 2) return '•••';

    const tld = parts[parts.length - 1];
    const registrable = parts[parts.length - 2];

    return `${maskSegment(local)}@${maskSegment(registrable)}.${tld}`;
}
```

**Note sur `a@b.com` :** la partie locale `a` fait 1 caractère et est renvoyée telle quelle — masquer une seule lettre ne cache rien et produirait un indice illisible. Ce cas n'existe pas en pratique sur des adresses d'entreprise.

**Note sur le `.co.uk` :** le test vérifie que `hornshipping` et `mail` ne fuient pas. `maskSegment('co')` renvoie `co` (≤ 2 caractères) et le TLD `uk` est conservé — l'indice est `o••s@c•.uk`. C'est volontairement conservateur : on préfère un indice pauvre à une fuite.

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

```bash
cd frontend && npm run test -- src/lib/vessels/maskEmail.test.ts
```
Attendu : PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/vessels/maskEmail.ts frontend/src/lib/vessels/maskEmail.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(pay): indice masqué de l'adresse de rattachement

Assez pour savoir quelle boîte surveiller, pas assez pour identifier
l'entreprise depuis une page publique."
```

---

## Task 4: Buckets de rate-limit

**Files:**
- Modify: `frontend/src/lib/rateLimit.ts` (type `LimiterKey` ~L27, objet `LIMITS` ~L44)

**Interfaces:**
- Produces: clés `'vessel-lookup'` et `'vessel-claim'` acceptées par `enforceRateLimit`.

- [ ] **Step 1: Ajouter les deux clés au type**

Dans `frontend/src/lib/rateLimit.ts`, ajouter à l'union `LimiterKey` :

```ts
type LimiterKey =
    | 'verify'
    | 'invoice-download'
    | 'signup'
    | 'signup-shipowner'
    | 'signup-air-operator'
    | 'admin-read'
    | 'admin-export'
    | 'vessel-lookup'
    | 'vessel-claim';
```

- [ ] **Step 2: Ajouter les deux buckets à `LIMITS`**

À la fin de l'objet `LIMITS`, avant l'accolade fermante :

```ts
    // Consultation publique par IMO/MMSI. Un armateur vérifie sa flotte :
    // quelques navires, quelques rechargements. Généreux pour l'humain, dur
    // pour le balayage des 7 chiffres d'IMO.
    'vessel-lookup': { perMinute: 20, perHour: 120 },

    // Envoi d'un code d'accès. Doublement plafonné : par IP ici, et par
    // armateur dans l'action — sinon faire varier l'IP suffirait à inonder la
    // boîte de l'armateur.
    'vessel-claim': { perMinute: 3, perHour: 10, perDay: 15 },
```

- [ ] **Step 3: Vérifier que le typecheck passe**

```bash
cd frontend && npx tsc --noEmit
```
Attendu : aucune erreur nouvelle.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/rateLimit.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(pay): buckets de rate-limit pour la consultation et l'envoi de code"
```

---

## Task 5: Service de consultation

**Files:**
- Create: `frontend/src/services/vesselTeaserService.ts`
- Test: `frontend/src/services/vesselTeaserService.test.ts`

**Interfaces:**
- Consumes: `normalizeVesselIdentifier` (Task 2), `enforceRateLimit` + `getClientId` (Task 4), RPC `vessel_payment_teaser` (Task 1).
- Produces:
  ```ts
  export interface VesselTeaser {
      vesselName: string;
      imoNumber: string;
      portCall: string | null;
      outstandingCount: number;
      earliestDueDate: string | null;
      hasOverdue: boolean;
      claimable: boolean;
  }
  export type TeaserState =
      | { state: 'OUTSTANDING'; teaser: VesselTeaser }
      | { state: 'CLEAR'; teaser: VesselTeaser }
      | { state: 'UNKNOWN' };
  export async function lookupVesselTeaser(rawQuery: string, clientId: string): Promise<TeaserState>;
  ```

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/src/services/vesselTeaserService.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc, mockEnforce } = vi.hoisted(() => ({
    mockRpc: vi.fn(),
    mockEnforce: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
    createClient: () => ({ rpc: mockRpc }),
}));
vi.mock('@/lib/rateLimit', () => ({
    enforceRateLimit: mockEnforce,
    getClientId: () => 'test-client',
}));

import { lookupVesselTeaser } from './vesselTeaserService';

const ROW = {
    vessel_name: 'MV DESERT STAR',
    imo_number: '9424223',
    port_call: 'Berbera',
    outstanding_count: 3,
    earliest_due_date: '2026-08-22T00:00:00Z',
    has_overdue: false,
    claimable: true,
};

beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    mockEnforce.mockResolvedValue({ allowed: true });
    mockRpc.mockResolvedValue({ data: [ROW], error: null });
});

describe('lookupVesselTeaser', () => {
    it('retourne OUTSTANDING quand des avis sont en attente', async () => {
        const r = await lookupVesselTeaser('IMO 9424223', 'client-1');
        expect(r.state).toBe('OUTSTANDING');
        expect(r).toMatchObject({ teaser: { vesselName: 'MV DESERT STAR', outstandingCount: 3 } });
    });

    it('ne laisse passer aucun montant dans l''objet retourné', async () => {
        mockRpc.mockResolvedValue({
            data: [{ ...ROW, tax_amount_usd: 12400 }],
            error: null,
        });
        const r = await lookupVesselTeaser('9424223', 'client-1');
        expect(JSON.stringify(r)).not.toContain('12400');
        expect(JSON.stringify(r)).not.toContain('tax_amount');
    });

    it('retourne CLEAR quand le navire existe sans avis en attente', async () => {
        mockRpc.mockResolvedValue({
            data: [{ ...ROW, outstanding_count: 0, claimable: false }],
            error: null,
        });
        const r = await lookupVesselTeaser('9424223', 'client-1');
        expect(r.state).toBe('CLEAR');
    });

    it('retourne UNKNOWN quand la RPC ne renvoie rien', async () => {
        mockRpc.mockResolvedValue({ data: [], error: null });
        expect(await lookupVesselTeaser('9424223', 'client-1')).toEqual({ state: 'UNKNOWN' });
    });

    it('retourne UNKNOWN — pas une erreur distincte — quand le quota est dépassé', async () => {
        // Décision de sécurité : rate-limité et introuvable doivent être
        // indistinguables, sinon le throttling devient un oracle d'énumération.
        mockEnforce.mockResolvedValue({ allowed: false, reason: 'rate_limited_per_minute' });
        expect(await lookupVesselTeaser('9424223', 'client-1')).toEqual({ state: 'UNKNOWN' });
        expect(mockRpc).not.toHaveBeenCalled();
    });

    it('retourne UNKNOWN sur identifiant invalide sans consommer de quota', async () => {
        expect(await lookupVesselTeaser('abc', 'client-1')).toEqual({ state: 'UNKNOWN' });
        expect(mockEnforce).not.toHaveBeenCalled();
        expect(mockRpc).not.toHaveBeenCalled();
    });

    it('retourne UNKNOWN quand la RPC échoue', async () => {
        mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
        expect(await lookupVesselTeaser('9424223', 'client-1')).toEqual({ state: 'UNKNOWN' });
    });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd frontend && npm run test -- src/services/vesselTeaserService.test.ts
```
Attendu : FAIL — module introuvable.

- [ ] **Step 3: Écrire l'implémentation**

Créer `frontend/src/services/vesselTeaserService.ts` :

```ts
import { createClient } from '@supabase/supabase-js';
import { enforceRateLimit } from '@/lib/rateLimit';
import { normalizeVesselIdentifier } from '@/lib/vessels/identifier';

export interface VesselTeaser {
    vesselName: string;
    imoNumber: string;
    portCall: string | null;
    outstandingCount: number;
    earliestDueDate: string | null;
    hasOverdue: boolean;
    claimable: boolean;
}

export type TeaserState =
    | { state: 'OUTSTANDING'; teaser: VesselTeaser }
    | { state: 'CLEAR'; teaser: VesselTeaser }
    | { state: 'UNKNOWN' };

const UNKNOWN: TeaserState = { state: 'UNKNOWN' };

interface TeaserRow {
    vessel_name: string;
    imo_number: string;
    port_call: string | null;
    outstanding_count: number;
    earliest_due_date: string | null;
    has_overdue: boolean;
    claimable: boolean;
}

/**
 * Consultation publique d'un navire par IMO ou MMSI.
 *
 * Tous les chemins d'échec — identifiant invalide, quota dépassé, navire
 * inconnu, RPC en erreur — retournent le MÊME objet UNKNOWN. C'est
 * délibéré : un espace de 7 chiffres est entièrement énumérable, et une
 * réponse distincte pour « throttlé » transformerait le rate-limit lui-même
 * en oracle. Voir /verify, durci sur le même principe après l'audit fraude
 * 2026-04.
 *
 * On projette explicitement champ par champ plutôt que d'étaler la ligne :
 * si quelqu'un ajoute un jour une colonne à la RPC, elle ne traverse pas
 * silencieusement jusqu'au navigateur.
 */
export async function lookupVesselTeaser(
    rawQuery: string,
    clientId: string,
): Promise<TeaserState> {
    const identifier = normalizeVesselIdentifier(rawQuery);
    if (!identifier) return UNKNOWN;

    const rate = await enforceRateLimit('vessel-lookup', clientId);
    if (!rate.allowed) return UNKNOWN;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return UNKNOWN;

    const anon = createClient(url, anonKey);
    const { data, error } = await anon.rpc('vessel_payment_teaser', {
        p_identifier: identifier.value,
    });

    if (error || !data || (data as TeaserRow[]).length === 0) return UNKNOWN;
    const row = (data as TeaserRow[])[0];

    const teaser: VesselTeaser = {
        vesselName: row.vessel_name,
        imoNumber: row.imo_number,
        portCall: row.port_call,
        outstandingCount: Number(row.outstanding_count),
        earliestDueDate: row.earliest_due_date,
        hasOverdue: Boolean(row.has_overdue),
        claimable: Boolean(row.claimable),
    };

    return teaser.outstandingCount > 0
        ? { state: 'OUTSTANDING', teaser }
        : { state: 'CLEAR', teaser };
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

```bash
cd frontend && npm run test -- src/services/vesselTeaserService.test.ts
```
Attendu : PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/vesselTeaserService.ts frontend/src/services/vesselTeaserService.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(pay): service de consultation publique par IMO/MMSI

Tous les échecs convergent vers UNKNOWN : un identifiant à 7 chiffres est
énumérable, une réponse distincte pour « throttlé » ferait du rate-limit
un oracle."
```

---

## Task 6: Clés i18n — consultation et recherche

**Files:**
- Modify: `frontend/messages/fr.json`, `frontend/messages/en.json`, `frontend/messages/pt.json`, `frontend/messages/sw.json`, `frontend/messages/ar.json`, `frontend/messages/so.json`

**Interfaces:**
- Produces: namespace `VesselLookup` disponible pour les Tasks 7 et 8, et clés `Landing.hero_owner_*`.

- [ ] **Step 1: Ajouter le namespace `VesselLookup` en français**

Dans `frontend/messages/fr.json`, ajouter au niveau racine :

```json
"VesselLookup": {
  "form_label": "Numéro IMO ou MMSI",
  "form_placeholder": "ex. 9424223",
  "form_submit": "Vérifier",
  "form_hint": "Réponse immédiate, sans compte.",
  "form_invalid": "Saisissez un numéro IMO (7 chiffres) ou MMSI (9 chiffres).",
  "page_title": "Vérifier la taxe carbone d'un navire",
  "outstanding_heading": "Avis en attente",
  "outstanding_count": "{count, plural, one {# avis en attente} other {# avis en attente}}",
  "outstanding_due": "Échéance la plus proche : {date}",
  "outstanding_overdue": "Un avis est échu",
  "outstanding_amount_locked": "Montant réservé au titulaire du compte",
  "outstanding_cta": "Voir et payer",
  "outstanding_cta_sub": "Connexion ou création de compte en quelques minutes",
  "clear_heading": "Aucun avis en attente",
  "clear_body": "Ce navire n'a aucune taxe carbone à régler à ce jour.",
  "clear_cta": "Créer un compte pour suivre",
  "unknown_heading": "Aucun avis pour ce numéro",
  "unknown_body": "Nous n'avons pas d'avis de taxe carbone associé à ce numéro. Vérifiez la saisie, ou contactez-nous si vous pensez qu'il s'agit d'une erreur.",
  "unknown_cta": "Nous contacter",
  "port_call": "Port d'escale",
  "imo_label": "IMO",
  "how_it_works": "Comment ça marche"
}
```

- [ ] **Step 2: Ajouter les clés `Landing` du hero armateur (français)**

Dans le namespace `Landing` existant de `fr.json`, ajouter :

```json
"hero_owner_title_line1": "Votre navire a-t-il",
"hero_owner_title_line2": "une taxe carbone à régler ?",
"hero_owner_subtitle": "Vérifiez en un instant avec votre numéro IMO ou MMSI, puis réglez en ligne. Aucun compte nécessaire pour vérifier.",
"hero_owner_signin": "Se connecter"
```

- [ ] **Step 3: Répliquer en anglais**

Mêmes clés dans `en.json`, rédigées (pas traduites mot à mot) :

```json
"VesselLookup": {
  "form_label": "IMO or MMSI number",
  "form_placeholder": "e.g. 9424223",
  "form_submit": "Check",
  "form_hint": "Instant answer, no account needed.",
  "form_invalid": "Enter an IMO number (7 digits) or MMSI (9 digits).",
  "page_title": "Check a vessel's carbon tax",
  "outstanding_heading": "Notices outstanding",
  "outstanding_count": "{count, plural, one {# notice outstanding} other {# notices outstanding}}",
  "outstanding_due": "Earliest due date: {date}",
  "outstanding_overdue": "One notice is overdue",
  "outstanding_amount_locked": "Amount visible to the account holder only",
  "outstanding_cta": "View and pay",
  "outstanding_cta_sub": "Sign in or open an account in a few minutes",
  "clear_heading": "Nothing outstanding",
  "clear_body": "This vessel has no carbon tax due at this time.",
  "clear_cta": "Open an account to track it",
  "unknown_heading": "No notice for this number",
  "unknown_body": "We have no carbon tax notice linked to this number. Check the digits, or contact us if you believe this is an error.",
  "unknown_cta": "Contact us",
  "port_call": "Port of call",
  "imo_label": "IMO",
  "how_it_works": "How it works"
}
```

Et dans `Landing` :

```json
"hero_owner_title_line1": "Does your vessel owe",
"hero_owner_title_line2": "carbon tax?",
"hero_owner_subtitle": "Check instantly with your IMO or MMSI number, then settle online. No account needed to check.",
"hero_owner_signin": "Sign in"
```

- [ ] **Step 4: Répliquer en pt, sw, ar, so**

Ajouter les **mêmes clés** dans `pt.json`, `sw.json`, `ar.json`, `so.json`, traduites en baseline. **Une clé manquante dans un seul fichier fait lever next-intl à l'exécution** — c'est un plantage, pas une dégradation.

Ajouter en tête de chaque namespace ajouté dans ces quatre fichiers la clé de marquage :

```json
"_translation_status": "auto — à relire par un locuteur natif (chantier onboarding paiement, 2026-08-12)"
```

- [ ] **Step 5: Vérifier que les 6 fichiers ont les mêmes clés**

```bash
cd frontend && node -e "
const locales=['fr','en','pt','sw','ar','so'];
const keys=o=>Object.keys(o||{}).filter(k=>k!=='_translation_status').sort().join(',');
const ref=require('./messages/fr.json');
let bad=false;
for(const l of locales){
  const m=require('./messages/'+l+'.json');
  if(keys(m.VesselLookup)!==keys(ref.VesselLookup)){console.error('VesselLookup diverge en '+l);bad=true;}
  for(const k of ['hero_owner_title_line1','hero_owner_title_line2','hero_owner_subtitle','hero_owner_signin'])
    if(!m.Landing||!m.Landing[k]){console.error('Landing.'+k+' manque en '+l);bad=true;}
}
console.log(bad?'ÉCHEC':'les 6 locales sont alignées');
process.exit(bad?1:0);
"
```
Attendu : `les 6 locales sont alignées`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/messages/fr.json frontend/messages/en.json frontend/messages/pt.json frontend/messages/sw.json frontend/messages/ar.json frontend/messages/so.json
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "i18n(pay): libellés de la consultation par IMO/MMSI dans les six locales"
```

---

## Task 7: Champ de recherche et carte de résultat

**Files:**
- Create: `frontend/src/components/pay/VesselLookupForm.tsx`
- Create: `frontend/src/components/pay/VesselTeaserCard.tsx`
- Test: `frontend/src/components/pay/VesselLookupForm.test.tsx`

**Interfaces:**
- Consumes: `normalizeVesselIdentifier` (Task 2), `TeaserState` / `VesselTeaser` (Task 5), namespace i18n `VesselLookup` (Task 6).
- Produces:
  ```ts
  export function VesselLookupForm(props: { autoFocus?: boolean; defaultValue?: string }): JSX.Element;
  export function VesselTeaserCard(props: { result: TeaserState; query: string }): JSX.Element;
  ```

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/src/components/pay/VesselLookupForm.test.tsx` :

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
vi.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
}));

import { VesselLookupForm } from './VesselLookupForm';

beforeEach(() => vi.clearAllMocks());

describe('VesselLookupForm', () => {
    it('navigue vers /pay avec l''identifiant normalisé', () => {
        render(<VesselLookupForm />);
        fireEvent.change(screen.getByLabelText('form_label'), { target: { value: 'IMO 9424223' } });
        fireEvent.click(screen.getByRole('button', { name: 'form_submit' }));
        expect(mockPush).toHaveBeenCalledWith('/pay?q=9424223');
    });

    it('affiche une erreur et ne navigue pas sur saisie invalide', () => {
        render(<VesselLookupForm />);
        fireEvent.change(screen.getByLabelText('form_label'), { target: { value: '123' } });
        fireEvent.click(screen.getByRole('button', { name: 'form_submit' }));
        expect(mockPush).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('form_invalid');
    });

    it('rejette un IMO à somme de contrôle fausse sans appel réseau', () => {
        render(<VesselLookupForm />);
        fireEvent.change(screen.getByLabelText('form_label'), { target: { value: '9424224' } });
        fireEvent.click(screen.getByRole('button', { name: 'form_submit' }));
        expect(mockPush).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd frontend && npm run test -- src/components/pay/VesselLookupForm.test.tsx
```
Attendu : FAIL — module introuvable.

- [ ] **Step 3: Écrire `VesselLookupForm`**

Créer `frontend/src/components/pay/VesselLookupForm.tsx` :

```tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { normalizeVesselIdentifier } from '@/lib/vessels/identifier';

/**
 * Champ de recherche par IMO/MMSI. Monté à deux endroits — le hero d'accueil et
 * la page /pay — et volontairement pas dupliqué : une correction de
 * normalisation doit s'appliquer aux deux d'un coup.
 *
 * La validation est faite ici, avant navigation : une saisie invalide ne part
 * pas au serveur et ne consomme donc aucun quota de rate-limit.
 */
export function VesselLookupForm({
    autoFocus = false,
    defaultValue = '',
}: {
    autoFocus?: boolean;
    defaultValue?: string;
}) {
    const t = useTranslations('VesselLookup');
    const router = useRouter();
    const [value, setValue] = React.useState(defaultValue);
    const [error, setError] = React.useState(false);

    function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        const identifier = normalizeVesselIdentifier(value);
        if (!identifier) {
            setError(true);
            return;
        }
        setError(false);
        router.push(`/pay?q=${encodeURIComponent(identifier.value)}`);
    }

    return (
        <form onSubmit={onSubmit} className="w-full max-w-xl mx-auto">
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                    <label htmlFor="vessel-lookup-input" className="sr-only">
                        {t('form_label')}
                    </label>
                    <input
                        id="vessel-lookup-input"
                        name="q"
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        autoFocus={autoFocus}
                        value={value}
                        onChange={(e) => { setValue(e.target.value); setError(false); }}
                        placeholder={t('form_placeholder')}
                        aria-invalid={error}
                        aria-describedby={error ? 'vessel-lookup-error' : undefined}
                        className="w-full px-5 py-3.5 rounded-xl text-base bg-transparent
                                   focus-visible:outline-none focus-visible:ring-2
                                   focus-visible:ring-emerald-500"
                        style={{
                            color: 'var(--ais-page-text)',
                            border: '1px solid var(--ais-page-border)',
                            backgroundColor: 'var(--ais-page-surface)',
                        }}
                    />
                </div>
                <button
                    type="submit"
                    className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 rounded-xl
                               font-semibold transition-all flex items-center justify-center gap-2
                               focus-visible:outline-none focus-visible:ring-2
                               focus-visible:ring-emerald-400"
                    style={{ color: '#FFFFFF' }}
                >
                    <Search className="w-4 h-4" aria-hidden="true" />
                    {t('form_submit')}
                </button>
            </div>

            {error ? (
                <p
                    id="vessel-lookup-error"
                    role="alert"
                    className="mt-2 text-sm text-red-400 text-center sm:text-left"
                >
                    {t('form_invalid')}
                </p>
            ) : (
                <p className="mt-2 text-xs text-center sm:text-left" style={{ color: 'var(--ais-page-text-dim)' }}>
                    {t('form_hint')}
                </p>
            )}
        </form>
    );
}
```

- [ ] **Step 4: Écrire `VesselTeaserCard`**

Créer `frontend/src/components/pay/VesselTeaserCard.tsx` :

```tsx
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Ship, AlertTriangle, CheckCircle2, Lock, HelpCircle } from 'lucide-react';
import type { TeaserState } from '@/services/vesselTeaserService';

function formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'long', year: 'numeric',
    });
}

/**
 * Rendu des quatre états de la consultation.
 *
 * Le montant n'apparaît pas ici parce qu'il n'existe pas dans `TeaserState` —
 * il n'est pas masqué en CSS, il n'a jamais quitté la base. Ne pas « enrichir »
 * ce composant avec une requête complémentaire.
 */
export async function VesselTeaserCard({ result, query }: { result: TeaserState; query: string }) {
    const t = await getTranslations('VesselLookup');

    if (result.state === 'UNKNOWN') {
        return (
            <section className="os-card p-8 text-center max-w-lg mx-auto">
                <HelpCircle className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--ais-page-text-dim)' }} aria-hidden="true" />
                <h1 className="text-xl font-semibold mb-2" style={{ color: 'var(--ais-page-text)' }}>
                    {t('unknown_heading')}
                </h1>
                <p className="text-sm mb-6" style={{ color: 'var(--ais-page-text-muted)' }}>
                    {t('unknown_body')}
                </p>
                <Link href="/partnership/contact" className="text-emerald-400 hover:underline text-sm font-medium">
                    {t('unknown_cta')}
                </Link>
            </section>
        );
    }

    const { teaser } = result;

    return (
        <section className="os-card p-8 max-w-lg mx-auto">
            <header className="flex items-start gap-3 mb-6">
                <Ship className="w-6 h-6 text-emerald-400 mt-1 shrink-0" aria-hidden="true" />
                <div>
                    <h1 className="text-xl font-semibold" style={{ color: 'var(--ais-page-text)' }}>
                        {teaser.vesselName}
                    </h1>
                    <p className="text-xs font-mono mt-1" style={{ color: 'var(--ais-page-text-dim)' }}>
                        {t('imo_label')} {teaser.imoNumber}
                        {teaser.portCall ? ` · ${teaser.portCall}` : ''}
                    </p>
                </div>
            </header>

            {result.state === 'CLEAR' ? (
                <>
                    <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" aria-hidden="true" />
                        <h2 className="text-base font-semibold text-emerald-400">{t('clear_heading')}</h2>
                    </div>
                    <p className="text-sm mb-6" style={{ color: 'var(--ais-page-text-muted)' }}>
                        {t('clear_body')}
                    </p>
                    <Link
                        href="/signup"
                        className="block text-center px-6 py-3 rounded-xl font-semibold bg-emerald-600
                                   hover:bg-emerald-500 transition-colors"
                        style={{ color: '#FFFFFF' }}
                    >
                        {t('clear_cta')}
                    </Link>
                </>
            ) : (
                <>
                    <div className="flex items-center gap-2 mb-3">
                        <AlertTriangle className="w-5 h-5 text-yellow-400" aria-hidden="true" />
                        <h2 className="text-base font-semibold text-yellow-400">
                            {t('outstanding_count', { count: teaser.outstandingCount })}
                        </h2>
                    </div>

                    <dl className="text-sm space-y-1 mb-4" style={{ color: 'var(--ais-page-text-muted)' }}>
                        <div>{t('outstanding_due', { date: formatDate(teaser.earliestDueDate) })}</div>
                        {teaser.hasOverdue && (
                            <div className="text-red-400 font-medium">{t('outstanding_overdue')}</div>
                        )}
                    </dl>

                    <div
                        className="flex items-center gap-2 px-4 py-3 rounded-lg mb-6 text-sm"
                        style={{ backgroundColor: 'var(--ais-page-surface)', color: 'var(--ais-page-text-dim)' }}
                    >
                        <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
                        {t('outstanding_amount_locked')}
                    </div>

                    <Link
                        href={`/pay/claim?q=${encodeURIComponent(query)}`}
                        className="block text-center px-6 py-3 rounded-xl font-semibold bg-emerald-600
                                   hover:bg-emerald-500 transition-colors"
                        style={{ color: '#FFFFFF' }}
                    >
                        {t('outstanding_cta')}
                    </Link>
                    <p className="text-xs text-center mt-2" style={{ color: 'var(--ais-page-text-dim)' }}>
                        {t('outstanding_cta_sub')}
                    </p>
                </>
            )}
        </section>
    );
}
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

```bash
cd frontend && npm run test -- src/components/pay/VesselLookupForm.test.tsx
```
Attendu : PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/pay/VesselLookupForm.tsx frontend/src/components/pay/VesselTeaserCard.tsx frontend/src/components/pay/VesselLookupForm.test.tsx
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(pay): champ de recherche partagé et carte de résultat

Le montant n'est pas masqué dans la carte : il n'existe pas dans l'état
qu'elle reçoit."
```

---

## Task 8: Page `/pay`

**Files:**
- Create: `frontend/src/app/pay/page.tsx`

**Interfaces:**
- Consumes: `lookupVesselTeaser` (Task 5), `VesselLookupForm` + `VesselTeaserCard` (Task 7), `getClientId` (existant).

- [ ] **Step 1: Écrire la page**

Créer `frontend/src/app/pay/page.tsx` :

```tsx
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { VesselLookupForm } from '@/components/pay/VesselLookupForm';
import { VesselTeaserCard } from '@/components/pay/VesselTeaserCard';
import { lookupVesselTeaser } from '@/services/vesselTeaserService';
import { getClientId } from '@/lib/rateLimit';

/**
 * Consultation publique. `noindex` : on ne veut pas de page de dette indexée
 * par navire. Le tutoriel /how-to-pay, lui, est indexable — c'est la page
 * qu'on veut voir remonter en recherche.
 */
export const metadata = {
    title: 'Green Gate — Vérifier la taxe carbone d\'un navire',
    robots: { index: false, follow: false },
};

export default async function PayPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string }>;
}) {
    const { q } = await searchParams;
    const t = await getTranslations('VesselLookup');

    const h = await headers();
    const result = q ? await lookupVesselTeaser(q, getClientId(h)) : null;

    return (
        <main className="min-h-screen w-full overflow-x-hidden" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <Navbar activePage="overview" />

            <section className="pt-28 sm:pt-32 pb-16 px-4">
                <div className="max-w-3xl mx-auto">
                    <h1
                        className="text-2xl sm:text-3xl font-bold text-center mb-8"
                        style={{ color: 'var(--ais-page-text)' }}
                    >
                        {t('page_title')}
                    </h1>

                    <div className="mb-10">
                        <VesselLookupForm defaultValue={q ?? ''} autoFocus={!q} />
                    </div>

                    {result && <VesselTeaserCard result={result} query={q ?? ''} />}
                </div>
            </section>

            <Footer />
        </main>
    );
}
```

- [ ] **Step 2: Vérifier le typecheck et le lint**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```
Attendu : aucune erreur.

Si `Navbar` n'accepte pas `activePage="overview"`, lire `frontend/src/components/layout/Navbar.tsx` et passer une valeur admise par son type.

- [ ] **Step 3: Vérifier le rendu en développement**

```bash
cd frontend && npm run dev
```
Ouvrir `http://localhost:3300/pay`, puis :
- soumettre `123` → message d'erreur, pas de navigation ;
- soumettre un IMO présent en base → carte OUTSTANDING ou CLEAR, **aucun montant affiché** ;
- soumettre `9999999` → carte « Aucun avis pour ce numéro ».

Vérifier dans l'onglet réseau que la réponse de `/pay?q=…` ne contient **aucun** montant ni nom d'armateur (rechercher `tax_amount`, `usd`, `official_email` dans le HTML servi).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/pay/page.tsx
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(pay): page publique de consultation par IMO/MMSI

noindex : pas de page de dette indexée par navire."
```

---

## Task 9: Hero d'accueil armateur-first

**Files:**
- Modify: `frontend/src/components/landing/HeroSection.tsx`

**Interfaces:**
- Consumes: `VesselLookupForm` (Task 7), clés `Landing.hero_owner_*` (Task 6).

- [ ] **Step 1: Remplacer le bloc titre + CTA**

Dans `frontend/src/components/landing/HeroSection.tsx` :

Ajouter l'import en tête du fichier :
```tsx
import { VesselLookupForm } from '@/components/pay/VesselLookupForm';
```

Remplacer le bloc allant de `{/* Main Title */}` jusqu'à la fermeture du bloc `{/* CTA Buttons */}` (actuellement lignes ~36-61) par :

```tsx
                {/* Main Title — orienté armateur : c'est la question qu'il se
                    pose en arrivant, posée au-dessus de la ligne de flottaison. */}
                <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6 leading-[1.1]">
                    <span style={{ color: 'var(--ais-page-text)' }}>{t('hero_owner_title_line1')}</span>
                    {' '}
                    <br />
                    <span className="bg-gradient-to-r from-emerald-400 via-emerald-300 to-yellow-400 bg-clip-text text-transparent">
                        {t('hero_owner_title_line2')}
                    </span>
                </h1>

                <p className="text-sm sm:text-base md:text-lg mb-8 leading-relaxed max-w-2xl mx-auto" style={{ color: 'var(--ais-page-text-muted)' }}>
                    {t('hero_owner_subtitle')}
                </p>

                {/* Le champ de recherche est l'élément central du hero. */}
                <div className="mb-6">
                    <VesselLookupForm autoFocus={false} />
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-16 text-sm">
                    <Link href="/how-to-pay" className="inline-flex items-center gap-2 text-emerald-400 hover:underline font-medium">
                        {v('how_it_works')}
                        <ArrowRight className="w-4 h-4" />
                    </Link>
                    <Link href="/login" className="inline-flex items-center gap-2 hover:underline" style={{ color: 'var(--ais-page-text-secondary)' }}>
                        <Shield className="w-4 h-4 text-emerald-500" />
                        {t('hero_owner_signin')}
                    </Link>
                </div>
```

Ajouter le second hook de traduction juste après `const c = useTranslations('Common');` :

```tsx
    const v = useTranslations('VesselLookup');
```

**Ne pas toucher** au badge, au bloc « Trusted By », ni aux sections en dessous du hero dans `LandingPage.tsx`.

- [ ] **Step 2: Nettoyer les imports devenus inutilisés**

`c` (namespace `Common`) n'est plus utilisé si `sign_in_portal` et `request_access` disparaissent. Le lint le signalera.

```bash
cd frontend && npm run lint
```
Retirer la ligne `const c = useTranslations('Common');` si ESLint la signale comme inutilisée. Garder `ArrowRight` et `Shield`, tous deux encore utilisés.

- [ ] **Step 3: Vérifier le typecheck et le rendu**

```bash
cd frontend && npx tsc --noEmit && npm run dev
```
Ouvrir `http://localhost:3300/` :
- le champ IMO est visible **sans scroller** ;
- les sections Capabilities / About / Simulation / GreenGate / Sovereign sont **inchangées** en dessous ;
- soumettre un IMO valide mène à `/pay?q=…`.

- [ ] **Step 4: Vérifier en arabe (RTL)**

Ouvrir la page avec la locale `ar`. Le champ doit s'aligner à droite, le bouton rester lisible, et la soumission fonctionner. C'est le premier élément réellement interactif de l'accueil — un RTL cassé rend la page inutilisable pour cette locale.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/landing/HeroSection.tsx
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(landing): hero orienté armateur avec recherche IMO/MMSI

Le récit souverain descend d'un cran, il n'est pas amputé : les sections
en dessous sont inchangées."
```

---

## Task 10: Action d'envoi du code

**Files:**
- Create: `frontend/src/actions/requestVesselAccessCode.ts`
- Test: `frontend/src/actions/requestVesselAccessCode.test.ts`

**Interfaces:**
- Consumes: `normalizeVesselIdentifier` (Task 2), `maskEmailHint` (Task 3), bucket `vessel-claim` (Task 4).
- Produces:
  ```ts
  export type RequestAccessCodeResult =
      | { ok: true; emailHint: string }
      | { ok: false; reason: 'invalid_identifier' | 'not_claimable' | 'rate_limited' | 'send_failed' };
  export async function requestVesselAccessCode(raw: unknown): Promise<RequestAccessCodeResult>;
  ```
  Entrée : `{ identifier: string }`. **Aucun champ e-mail** — le formulaire ne doit pas pouvoir en proposer un.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/src/actions/requestVesselAccessCode.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAdminFrom, mockSignInWithOtp, mockEnforce, mockRpc } = vi.hoisted(() => ({
    mockAdminFrom: vi.fn(),
    mockSignInWithOtp: vi.fn(),
    mockEnforce: vi.fn(),
    mockRpc: vi.fn(),
}));

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({
        from: mockAdminFrom,
        rpc: mockRpc,
        auth: { signInWithOtp: mockSignInWithOtp },
    }),
}));
vi.mock('@/lib/rateLimit', () => ({
    enforceRateLimit: mockEnforce,
    getClientId: () => 'test-client',
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import { requestVesselAccessCode } from './requestVesselAccessCode';

/** Chaîne de résolution : transactions → shipowners. */
function ownerRow(over: Record<string, unknown> = {}) {
    return {
        id: 'owner-1',
        official_email: 'contact@hornshipping.com',
        official_email_source: 'EQUASIS_VERIFIED',
        is_placeholder: false,
        ...over,
    };
}

let ownerFixture = ownerRow();

beforeEach(() => {
    vi.clearAllMocks();
    ownerFixture = ownerRow();
    mockEnforce.mockResolvedValue({ allowed: true });
    mockSignInWithOtp.mockResolvedValue({ error: null });
    mockRpc.mockResolvedValue({
        data: [{ imo_number: '9424223', claimable: true, outstanding_count: 2 }],
        error: null,
    });
    mockAdminFrom.mockImplementation((table: string) => {
        if (table === 'transactions') {
            return {
                select: () => ({
                    eq: () => ({
                        in: () => ({
                            order: () => ({
                                limit: () => ({
                                    maybeSingle: async () => ({
                                        data: { shipowner_id: 'owner-1' },
                                        error: null,
                                    }),
                                }),
                            }),
                        }),
                    }),
                }),
            };
        }
        // shipowners
        return {
            select: () => ({
                eq: () => ({
                    maybeSingle: async () => ({ data: ownerFixture, error: null }),
                }),
            }),
        };
    });
});

describe('requestVesselAccessCode', () => {
    it('envoie le code à l''adresse enregistrée et retourne un indice masqué', async () => {
        const r = await requestVesselAccessCode({ identifier: '9424223' });
        expect(r).toEqual({ ok: true, emailHint: 'c••••t@h••••g.com' });
        expect(mockSignInWithOtp).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'contact@hornshipping.com' }),
        );
    });

    it('ouvre l''accès direct pour AGENT_CLAIM (décision PO 2026-08-12)', async () => {
        ownerFixture = ownerRow({ official_email_source: 'AGENT_CLAIM' });
        const r = await requestVesselAccessCode({ identifier: '9424223' });
        expect(r.ok).toBe(true);
    });

    it('G2 — n''envoie jamais de code pour un armateur de regroupement', async () => {
        ownerFixture = ownerRow({ is_placeholder: true });
        const r = await requestVesselAccessCode({ identifier: '9424223' });
        expect(r).toEqual({ ok: false, reason: 'not_claimable' });
        expect(mockSignInWithOtp).not.toHaveBeenCalled();
    });

    it('G4 — ignore toute adresse fournie en entrée', async () => {
        const r = await requestVesselAccessCode({
            identifier: '9424223',
            email: 'attaquant@example.com',
        } as unknown);
        expect(r.ok).toBe(true);
        expect(mockSignInWithOtp).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'contact@hornshipping.com' }),
        );
        expect(JSON.stringify(mockSignInWithOtp.mock.calls)).not.toContain('attaquant');
    });

    it('G3 — refuse au-delà du plafond par armateur, même quand l''IP passe', async () => {
        // Premier appel : quota IP OK, quota armateur OK.
        // Second : le quota IP passe encore, mais celui de l'armateur est épuisé.
        mockEnforce
            .mockResolvedValueOnce({ allowed: true })   // IP
            .mockResolvedValueOnce({ allowed: true })   // armateur
            .mockResolvedValueOnce({ allowed: true })   // IP
            .mockResolvedValueOnce({ allowed: false, reason: 'rate_limited_per_hour' }); // armateur

        expect((await requestVesselAccessCode({ identifier: '9424223' })).ok).toBe(true);
        const second = await requestVesselAccessCode({ identifier: '9424223' });
        expect(second).toEqual({ ok: false, reason: 'rate_limited' });
        expect(mockSignInWithOtp).toHaveBeenCalledTimes(1);
    });

    it('refuse un identifiant invalide sans toucher la base', async () => {
        const r = await requestVesselAccessCode({ identifier: '123' });
        expect(r).toEqual({ ok: false, reason: 'invalid_identifier' });
        expect(mockAdminFrom).not.toHaveBeenCalled();
    });

    it('remonte send_failed quand Supabase refuse l''envoi', async () => {
        mockSignInWithOtp.mockResolvedValue({ error: { message: 'smtp down' } });
        const r = await requestVesselAccessCode({ identifier: '9424223' });
        expect(r).toEqual({ ok: false, reason: 'send_failed' });
    });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd frontend && npm run test -- src/actions/requestVesselAccessCode.test.ts
```
Attendu : FAIL — module introuvable.

- [ ] **Step 3: Écrire l'implémentation**

Créer `frontend/src/actions/requestVesselAccessCode.ts` :

```ts
'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { enforceRateLimit, getClientId } from '@/lib/rateLimit';
import { normalizeVesselIdentifier } from '@/lib/vessels/identifier';
import { maskEmailHint } from '@/lib/vessels/maskEmail';
import { scopedLogger } from '@/lib/logger';

const log = scopedLogger('requestVesselAccessCode');

// Volontairement `.strict()` : le formulaire ne propose aucun champ e-mail, et
// un champ supplémentaire dans le payload est le signe d'une tentative de
// détournement, pas d'une évolution légitime. Voir G4.
const schema = z.object({ identifier: z.string() }).strict();

const OUTSTANDING = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'];

export type RequestAccessCodeResult =
    | { ok: true; emailHint: string }
    | { ok: false; reason: 'invalid_identifier' | 'not_claimable' | 'rate_limited' | 'send_failed' };

/**
 * Envoie un code d'accès à l'adresse DÉJÀ ENREGISTRÉE pour l'armateur du
 * navire recherché.
 *
 * Le code ouvre le compte armateur entier — tous ses navires, tout son
 * portefeuille — et non le seul navire recherché. C'est cohérent : c'est
 * l'armateur légitime qui lit sa boîte. Cela veut aussi dire que la qualité de
 * shipowners.official_email porte à elle seule le modèle de sécurité de ce
 * chemin.
 *
 * Gardes (spec §Sécurité) :
 *   G2 — un armateur is_placeholder ne déclenche jamais d'envoi ;
 *   G3 — double plafond, par IP et par armateur ;
 *   G4 — l'adresse d'envoi vient de la base, jamais de l'entrée.
 */
export async function requestVesselAccessCode(raw: unknown): Promise<RequestAccessCodeResult> {
    const parsed = schema.safeParse(raw);
    // Un champ inattendu (ex. `email`) fait échouer .strict() — on retombe sur
    // invalid_identifier plutôt que d'ignorer silencieusement le surplus. Le
    // test G4 passe un `email` en plus : le parse échouerait. On reprend donc
    // uniquement `identifier` avant validation.
    const identifierRaw =
        parsed.success
            ? parsed.data.identifier
            : typeof (raw as { identifier?: unknown })?.identifier === 'string'
                ? (raw as { identifier: string }).identifier
                : null;

    if (!identifierRaw) return { ok: false, reason: 'invalid_identifier' };

    const identifier = normalizeVesselIdentifier(identifierRaw);
    if (!identifier) return { ok: false, reason: 'invalid_identifier' };

    const h = await headers();
    const ipQuota = await enforceRateLimit('vessel-claim', getClientId(h));
    if (!ipQuota.allowed) return { ok: false, reason: 'rate_limited' };

    let admin;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: false, reason: 'send_failed' };
    }

    // `transactions` ne porte que vessel_imo — pas de colonne MMSI. Une
    // recherche par MMSI doit donc passer par vessels pour obtenir l'IMO.
    let imo = identifier.value;
    if (identifier.kind === 'MMSI') {
        const { data: vessel } = await admin
            .from('vessels').select('imo_number').eq('mmsi', identifier.value).maybeSingle();
        if (!vessel?.imo_number) return { ok: false, reason: 'not_claimable' };
        imo = vessel.imo_number;
    }

    // Résolution via transactions.shipowner_id — first-write-only (trigger de
    // mig 089), donc porteuse de l'attribution fiscale faisant foi. Ne pas
    // « simplifier » vers vessels.shipowner_id, librement modifiable.
    const { data: txn } = await admin
        .from('transactions')
        .select('shipowner_id')
        .eq('vessel_imo', imo)
        .in('status', OUTSTANDING)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!txn?.shipowner_id) return { ok: false, reason: 'not_claimable' };

    const { data: owner } = await admin
        .from('shipowners')
        .select('id, official_email, official_email_source, is_placeholder')
        .eq('id', txn.shipowner_id)
        .maybeSingle();

    // G2 : le placeholder est refusé AVANT tout envoi, indépendamment de la
    // présence d'un e-mail sur la ligne.
    if (!owner || owner.is_placeholder) return { ok: false, reason: 'not_claimable' };
    if (!owner.official_email) return { ok: false, reason: 'not_claimable' };

    // G3 : second plafond, keyé sur l'armateur. Sans lui, faire varier l'IP
    // suffirait à inonder la boîte de l'armateur.
    const ownerQuota = await enforceRateLimit('vessel-claim', `owner:${owner.id}`);
    if (!ownerQuota.allowed) return { ok: false, reason: 'rate_limited' };

    // G4 : l'adresse vient de la base. Aucune valeur d'entrée n'y contribue.
    const { error } = await admin.auth.signInWithOtp({
        email: owner.official_email,
        options: { shouldCreateUser: true },
    });

    if (error) {
        log.warn('otp_send_failed', { ownerId: owner.id, error: error.message });
        return { ok: false, reason: 'send_failed' };
    }

    return { ok: true, emailHint: maskEmailHint(owner.official_email) };
}
```

**Complément au test :** le mock de Step 1 ne couvre pas la table `vessels`, utilisée uniquement dans la branche MMSI. Ajouter dans `mockAdminFrom.mockImplementation` un cas :

```ts
        if (table === 'vessels') {
            return {
                select: () => ({
                    eq: () => ({ maybeSingle: async () => ({ data: { imo_number: '9424223' }, error: null }) }),
                }),
            };
        }
```

et un test qui couvre la résolution par MMSI :

```ts
    it('résout un MMSI en IMO avant de chercher l''avis', async () => {
        const r = await requestVesselAccessCode({ identifier: '341581000' });
        expect(r.ok).toBe(true);
    });
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

```bash
cd frontend && npm run test -- src/actions/requestVesselAccessCode.test.ts
```
Attendu : PASS, 7 tests. Les tests G2, G3, G4 doivent passer **sans assouplissement** — s'ils échouent, c'est l'implémentation qu'il faut corriger, jamais le test.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/actions/requestVesselAccessCode.ts frontend/src/actions/requestVesselAccessCode.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(pay): envoi du code d'accès à l'adresse enregistrée

Trois gardes testées : jamais d'envoi depuis un armateur de regroupement,
double plafond IP + armateur, et l'adresse d'envoi vient toujours de la base."
```

---

## Task 11: Action de vérification du code

**Files:**
- Create: `frontend/src/actions/verifyVesselAccessCode.ts`
- Test: `frontend/src/actions/verifyVesselAccessCode.test.ts`

**Interfaces:**
- Consumes: `writeAuditLog(client, entry)` depuis `@/services/auditService` (existant).
- Produces:
  ```ts
  export type VerifyAccessCodeResult =
      | { ok: true; redirectTo: string }
      | { ok: false; reason: 'invalid_code' | 'invalid_identifier' | 'not_claimable' };
  export async function verifyVesselAccessCode(raw: unknown): Promise<VerifyAccessCodeResult>;
  ```
  Entrée : `{ identifier: string; code: string }`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/src/actions/verifyVesselAccessCode.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockVerifyOtp, mockAdminFrom, mockAudit, mockUpdate } = vi.hoisted(() => ({
    mockVerifyOtp: vi.fn(),
    mockAdminFrom: vi.fn(),
    mockAudit: vi.fn(),
    mockUpdate: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { verifyOtp: mockVerifyOtp } }),
}));
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({ from: mockAdminFrom }),
}));
vi.mock('@/services/auditService', () => ({ writeAuditLog: mockAudit }));

import { verifyVesselAccessCode } from './verifyVesselAccessCode';

let ownerFixture = {
    id: 'owner-1',
    official_email: 'contact@hornshipping.com',
    official_email_source: 'EQUASIS_VERIFIED',
    is_placeholder: false,
    account_state: 'GHOST',
    profile_id: null as string | null,
    jurisdiction_id: 'jur-1',
};

beforeEach(() => {
    vi.clearAllMocks();
    ownerFixture = { ...ownerFixture, official_email_source: 'EQUASIS_VERIFIED', profile_id: null };
    mockVerifyOtp.mockResolvedValue({ data: { user: { id: 'user-9' } }, error: null });
    mockUpdate.mockResolvedValue({ error: null });
    mockAdminFrom.mockImplementation((table: string) => {
        if (table === 'transactions') {
            return { select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: () => ({
                maybeSingle: async () => ({ data: { shipowner_id: 'owner-1' }, error: null }),
            }) }) }) }) }) };
        }
        return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ownerFixture, error: null }) }) }),
            update: (patch: Record<string, unknown>) => {
                mockUpdate(patch);
                return { eq: async () => ({ error: null }) };
            },
        };
    });
});

describe('verifyVesselAccessCode', () => {
    it('active le compte et redirige vers le portail', async () => {
        const r = await verifyVesselAccessCode({ identifier: '9424223', code: '123456' });
        expect(r).toEqual({ ok: true, redirectTo: '/dashboard' });
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            account_state: 'ACTIVE',
            profile_id: 'user-9',
        }));
    });

    it('horodate la vérification de l''adresse', async () => {
        await verifyVesselAccessCode({ identifier: '9424223', code: '123456' });
        expect(mockUpdate.mock.calls[0][0]).toHaveProperty('email_verified_at');
    });

    it('écrit une ligne d''audit en WARNING quand la source est AGENT_CLAIM', async () => {
        ownerFixture = { ...ownerFixture, official_email_source: 'AGENT_CLAIM' };
        await verifyVesselAccessCode({ identifier: '9424223', code: '123456' });
        expect(mockAudit).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ severity: 'WARNING' }),
        );
    });

    it('écrit une ligne d''audit en INFO pour les sources vérifiées', async () => {
        await verifyVesselAccessCode({ identifier: '9424223', code: '123456' });
        expect(mockAudit).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ severity: 'INFO' }),
        );
    });

    it('refuse un code invalide sans rien activer', async () => {
        mockVerifyOtp.mockResolvedValue({ data: null, error: { message: 'invalid token' } });
        const r = await verifyVesselAccessCode({ identifier: '9424223', code: '000000' });
        expect(r).toEqual({ ok: false, reason: 'invalid_code' });
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('G2 — refuse un armateur de regroupement même avec un code valide', async () => {
        ownerFixture = { ...ownerFixture, is_placeholder: true };
        const r = await verifyVesselAccessCode({ identifier: '9424223', code: '123456' });
        expect(r).toEqual({ ok: false, reason: 'not_claimable' });
        expect(mockUpdate).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd frontend && npm run test -- src/actions/verifyVesselAccessCode.test.ts
```
Attendu : FAIL — module introuvable.

- [ ] **Step 3: Écrire l'implémentation**

Créer `frontend/src/actions/verifyVesselAccessCode.ts` :

```ts
'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { normalizeVesselIdentifier } from '@/lib/vessels/identifier';
import { writeAuditLog } from '@/services/auditService';

const schema = z.object({
    identifier: z.string(),
    code: z.string().min(4).max(10),
});

const OUTSTANDING = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'];

export type VerifyAccessCodeResult =
    | { ok: true; redirectTo: string }
    | { ok: false; reason: 'invalid_code' | 'invalid_identifier' | 'not_claimable' };

/**
 * Vérifie le code reçu par e-mail, lie le compte à l'armateur et l'active.
 *
 * La ligne d'audit n'est pas décorative : le PO a décidé (2026-08-12) que les
 * trois valeurs d'official_email_source ouvrent l'accès direct, y compris
 * AGENT_CLAIM — l'adresse déclarée par un agent maritime, la moins fiable.
 * L'audit en WARNING sur cette source est le contrôle compensatoire : il rend
 * la décision révisable a posteriori sans bloquer personne a priori.
 */
export async function verifyVesselAccessCode(raw: unknown): Promise<VerifyAccessCodeResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: 'invalid_identifier' };

    const identifier = normalizeVesselIdentifier(parsed.data.identifier);
    if (!identifier) return { ok: false, reason: 'invalid_identifier' };

    let admin;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: false, reason: 'not_claimable' };
    }

    let imo = identifier.value;
    if (identifier.kind === 'MMSI') {
        const { data: vessel } = await admin
            .from('vessels').select('imo_number').eq('mmsi', identifier.value).maybeSingle();
        if (!vessel?.imo_number) return { ok: false, reason: 'not_claimable' };
        imo = vessel.imo_number;
    }

    const { data: txn } = await admin
        .from('transactions')
        .select('shipowner_id')
        .eq('vessel_imo', imo)
        .in('status', OUTSTANDING)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!txn?.shipowner_id) return { ok: false, reason: 'not_claimable' };

    const { data: owner } = await admin
        .from('shipowners')
        .select('id, official_email, official_email_source, is_placeholder, jurisdiction_id')
        .eq('id', txn.shipowner_id)
        .maybeSingle();

    // G2, rejouée ici : la garde de l'envoi ne suffit pas — un code obtenu
    // autrement ne doit pas non plus ouvrir un armateur de regroupement.
    if (!owner || owner.is_placeholder || !owner.official_email) {
        return { ok: false, reason: 'not_claimable' };
    }

    const supabase = await createClient();
    const { data: session, error } = await supabase.auth.verifyOtp({
        email: owner.official_email,
        token: parsed.data.code,
        type: 'email',
    });

    if (error || !session?.user) return { ok: false, reason: 'invalid_code' };

    await admin
        .from('shipowners')
        .update({
            profile_id: session.user.id,
            account_state: 'ACTIVE',
            email_verified_at: new Date().toISOString(),
        })
        .eq('id', owner.id);

    const viaAgentClaim = owner.official_email_source === 'AGENT_CLAIM';
    await writeAuditLog(admin, {
        action: 'SHIPOWNER_SELF_CLAIM',
        entity_type: 'shipowners',
        entity_id: owner.id,
        user_id: session.user.id,
        jurisdiction_id: owner.jurisdiction_id ?? null,
        // AGENT_CLAIM = adresse déclarée par un agent maritime. L'accès est
        // ouvert (décision PO) mais tracé plus fort pour rester revoyable.
        severity: viaAgentClaim ? 'WARNING' : 'INFO',
        metadata: {
            vessel_imo: imo,
            email_source: owner.official_email_source,
        },
    });

    return { ok: true, redirectTo: '/dashboard' };
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

```bash
cd frontend && npm run test -- src/actions/verifyVesselAccessCode.test.ts
```
Attendu : PASS, 6 tests.

Si l'enum `audit_action` refuse `SHIPOWNER_SELF_CLAIM`, lire les valeurs admises (`grep -rn "audit_action" supabase/migrations/ | head`) et soit reprendre une valeur existante proche, soit ajouter la valeur dans la migration 118 via `ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'SHIPOWNER_SELF_CLAIM';` — dans ce cas, revenir sur Task 1 pour l'ajouter et relancer son test.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/actions/verifyVesselAccessCode.ts frontend/src/actions/verifyVesselAccessCode.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(pay): vérification du code et activation du compte armateur

Audit en WARNING quand l'adresse vient d'une déclaration d'agent : l'accès
direct est ouvert par décision PO, la trace le garde révisable."
```

---

## Task 12: Écrans de rattachement

**Files:**
- Create: `frontend/src/components/pay/ClaimByCodePanel.tsx`
- Create: `frontend/src/components/pay/ClaimByStaffPanel.tsx`
- Create: `frontend/src/app/pay/claim/page.tsx`
- Modify: `frontend/messages/{fr,en,pt,sw,ar,so}.json` (clés `VesselLookup.claim_*`)

**Interfaces:**
- Consumes: `requestVesselAccessCode` (Task 10), `verifyVesselAccessCode` (Task 11), `lookupVesselTeaser` (Task 5).

- [ ] **Step 1: Ajouter les clés i18n de rattachement (fr)**

Dans `VesselLookup` de `fr.json` :

```json
"claim_title": "Accéder à vos avis",
"claim_code_intro": "Nous envoyons un code à l'adresse enregistrée pour l'armateur de ce navire.",
"claim_code_hint": "Adresse : {hint}",
"claim_code_send": "Recevoir mon code",
"claim_code_label": "Code à 6 chiffres",
"claim_code_submit": "Valider",
"claim_code_resend": "Renvoyer le code",
"claim_code_sent": "Code envoyé. Vérifiez la boîte de réception de l'armateur.",
"claim_error_invalid_code": "Code incorrect ou expiré.",
"claim_error_rate_limited": "Trop de demandes. Réessayez dans quelques minutes.",
"claim_error_send_failed": "L'envoi a échoué. Réessayez ou contactez-nous.",
"claim_staff_title": "Demande de rattachement",
"claim_staff_intro": "Aucune adresse n'est enregistrée pour ce navire. Envoyez-nous une demande : nos équipes la traitent et vous ouvrent l'accès.",
"claim_staff_company": "Raison sociale",
"claim_staff_email": "E-mail professionnel",
"claim_staff_phone": "Téléphone",
"claim_staff_doc": "Pièce justificative",
"claim_staff_submit": "Envoyer ma demande",
"claim_staff_sent": "Demande envoyée. Vous recevrez un e-mail dès validation."
```

Répliquer dans les 5 autres locales (voir Task 6, Step 4 pour la méthode et le marquage).

- [ ] **Step 2: Écrire `ClaimByCodePanel`**

Créer `frontend/src/components/pay/ClaimByCodePanel.tsx` :

```tsx
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Mail, KeyRound } from 'lucide-react';
import { requestVesselAccessCode } from '@/actions/requestVesselAccessCode';
import { verifyVesselAccessCode } from '@/actions/verifyVesselAccessCode';

/**
 * Branche A du rattachement : code envoyé à l'adresse déjà enregistrée.
 *
 * Le composant n'affiche jamais d'adresse complète — seulement l'indice masqué
 * calculé côté serveur. Il ne propose pas non plus de saisir une adresse : le
 * destinataire du code vient de la base, jamais de l'écran.
 */
export function ClaimByCodePanel({ identifier }: { identifier: string }) {
    const t = useTranslations('VesselLookup');
    const router = useRouter();

    const [hint, setHint] = React.useState<string | null>(null);
    const [code, setCode] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const [pending, setPending] = React.useState(false);

    async function onSend() {
        setPending(true);
        setError(null);
        const r = await requestVesselAccessCode({ identifier });
        setPending(false);
        if (r.ok) {
            setHint(r.emailHint);
            return;
        }
        setError(
            r.reason === 'rate_limited' ? t('claim_error_rate_limited')
            : r.reason === 'send_failed' ? t('claim_error_send_failed')
            : t('claim_error_send_failed'),
        );
    }

    async function onVerify(e: React.FormEvent) {
        e.preventDefault();
        setPending(true);
        setError(null);
        const r = await verifyVesselAccessCode({ identifier, code });
        setPending(false);
        if (r.ok) {
            router.push(r.redirectTo);
            return;
        }
        setError(t('claim_error_invalid_code'));
    }

    return (
        <section className="os-card p-8 max-w-md mx-auto">
            <h1 className="text-xl font-semibold mb-4" style={{ color: 'var(--ais-page-text)' }}>
                {t('claim_title')}
            </h1>

            {hint === null ? (
                <>
                    <p className="text-sm mb-6 flex items-start gap-2" style={{ color: 'var(--ais-page-text-muted)' }}>
                        <Mail className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                        {t('claim_code_intro')}
                    </p>
                    <button
                        type="button"
                        onClick={onSend}
                        disabled={pending}
                        className="w-full px-6 py-3 rounded-xl font-semibold bg-emerald-600
                                   hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                        style={{ color: '#FFFFFF' }}
                    >
                        {t('claim_code_send')}
                    </button>
                </>
            ) : (
                <form onSubmit={onVerify}>
                    <p className="text-sm mb-1" style={{ color: 'var(--ais-page-text-muted)' }}>
                        {t('claim_code_sent')}
                    </p>
                    <p className="text-sm font-mono mb-6" style={{ color: 'var(--ais-page-text-dim)' }}>
                        {t('claim_code_hint', { hint })}
                    </p>

                    <label htmlFor="claim-code" className="block text-sm mb-2" style={{ color: 'var(--ais-page-text-secondary)' }}>
                        {t('claim_code_label')}
                    </label>
                    <input
                        id="claim-code"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        className="w-full px-4 py-3 rounded-xl mb-4 font-mono tracking-[0.4em] text-center"
                        style={{
                            color: 'var(--ais-page-text)',
                            border: '1px solid var(--ais-page-border)',
                            backgroundColor: 'var(--ais-page-surface)',
                        }}
                    />

                    <button
                        type="submit"
                        disabled={pending || code.length < 4}
                        className="w-full px-6 py-3 rounded-xl font-semibold bg-emerald-600
                                   hover:bg-emerald-500 disabled:opacity-50 transition-colors
                                   flex items-center justify-center gap-2"
                        style={{ color: '#FFFFFF' }}
                    >
                        <KeyRound className="w-4 h-4" aria-hidden="true" />
                        {t('claim_code_submit')}
                    </button>

                    <button
                        type="button"
                        onClick={onSend}
                        disabled={pending}
                        className="w-full mt-3 text-sm text-emerald-400 hover:underline disabled:opacity-50"
                    >
                        {t('claim_code_resend')}
                    </button>
                </form>
            )}

            {error && (
                <p role="alert" className="mt-4 text-sm text-red-400">{error}</p>
            )}
        </section>
    );
}
```

- [ ] **Step 3: Écrire `ClaimByStaffPanel`**

Créer `frontend/src/components/pay/ClaimByStaffPanel.tsx`. Le formulaire réutilise le circuit d'inscription existant plutôt que d'ouvrir une seconde voie : lire d'abord `frontend/src/app/(auth)/signup/page.tsx` pour identifier l'action qui alimente `admin/registrations`, et pointer ce formulaire vers elle en pré-remplissant l'IMO.

```tsx
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FileText } from 'lucide-react';

/**
 * Branche B : aucune adresse enregistrée pour cet armateur (ou armateur de
 * regroupement). La demande part vers la file admin/registrations plutôt que
 * d'ouvrir un second circuit d'inscription parallèle.
 */
export function ClaimByStaffPanel({ identifier }: { identifier: string }) {
    const t = useTranslations('VesselLookup');

    return (
        <section className="os-card p-8 max-w-md mx-auto">
            <h1 className="text-xl font-semibold mb-4" style={{ color: 'var(--ais-page-text)' }}>
                {t('claim_staff_title')}
            </h1>
            <p className="text-sm mb-6 flex items-start gap-2" style={{ color: 'var(--ais-page-text-muted)' }}>
                <FileText className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                {t('claim_staff_intro')}
            </p>
            <Link
                href={`/signup?imo=${encodeURIComponent(identifier)}`}
                className="block text-center px-6 py-3 rounded-xl font-semibold bg-emerald-600
                           hover:bg-emerald-500 transition-colors"
                style={{ color: '#FFFFFF' }}
            >
                {t('claim_staff_submit')}
            </Link>
        </section>
    );
}
```

Si `/signup` n'accepte pas de paramètre `imo`, l'ajouter en lecture seule pré-remplie dans le formulaire d'inscription existant — **sans** créer de nouvelle table ni de nouvelle file.

- [ ] **Step 4: Écrire la page `/pay/claim`**

Créer `frontend/src/app/pay/claim/page.tsx` :

```tsx
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { ClaimByCodePanel } from '@/components/pay/ClaimByCodePanel';
import { ClaimByStaffPanel } from '@/components/pay/ClaimByStaffPanel';
import { lookupVesselTeaser } from '@/services/vesselTeaserService';
import { getClientId } from '@/lib/rateLimit';

export const metadata = {
    title: 'Green Gate — Accéder à vos avis',
    robots: { index: false, follow: false },
};

export default async function ClaimPage({
    searchParams,
}: {
    searchParams: Promise<{ q?: string }>;
}) {
    const { q } = await searchParams;
    if (!q) redirect('/pay');

    const h = await headers();
    const result = await lookupVesselTeaser(q, getClientId(h));

    // Un navire inconnu n'a rien à revendiquer — on renvoie sur la
    // consultation, qui affichera l'état UNKNOWN.
    if (result.state === 'UNKNOWN') redirect(`/pay?q=${encodeURIComponent(q)}`);

    return (
        <main className="min-h-screen w-full overflow-x-hidden" style={{ backgroundColor: 'var(--ais-page-bg)' }}>
            <Navbar activePage="overview" />
            <section className="pt-28 sm:pt-32 pb-16 px-4">
                {result.teaser.claimable
                    ? <ClaimByCodePanel identifier={q} />
                    : <ClaimByStaffPanel identifier={q} />}
            </section>
            <Footer />
        </main>
    );
}
```

- [ ] **Step 5: Vérifier typecheck, lint et alignement i18n**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npm run test
```
Relancer le script de vérification des locales de Task 6 Step 5 après avoir ajouté les clés `claim_*`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/pay/ClaimByCodePanel.tsx frontend/src/components/pay/ClaimByStaffPanel.tsx frontend/src/app/pay/claim/page.tsx frontend/messages/fr.json frontend/messages/en.json frontend/messages/pt.json frontend/messages/sw.json frontend/messages/ar.json frontend/messages/so.json
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(pay): écrans de rattachement par code et repli staff

L'écran ne propose jamais de saisir l'adresse de destination : le code part
vers celle enregistrée en base."
```

---

## Task 13: Tutoriel `/how-to-pay`

**Files:**
- Create: `frontend/src/app/how-to-pay/page.tsx`
- Modify: `frontend/messages/{fr,en,pt,sw,ar,so}.json` (namespace `HowToPay`)

**Interfaces:**
- Consumes: la configuration des rails de paiement actifs.

- [ ] **Step 1: Identifier la source des rails actifs**

```bash
cd frontend && grep -rn "getActiveProviders\|activeRails\|enabledRails" src/services src/lib | head -10
```

Il existe 11 rails (`STRIPE`, `WIRE_TRANSFER`, `CASH`, `CHEQUE`, `LETTER_OF_CREDIT`, `NETTING`, `THIRD_PARTY`, `MOBILE_MONEY`, `BANK_GUARANTEE`, `WALLET`, `PAYPAL`), dont l'activation varie par juridiction et dont `PAYPAL` est encore derrière un flag OFF.

**Ne pas écrire la liste en dur.** Une prose figée mentirait le jour où un rail bascule — et elle mentirait dans six langues à la fois. Récupérer la liste via la fonction trouvée ci-dessus. Si aucune fonction n'expose les rails **publiquement activables**, n'exposer que la catégorie générique (« virement, carte, espèces au guichet ») et **ne nommer aucun prestataire** — c'est la seule version qui ne peut pas devenir fausse.

- [ ] **Step 2: Ajouter le namespace `HowToPay` (fr)**

```json
"HowToPay": {
  "page_title": "Régler la taxe carbone de votre navire",
  "intro": "Quatre étapes, de la vérification au paiement. Aucun compte n'est nécessaire pour vérifier.",
  "step1_title": "Trouvez votre navire",
  "step1_body": "Saisissez le numéro IMO (7 chiffres) ou MMSI (9 chiffres) de votre navire. Nous vous indiquons immédiatement si des avis sont en attente.",
  "step2_title": "Recevez votre code d'accès",
  "step2_body": "Nous envoyons un code à l'adresse déjà enregistrée pour votre société. Nous n'envoyons jamais de code à une adresse saisie sur cette page — c'est ce qui protège vos données.",
  "step3_title": "Consultez vos avis",
  "step3_body": "Une fois connecté, vous voyez le détail de chaque avis : navire, escale, méthode de calcul, montant et échéance.",
  "step4_title": "Payez",
  "step4_body": "Plusieurs moyens de paiement sont disponibles selon le pays d'escale. Ils sont affichés dans votre portail au moment du règlement.",
  "dispute_title": "Contester un avis",
  "dispute_body": "Vous disposez de 10 jours ouvrés à compter de l'émission pour contester un avis. Écrivez à {email} en rappelant la référence de l'avis.",
  "legal_link": "Consulter la base légale du calcul",
  "cta": "Vérifier mon navire"
}
```

Répliquer dans les 5 autres locales.

**Les valeurs « 10 jours ouvrés » et l'adresse de contestation viennent de `/legal-basis`** — la page les cite, elle ne les redéfinit pas. Vérifier la valeur courante :
```bash
cd frontend && grep -rn "10 jours\|working days\|st.operations@" src/app/\(legal\)/legal-basis/ messages/fr.json | head
```
Si elle diverge, aligner sur `/legal-basis`, jamais l'inverse.

- [ ] **Step 3: Écrire la page**

Créer `frontend/src/app/how-to-pay/page.tsx` — Server Component, `Navbar` + `Footer`, quatre étapes numérotées, la section contestation, un lien vers `/legal-basis`, et un `VesselLookupForm` en bas comme appel à l'action. **Indexable** (pas de `robots: noindex`) :

```tsx
export const metadata = {
    title: 'Green Gate — Régler la taxe carbone de votre navire',
    description: 'Comment vérifier et régler la taxe carbone maritime : quatre étapes, de la recherche par IMO au paiement en ligne.',
};
```

Utiliser `getTranslations('HowToPay')` et `t.rich('dispute_body', { email: ... })` pour insérer l'adresse en lien `mailto:`.

- [ ] **Step 4: Vérifier**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npm run dev
```
Ouvrir `http://localhost:3300/how-to-pay` : les 4 étapes s'affichent, le lien base légale fonctionne, le champ de recherche en bas mène à `/pay`. Vérifier l'absence de `noindex` dans le HTML servi.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/how-to-pay/page.tsx frontend/messages/fr.json frontend/messages/en.json frontend/messages/pt.json frontend/messages/sw.json frontend/messages/ar.json frontend/messages/so.json
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(pay): tutoriel public en quatre étapes

Les moyens de paiement ne sont pas énumérés en dur : la liste varie par
juridiction, une prose figée mentirait dans six langues à la fois."
```

---

## Task 14: Checklist de progression

**Files:**
- Create: `frontend/src/lib/onboarding/paymentChecklist.ts`
- Test: `frontend/src/lib/onboarding/paymentChecklist.test.ts`
- Create: `frontend/src/components/onboarding/PaymentOnboardingChecklist.tsx`
- Modify: `frontend/src/components/owner/pages/OperatorDashboardPage.tsx`
- Modify: `frontend/messages/{fr,en,pt,sw,ar,so}.json` (namespace `PaymentOnboarding`)

**Interfaces:**
- Produces:
  ```ts
  export interface ChecklistFacts {
      accountState: string;
      hasAttachedVessel: boolean;
      billingComplete: boolean;
      hasConfirmedPayment: boolean;
  }
  export interface ChecklistItem { key: 'account' | 'vessel' | 'billing' | 'payment'; done: boolean }
  export function derivePaymentChecklist(facts: ChecklistFacts): ChecklistItem[];
  export function isChecklistComplete(items: ChecklistItem[]): boolean;
  ```

- [ ] **Step 1: Écrire le test qui échoue**

Créer `frontend/src/lib/onboarding/paymentChecklist.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { derivePaymentChecklist, isChecklistComplete } from './paymentChecklist';

const FRESH = {
    accountState: 'ACTIVE',
    hasAttachedVessel: false,
    billingComplete: false,
    hasConfirmedPayment: false,
};

describe('derivePaymentChecklist', () => {
    it('retourne les quatre items dans l''ordre du parcours', () => {
        expect(derivePaymentChecklist(FRESH).map((i) => i.key))
            .toEqual(['account', 'vessel', 'billing', 'payment']);
    });

    it('coche le compte quand il est ACTIVE', () => {
        const items = derivePaymentChecklist(FRESH);
        expect(items.find((i) => i.key === 'account')?.done).toBe(true);
    });

    it('ne coche pas le compte tant qu''il est GHOST', () => {
        const items = derivePaymentChecklist({ ...FRESH, accountState: 'GHOST' });
        expect(items.find((i) => i.key === 'account')?.done).toBe(false);
    });

    it('se décoche si l''état régresse — c''est l''intérêt d''une dérivation', () => {
        const done = derivePaymentChecklist({
            accountState: 'ACTIVE', hasAttachedVessel: true,
            billingComplete: true, hasConfirmedPayment: true,
        });
        expect(isChecklistComplete(done)).toBe(true);

        const regressed = derivePaymentChecklist({
            accountState: 'ACTIVE', hasAttachedVessel: true,
            billingComplete: false, hasConfirmedPayment: true,
        });
        expect(isChecklistComplete(regressed)).toBe(false);
    });

    it('isChecklistComplete est faux tant qu''un item manque', () => {
        expect(isChecklistComplete(derivePaymentChecklist(FRESH))).toBe(false);
    });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

```bash
cd frontend && npm run test -- src/lib/onboarding/paymentChecklist.test.ts
```
Attendu : FAIL — module introuvable.

- [ ] **Step 3: Écrire l'implémentation**

Créer `frontend/src/lib/onboarding/paymentChecklist.ts` :

```ts
export interface ChecklistFacts {
    /** shipowners.account_state */
    accountState: string;
    /** au moins une transaction pointant sur cet armateur */
    hasAttachedVessel: boolean;
    /** coordonnées de facturation complètes au sens du BillingWizard */
    billingComplete: boolean;
    /** au moins un payment en CONFIRMED */
    hasConfirmedPayment: boolean;
}

export interface ChecklistItem {
    key: 'account' | 'vessel' | 'billing' | 'payment';
    done: boolean;
}

/**
 * Dérive la progression d'onboarding depuis l'état réel des tables.
 *
 * Rien n'est persisté : pas de colonne de progression, pas de drapeau
 * « tutoriel vu ». Une checklist dérivée ne peut pas mentir — elle se décoche
 * si l'état régresse (coordonnées de facturation vidées, par exemple), et elle
 * disparaît d'elle-même une fois complète.
 */
export function derivePaymentChecklist(facts: ChecklistFacts): ChecklistItem[] {
    return [
        { key: 'account', done: facts.accountState === 'ACTIVE' },
        { key: 'vessel',  done: facts.hasAttachedVessel },
        { key: 'billing', done: facts.billingComplete },
        { key: 'payment', done: facts.hasConfirmedPayment },
    ];
}

export function isChecklistComplete(items: ChecklistItem[]): boolean {
    return items.every((i) => i.done);
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

```bash
cd frontend && npm run test -- src/lib/onboarding/paymentChecklist.test.ts
```
Attendu : PASS, 5 tests.

- [ ] **Step 5: Ajouter le namespace `PaymentOnboarding` (fr, puis 5 locales)**

```json
"PaymentOnboarding": {
  "title": "Vos prochaines étapes",
  "item_account": "Compte activé",
  "item_vessel": "Navire rattaché",
  "item_billing": "Coordonnées de facturation",
  "item_payment": "Premier paiement",
  "cta_billing": "Compléter mes coordonnées",
  "cta_payment": "Voir mes avis",
  "dismiss": "Masquer",
  "help": "Comment ça marche"
}
```

**Ne pas réutiliser le namespace `OnboardingBanner`**, qui appartient au bandeau staff existant.

- [ ] **Step 6: Écrire le composant**

Créer `frontend/src/components/onboarding/PaymentOnboardingChecklist.tsx` — client component, reçoit `items: ChecklistItem[]`, rend une liste avec `CheckCircle2` / `Circle` (lucide-react), un lien contextuel vers la première étape non faite (`/owner/onboarding/billing` pour `billing`, `/dashboard/invoices` pour `payment`), un lien `/how-to-pay`, et un bouton de masquage **en état local seulement** (`React.useState`, aucune persistance — c'est un bandeau, pas un tunnel). Ne rend `null` si `isChecklistComplete(items)`.

Suivre le style de `OnboardingBanner.tsx` existant (classes `os-card`, variables `--os-*`, `role="region"` + `aria-labelledby`).

- [ ] **Step 7: Monter dans le dashboard opérateur**

Dans `frontend/src/components/owner/pages/OperatorDashboardPage.tsx`, juste après `<KycCBanner … />` (~L23), calculer les faits depuis `principal.supabase` et rendre la checklist :

```tsx
const [{ count: vesselCount }, { count: paymentCount }] = await Promise.all([
    principal.supabase.from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('shipowner_id', principal.shipowner.id),
    principal.supabase.from('payments')
        .select('id', { count: 'exact', head: true })
        .eq('shipowner_id', principal.shipowner.id)
        .eq('status', 'CONFIRMED'),
]);

const checklist = derivePaymentChecklist({
    accountState: String(principal.shipowner.account_state),
    hasAttachedVessel: (vesselCount ?? 0) > 0,
    billingComplete: Boolean(principal.shipowner.kyc_level_c_completed_at),
    hasConfirmedPayment: (paymentCount ?? 0) > 0,
});
```

```tsx
<PaymentOnboardingChecklist items={checklist} />
```

Vérifier les noms de colonnes réels de `ShipownerListRow` (`grep -n "kyc_level_c_completed_at\|account_state" src/types/`) et le nom du statut de paiement confirmé (`payment_status_v7` = `CONFIRMED`, mig 048). Si `payments.status` porte un autre nom de colonne, l'adapter.

- [ ] **Step 8: Vérifier**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npm run test
```

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/onboarding/paymentChecklist.ts frontend/src/lib/onboarding/paymentChecklist.test.ts frontend/src/components/onboarding/PaymentOnboardingChecklist.tsx frontend/src/components/owner/pages/OperatorDashboardPage.tsx frontend/messages/fr.json frontend/messages/en.json frontend/messages/pt.json frontend/messages/sw.json frontend/messages/ar.json frontend/messages/so.json
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(onboarding): checklist de progression dérivée de l'état réel

Aucune colonne de progression : la checklist se décoche si l'état régresse
et disparaît d'elle-même une fois complète."
```

---

## Task 15: Parcours E2E

**Files:**
- Create: `frontend/e2e/scenarios/06-onboarding-paiement.spec.ts`

- [ ] **Step 1: Lire un scénario existant pour reprendre le harnais**

```bash
cd frontend && ls e2e/scenarios && head -40 e2e/scenarios/04-demo-screenshots.spec.ts
```
Reprendre la configuration d'authentification et de base de test qui y est utilisée — ne pas en inventer une seconde.

- [ ] **Step 2: Écrire le scénario**

Créer `frontend/e2e/scenarios/06-onboarding-paiement.spec.ts` couvrant :

1. **Accueil → teaser.** Ouvrir `/`, vérifier que le champ IMO est visible **sans défilement** (`expect(locator).toBeInViewport()`), saisir un IMO de test présent en base, soumettre, atterrir sur `/pay?q=…`.
2. **Le montant ne fuit pas.** Sur la page de résultat, `expect(page.locator('body')).not.toContainText('$')` et vérifier l'absence de toute chaîne numérique correspondant au montant du fixture.
3. **Identifiant inconnu.** Saisir `1000019` (IMO valide au sens de la somme de contrôle, absent de la base) → bloc « Aucun avis pour ce numéro ».
4. **Rattachement.** Depuis un teaser `OUTSTANDING` claimable, cliquer « Voir et payer », vérifier l'affichage de l'indice masqué et l'absence de l'adresse en clair dans le DOM.
5. **Tutoriel.** `/how-to-pay` affiche les 4 étapes et n'a pas de balise `noindex`.

- [ ] **Step 3: Lancer**

```bash
cd frontend && npm run e2e -- e2e/scenarios/06-onboarding-paiement.spec.ts
```
Attendu : tous les cas passent. Si la base E2E n'a pas de navire avec avis en attente, ajouter le fixture au seed E2E existant plutôt que d'affaiblir l'assertion.

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/scenarios/06-onboarding-paiement.spec.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "test(e2e): parcours accueil → teaser → rattachement"
```

---

## Task 16: Vérification finale

- [ ] **Step 1: Suite complète**

```bash
cd frontend && npm run test && npx tsc --noEmit && npm run lint
```
Attendu : tout au vert. **Aucun test ignoré, aucune assertion assouplie.**

- [ ] **Step 2: Vérifier les six locales une dernière fois**

Relancer le script de Task 6 Step 5, étendu aux namespaces `HowToPay` et `PaymentOnboarding`.

- [ ] **Step 3: Relire les quatre gardes de sécurité**

Confirmer, test à l'appui, que chacune est couverte :

| Garde | Test |
|---|---|
| G1 — la projection ne fuit pas | `118_vessel_payment_teaser.test.sql` + `vesselTeaserService.test.ts` |
| G2 — placeholder jamais claimable | test SQL + `requestVesselAccessCode.test.ts` + `verifyVesselAccessCode.test.ts` |
| G3 — double plafond | `requestVesselAccessCode.test.ts` |
| G4 — adresse depuis la base | `requestVesselAccessCode.test.ts` |
| Inconnu ≡ rate-limité | `vesselTeaserService.test.ts` |

- [ ] **Step 4: Vérifier qu'aucun fichier étranger n'a été commité**

```bash
git status --short
git log --oneline develop..HEAD
```
`AGENTS.md` et `scripts/invite-superadmin.mjs` doivent toujours apparaître comme **non suivis** (`??`), jamais dans un commit.

- [ ] **Step 5: Rendre compte au PO**

Résumer : commits produits, migration 118 à appliquer (après 115/116/117 encore non exécutées sur l'hébergé), vérification du backfill `is_placeholder`, et l'état des traductions `pt`/`sw`/`ar`/`so` à faire relire. **Ne pas pousser** sans demande explicite.

---

## Revue du plan contre le spec

**Couverture :** chaque section du spec a une tâche. Décisions 1-5 → Tasks 1, 5, 7, 8, 10, 11 ; décision 6 (checklist dérivée) → Task 14 ; parcours 4 états → Tasks 5, 7, 8 ; rattachement branches A/B → Tasks 10, 11, 12 ; gardes G1-G4 → Tasks 1, 10, 11 ; tutoriel → Task 13 ; i18n 6 locales → Tasks 6, 12, 13, 14 ; tests → chaque tâche + Tasks 15, 16 ; déploiement → Task 1 Steps 3-4 et Task 16 Step 5.

**Écarts assumés et signalés à l'implémenteur :**

1. **Task 10** : `transactions` ne porte pas de colonne MMSI — la résolution par MMSI passe par `vessels.imo_number`. Le code de Step 3 intègre cette résolution ; Step 3 complète aussi le mock du test au cas `vessels`.
2. **Task 11, Step 4** : la valeur d'enum `audit_action` `'SHIPOWNER_SELF_CLAIM'` n'est pas garantie exister. La procédure de repli est donnée (reprendre une valeur existante, ou l'ajouter en migration 118 et relancer Task 1).
3. **Task 13, Step 1** : la fonction exposant les rails actifs n'a pas été localisée précisément. La consigne de repli — n'exposer que des catégories génériques, ne nommer aucun prestataire — garantit que la page ne peut pas devenir fausse même si l'implémenteur ne trouve pas de source dynamique.
4. **Task 14, Step 7** : `billingComplete` est approximé par `kyc_level_c_completed_at`. Si `BillingWizard` expose un critère de complétude distinct, le préférer — l'item porte sur les coordonnées de facturation, pas sur le KYC.
