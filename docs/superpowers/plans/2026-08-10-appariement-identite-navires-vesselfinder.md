# Appariement de l'identité des navires (VesselFinder) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** permettre à un officier de port d'apparier un navire non identifié du portefeuille (73 placeholders `VESSEL-W4-*` + 2 IMO en texte libre) à un navire réel issu d'un export d'escales VesselFinder, en écrivant son identité et son contact de facturation sous garde sanctions.

**Architecture :** un parseur pur (aucune I/O) transforme le CSV en candidats validés ; une table `vessel_identity_candidates` stocke un candidat par navire distinct ; une action serveur applique un appariement décidé par un humain, sous cinq gardes, vers `vessels` et `shipowners`. Aucune écriture automatique dans `transactions`.

**Tech Stack :** Next.js 16 / React 19 / TypeScript strict / Zod v4 / Supabase (Postgres 17) / Vitest / next-intl.

**Spec :** `docs/superpowers/specs/2026-08-10-appariement-identite-navires-vesselfinder-design.md`

## Global Constraints

- TypeScript **strict**. `any` interdit. Ne jamais écrire `ReturnType<typeof createClient>` (cascade de `never` avec @supabase/supabase-js ≥ 2.98) — utiliser `import { type SupabaseClient } from '@supabase/supabase-js'`.
- Zod **v4** : `z.record(z.string(), z.unknown())` prend **deux** arguments.
- Un fichier `'use server'` n'exporte **que** des fonctions `async`. Les schémas Zod et les types restent internes au module, sinon `next build` casse.
- Migrations : les numéros libres sont **115** et **116** (la dernière existante est `114_paypal_rail_support.sql`). Chaque migration se termine par un bloc `-- DOWN:` en commentaire, comme les migrations existantes.
- Tests : `cd frontend && npm run test -- <chemin>`. Lint : `cd frontend && npm run lint`.
- Tests de migration : `./supabase/tests/run.sh migrations/<fichier>.test.sql` (enveloppe `BEGIN; … ROLLBACK;` + `DO $$ ASSERT … $$`).
- Enum `public.vessel_category` = `CONTAINER | CARGO | TANKER | BULK_CARRIER | FERRY | NAVAL | SCIENTIFIC` (migration 003). Aucune valeur `TUG` ni `LIVESTOCK`.
- `public.audit_action` contient déjà `SANCTIONS_CONTACT_BLOCKED` (migration 092) et `TRANSACTION_UPDATED`.
- Commits : auteur `git commit --author="Loïc Leclerc <leclerc@drwintech.com>"`, message conventionnel humanisé, **jamais** de `Co-Authored-By: Claude` ni de mention « Generated with Claude Code ». Staging explicite par chemins, jamais `git add -A`.
- Branche : créer `feat/vessel-identity-matching` depuis `origin/develop`.

---

## Structure des fichiers

| Fichier | Responsabilité |
| --- | --- |
| `frontend/src/services/vesselIdentity/imo.ts` | somme de contrôle IMO — utilisé par le parseur *et* l'action |
| `frontend/src/services/vesselIdentity/vesselFinderParser.ts` | CSV → candidats validés. Fonction pure, aucune I/O |
| `frontend/src/services/vesselIdentity/vesselIdentityService.ts` | persistance des candidats, marquage sanctions |
| `frontend/src/domain/sanctions/entityMatch.ts` | rapprochement de raisons sociales par jetons |
| `frontend/src/actions/applyVesselIdentity.ts` | action serveur : cinq gardes, écriture, audit |
| `frontend/src/app/(dashboard)/admin/vessel-identity/page.tsx` | composant serveur, garde RBAC |
| `frontend/src/app/(dashboard)/admin/vessel-identity/VesselIdentityPanel.tsx` | panneau client : dépôt, appariement |
| `supabase/migrations/115_vessel_identity_candidates.sql` | table + RLS |
| `supabase/migrations/116_vesselfinder_email_source.sql` | extension du CHECK `official_email_source` |

Découpage par responsabilité : le parseur ne connaît pas la base, le service ne connaît pas le CSV, l'action ne connaît ni l'un ni l'autre au-delà de leurs interfaces.

---

## Task 1 : somme de contrôle IMO

**Files:**
- Create: `frontend/src/services/vesselIdentity/imo.ts`
- Test: `frontend/src/services/vesselIdentity/imo.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `isValidImo(value: string): boolean`.

- [ ] **Step 1 : écrire le test qui échoue**

```ts
// frontend/src/services/vesselIdentity/imo.test.ts
import { describe, it, expect } from 'vitest';
import { isValidImo } from './imo';

describe('isValidImo', () => {
    it('accepte les IMO réels de l’export d’escales', () => {
        for (const imo of ['9235957', '7504158', '9167057', '1152604', '6422303']) {
            expect(isValidImo(imo)).toBe(true);
        }
    });

    it('rejette une somme de contrôle fausse', () => {
        expect(isValidImo('9235958')).toBe(false);
    });

    it('rejette ce qui n’est pas sept chiffres', () => {
        expect(isValidImo('0')).toBe(false);
        expect(isValidImo('123456')).toBe(false);
        expect(isValidImo('12345678')).toBe(false);
        expect(isValidImo('UNVERIFIED-nav-042')).toBe(false);
        expect(isValidImo('à confirmer')).toBe(false);
        expect(isValidImo('Hors registre Equasis')).toBe(false);
        expect(isValidImo('')).toBe(false);
    });
});
```

- [ ] **Step 2 : lancer le test et vérifier qu’il échoue**

Run: `cd frontend && npm run test -- src/services/vesselIdentity/imo.test.ts`
Attendu : FAIL — `Failed to resolve import "./imo"`.

- [ ] **Step 3 : écrire l’implémentation minimale**

```ts
// frontend/src/services/vesselIdentity/imo.ts

/**
 * Somme de contrôle IMO (résolution A.1078(28)) : les six premiers chiffres sont
 * pondérés par 7, 6, 5, 4, 3, 2 ; le dernier chiffre de la somme est la clé.
 *
 * Sert de prédicat « ce navire est identifié » : les trois formes de non-identité
 * du portefeuille (`UNVERIFIED-<seed-id>`, « à confirmer », « Hors registre
 * Equasis ») échouent toutes ici, ce qui évite de tester chaque forme séparément.
 */
export function isValidImo(value: string): boolean {
    if (!/^\d{7}$/.test(value)) return false;
    let sum = 0;
    for (let i = 0; i < 6; i += 1) {
        sum += Number(value[i]) * (7 - i);
    }
    return sum % 10 === Number(value[6]);
}
```

- [ ] **Step 4 : lancer le test et vérifier qu’il passe**

Run: `cd frontend && npm run test -- src/services/vesselIdentity/imo.test.ts`
Attendu : PASS, 3 tests.

- [ ] **Step 5 : commit**

```bash
git add frontend/src/services/vesselIdentity/imo.ts frontend/src/services/vesselIdentity/imo.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(vessel-identity): validation de la somme de contrôle IMO"
```

---

## Task 2 : parseur de l’export d’escales

**Files:**
- Create: `frontend/src/services/vesselIdentity/vesselFinderParser.ts`
- Test: `frontend/src/services/vesselIdentity/vesselFinderParser.test.ts`

**Interfaces:**
- Consumes: `isValidImo` (Task 1).
- Produces:

```ts
export interface VesselFinderCandidate {
    imoNumber: string;
    mmsi: string | null;
    callSign: string | null;
    vesselName: string;
    flagCode: string;
    typeRaw: string;
    category: 'CONTAINER' | 'CARGO' | 'TANKER' | 'BULK_CARRIER' | 'FERRY' | 'NAVAL' | 'SCIENTIFIC';
    grossTonnage: number | null;
    deadweight: number | null;
    buildYear: number | null;
    managerName: string | null;
    managerCountry: string | null;
    managerEmail: string | null;
    ownerName: string | null;
    ownerCountry: string | null;
    ownerEmail: string | null;
    ismManagerName: string | null;
    ismManagerEmail: string | null;
    lastSeenAt: string;
}

export interface RejectedRow { lineNumber: number; vesselName: string; reason: string }
export interface ParseResult { candidates: VesselFinderCandidate[]; rejected: RejectedRow[]; rowsRead: number }
export function parseVesselFinderPortCalls(csv: string): ParseResult;
export function resolveBillingEmail(c: VesselFinderCandidate): string | null;
```

**Contexte indispensable.** L’en-tête du fichier contient des **noms de colonnes en double** : `TYPE` en position 4 (code AIS numérique) *et* 14 (`TYPENAME` textuel), `DRAUGHT` en position 5 (tirant d’eau du mouvement) *et* 22 (tirant d’eau maximal). Un parseur indexé par nom écraserait silencieusement la première valeur. **La lecture se fait par index.**

- [ ] **Step 1 : écrire le test qui échoue**

```ts
// frontend/src/services/vesselIdentity/vesselFinderParser.test.ts
import { describe, it, expect } from 'vitest';
import { parseVesselFinderPortCalls, resolveBillingEmail } from './vesselFinderParser';

const HEADER =
    '"MMSI","IMO","SHIP NAME","TYPE","DRAUGHT","DATE TIME (UTC)","EVENT","PORT NAME","LOCODE",' +
    'CALLSIGN,BUILT,FLAG,FLAGNAME,TYPE,TYPENAME,STATUS,GT,DWT,LOA,LPP,BEAM,DRAUGHT,CLASS,CLASSCODE,' +
    'MANAGER_NAME,MANAGER_COUNTRY,MANAGER_ADDRESS,MANAGER_WEB,MANAGER_EMAIL,MANAGER_PHONE,MANAGER_FAX,' +
    'OWNER_NAME,OWNER_COUNTRY,OWNER_ADDRESS,OWNER_WEB,OWNER_EMAIL,OWNER_PHONE,OWNER_FAX,' +
    'ISM_MANAGER_NAME,ISM_MANAGER_COUNTRY,ISM_MANAGER_ADDRESS,ISM_MANAGER_WEB,ISM_MANAGER_EMAIL,' +
    'ISM_MANAGER_PHONE,ISM_MANAGER_FAX,PI_COMPANY,PI_INCEPTION';

/** TRUST 1 — manager porteur de l’e-mail, owner sans adresse. LOA 55 < LPP 74 dans la source réelle. */
const TRUST1 = (dateTime: string, loa = '74', lpp = '55') =>
    `671882000,7504158,"TRUST 1",70,5.0,"${dateTime}","ENTER_ZONE","Berbera Anch.","SOBBO",5VEV4,1975,TG,Togo,A38A,Livestock Carrier,IN SERVICE/COMMISSION,2975,2560,${loa},${lpp},12,5,COLUMBUS AMERICAN REGISTER,CAR,` +
    `FAROS SHIPPING CO SARL,LB,"Office 54, Beirut, Lebanon.",http://www.farosshipping.com,faros@farosshipping.example,+99 1 1036,+961 1 566476,` +
    `UNIVERSAL SHIPPING & LOGISTIC,LB,"C/O: Faros Shipping Co Sarl, Beirut.",,,+99 1 1036,+961 1 566476,` +
    `FAROS SHIPPING CO SARL,LB,"Office 54, Beirut, Lebanon.",http://www.farosshipping.com,faros@farosshipping.example,+99 1 1036,+961 1 566476,,0000-00-00`;

/** MAYAR — ni manager ni owner joignables, seul l’ISM manager porte une adresse. */
const MAYAR =
    `341264001,9167057,"MAYAR",70,6.4,"2026-05-01 07:33:31","EXIT_ZONE","Berbera Anch.","SOBBO",V4LK5,1998,KN,Saint Kitts & Nevis,A38A,Livestock Carrier,IN SERVICE/COMMISSION,4752,4200,103.1,96.86,16.8,6.25,REGISTRO ITALIANO NAVALE,RINA,` +
    `LEVANTE MARITTIMO CO,MH,"Majuro, Marshall Islands.",,,,,` +
    `LEVANTE MARITTIMO CO,MH,"Majuro, Marshall Islands.",,,,,` +
    `MORGAN NAVIGATION CO SA,LB,"Beirut, Lebanon.",,morgan.navigation@mail.example,+99 1 1039,,North of England P&I Association,2022-06-09`;

/** Boutre local : IMO 0, aucune particularité. */
const NAFISA =
    '417078690,0,"NAFISA",90,0.0,"2026-05-02 04:19:37","EXIT_ZONE","Berbera","SOBBO",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,';

const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

describe('parseVesselFinderPortCalls', () => {
    it('lit les colonnes par index malgré les doublons TYPE et DRAUGHT', () => {
        const r = parseVesselFinderPortCalls(csv(TRUST1('2026-05-01 05:21:13')));
        expect(r.candidates).toHaveLength(1);
        const c = r.candidates[0];
        expect(c.imoNumber).toBe('7504158');
        expect(c.mmsi).toBe('671882000');
        expect(c.callSign).toBe('5VEV4');
        expect(c.vesselName).toBe('TRUST 1');
        expect(c.flagCode).toBe('TG');
        expect(c.typeRaw).toBe('Livestock Carrier');
        expect(c.category).toBe('CARGO');
        expect(c.buildYear).toBe(1975);
    });

    it('mappe GT et DWT sur des champs distincts', () => {
        const c = parseVesselFinderPortCalls(csv(TRUST1('2026-05-01 05:21:13'))).candidates[0];
        expect(c.grossTonnage).toBe(2975);
        expect(c.deadweight).toBe(2560);
    });

    it('extrait les trois contacts', () => {
        const c = parseVesselFinderPortCalls(csv(TRUST1('2026-05-01 05:21:13'))).candidates[0];
        expect(c.managerName).toBe('FAROS SHIPPING CO SARL');
        expect(c.managerEmail).toBe('faros@farosshipping.example');
        expect(c.ownerName).toBe('UNIVERSAL SHIPPING & LOGISTIC');
        expect(c.ownerEmail).toBeNull();
        expect(c.ismManagerName).toBe('FAROS SHIPPING CO SARL');
    });

    it('déduplique par IMO en gardant le mouvement le plus récent', () => {
        const r = parseVesselFinderPortCalls(
            csv(TRUST1('2026-05-01 05:21:13'), TRUST1('2026-07-19 15:12:19'), TRUST1('2026-06-11 08:50:14')),
        );
        expect(r.rowsRead).toBe(3);
        expect(r.candidates).toHaveLength(1);
        expect(r.candidates[0].lastSeenAt).toBe('2026-07-19 15:12:19');
    });

    it('rejette les engins sans IMO avec un motif', () => {
        const r = parseVesselFinderPortCalls(csv(NAFISA));
        expect(r.candidates).toHaveLength(0);
        expect(r.rejected).toEqual([
            { lineNumber: 2, vesselName: 'NAFISA', reason: 'IMO absent ou nul' },
        ]);
    });

    it('rejette une somme de contrôle IMO invalide', () => {
        const bad = TRUST1('2026-05-01 05:21:13').replace('7504158', '7504159');
        const r = parseVesselFinderPortCalls(csv(bad));
        expect(r.candidates).toHaveLength(0);
        expect(r.rejected[0].reason).toBe('somme de contrôle IMO invalide');
    });

    it('rejette une incohérence dimensionnelle LOA < LPP', () => {
        const r = parseVesselFinderPortCalls(csv(TRUST1('2026-05-01 05:21:13', '55', '74')));
        expect(r.candidates).toHaveLength(0);
        expect(r.rejected[0].reason).toBe('LOA inférieure à LPP');
    });

    it('rejette un TYPENAME inconnu du référentiel fiscal', () => {
        const r = parseVesselFinderPortCalls(
            csv(TRUST1('2026-05-01 05:21:13').replace(',Livestock Carrier,', ',Submersible Drilling Rig,')),
        );
        expect(r.rejected[0].reason).toBe('type de navire inconnu : Submersible Drilling Rig');
    });

    it('rejette un pavillon hors ISO-3166 alpha-2', () => {
        const r = parseVesselFinderPortCalls(csv(TRUST1('2026-05-01 05:21:13').replace(',TG,Togo,', ',TOGO,Togo,')));
        expect(r.rejected[0].reason).toBe('pavillon non ISO-2 : TOGO');
    });

    it('normalise les noms sales de la source', () => {
        const dirty = TRUST1('2026-05-01 05:21:13').replace('"TRUST 1"', '" TRUST   1 "');
        expect(parseVesselFinderPortCalls(csv(dirty)).candidates[0].vesselName).toBe('TRUST 1');
    });

    it('refuse un en-tête non conforme au gabarit', () => {
        expect(() => parseVesselFinderPortCalls('MMSI,IMO,NAME\n1,2,3')).toThrow(
            /en-tête inattendu/i,
        );
    });
});

describe('resolveBillingEmail', () => {
    const base = parseVesselFinderPortCalls(csv(TRUST1('2026-05-01 05:21:13'))).candidates[0];

    it('préfère le manager', () => {
        expect(resolveBillingEmail(base)).toBe('faros@farosshipping.example');
    });

    it('retombe sur l’owner puis sur l’ISM manager', () => {
        expect(resolveBillingEmail({ ...base, managerEmail: null, ownerEmail: 'o@x.com' })).toBe('o@x.com');
        expect(
            resolveBillingEmail({ ...base, managerEmail: null, ownerEmail: null, ismManagerEmail: 'i@x.com' }),
        ).toBe('i@x.com');
    });

    it('renvoie null quand aucun contact n’est joignable', () => {
        expect(
            resolveBillingEmail({ ...base, managerEmail: null, ownerEmail: null, ismManagerEmail: null }),
        ).toBeNull();
    });

    it('résout MAYAR par l’ISM manager', () => {
        const mayar = parseVesselFinderPortCalls(csv(MAYAR)).candidates[0];
        expect(resolveBillingEmail(mayar)).toBe('morgan.navigation@mail.example');
    });
});
```

- [ ] **Step 2 : lancer le test et vérifier qu’il échoue**

Run: `cd frontend && npm run test -- src/services/vesselIdentity/vesselFinderParser.test.ts`
Attendu : FAIL — module introuvable.

- [ ] **Step 3 : écrire l’implémentation**

```ts
// frontend/src/services/vesselIdentity/vesselFinderParser.ts
import { isValidImo } from './imo';

export type VesselCategory =
    | 'CONTAINER' | 'CARGO' | 'TANKER' | 'BULK_CARRIER' | 'FERRY' | 'NAVAL' | 'SCIENTIFIC';

export interface VesselFinderCandidate {
    imoNumber: string;
    mmsi: string | null;
    callSign: string | null;
    vesselName: string;
    flagCode: string;
    typeRaw: string;
    category: VesselCategory;
    grossTonnage: number | null;
    deadweight: number | null;
    buildYear: number | null;
    managerName: string | null;
    managerCountry: string | null;
    managerEmail: string | null;
    ownerName: string | null;
    ownerCountry: string | null;
    ownerEmail: string | null;
    ismManagerName: string | null;
    ismManagerEmail: string | null;
    /** `DATE TIME (UTC)` du mouvement le plus récent retenu pour ce navire. */
    lastSeenAt: string;
}

export interface RejectedRow {
    lineNumber: number;
    vesselName: string;
    reason: string;
}

export interface ParseResult {
    candidates: VesselFinderCandidate[];
    rejected: RejectedRow[];
    rowsRead: number;
}

/**
 * Index des colonnes exploitées. La lecture est POSITIONNELLE : l'en-tête de
 * VesselFinder contient `TYPE` deux fois (4 = code AIS, 14 = libellé) et
 * `DRAUGHT` deux fois (5 = tirant du mouvement, 22 = tirant maximal). Un accès
 * par nom perdrait silencieusement l'une des deux valeurs.
 */
const COL = {
    MMSI: 0, IMO: 1, SHIP_NAME: 2, DATE_TIME: 5, EVENT: 6, LOCODE: 8,
    CALLSIGN: 9, BUILT: 10, FLAG: 11, TYPENAME: 14, GT: 16, DWT: 17, LOA: 18, LPP: 19,
    MANAGER_NAME: 24, MANAGER_COUNTRY: 25, MANAGER_EMAIL: 28,
    OWNER_NAME: 31, OWNER_COUNTRY: 32, OWNER_EMAIL: 35,
    ISM_NAME: 38, ISM_EMAIL: 42,
} as const;

/** Colonnes dont la présence à l'index attendu atteste du bon gabarit. */
const HEADER_GUARD: ReadonlyArray<readonly [number, string]> = [
    [COL.MMSI, 'MMSI'], [COL.IMO, 'IMO'], [COL.SHIP_NAME, 'SHIP NAME'],
    [COL.DATE_TIME, 'DATE TIME (UTC)'], [COL.EVENT, 'EVENT'],
    [COL.TYPENAME, 'TYPENAME'], [COL.GT, 'GT'], [COL.DWT, 'DWT'],
    [COL.MANAGER_EMAIL, 'MANAGER_EMAIL'], [COL.OWNER_EMAIL, 'OWNER_EMAIL'],
    [COL.ISM_EMAIL, 'ISM_MANAGER_EMAIL'],
];

/**
 * Correspondance TYPENAME → catégorie fiscale. Volontairement SANS valeur par
 * défaut : `mapVesselCategory` de l'import onboarding retombe sur 'CARGO', ce qui
 * classerait un pétrolier en cargo et fausserait la taxe. Ici un libellé inconnu
 * rejette la ligne et impose une décision humaine.
 */
const CATEGORY_BY_TYPENAME: Readonly<Record<string, VesselCategory>> = {
    'Bulk Carrier': 'BULK_CARRIER',
    'Container Ship': 'CONTAINER',
    'General Cargo Ship': 'CARGO',
    'Deck Cargo Ship': 'CARGO',
    'Ro-Ro Cargo Ship': 'CARGO',
    'Palletised Cargo Ship': 'CARGO',
    'Refrigerated Cargo Ship': 'CARGO',
    'Livestock Carrier': 'CARGO',
    'Landing Craft': 'CARGO',
    'Tug': 'CARGO',
    'Oil Products Tanker': 'TANKER',
    'Chemical/Oil Products Tanker': 'TANKER',
    'LPG Tanker': 'TANKER',
};

/** Découpe une ligne CSV en respectant les guillemets (adresses contenant des virgules). */
function splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
            if (quoted && line[i + 1] === '"') { field += '"'; i += 1; }
            else quoted = !quoted;
        } else if (ch === ',' && !quoted) {
            out.push(field);
            field = '';
        } else {
            field += ch;
        }
    }
    out.push(field);
    return out;
}

const clean = (v: string | undefined): string | null => {
    const t = (v ?? '').trim().replace(/\s+/g, ' ');
    return t === '' ? null : t;
};

const num = (v: string | undefined): number | null => {
    const t = (v ?? '').trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
};

const email = (v: string | undefined): string | null => {
    const t = clean(v);
    return t && t.includes('@') ? t.toLowerCase() : null;
};

function assertHeader(cells: string[]): void {
    for (const [index, label] of HEADER_GUARD) {
        if ((cells[index] ?? '').trim().replace(/^"|"$/g, '') !== label) {
            throw new Error(
                `Export VesselFinder : en-tête inattendu — colonne ${index} devrait être « ${label} », ` +
                `trouvé « ${(cells[index] ?? '').trim()} ». Le fichier n'est pas un export d'escales.`,
            );
        }
    }
}

export function parseVesselFinderPortCalls(csv: string): ParseResult {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) throw new Error('Export VesselFinder : fichier vide');
    assertHeader(splitCsvLine(lines[0]));

    const byImo = new Map<string, VesselFinderCandidate>();
    const rejected: RejectedRow[] = [];
    let rowsRead = 0;

    for (let i = 1; i < lines.length; i += 1) {
        rowsRead += 1;
        const lineNumber = i + 1;
        const c = splitCsvLine(lines[i]);
        const vesselName = clean(c[COL.SHIP_NAME]) ?? '(sans nom)';
        const reject = (reason: string) => rejected.push({ lineNumber, vesselName, reason });

        const imoRaw = (c[COL.IMO] ?? '').trim();
        if (imoRaw === '' || imoRaw === '0') { reject('IMO absent ou nul'); continue; }
        if (!isValidImo(imoRaw)) { reject('somme de contrôle IMO invalide'); continue; }

        const flag = clean(c[COL.FLAG]);
        if (!flag || !/^[A-Z]{2}$/.test(flag)) {
            reject(`pavillon non ISO-2 : ${flag ?? '(vide)'}`); continue;
        }

        const typeRaw = clean(c[COL.TYPENAME]);
        const category = typeRaw ? CATEGORY_BY_TYPENAME[typeRaw] : undefined;
        if (!typeRaw || !category) {
            reject(`type de navire inconnu : ${typeRaw ?? '(vide)'}`); continue;
        }

        const loa = num(c[COL.LOA]);
        const lpp = num(c[COL.LPP]);
        if (loa !== null && lpp !== null && lpp > 0 && loa < lpp) {
            reject('LOA inférieure à LPP'); continue;
        }

        const lastSeenAt = clean(c[COL.DATE_TIME]) ?? '';
        const candidate: VesselFinderCandidate = {
            imoNumber: imoRaw,
            mmsi: clean(c[COL.MMSI]),
            callSign: clean(c[COL.CALLSIGN]),
            vesselName,
            flagCode: flag,
            typeRaw,
            category,
            grossTonnage: num(c[COL.GT]),
            deadweight: num(c[COL.DWT]),
            buildYear: num(c[COL.BUILT]),
            managerName: clean(c[COL.MANAGER_NAME]),
            managerCountry: clean(c[COL.MANAGER_COUNTRY]),
            managerEmail: email(c[COL.MANAGER_EMAIL]),
            ownerName: clean(c[COL.OWNER_NAME]),
            ownerCountry: clean(c[COL.OWNER_COUNTRY]),
            ownerEmail: email(c[COL.OWNER_EMAIL]),
            ismManagerName: clean(c[COL.ISM_NAME]),
            ismManagerEmail: email(c[COL.ISM_EMAIL]),
            lastSeenAt,
        };

        const previous = byImo.get(imoRaw);
        if (!previous || candidate.lastSeenAt > previous.lastSeenAt) {
            byImo.set(imoRaw, candidate);
        }
    }

    return { candidates: [...byImo.values()], rejected, rowsRead };
}

/**
 * Destinataire de facturation (décision D4 de la spec) : le manager d'abord.
 * Mesuré sur l'export réel : manager 32 navires, owner 1, ISM 14 — l'owner est
 * presque toujours une société mono-navire domiciliée chez un trust, sans e-mail.
 */
export function resolveBillingEmail(c: VesselFinderCandidate): string | null {
    return c.managerEmail ?? c.ownerEmail ?? c.ismManagerEmail ?? null;
}
```

- [ ] **Step 4 : lancer le test et vérifier qu’il passe**

Run: `cd frontend && npm run test -- src/services/vesselIdentity/vesselFinderParser.test.ts`
Attendu : PASS, 14 tests.

- [ ] **Step 5 : commit**

```bash
git add frontend/src/services/vesselIdentity/vesselFinderParser.ts frontend/src/services/vesselIdentity/vesselFinderParser.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(vessel-identity): parseur de l'export d'escales VesselFinder"
```

---

## Task 3 : rapprochement de raisons sociales par jetons

**Files:**
- Create: `frontend/src/domain/sanctions/entityMatch.ts`
- Test: `frontend/src/domain/sanctions/entityMatch.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `significantTokens(name: string): Set<string>` · `matchesSanctionedEntity(candidateName: string, referenceNames: readonly string[]): boolean`.

**Contexte indispensable.** Le référentiel porte des raisons sociales approximatives : `Petrofleet Shipping` contre `PETROFLEET ENERGY TRADING LLC`, `Morgan Navigation SA` contre `MORGAN NAVIGATION CO SA`. L’égalité stricte n’en reconnaît **aucune** — vérifié sur l’export réel. La garde doit donc rapprocher par jetons significatifs, et elle **penche volontairement vers le blocage** : un faux positif empêche un envoi et déclenche une revue, un faux négatif enverrait une facture à une entité sanctionnée.

- [ ] **Step 1 : écrire le test qui échoue**

```ts
// frontend/src/domain/sanctions/entityMatch.test.ts
import { describe, it, expect } from 'vitest';
import { significantTokens, matchesSanctionedEntity } from './entityMatch';

describe('significantTokens', () => {
    it('écarte les mots de forme juridique et de secteur', () => {
        expect([...significantTokens('Petrofleet Shipping')]).toEqual(['PETROFLEET']);
        expect([...significantTokens('PETROFLEET ENERGY TRADING LLC')]).toEqual(['PETROFLEET']);
    });

    it('conserve NAVIGATION, trop discriminant pour être écarté', () => {
        expect([...significantTokens('Morgan Navigation SA')]).toEqual(['MORGAN', 'NAVIGATION']);
    });

    it('ignore la ponctuation et les mots de moins de trois lettres', () => {
        expect([...significantTokens('H&P Ship Management Ltd')]).toEqual([]);
    });
});

describe('matchesSanctionedEntity', () => {
    it('reconnaît Petrofleet malgré une raison sociale divergente', () => {
        expect(matchesSanctionedEntity('PETROFLEET ENERGY TRADING LLC', ['Petrofleet Shipping', 'Petrofleet'])).toBe(true);
    });

    it('reconnaît Morgan Navigation malgré le suffixe CO SA', () => {
        expect(matchesSanctionedEntity('MORGAN NAVIGATION CO SA', ['Morgan Navigation SA'])).toBe(true);
    });

    it('reconnaît IRISL par son alias court', () => {
        expect(matchesSanctionedEntity('IRISL MARINE SERVICES', ['IRISL'])).toBe(true);
    });

    it('ne rapproche pas des sociétés sans jeton commun', () => {
        expect(matchesSanctionedEntity('FAROS SHIPPING CO SARL', ['Petrofleet Shipping', 'Morgan Navigation SA'])).toBe(false);
        expect(matchesSanctionedEntity('CORAL TECHNICAL SERVICES', ['Morgan Navigation SA'])).toBe(false);
    });

    it('ne matche jamais sur une référence sans jeton significatif', () => {
        expect(matchesSanctionedEntity('N IMPORTE QUOI', ['Ship Co Ltd'])).toBe(false);
    });

    it('tolère un nom candidat vide', () => {
        expect(matchesSanctionedEntity('', ['Petrofleet'])).toBe(false);
    });
});
```

- [ ] **Step 2 : lancer le test et vérifier qu’il échoue**

Run: `cd frontend && npm run test -- src/domain/sanctions/entityMatch.test.ts`
Attendu : FAIL — module introuvable.

- [ ] **Step 3 : écrire l’implémentation**

```ts
// frontend/src/domain/sanctions/entityMatch.ts

/**
 * Mots vides des raisons sociales maritimes : formes juridiques et termes de
 * secteur, trop répandus pour discriminer. NAVIGATION en est volontairement
 * absent : il reste porteur de sens (« Morgan Navigation »).
 */
const STOP_WORDS = new Set([
    'SHIPPING', 'SHIP', 'SHIPS', 'MARITIME', 'MARINE', 'COMPANY', 'GROUP',
    'MANAGEMENT', 'MGMT', 'SERVICES', 'SERVICE', 'TRADING', 'ENERGY',
    'INTERNATIONAL', 'HOLDING', 'HOLDINGS', 'LINES', 'LINE', 'AGENCY',
    'SARL', 'LTD', 'LLC', 'INC', 'PTE', 'FZE', 'FZCO', 'DMCC', 'GMBH', 'CORP',
]);

/** Jetons discriminants d'une raison sociale : majuscules, ≥ 3 lettres, hors mots vides. */
export function significantTokens(name: string): Set<string> {
    return new Set(
        String(name ?? '')
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, ' ')
            .split(' ')
            .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
    );
}

/**
 * Vrai si le candidat contient TOUS les jetons significatifs d'au moins une des
 * dénominations de référence. Le sens est asymétrique : la référence (le nom
 * sanctionné du référentiel, souvent plus court) doit être incluse dans le
 * candidat (le nom VesselFinder, souvent enrichi de suffixes).
 *
 * En cas de doute la fonction penche vers le rapprochement : un faux positif
 * bloque un envoi et provoque une revue humaine ; un faux négatif enverrait une
 * facture à une entité sous sanctions.
 */
export function matchesSanctionedEntity(
    candidateName: string,
    referenceNames: readonly string[],
): boolean {
    const candidate = significantTokens(candidateName);
    if (candidate.size === 0) return false;
    return referenceNames.some((reference) => {
        const ref = significantTokens(reference);
        if (ref.size === 0) return false;
        return [...ref].every((token) => candidate.has(token));
    });
}
```

- [ ] **Step 4 : lancer le test et vérifier qu’il passe**

Run: `cd frontend && npm run test -- src/domain/sanctions/entityMatch.test.ts`
Attendu : PASS, 9 tests.

- [ ] **Step 5 : commit**

```bash
git add frontend/src/domain/sanctions/entityMatch.ts frontend/src/domain/sanctions/entityMatch.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(sanctions): rapprochement de raisons sociales par jetons"
```

---

## Task 4 : migration 115 — table des candidats

**Files:**
- Create: `supabase/migrations/115_vessel_identity_candidates.sql`
- Test: `supabase/tests/migrations/115_vessel_identity_candidates.test.sql`

**Interfaces:**
- Consumes: `public.vessels`, `public.profiles`, `public.vessel_category`.
- Produces: table `public.vessel_identity_candidates`.

- [ ] **Step 1 : écrire le test de migration qui échoue**

```sql
-- supabase/tests/migrations/115_vessel_identity_candidates.test.sql
BEGIN;

DO $$
BEGIN
  ASSERT (SELECT to_regclass('public.vessel_identity_candidates') IS NOT NULL),
    'la table vessel_identity_candidates doit exister';

  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.vessel_identity_candidates'::regclass),
    'RLS doit être activée';

  ASSERT (SELECT COUNT(*) FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'vessel_identity_candidates') >= 1,
    'au moins une policy RLS doit exister';
END $$;

-- un candidat valide s'insère
INSERT INTO public.vessel_identity_candidates
  (batch_label, source, imo_number, vessel_name, imported_by)
VALUES ('test.csv', 'VESSELFINDER_PORTCALLS', '7504158', 'TRUST 1', NULL);

-- le même IMO deux fois dans le même lot est refusé
DO $$
BEGIN
  BEGIN
    INSERT INTO public.vessel_identity_candidates
      (batch_label, source, imo_number, vessel_name, imported_by)
    VALUES ('test.csv', 'VESSELFINDER_PORTCALLS', '7504158', 'TRUST 1 BIS', NULL);
    ASSERT FALSE, 'un IMO dupliqué dans un même lot aurait dû être refusé';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

-- une source hors liste est refusée
DO $$
BEGIN
  BEGIN
    INSERT INTO public.vessel_identity_candidates
      (batch_label, source, imo_number, vessel_name, imported_by)
    VALUES ('test.csv', 'EQUASIS', '9235957', 'RASHA', NULL);
    ASSERT FALSE, 'une source inconnue aurait dû être refusée';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- un statut hors liste est refusé
DO $$
BEGIN
  BEGIN
    INSERT INTO public.vessel_identity_candidates
      (batch_label, source, imo_number, vessel_name, status, imported_by)
    VALUES ('test.csv', 'MANUAL', '9167057', 'MAYAR', 'WHATEVER', NULL);
    ASSERT FALSE, 'un statut inconnu aurait dû être refusé';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

ROLLBACK;
```

- [ ] **Step 2 : lancer le test et vérifier qu’il échoue**

Run: `./supabase/tests/run.sh migrations/115_vessel_identity_candidates.test.sql`
Attendu : FAIL — `la table vessel_identity_candidates doit exister`.

- [ ] **Step 3 : écrire la migration**

```sql
-- supabase/migrations/115_vessel_identity_candidates.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 115 : vessel_identity_candidates
--
-- Une ligne = UN NAVIRE DISTINCT issu d'un export d'escales VesselFinder (ou
-- d'une saisie manuelle), jamais un mouvement portuaire. La déduplication par
-- IMO est faite en amont par le parseur, qui retient le mouvement le plus récent.
--
-- Aucune créance n'est portée ici : la table n'est pas scopée par juridiction.
-- Les propositions ne sont JAMAIS appliquées automatiquement — un humain apparie.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.vessel_identity_candidates (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_label            TEXT NOT NULL,
  source                 TEXT NOT NULL
                           CHECK (source IN ('VESSELFINDER_PORTCALLS', 'MANUAL')),

  -- identité
  imo_number             TEXT NOT NULL,
  mmsi                   TEXT,
  call_sign              TEXT,
  vessel_name            TEXT NOT NULL,
  flag_code              CHAR(2),
  type_raw               TEXT,
  category               public.vessel_category,
  gross_tonnage          INTEGER,
  deadweight             INTEGER,
  build_year             INTEGER,
  last_seen_at           TEXT,

  -- contacts (trois niveaux, cf. décision D4 : manager → owner → ISM)
  manager_name           TEXT,
  manager_country        TEXT,
  manager_email          TEXT,
  owner_name             TEXT,
  owner_country          TEXT,
  owner_email            TEXT,
  ism_manager_name       TEXT,
  ism_manager_email      TEXT,

  -- garde sanctions, posée à l'import
  contact_blocked        BOOLEAN NOT NULL DEFAULT FALSE,
  contact_blocked_reason TEXT,

  -- cycle de vie
  status                 TEXT NOT NULL DEFAULT 'PENDING'
                           CHECK (status IN ('PENDING', 'MATCHED', 'CONFLICT', 'REJECTED')),
  matched_vessel_id      UUID REFERENCES public.vessels(id),
  matched_by             UUID REFERENCES public.profiles(id),
  matched_at             TIMESTAMPTZ,
  imported_by            UUID REFERENCES public.profiles(id),
  imported_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_vic_batch_imo
  ON public.vessel_identity_candidates(batch_label, imo_number);
CREATE INDEX idx_vic_pending
  ON public.vessel_identity_candidates(batch_label, status)
  WHERE status = 'PENDING';

ALTER TABLE public.vessel_identity_candidates ENABLE ROW LEVEL SECURITY;

-- Personnel uniquement. Aucun armateur ne voit cette table : elle contient les
-- coordonnées de tiers et le drapeau de blocage sanctions.
CREATE POLICY vic_staff_all ON public.vessel_identity_candidates
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN')
    )
  );

COMMENT ON TABLE public.vessel_identity_candidates IS
  'Candidats d''identité navire issus d''un export d''escales VesselFinder. Un candidat n''est jamais appliqué automatiquement : l''appariement est une assertion humaine tracée dans audit_logs.';
COMMENT ON COLUMN public.vessel_identity_candidates.contact_blocked IS
  'Vrai si l''une des trois sociétés correspond à une entité sous sanctions (OFAC/UN). L''e-mail n''est alors jamais proposé comme destinataire.';

-- DOWN:
-- DROP TABLE IF EXISTS public.vessel_identity_candidates;
```

- [ ] **Step 4 : lancer le test et vérifier qu’il passe**

Run: `./supabase/tests/run.sh migrations/115_vessel_identity_candidates.test.sql`
Attendu : PASS.

- [ ] **Step 5 : commit**

```bash
git add supabase/migrations/115_vessel_identity_candidates.sql supabase/tests/migrations/115_vessel_identity_candidates.test.sql
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(vessel-identity): table des candidats d'identité navire"
```

---

## Task 5 : migration 116 + chaîne de confiance VESSELFINDER_VERIFIED

**Files:**
- Create: `supabase/migrations/116_vesselfinder_email_source.sql`
- Create: `supabase/tests/migrations/116_vesselfinder_email_source.test.sql`
- Modify: `frontend/src/services/shipownerService.ts` (type `EmailSource` et table `TRUST`)
- Create: `frontend/src/services/shipownerService.trust.test.ts`

**Interfaces:**
- Consumes: `upsertShipownerEmail(db, ownerId, email, source)` existant.
- Produces: la valeur `'VESSELFINDER_VERIFIED'` acceptée par `EmailSource` et par la contrainte base.

**Contexte.** La contrainte est déclarée en ligne dans `supabase/migrations/024_shipowners_and_mappings.sql` :
`official_email_source TEXT CHECK (official_email_source IN ('AGENT_CLAIM', 'PORT_OFFICER', 'EQUASIS_VERIFIED'))`.
Postgres l’a nommée `shipowners_official_email_source_check`.

- [ ] **Step 1 : écrire les deux tests qui échouent**

```sql
-- supabase/tests/migrations/116_vesselfinder_email_source.test.sql
BEGIN;

INSERT INTO public.shipowners (name, official_email, official_email_source)
VALUES ('Test VF', 'a@b.com', 'VESSELFINDER_VERIFIED');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.shipowners (name, official_email, official_email_source)
    VALUES ('Test KO', 'c@d.com', 'SOMETHING_ELSE');
    ASSERT FALSE, 'une source inconnue aurait dû rester refusée';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

ROLLBACK;
```

```ts
// frontend/src/services/shipownerService.trust.test.ts
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { upsertShipownerEmail, type EmailSource } from './shipownerService';

/** Client minimal : mémorise la source courante et enregistre les mises à jour. */
function fakeDb(currentSource: EmailSource | null) {
    const updates: Array<Record<string, unknown>> = [];
    const db = {
        from: () => ({
            select: () => ({
                eq: () => ({
                    single: async () => ({
                        data: { official_email: 'old@x.com', official_email_source: currentSource },
                        error: null,
                    }),
                }),
            }),
            update: (payload: Record<string, unknown>) => {
                updates.push(payload);
                return { eq: () => ({ select: () => ({ single: async () => ({ data: payload, error: null }) }) }) };
            },
        }),
    } as unknown as SupabaseClient;
    return { db, updates };
}

describe('chaîne de confiance des e-mails', () => {
    it('VESSELFINDER_VERIFIED remplace une revendication d’agent', async () => {
        const { db, updates } = fakeDb('AGENT_CLAIM');
        await upsertShipownerEmail(db, 'owner-1', 'new@x.com', 'VESSELFINDER_VERIFIED');
        expect(updates).toHaveLength(1);
        expect(updates[0].official_email_source).toBe('VESSELFINDER_VERIFIED');
    });

    it('VESSELFINDER_VERIFIED n’écrase pas une saisie d’officier de port', async () => {
        const { db, updates } = fakeDb('PORT_OFFICER');
        await upsertShipownerEmail(db, 'owner-1', 'new@x.com', 'VESSELFINDER_VERIFIED');
        expect(updates).toHaveLength(0);
    });

    it('VESSELFINDER_VERIFIED est au même niveau qu’EQUASIS_VERIFIED', async () => {
        const { db, updates } = fakeDb('EQUASIS_VERIFIED');
        await upsertShipownerEmail(db, 'owner-1', 'new@x.com', 'VESSELFINDER_VERIFIED');
        expect(updates).toHaveLength(1);
    });
});
```

- [ ] **Step 2 : lancer les deux tests et vérifier qu’ils échouent**

Run: `./supabase/tests/run.sh migrations/116_vesselfinder_email_source.test.sql`
Attendu : FAIL — `check_violation` sur l’insertion de `VESSELFINDER_VERIFIED`.

Run: `cd frontend && npm run test -- src/services/shipownerService.trust.test.ts`
Attendu : FAIL — TypeScript refuse `'VESSELFINDER_VERIFIED'` comme `EmailSource`.

- [ ] **Step 3 : écrire la migration et étendre le service**

```sql
-- supabase/migrations/116_vesselfinder_email_source.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 116 : VESSELFINDER_VERIFIED dans la chaîne de confiance
--
-- Niveaux : AGENT_CLAIM (1) < EQUASIS_VERIFIED (2) = VESSELFINDER_VERIFIED (2)
--           < PORT_OFFICER (3)
-- Une adresse issue de VesselFinder remplace donc une revendication d'agent,
-- mais jamais une saisie d'officier de port.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.shipowners
  DROP CONSTRAINT IF EXISTS shipowners_official_email_source_check;

ALTER TABLE public.shipowners
  ADD CONSTRAINT shipowners_official_email_source_check
  CHECK (official_email_source IN
    ('AGENT_CLAIM', 'PORT_OFFICER', 'EQUASIS_VERIFIED', 'VESSELFINDER_VERIFIED'));

-- DOWN:
-- ALTER TABLE public.shipowners DROP CONSTRAINT shipowners_official_email_source_check;
-- ALTER TABLE public.shipowners ADD CONSTRAINT shipowners_official_email_source_check
--   CHECK (official_email_source IN ('AGENT_CLAIM', 'PORT_OFFICER', 'EQUASIS_VERIFIED'));
```

Dans `frontend/src/services/shipownerService.ts`, remplacer la ligne 3 :

```ts
export type EmailSource = 'AGENT_CLAIM' | 'PORT_OFFICER' | 'EQUASIS_VERIFIED' | 'VESSELFINDER_VERIFIED';
```

et la table `TRUST` :

```ts
const TRUST: Record<EmailSource, number> = {
  AGENT_CLAIM: 1,
  EQUASIS_VERIFIED: 2,
  VESSELFINDER_VERIFIED: 2,
  PORT_OFFICER: 3,
};
```

- [ ] **Step 4 : lancer les deux tests et vérifier qu’ils passent**

Run: `./supabase/tests/run.sh migrations/116_vesselfinder_email_source.test.sql` → PASS
Run: `cd frontend && npm run test -- src/services/shipownerService` → PASS (les tests existants du service doivent rester verts)

- [ ] **Step 5 : commit**

```bash
git add supabase/migrations/116_vesselfinder_email_source.sql supabase/tests/migrations/116_vesselfinder_email_source.test.sql frontend/src/services/shipownerService.ts frontend/src/services/shipownerService.trust.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(shipowners): source d'e-mail VESSELFINDER_VERIFIED"
```

---

## Task 6 : service d’import des candidats

**Files:**
- Create: `frontend/src/services/vesselIdentity/vesselIdentityService.ts`
- Test: `frontend/src/services/vesselIdentity/vesselIdentityService.test.ts`

**Interfaces:**
- Consumes: `VesselFinderCandidate`, `ParseResult` (Task 2) ; `matchesSanctionedEntity` (Task 3).
- Produces:

```ts
export interface SanctionedEntity { id: string; name: string; aliases: string[] }
export interface FlaggedCandidate extends VesselFinderCandidate {
    contactBlocked: boolean;
    contactBlockedReason: string | null;
}
export function flagSanctionedCandidates(
    candidates: readonly VesselFinderCandidate[],
    sanctioned: readonly SanctionedEntity[],
): FlaggedCandidate[];
export function loadSanctionedEntities(db: SupabaseClient): Promise<SanctionedEntity[]>;
export function insertCandidates(
    db: SupabaseClient,
    batchLabel: string,
    importedBy: string,
    candidates: readonly FlaggedCandidate[],
): Promise<number>;
```

- [ ] **Step 1 : écrire le test qui échoue**

```ts
// frontend/src/services/vesselIdentity/vesselIdentityService.test.ts
import { describe, it, expect } from 'vitest';
import { flagSanctionedCandidates, type SanctionedEntity } from './vesselIdentityService';
import type { VesselFinderCandidate } from './vesselFinderParser';

const base: VesselFinderCandidate = {
    imoNumber: '9167057', mmsi: '341264001', callSign: 'V4LK5', vesselName: 'MAYAR',
    flagCode: 'KN', typeRaw: 'Livestock Carrier', category: 'CARGO',
    grossTonnage: 4752, deadweight: 4200, buildYear: 1998,
    managerName: 'LEVANTE MARITTIMO CO', managerCountry: 'MH', managerEmail: null,
    ownerName: 'LEVANTE MARITTIMO CO', ownerCountry: 'MH', ownerEmail: null,
    ismManagerName: 'MORGAN NAVIGATION CO SA', ismManagerEmail: 'morgan.navigation@mail.example',
    lastSeenAt: '2026-05-01 07:33:31',
};

const SANCTIONED: SanctionedEntity[] = [
    { id: 'arm-012', name: 'Petrofleet Shipping', aliases: ['Petrofleet'] },
    { id: 'arm-013', name: 'Morgan Navigation SA', aliases: ['Morgan Nav Beirut'] },
];

describe('flagSanctionedCandidates', () => {
    it('bloque un candidat dont l’ISM manager est sous sanctions', () => {
        const [c] = flagSanctionedCandidates([base], SANCTIONED);
        expect(c.contactBlocked).toBe(true);
        expect(c.contactBlockedReason).toBe('ISM manager sous sanctions : Morgan Navigation SA (arm-013)');
    });

    it('bloque un candidat dont le manager est sous sanctions', () => {
        const mtSahil = { ...base, imoNumber: '8619003', vesselName: 'MT SAHIL',
            managerName: 'PETROFLEET ENERGY TRADING LLC', managerEmail: 'info@petrofleetenergy.example',
            ismManagerName: 'PETROFLEET ENERGY TRADING LLC', ismManagerEmail: 'info@petrofleetenergy.example' };
        const [c] = flagSanctionedCandidates([mtSahil], SANCTIONED);
        expect(c.contactBlocked).toBe(true);
        expect(c.contactBlockedReason).toBe('manager sous sanctions : Petrofleet Shipping (arm-012)');
    });

    it('laisse passer un candidat sans lien de sanction', () => {
        const trust1 = { ...base, imoNumber: '7504158', vesselName: 'TRUST 1',
            managerName: 'FAROS SHIPPING CO SARL', managerEmail: 'faros@farosshipping.example',
            ownerName: 'UNIVERSAL SHIPPING & LOGISTIC',
            ismManagerName: 'FAROS SHIPPING CO SARL', ismManagerEmail: 'faros@farosshipping.example' };
        const [c] = flagSanctionedCandidates([trust1], SANCTIONED);
        expect(c.contactBlocked).toBe(false);
        expect(c.contactBlockedReason).toBeNull();
    });

    it('ne bloque rien quand la liste de sanctions est vide', () => {
        const [c] = flagSanctionedCandidates([base], []);
        expect(c.contactBlocked).toBe(false);
    });
});
```

- [ ] **Step 2 : lancer le test et vérifier qu’il échoue**

Run: `cd frontend && npm run test -- src/services/vesselIdentity/vesselIdentityService.test.ts`
Attendu : FAIL — module introuvable.

- [ ] **Step 3 : écrire l’implémentation**

```ts
// frontend/src/services/vesselIdentity/vesselIdentityService.ts
import { type SupabaseClient } from '@supabase/supabase-js';
import { matchesSanctionedEntity } from '@/domain/sanctions/entityMatch';
import type { VesselFinderCandidate } from './vesselFinderParser';

export interface SanctionedEntity {
    id: string;
    name: string;
    aliases: string[];
}

export interface FlaggedCandidate extends VesselFinderCandidate {
    contactBlocked: boolean;
    contactBlockedReason: string | null;
}

/**
 * Marque les candidats dont l'une des trois sociétés correspond à une entité
 * sous sanctions. Le blocage porte sur le CONTACT, pas sur l'identité : le
 * navire reste appariable, seul l'e-mail devient inutilisable.
 *
 * L'ordre d'examen suit celui du destinataire (manager → owner → ISM), pour que
 * le motif désigne la société qui aurait effectivement été contactée.
 */
export function flagSanctionedCandidates(
    candidates: readonly VesselFinderCandidate[],
    sanctioned: readonly SanctionedEntity[],
): FlaggedCandidate[] {
    return candidates.map((c) => {
        const roles: ReadonlyArray<readonly [string, string | null]> = [
            ['manager', c.managerName],
            ['owner', c.ownerName],
            ['ISM manager', c.ismManagerName],
        ];
        for (const [role, name] of roles) {
            if (!name) continue;
            const hit = sanctioned.find((s) => matchesSanctionedEntity(name, [s.name, ...s.aliases]));
            if (hit) {
                return {
                    ...c,
                    contactBlocked: true,
                    contactBlockedReason: `${role} sous sanctions : ${hit.name} (${hit.id})`,
                };
            }
        }
        return { ...c, contactBlocked: false, contactBlockedReason: null };
    });
}

/** Charge les armateurs marqués OFAC SDN ou UN prohibited (colonnes de la migration 092). */
export async function loadSanctionedEntities(db: SupabaseClient): Promise<SanctionedEntity[]> {
    const { data, error } = await db
        .from('shipowners')
        .select('id, name, aliases, is_ofac_sdn, is_un_prohibited')
        .or('is_ofac_sdn.eq.true,is_un_prohibited.eq.true');
    if (error) throw error;
    return (data ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
    }));
}

/** Insère un lot de candidats. Retourne le nombre de lignes écrites. */
export async function insertCandidates(
    db: SupabaseClient,
    batchLabel: string,
    importedBy: string,
    candidates: readonly FlaggedCandidate[],
): Promise<number> {
    if (candidates.length === 0) return 0;
    const rows = candidates.map((c) => ({
        batch_label: batchLabel,
        source: 'VESSELFINDER_PORTCALLS',
        imo_number: c.imoNumber,
        mmsi: c.mmsi,
        call_sign: c.callSign,
        vessel_name: c.vesselName,
        flag_code: c.flagCode,
        type_raw: c.typeRaw,
        category: c.category,
        gross_tonnage: c.grossTonnage,
        deadweight: c.deadweight,
        build_year: c.buildYear,
        last_seen_at: c.lastSeenAt,
        manager_name: c.managerName,
        manager_country: c.managerCountry,
        manager_email: c.managerEmail,
        owner_name: c.ownerName,
        owner_country: c.ownerCountry,
        owner_email: c.ownerEmail,
        ism_manager_name: c.ismManagerName,
        ism_manager_email: c.ismManagerEmail,
        contact_blocked: c.contactBlocked,
        contact_blocked_reason: c.contactBlockedReason,
        status: 'PENDING',
        imported_by: importedBy,
    }));
    const { error } = await db.from('vessel_identity_candidates').insert(rows);
    if (error) throw error;
    return rows.length;
}
```

- [ ] **Step 4 : lancer le test et vérifier qu’il passe**

Run: `cd frontend && npm run test -- src/services/vesselIdentity/vesselIdentityService.test.ts`
Attendu : PASS, 4 tests.

- [ ] **Step 5 : commit**

```bash
git add frontend/src/services/vesselIdentity/vesselIdentityService.ts frontend/src/services/vesselIdentity/vesselIdentityService.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(vessel-identity): import des candidats et marquage sanctions"
```

---

## Task 7 : action serveur `applyVesselIdentity`

**Files:**
- Create: `frontend/src/actions/applyVesselIdentity.ts`
- Test: `frontend/src/actions/applyVesselIdentity.test.ts`

**Interfaces:**
- Consumes: `isValidImo` (Task 1), `upsertShipownerEmail` + `EmailSource` (Task 5), table `vessel_identity_candidates` (Task 4).
- Produces: `applyVesselIdentity(raw: unknown): Promise<ApplyVesselIdentityResult>` avec

```ts
export type ApplyVesselIdentityResult =
    | { ok: true; vesselId: string; emailApplied: boolean }
    | { ok: false; reason: string };
```

**Les cinq gardes, dans cet ordre.** Chacune interrompt sans écrire.

1. Zod + authentification + rôle ∈ `PORT_OFFICER | FINANCE_ADMIN | SUPERADMIN`.
2. Le candidat existe et son statut est `PENDING`.
3. Le navire cible existe et **n’est pas identifié** — `!isValidImo(vessel.imo_number)`. Ce test couvre les trois formes (`UNVERIFIED-*`, « à confirmer », « Hors registre Equasis ») et refuse tout navire réellement identifié.
4. Aucune autre ligne `vessels` ne porte déjà cet IMO ou ce MMSI → sinon statut `CONFLICT`, aucune écriture.
5. Le contact n’est appliqué que si `contact_blocked` est faux ; sinon l’identité est écrite et un `audit_logs` `SANCTIONS_CONTACT_BLOCKED` de sévérité `CRITICAL` est produit.

- [ ] **Step 1 : écrire le test qui échoue**

```ts
// frontend/src/actions/applyVesselIdentity.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.fn();
const mockFrom = vi.fn();
const mockAdminFrom = vi.fn();
const mockUpsertEmail = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { getUser: mockAuth }, from: mockFrom }),
}));
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({ from: mockAdminFrom }),
}));
vi.mock('@/services/shipownerService', () => ({
    upsertShipownerEmail: mockUpsertEmail,
}));

import { applyVesselIdentity } from './applyVesselIdentity';

/** Construit un faux client dont chaque table renvoie une réponse scriptée. */
function tableStub(responses: Record<string, unknown>) {
    return (table: string) => {
        const chain = {
            select: () => chain,
            eq: () => chain,
            neq: () => chain,
            or: () => chain,
            maybeSingle: async () => ({ data: responses[table] ?? null, error: null }),
            single: async () => ({ data: responses[table] ?? null, error: null }),
            update: () => chain,
            insert: async () => ({ error: null }),
        };
        return chain;
    };
}

const CANDIDATE = {
    id: '11111111-1111-1111-1111-111111111111',
    imo_number: '7504158', mmsi: '671882000', call_sign: '5VEV4', vessel_name: 'TRUST 1',
    flag_code: 'TG', category: 'CARGO', type_raw: 'Livestock Carrier',
    gross_tonnage: 2975, deadweight: 2560, build_year: 1975,
    manager_email: 'faros@farosshipping.example', owner_email: null, ism_manager_email: null,
    contact_blocked: false, contact_blocked_reason: null, status: 'PENDING',
};

const PLACEHOLDER_VESSEL = {
    id: '22222222-2222-2222-2222-222222222222',
    imo_number: 'UNVERIFIED-nav-042', mmsi: null, shipowner_id: '33333333-3333-3333-3333-333333333333',
    jurisdiction_id: null,
};

const INPUT = { candidateId: CANDIDATE.id, vesselId: PLACEHOLDER_VESSEL.id };

beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockImplementation(tableStub({ profiles: { role: 'PORT_OFFICER', full_name: 'Officier' } }));
    mockUpsertEmail.mockResolvedValue({});
});

describe('applyVesselIdentity', () => {
    it('refuse un utilisateur non authentifié', async () => {
        mockAuth.mockResolvedValue({ data: { user: null } });
        expect(await applyVesselIdentity(INPUT)).toEqual({ ok: false, reason: 'not authenticated' });
    });

    it('refuse un rôle insuffisant', async () => {
        mockFrom.mockImplementation(tableStub({ profiles: { role: 'SHIPPING_AGENT', full_name: 'Agent' } }));
        expect(await applyVesselIdentity(INPUT)).toEqual({ ok: false, reason: 'insufficient role' });
    });

    it('refuse d’écrire sur un navire déjà identifié', async () => {
        mockAdminFrom.mockImplementation(tableStub({
            vessel_identity_candidates: CANDIDATE,
            vessels: { ...PLACEHOLDER_VESSEL, imo_number: '9235957' },
        }));
        const r = await applyVesselIdentity(INPUT);
        expect(r).toEqual({ ok: false, reason: 'vessel already identified' });
        expect(mockUpsertEmail).not.toHaveBeenCalled();
    });

    it('accepte les trois formes de non-identité', async () => {
        for (const imo of ['UNVERIFIED-nav-042', 'à confirmer', 'Hors registre Equasis']) {
            mockAdminFrom.mockImplementation(tableStub({
                vessel_identity_candidates: CANDIDATE,
                vessels: { ...PLACEHOLDER_VESSEL, imo_number: imo },
            }));
            const r = await applyVesselIdentity(INPUT);
            expect(r.ok, `imo=${imo}`).toBe(true);
        }
    });

    it('applique l’e-mail du manager via VESSELFINDER_VERIFIED', async () => {
        mockAdminFrom.mockImplementation(tableStub({
            vessel_identity_candidates: CANDIDATE,
            vessels: PLACEHOLDER_VESSEL,
        }));
        const r = await applyVesselIdentity(INPUT);
        expect(r).toMatchObject({ ok: true, emailApplied: true });
        expect(mockUpsertEmail).toHaveBeenCalledWith(
            expect.anything(), PLACEHOLDER_VESSEL.shipowner_id,
            'faros@farosshipping.example', 'VESSELFINDER_VERIFIED',
        );
    });

    it('n’applique jamais l’e-mail d’un contact bloqué', async () => {
        mockAdminFrom.mockImplementation(tableStub({
            vessel_identity_candidates: {
                ...CANDIDATE, contact_blocked: true,
                contact_blocked_reason: 'ISM manager sous sanctions : Morgan Navigation SA (arm-013)',
                manager_email: null, ism_manager_email: 'morgan.navigation@mail.example',
            },
            vessels: PLACEHOLDER_VESSEL,
        }));
        const r = await applyVesselIdentity(INPUT);
        expect(r).toMatchObject({ ok: true, emailApplied: false });
        expect(mockUpsertEmail).not.toHaveBeenCalled();
    });

    it('refuse un candidat déjà traité', async () => {
        mockAdminFrom.mockImplementation(tableStub({
            vessel_identity_candidates: { ...CANDIDATE, status: 'MATCHED' },
            vessels: PLACEHOLDER_VESSEL,
        }));
        expect(await applyVesselIdentity(INPUT)).toEqual({ ok: false, reason: 'candidate already processed' });
    });

    it('refuse une entrée mal formée', async () => {
        const r = await applyVesselIdentity({ candidateId: 'pas-un-uuid', vesselId: 'non plus' });
        expect(r.ok).toBe(false);
    });
});
```

- [ ] **Step 2 : lancer le test et vérifier qu’il échoue**

Run: `cd frontend && npm run test -- src/actions/applyVesselIdentity.test.ts`
Attendu : FAIL — module introuvable.

- [ ] **Step 3 : écrire l’implémentation**

```ts
// frontend/src/actions/applyVesselIdentity.ts
'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { upsertShipownerEmail } from '@/services/shipownerService';
import { isValidImo } from '@/services/vesselIdentity/imo';

// Schéma et types restent internes : un module 'use server' n'exporte que des
// fonctions async, sinon `next build` casse.
const schema = z.object({
    candidateId: z.string().uuid(),
    vesselId: z.string().uuid(),
});

const ALLOWED_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

export type ApplyVesselIdentityResult =
    | { ok: true; vesselId: string; emailApplied: boolean }
    | { ok: false; reason: string };

/**
 * Applique un appariement décidé par un humain : le candidat VesselFinder
 * devient l'identité du navire placeholder désigné.
 *
 * Cinq gardes, dans l'ordre, chacune interrompant sans écrire :
 *   1. authentification et rôle
 *   2. candidat existant et encore PENDING
 *   3. navire cible NON identifié — `!isValidImo(imo_number)` couvre
 *      `UNVERIFIED-*`, « à confirmer » et « Hors registre Equasis »
 *   4. aucun autre navire ne porte cet IMO ou ce MMSI (sinon CONFLICT)
 *   5. contact appliqué seulement si le candidat n'est pas sous sanctions
 */
export async function applyVesselIdentity(raw: unknown): Promise<ApplyVesselIdentityResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role, full_name')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !ALLOWED_ROLES.includes(String(profile.role))) {
        return { ok: false, reason: 'insufficient role' };
    }

    let admin;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: false, reason: 'service role not configured' };
    }

    // Garde 2 — candidat
    const { data: candidate } = await admin
        .from('vessel_identity_candidates')
        .select('*')
        .eq('id', parsed.data.candidateId)
        .maybeSingle();
    if (!candidate) return { ok: false, reason: 'candidate not found' };
    if (candidate.status !== 'PENDING') {
        return { ok: false, reason: 'candidate already processed' };
    }

    // Garde 3 — navire non identifié
    const { data: vessel } = await admin
        .from('vessels')
        .select('id, imo_number, mmsi, shipowner_id, jurisdiction_id')
        .eq('id', parsed.data.vesselId)
        .maybeSingle();
    if (!vessel) return { ok: false, reason: 'vessel not found' };
    if (isValidImo(String(vessel.imo_number))) {
        return { ok: false, reason: 'vessel already identified' };
    }

    // Garde 4 — collision d'identité
    const { data: clash } = await admin
        .from('vessels')
        .select('id')
        .neq('id', vessel.id)
        .or(
            candidate.mmsi
                ? `imo_number.eq.${candidate.imo_number},mmsi.eq.${candidate.mmsi}`
                : `imo_number.eq.${candidate.imo_number}`,
        )
        .maybeSingle();
    if (clash) {
        await admin
            .from('vessel_identity_candidates')
            .update({ status: 'CONFLICT' })
            .eq('id', candidate.id);
        return { ok: false, reason: 'identity already held by another vessel' };
    }

    // Écriture de l'identité
    const { error: updateErr } = await admin
        .from('vessels')
        .update({
            imo_number: candidate.imo_number,
            mmsi: candidate.mmsi,
            call_sign: candidate.call_sign,
            name: candidate.vessel_name,
            flag_code: candidate.flag_code,
            category: candidate.category,
            vessel_subtype: candidate.type_raw,
            gross_tonnage_dwt: candidate.gross_tonnage,
            dwt: candidate.deadweight,
            build_year: candidate.build_year,
        })
        .eq('id', vessel.id);
    if (updateErr) return { ok: false, reason: updateErr.message };

    // Garde 5 — contact
    const billingEmail = candidate.contact_blocked
        ? null
        : (candidate.manager_email ?? candidate.owner_email ?? candidate.ism_manager_email ?? null);

    let emailApplied = false;
    if (billingEmail && vessel.shipowner_id) {
        await upsertShipownerEmail(admin, String(vessel.shipowner_id), billingEmail, 'VESSELFINDER_VERIFIED');
        emailApplied = true;
    }

    if (candidate.contact_blocked) {
        await admin.from('audit_logs').insert({
            user_id: auth.user.id,
            user_full_name: profile.full_name ?? 'Officier',
            action: 'SANCTIONS_CONTACT_BLOCKED',
            severity: 'CRITICAL',
            entity_type: 'Vessel',
            entity_id: vessel.id,
            jurisdiction_id: vessel.jurisdiction_id ?? null,
            details_json: {
                event: 'VESSELFINDER_CONTACT_BLOCKED',
                imoNumber: candidate.imo_number,
                reason: candidate.contact_blocked_reason,
            },
        });
    }

    await admin
        .from('vessel_identity_candidates')
        .update({
            status: 'MATCHED',
            matched_vessel_id: vessel.id,
            matched_by: auth.user.id,
            matched_at: new Date().toISOString(),
        })
        .eq('id', candidate.id);

    await admin.from('audit_logs').insert({
        user_id: auth.user.id,
        user_full_name: profile.full_name ?? 'Officier',
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Vessel',
        entity_id: vessel.id,
        jurisdiction_id: vessel.jurisdiction_id ?? null,
        details_json: {
            event: 'VESSEL_IDENTITY_MATCHED',
            previousImo: vessel.imo_number,
            imoNumber: candidate.imo_number,
            mmsi: candidate.mmsi,
            vesselName: candidate.vessel_name,
            emailApplied,
            candidateId: candidate.id,
        },
    });

    return { ok: true, vesselId: String(vessel.id), emailApplied };
}
```

- [ ] **Step 4 : lancer le test et vérifier qu’il passe**

Run: `cd frontend && npm run test -- src/actions/applyVesselIdentity.test.ts`
Attendu : PASS, 8 tests.

- [ ] **Step 5 : commit**

```bash
git add frontend/src/actions/applyVesselIdentity.ts frontend/src/actions/applyVesselIdentity.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(vessel-identity): action d'appariement sous cinq gardes"
```

---

## Task 8 : écran d’appariement

**Files:**
- Create: `frontend/src/app/(dashboard)/admin/vessel-identity/page.tsx`
- Create: `frontend/src/app/(dashboard)/admin/vessel-identity/VesselIdentityPanel.tsx`
- Create: `frontend/src/actions/importVesselIdentityBatch.ts`
- Modify: `frontend/src/lib/rbac.ts` (ajouter la clé `vessel-identity` dans `NAV_PERMISSIONS`)
- Modify: `frontend/src/components/dashboard/DashboardSidebar.tsx` (entrée de navigation)
- Modify: `frontend/messages/{en,fr,ar,pt,sw,so}.json` (namespace `AdminVesselIdentity`)
- Test: `frontend/src/actions/importVesselIdentityBatch.test.ts`

**Interfaces:**
- Consumes: `parseVesselFinderPortCalls` (Task 2) ; `flagSanctionedCandidates`, `loadSanctionedEntities`, `insertCandidates` (Task 6) ; `applyVesselIdentity` (Task 7).
- Produces: `importVesselIdentityBatch(raw: unknown): Promise<ImportBatchResult>` avec

```ts
export type ImportBatchResult =
    | { ok: true; batchLabel: string; inserted: number; rowsRead: number;
        rejected: Array<{ lineNumber: number; vesselName: string; reason: string }> }
    | { ok: false; reason: string };
```

- [ ] **Step 1 : écrire le test qui échoue**

```ts
// frontend/src/actions/importVesselIdentityBatch.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.fn();
const mockFrom = vi.fn();
const mockInsertCandidates = vi.fn();
const mockLoadSanctioned = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { getUser: mockAuth }, from: mockFrom }),
}));
vi.mock('@/lib/supabase/tenant', () => ({ createPlatformClient: () => ({ from: vi.fn() }) }));
vi.mock('@/services/vesselIdentity/vesselIdentityService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/vesselIdentity/vesselIdentityService')>();
    return { ...actual, insertCandidates: mockInsertCandidates, loadSanctionedEntities: mockLoadSanctioned };
});

import { importVesselIdentityBatch } from './importVesselIdentityBatch';

const HEADER =
    '"MMSI","IMO","SHIP NAME","TYPE","DRAUGHT","DATE TIME (UTC)","EVENT","PORT NAME","LOCODE",' +
    'CALLSIGN,BUILT,FLAG,FLAGNAME,TYPE,TYPENAME,STATUS,GT,DWT,LOA,LPP,BEAM,DRAUGHT,CLASS,CLASSCODE,' +
    'MANAGER_NAME,MANAGER_COUNTRY,MANAGER_ADDRESS,MANAGER_WEB,MANAGER_EMAIL,MANAGER_PHONE,MANAGER_FAX,' +
    'OWNER_NAME,OWNER_COUNTRY,OWNER_ADDRESS,OWNER_WEB,OWNER_EMAIL,OWNER_PHONE,OWNER_FAX,' +
    'ISM_MANAGER_NAME,ISM_MANAGER_COUNTRY,ISM_MANAGER_ADDRESS,ISM_MANAGER_WEB,ISM_MANAGER_EMAIL,' +
    'ISM_MANAGER_PHONE,ISM_MANAGER_FAX,PI_COMPANY,PI_INCEPTION';

const TRUST1 =
    '671882000,7504158,"TRUST 1",70,5.0,"2026-05-01 05:21:13","ENTER_ZONE","Berbera Anch.","SOBBO",5VEV4,1975,TG,Togo,A38A,Livestock Carrier,IN SERVICE/COMMISSION,2975,2560,74,55,12,5,CAR,CAR,' +
    'FAROS SHIPPING CO SARL,LB,"Beirut.",,faros@farosshipping.example,,,' +
    'UNIVERSAL SHIPPING & LOGISTIC,LB,"Beirut.",,,,,' +
    'FAROS SHIPPING CO SARL,LB,"Beirut.",,faros@farosshipping.example,,,,0000-00-00';

const NAFISA =
    '417078690,0,"NAFISA",90,0.0,"2026-05-02 04:19:37","EXIT_ZONE","Berbera","SOBBO",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,';

beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockImplementation(() => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'PORT_OFFICER', full_name: 'O' }, error: null }) }) }),
    }));
    mockLoadSanctioned.mockResolvedValue([]);
    mockInsertCandidates.mockResolvedValue(1);
});

describe('importVesselIdentityBatch', () => {
    it('insère les candidats et rend compte des rejets', async () => {
        const r = await importVesselIdentityBatch({
            batchLabel: 'portcalls-mai-aout.csv',
            csv: [HEADER, TRUST1, NAFISA].join('\n'),
        });
        expect(r).toMatchObject({ ok: true, inserted: 1, rowsRead: 2 });
        if (r.ok) {
            expect(r.rejected).toEqual([
                { lineNumber: 3, vesselName: 'NAFISA', reason: 'IMO absent ou nul' },
            ]);
        }
    });

    it('refuse un rôle insuffisant', async () => {
        mockFrom.mockImplementation(() => ({
            select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'SHIPPING_AGENT' }, error: null }) }) }),
        }));
        const r = await importVesselIdentityBatch({ batchLabel: 'x.csv', csv: [HEADER, TRUST1].join('\n') });
        expect(r).toEqual({ ok: false, reason: 'insufficient role' });
        expect(mockInsertCandidates).not.toHaveBeenCalled();
    });

    it('rend un message explicite sur un fichier qui n’est pas un export d’escales', async () => {
        const r = await importVesselIdentityBatch({ batchLabel: 'x.csv', csv: 'IMO,MMSI,FLAG,NAME,TYPE\n1,2,3,4,5' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/en-tête inattendu/i);
    });
});
```

- [ ] **Step 2 : lancer le test et vérifier qu’il échoue**

Run: `cd frontend && npm run test -- src/actions/importVesselIdentityBatch.test.ts`
Attendu : FAIL — module introuvable.

- [ ] **Step 3 : écrire l’action d’import**

```ts
// frontend/src/actions/importVesselIdentityBatch.ts
'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { parseVesselFinderPortCalls } from '@/services/vesselIdentity/vesselFinderParser';
import {
    flagSanctionedCandidates,
    insertCandidates,
    loadSanctionedEntities,
} from '@/services/vesselIdentity/vesselIdentityService';

const schema = z.object({
    batchLabel: z.string().min(1).max(200),
    csv: z.string().min(1),
});

const ALLOWED_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

export type ImportBatchResult =
    | {
          ok: true;
          batchLabel: string;
          inserted: number;
          rowsRead: number;
          rejected: Array<{ lineNumber: number; vesselName: string; reason: string }>;
      }
    | { ok: false; reason: string };

/**
 * Importe un export d'escales VesselFinder comme lot de candidats.
 * Aucune écriture dans `vessels` : l'import ne fait que constituer la liste à apparier.
 */
export async function importVesselIdentityBatch(raw: unknown): Promise<ImportBatchResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role, full_name')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !ALLOWED_ROLES.includes(String(profile.role))) {
        return { ok: false, reason: 'insufficient role' };
    }

    let admin;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: false, reason: 'service role not configured' };
    }

    let result;
    try {
        result = parseVesselFinderPortCalls(parsed.data.csv);
    } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : 'parsing failed' };
    }

    const sanctioned = await loadSanctionedEntities(admin);
    const flagged = flagSanctionedCandidates(result.candidates, sanctioned);
    const inserted = await insertCandidates(admin, parsed.data.batchLabel, auth.user.id, flagged);

    return {
        ok: true,
        batchLabel: parsed.data.batchLabel,
        inserted,
        rowsRead: result.rowsRead,
        rejected: result.rejected,
    };
}
```

- [ ] **Step 4 : lancer le test et vérifier qu’il passe**

Run: `cd frontend && npm run test -- src/actions/importVesselIdentityBatch.test.ts`
Attendu : PASS, 3 tests.

- [ ] **Step 5 : brancher la navigation et le RBAC**

Dans `frontend/src/lib/rbac.ts`, ajouter dans `NAV_PERMISSIONS`, sous le bloc `// Admin` :

```ts
    'vessel-identity': [UserRole.PORT_OFFICER, UserRole.FINANCE_ADMIN, UserRole.SUPERADMIN],
```

Dans `frontend/src/components/dashboard/DashboardSidebar.tsx`, ajouter l’entrée correspondante
à côté des autres entrées admin, avec la clé `vessel-identity` et le libellé issu du namespace
`AdminVesselIdentity`.

- [ ] **Step 6 : ajouter les clés i18n sur les six locales**

Dans chacun de `frontend/messages/{en,fr,ar,pt,sw,so}.json`, ajouter le namespace
`AdminVesselIdentity`. Version française :

```json
"AdminVesselIdentity": {
  "title": "Identité des navires",
  "subtitle": "Apparier un navire non identifié à un navire réel issu d'un export d'escales VesselFinder",
  "uploadLabel": "Déposer l'export d'escales (CSV)",
  "batchLabel": "Nom du lot",
  "import": "Importer",
  "importReport": "{rowsRead} lignes lues · {inserted} navires retenus · {rejected} lignes rejetées",
  "rejectedTitle": "Lignes rejetées",
  "rejectedLine": "Ligne {lineNumber} — {vesselName} : {reason}",
  "unidentifiedTitle": "Navires non identifiés",
  "candidatesTitle": "Candidats disponibles",
  "match": "Apparier",
  "matched": "Apparié",
  "conflict": "Conflit — identité déjà portée par un autre navire",
  "contactBlocked": "Contact bloqué (sanctions)",
  "contactBlockedHint": "L'identité peut être appariée, mais aucun e-mail ne sera enregistré.",
  "billingEmail": "Contact de facturation",
  "noEmail": "Aucun contact joignable",
  "searchPlaceholder": "Rechercher par nom, IMO ou MMSI",
  "empty": "Aucun candidat en attente. Déposez un export pour commencer."
}
```

Les cinq autres locales reçoivent les mêmes clés traduites. `en` est la référence de parité :
toute clé absente d’une locale casse le rendu.

- [ ] **Step 7 : écrire la page serveur et le panneau client**

`page.tsx` est un composant serveur : il vérifie le rôle via le helper de garde utilisé par les
autres pages `admin/*`, charge les navires non identifiés et les candidats `PENDING` du lot le
plus récent, puis passe les données au panneau client.

```tsx
// frontend/src/app/(dashboard)/admin/vessel-identity/page.tsx
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { isValidImo } from '@/services/vesselIdentity/imo';
import VesselIdentityPanel from './VesselIdentityPanel';

const ALLOWED_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

export default async function VesselIdentityPage() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) notFound();

    const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', auth.user.id).single();
    if (!profile || !ALLOWED_ROLES.includes(String(profile.role))) notFound();

    const admin = createPlatformClient();

    // Les navires non identifiés ne se filtrent pas en SQL : le prédicat est la
    // somme de contrôle IMO, pas un motif textuel. On charge puis on filtre.
    const { data: vessels } = await admin
        .from('vessels')
        .select('id, imo_number, name, shipowner_id, shipowners(name)')
        .order('name');
    const unidentified = (vessels ?? []).filter((v) => !isValidImo(String(v.imo_number)));

    const { data: candidates } = await admin
        .from('vessel_identity_candidates')
        .select('*')
        .eq('status', 'PENDING')
        .order('vessel_name');

    return <VesselIdentityPanel unidentified={unidentified} candidates={candidates ?? []} />;
}
```

```tsx
// frontend/src/app/(dashboard)/admin/vessel-identity/VesselIdentityPanel.tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { importVesselIdentityBatch } from '@/actions/importVesselIdentityBatch';
import { applyVesselIdentity } from '@/actions/applyVesselIdentity';

interface UnidentifiedVessel {
    id: string;
    imo_number: string;
    name: string;
    shipowner_id: string | null;
    shipowners: { name: string } | null;
}

interface Candidate {
    id: string;
    imo_number: string;
    mmsi: string | null;
    vessel_name: string;
    flag_code: string | null;
    type_raw: string | null;
    gross_tonnage: number | null;
    deadweight: number | null;
    manager_email: string | null;
    owner_email: string | null;
    ism_manager_email: string | null;
    contact_blocked: boolean;
    contact_blocked_reason: string | null;
}

interface Report {
    rowsRead: number;
    inserted: number;
    rejected: Array<{ lineNumber: number; vesselName: string; reason: string }>;
}

export default function VesselIdentityPanel({
    unidentified,
    candidates,
}: {
    unidentified: UnidentifiedVessel[];
    candidates: Candidate[];
}) {
    const t = useTranslations('AdminVesselIdentity');
    const [report, setReport] = useState<Report | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [selectedVessel, setSelectedVessel] = useState<string | null>(null);
    const [search, setSearch] = useState('');

    async function onFile(file: File) {
        setBusy(true);
        setError(null);
        const csv = await file.text();
        const res = await importVesselIdentityBatch({ batchLabel: file.name, csv });
        setBusy(false);
        if (!res.ok) { setError(res.reason); return; }
        setReport({ rowsRead: res.rowsRead, inserted: res.inserted, rejected: res.rejected });
    }

    async function onMatch(candidateId: string) {
        if (!selectedVessel) return;
        setBusy(true);
        setError(null);
        const res = await applyVesselIdentity({ candidateId, vesselId: selectedVessel });
        setBusy(false);
        if (!res.ok) { setError(res.reason); return; }
        window.location.reload();
    }

    const billingEmail = (c: Candidate) =>
        c.contact_blocked ? null : (c.manager_email ?? c.owner_email ?? c.ism_manager_email);

    const visible = candidates.filter((c) => {
        const q = search.trim().toUpperCase();
        if (!q) return true;
        return (
            c.vessel_name.toUpperCase().includes(q) ||
            c.imo_number.includes(q) ||
            (c.mmsi ?? '').includes(q)
        );
    });

    return (
        <div className="space-y-6 p-6">
            <header>
                <h1 className="text-2xl font-semibold">{t('title')}</h1>
                <p className="text-sm text-slate-500">{t('subtitle')}</p>
            </header>

            <section className="rounded-lg border p-4">
                <label className="block text-sm font-medium">{t('uploadLabel')}</label>
                <input
                    type="file"
                    accept=".csv,text/csv"
                    disabled={busy}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
                />
                {report && (
                    <div className="mt-3 text-sm">
                        <p>{t('importReport', {
                            rowsRead: report.rowsRead,
                            inserted: report.inserted,
                            rejected: report.rejected.length,
                        })}</p>
                        {report.rejected.length > 0 && (
                            <details className="mt-2">
                                <summary>{t('rejectedTitle')}</summary>
                                <ul className="mt-1 list-disc pl-5">
                                    {report.rejected.map((r) => (
                                        <li key={`${r.lineNumber}`}>
                                            {t('rejectedLine', { ...r })}
                                        </li>
                                    ))}
                                </ul>
                            </details>
                        )}
                    </div>
                )}
                {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            </section>

            <div className="grid gap-6 md:grid-cols-2">
                <section>
                    <h2 className="mb-2 font-medium">{t('unidentifiedTitle')}</h2>
                    <ul className="divide-y rounded-lg border">
                        {unidentified.map((v) => (
                            <li key={v.id}>
                                <button
                                    type="button"
                                    onClick={() => setSelectedVessel(v.id)}
                                    className={`w-full px-3 py-2 text-left ${
                                        selectedVessel === v.id ? 'bg-emerald-50' : ''
                                    }`}
                                >
                                    <span className="font-medium">{v.name}</span>
                                    <span className="block text-xs text-slate-500">
                                        {v.imo_number} · {v.shipowners?.name ?? '—'}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>

                <section>
                    <h2 className="mb-2 font-medium">{t('candidatesTitle')}</h2>
                    <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('searchPlaceholder')}
                        className="mb-2 w-full rounded border px-2 py-1 text-sm"
                    />
                    {visible.length === 0 && <p className="text-sm text-slate-500">{t('empty')}</p>}
                    <ul className="divide-y rounded-lg border">
                        {visible.map((c) => (
                            <li key={c.id} className="px-3 py-2">
                                <div className="font-medium">{c.vessel_name}</div>
                                <div className="text-xs text-slate-500">
                                    IMO {c.imo_number} · MMSI {c.mmsi ?? '—'} · {c.flag_code ?? '—'} ·
                                    GT {c.gross_tonnage ?? '—'} · DWT {c.deadweight ?? '—'}
                                </div>
                                {c.contact_blocked ? (
                                    <div className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                                        <strong>{t('contactBlocked')}</strong> — {c.contact_blocked_reason}
                                        <div>{t('contactBlockedHint')}</div>
                                    </div>
                                ) : (
                                    <div className="mt-1 text-xs">
                                        {t('billingEmail')} : {billingEmail(c) ?? t('noEmail')}
                                    </div>
                                )}
                                <button
                                    type="button"
                                    disabled={!selectedVessel || busy}
                                    onClick={() => void onMatch(c.id)}
                                    className="mt-2 rounded bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-40"
                                >
                                    {t('match')}
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            </div>
        </div>
    );
}
```

Les fenêtres modales éventuelles utilisent des `div` `ModalOverlay` comme le reste de l’admin,
**pas** Radix Dialog.

- [ ] **Step 8 : vérifier l’ensemble**

```bash
cd frontend && npm run lint && npm run test && npm run build
```

Attendu : lint propre, suite verte, build réussi.

- [ ] **Step 9 : commit**

```bash
git add frontend/src/app/\(dashboard\)/admin/vessel-identity frontend/src/actions/importVesselIdentityBatch.ts frontend/src/actions/importVesselIdentityBatch.test.ts frontend/src/lib/rbac.ts frontend/src/components/dashboard/DashboardSidebar.tsx frontend/messages
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(vessel-identity): écran d'appariement et import de lot"
```

---

## Task 9 : saisie unitaire d’un candidat

**Files:**
- Create: `frontend/src/actions/createManualCandidate.ts`
- Test: `frontend/src/actions/createManualCandidate.test.ts`
- Modify: `frontend/src/app/(dashboard)/admin/vessel-identity/VesselIdentityPanel.tsx` (formulaire)
- Modify: `frontend/messages/{en,fr,ar,pt,sw,so}.json` (clés du formulaire)

**Pourquoi cette tâche.** La décision D1 de la spec retient **deux** entrées : l’import de fichier
et la saisie unitaire. L’import ne couvre que les navires ayant touché Berbera pendant la période
exportée ; les six navires du portefeuille absents des escales (ROYAL O, SUVARI REIS, KURT MAS,
GULF KING, GOLDEN ID, ACHILLES) n’ont pas d’autre chemin.

**Interfaces:**
- Consumes: `isValidImo` (Task 1) ; `flagSanctionedCandidates`, `loadSanctionedEntities` (Task 6).
- Produces: `createManualCandidate(raw: unknown): Promise<{ ok: true; candidateId: string } | { ok: false; reason: string }>`.

- [ ] **Step 1 : écrire le test qui échoue**

```ts
// frontend/src/actions/createManualCandidate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.fn();
const mockFrom = vi.fn();
const mockAdminFrom = vi.fn();
const mockLoadSanctioned = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { getUser: mockAuth }, from: mockFrom }),
}));
vi.mock('@/lib/supabase/tenant', () => ({ createPlatformClient: () => ({ from: mockAdminFrom }) }));
vi.mock('@/services/vesselIdentity/vesselIdentityService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/vesselIdentity/vesselIdentityService')>();
    return { ...actual, loadSanctionedEntities: mockLoadSanctioned };
});

import { createManualCandidate } from './createManualCandidate';

const VALID = {
    imoNumber: '9424223',
    vesselName: 'NYALA',
    mmsi: '341581000',
    flagCode: 'KN',
    typeRaw: 'Oil Products Tanker',
    grossTonnage: 5000,
    deadweight: 8000,
    buildYear: 2010,
    managerName: 'SOME MANAGER LTD',
    managerEmail: 'ops@some-manager.com',
};

let inserted: Record<string, unknown> | null = null;

beforeEach(() => {
    vi.clearAllMocks();
    inserted = null;
    mockAuth.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockImplementation(() => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'PORT_OFFICER' }, error: null }) }) }),
    }));
    mockAdminFrom.mockImplementation(() => ({
        insert: (row: Record<string, unknown>) => {
            inserted = row;
            return { select: () => ({ single: async () => ({ data: { id: 'cand-1' }, error: null }) }) };
        },
    }));
    mockLoadSanctioned.mockResolvedValue([]);
});

describe('createManualCandidate', () => {
    it('crée un candidat de source MANUAL', async () => {
        const r = await createManualCandidate(VALID);
        expect(r).toEqual({ ok: true, candidateId: 'cand-1' });
        expect(inserted).toMatchObject({ source: 'MANUAL', imo_number: '9424223', status: 'PENDING' });
    });

    it('refuse un IMO dont la somme de contrôle est fausse — la garde de la saisie manuelle', async () => {
        const r = await createManualCandidate({ ...VALID, imoNumber: '9424224' });
        expect(r).toEqual({ ok: false, reason: 'somme de contrôle IMO invalide' });
        expect(inserted).toBeNull();
    });

    it('refuse un type de navire inconnu', async () => {
        const r = await createManualCandidate({ ...VALID, typeRaw: 'Submersible Drilling Rig' });
        expect(r.ok).toBe(false);
        expect(inserted).toBeNull();
    });

    it('marque le contact bloqué quand la société est sous sanctions', async () => {
        mockLoadSanctioned.mockResolvedValue([
            { id: 'arm-012', name: 'Petrofleet Shipping', aliases: ['Petrofleet'] },
        ]);
        const r = await createManualCandidate({
            ...VALID, managerName: 'PETROFLEET ENERGY TRADING LLC', managerEmail: 'info@petrofleetenergy.example',
        });
        expect(r.ok).toBe(true);
        expect(inserted).toMatchObject({
            contact_blocked: true,
            contact_blocked_reason: 'manager sous sanctions : Petrofleet Shipping (arm-012)',
        });
    });

    it('refuse un rôle insuffisant', async () => {
        mockFrom.mockImplementation(() => ({
            select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'SHIPPING_AGENT' }, error: null }) }) }),
        }));
        expect(await createManualCandidate(VALID)).toEqual({ ok: false, reason: 'insufficient role' });
    });
});
```

- [ ] **Step 2 : lancer le test et vérifier qu’il échoue**

Run: `cd frontend && npm run test -- src/actions/createManualCandidate.test.ts`
Attendu : FAIL — module introuvable.

- [ ] **Step 3 : écrire l’implémentation**

```ts
// frontend/src/actions/createManualCandidate.ts
'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { isValidImo } from '@/services/vesselIdentity/imo';
import { CATEGORY_BY_TYPENAME } from '@/services/vesselIdentity/vesselFinderParser';
import {
    flagSanctionedCandidates,
    loadSanctionedEntities,
} from '@/services/vesselIdentity/vesselIdentityService';

const schema = z.object({
    imoNumber: z.string(),
    vesselName: z.string().min(1),
    mmsi: z.string().nullable().optional(),
    callSign: z.string().nullable().optional(),
    flagCode: z.string().length(2),
    typeRaw: z.string().min(1),
    grossTonnage: z.number().int().nonnegative().nullable().optional(),
    deadweight: z.number().int().nonnegative().nullable().optional(),
    buildYear: z.number().int().nullable().optional(),
    managerName: z.string().nullable().optional(),
    managerEmail: z.string().nullable().optional(),
    ownerName: z.string().nullable().optional(),
    ownerEmail: z.string().nullable().optional(),
    ismManagerName: z.string().nullable().optional(),
    ismManagerEmail: z.string().nullable().optional(),
});

const ALLOWED_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

export type CreateManualCandidateResult =
    | { ok: true; candidateId: string }
    | { ok: false; reason: string };

/**
 * Saisie unitaire d'un candidat, pour les navires absents de l'export d'escales.
 * Les mêmes contrôles que l'import s'appliquent — en particulier la somme de
 * contrôle IMO, qui est ici la seule protection contre une faute de frappe sur
 * l'identifiant fiscal du navire.
 */
export async function createManualCandidate(raw: unknown): Promise<CreateManualCandidateResult> {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }
    const input = parsed.data;

    if (!isValidImo(input.imoNumber)) {
        return { ok: false, reason: 'somme de contrôle IMO invalide' };
    }
    const category = CATEGORY_BY_TYPENAME[input.typeRaw];
    if (!category) {
        return { ok: false, reason: `type de navire inconnu : ${input.typeRaw}` };
    }
    if (!/^[A-Z]{2}$/.test(input.flagCode)) {
        return { ok: false, reason: `pavillon non ISO-2 : ${input.flagCode}` };
    }

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', auth.user.id).single();
    if (!profile || !ALLOWED_ROLES.includes(String(profile.role))) {
        return { ok: false, reason: 'insufficient role' };
    }

    let admin;
    try {
        admin = createPlatformClient();
    } catch {
        return { ok: false, reason: 'service role not configured' };
    }

    const sanctioned = await loadSanctionedEntities(admin);
    const [flagged] = flagSanctionedCandidates(
        [{
            imoNumber: input.imoNumber,
            mmsi: input.mmsi ?? null,
            callSign: input.callSign ?? null,
            vesselName: input.vesselName,
            flagCode: input.flagCode,
            typeRaw: input.typeRaw,
            category,
            grossTonnage: input.grossTonnage ?? null,
            deadweight: input.deadweight ?? null,
            buildYear: input.buildYear ?? null,
            managerName: input.managerName ?? null,
            managerCountry: null,
            managerEmail: input.managerEmail ?? null,
            ownerName: input.ownerName ?? null,
            ownerCountry: null,
            ownerEmail: input.ownerEmail ?? null,
            ismManagerName: input.ismManagerName ?? null,
            ismManagerEmail: input.ismManagerEmail ?? null,
            lastSeenAt: '',
        }],
        sanctioned,
    );

    const { data, error } = await admin
        .from('vessel_identity_candidates')
        .insert({
            batch_label: `saisie-manuelle-${input.imoNumber}`,
            source: 'MANUAL',
            imo_number: flagged.imoNumber,
            mmsi: flagged.mmsi,
            call_sign: flagged.callSign,
            vessel_name: flagged.vesselName,
            flag_code: flagged.flagCode,
            type_raw: flagged.typeRaw,
            category: flagged.category,
            gross_tonnage: flagged.grossTonnage,
            deadweight: flagged.deadweight,
            build_year: flagged.buildYear,
            manager_name: flagged.managerName,
            manager_email: flagged.managerEmail,
            owner_name: flagged.ownerName,
            owner_email: flagged.ownerEmail,
            ism_manager_name: flagged.ismManagerName,
            ism_manager_email: flagged.ismManagerEmail,
            contact_blocked: flagged.contactBlocked,
            contact_blocked_reason: flagged.contactBlockedReason,
            status: 'PENDING',
            imported_by: auth.user.id,
        })
        .select('id')
        .single();
    if (error || !data) return { ok: false, reason: error?.message ?? 'insert failed' };

    return { ok: true, candidateId: String(data.id) };
}
```

Cette action consomme `CATEGORY_BY_TYPENAME`, qui doit donc être **exporté** depuis
`vesselFinderParser.ts` (ajouter `export` devant la déclaration `const CATEGORY_BY_TYPENAME`).
Le module n'est pas un `'use server'`, l'export d'une constante y est licite.

- [ ] **Step 4 : lancer le test et vérifier qu’il passe**

Run: `cd frontend && npm run test -- src/actions/createManualCandidate.test.ts`
Attendu : PASS, 5 tests.

- [ ] **Step 5 : brancher le formulaire dans le panneau**

Ajouter dans `VesselIdentityPanel.tsx` un bloc dépliable « Saisie manuelle » sous la zone de
dépôt, avec les champs `imoNumber`, `vesselName`, `mmsi`, `callSign`, `flagCode`, `typeRaw`
(liste déroulante alimentée par les clés de `CATEGORY_BY_TYPENAME`), `grossTonnage`,
`deadweight`, `buildYear`, `managerName`, `managerEmail`. À la soumission, appeler
`createManualCandidate` et recharger. Ajouter les clés i18n correspondantes sur les six locales :
`manualTitle`, `manualSubmit`, `manualImo`, `manualName`, `manualFlag`, `manualType`,
`manualManager`, `manualManagerEmail`.

- [ ] **Step 6 : vérifier l’ensemble**

```bash
cd frontend && npm run lint && npm run test && npm run build
```

- [ ] **Step 7 : commit**

```bash
git add frontend/src/actions/createManualCandidate.ts frontend/src/actions/createManualCandidate.test.ts frontend/src/services/vesselIdentity/vesselFinderParser.ts frontend/src/app/\(dashboard\)/admin/vessel-identity/VesselIdentityPanel.tsx frontend/messages
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(vessel-identity): saisie unitaire d'un candidat"
```

---

## Bascule

Après merge, dans cet ordre :

1. Appliquer les migrations sur l’hébergé :
   `supabase db push --db-url "postgresql://postgres:<SUPABASE_DB_PASSWORD>@db.<ref>.supabase.co:5432/postgres"`
   (115 puis 116, après les 113/114 du rail PayPal).
2. Déposer l’export d’escales via `/admin/vessel-identity` et vérifier le compte rendu :
   sur l’export de référence, 86 navires retenus et 13 lignes rejetées pour `IMO absent ou nul`.
3. Vérifier que MAYAR, HAJH GHSN J, LILY J et MT SAHIL ressortent en **contact bloqué**.
4. Apparier en priorité les navires de `arm-014` (83 pro-formas, 1 625 990,91 USD).

## Ce que ce plan ne fait pas

- Aucune création d’`arrival_alerts` ni de pro-forma depuis les escales (décision D5).
- Aucune réémission des 73 pro-formas à IMO synthétique (décision D6, chantier distinct :
  `transactions.vessel_imo` est gelé par la migration 089).
- Aucun écran de fusion de doublons : le conflit est détecté et bloqué, pas résolu.
- Aucune correction de la clé d’upsert AIS (`onConflict: 'mmsi'`), dette consignée au §9 de la spec.
