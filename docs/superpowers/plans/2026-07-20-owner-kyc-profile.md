# Owner — Profil & KYC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une page owner `/owner/profile` (consulter/éditer KYC-B & KYC-C + statut), un schéma Zod KYC partagé client/serveur, l'upload d'une pièce bancaire au KYC-C, et le polissage du wizard KYC-C — en extension de l'existant.

**Architecture:** Un schéma Zod partagé (`lib/kyc/kycSchema.ts`) devient la source de vérité pour `submitKycC`, le wizard et une nouvelle action d'édition. Un service `ownerKycService` lit le profil (IBAN masqué **côté serveur**). Une migration additive ajoute la pièce bancaire KYC-C. La page `/owner/profile` et un composant statut consomment le tout.

**Tech Stack:** Next.js 16 App Router, React 19, TS strict, Zod 4, Supabase (`@supabase/ssr` + storage bucket `shipowner-kyc`), next-intl (6 locales), Vitest, design system `Os*`.

## Global Constraints

- TypeScript **strict, jamais `any`**.
- Validation **Zod** de tout input externe, via le **schéma partagé** `frontend/src/lib/kyc/kycSchema.ts` (client + serveur).
- Composants **`Os*` uniquement** : `OsInput({label,error,hint,...})`, `OsSelect({label,error,placeholder,options:{value,label}[]})`, `OsButton({variant,size,loading,disabled,children})`, `OsCard`.
- **IBAN jamais en clair** : masqué **côté serveur** via `maskIban(await decryptIban(...))` (réutiliser `maskIban` de `armateurService`, `decryptIban`/`encryptIban` de `kycService`). Le DTO renvoyé au client n'a **pas** de champ `iban` brut. Jamais ré-affiché, même au propriétaire.
- Migration ADDITIVE `098`, `ADD COLUMN IF NOT EXISTS`, `-- DOWN:` final.
- Upload de pièce : bucket **`shipowner-kyc`** (patron existant `RegisterForm.tsx` : `supabase.storage.from('shipowner-kyc').upload(path, file)`), signed URL via `GET /api/admin/kyc-doc?path=…`.
- `requireOwner()` → `{ userId, shipowner, jurisdictionId }` ; écritures scoping `createTenantClient(jurisdictionId)` + `.eq('id', session.shipowner.id)` (patron `submitKycC`).
- Commits : auteur `Loïc Leclerc <leclerc@drwintech.com>`, messages humanisés, **jamais** de trailer IA, staging explicite. Branche `feat/owner-kyc-profile` (base `develop`), PR vers `develop`.

---

### Task 1: Migration — pièce bancaire KYC-C

**Files:**
- Create: `supabase/migrations/098_shipowner_billing_proof.sql`

**Interfaces:**
- Produces: colonnes `shipowners.billing_proof_doc_url text NULL`, `shipowners.billing_proof_doc_type text NULL`.

- [ ] **Step 1: Écrire la migration**

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 098: pièce justificative bancaire KYC-C
-- Ajoute à shipowners le document justificatif de l'étape bancaire (KYC-C),
-- distinct du proof_doc_* du KYC-B (identité, inscription). ADDITIVE.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.shipowners ADD COLUMN IF NOT EXISTS billing_proof_doc_url  text;
ALTER TABLE public.shipowners ADD COLUMN IF NOT EXISTS billing_proof_doc_type text;

COMMENT ON COLUMN public.shipowners.billing_proof_doc_url  IS 'Chemin storage (bucket shipowner-kyc) de la pièce bancaire KYC-C (ex. RIB/attestation).';
COMMENT ON COLUMN public.shipowners.billing_proof_doc_type IS 'Type de la pièce bancaire KYC-C.';

-- DOWN:
-- ALTER TABLE public.shipowners DROP COLUMN IF EXISTS billing_proof_doc_url;
-- ALTER TABLE public.shipowners DROP COLUMN IF EXISTS billing_proof_doc_type;
```

- [ ] **Step 2: Vérifier**

Run: `grep -c "IF NOT EXISTS" supabase/migrations/098_shipowner_billing_proof.sql`
Expected: `2`. Vérifier `-- DOWN:` présent.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/098_shipowner_billing_proof.sql
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(db): pièce justificative bancaire KYC-C sur shipowners"
```

---

### Task 2: Schéma Zod partagé + refactor `submitKycC`

**Files:**
- Create: `frontend/src/lib/kyc/kycSchema.ts`
- Create: `frontend/src/lib/kyc/kycSchema.test.ts`
- Modify: `frontend/src/actions/submitKycC.ts`

**Interfaces:**
- Produces: `kycCSchema` (ZodObject), `type KycCInput = z.infer<typeof kycCSchema>`, `kycBEditableSchema`, `type KycBEditableInput`, `ALLOWED_DOC_TYPES`, `ALLOWED_LANGS`.
- Consumes (submitKycC): `kycCSchema`.

- [ ] **Step 1: Écrire les tests (échouants)**

Créer `frontend/src/lib/kyc/kycSchema.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { kycCSchema, kycBEditableSchema } from './kycSchema';

describe('kycCSchema', () => {
    const valid = {
        billing_legal_name: 'Acme Shipping Ltd',
        billing_address_line1: '1 Harbour Rd',
        billing_city: 'Hargeisa',
        billing_postal_code: '00000',
        billing_country_code: 'SO',
        iban: 'SO21000000000000000001',
        swift_bic: 'ABCDSOSX',
        bank_name: 'Bank of Somaliland',
        cgv_accepted: true,
    };
    it('accepte un cas valide', () => {
        expect(kycCSchema.safeParse(valid).success).toBe(true);
    });
    it('rejette un IBAN malformé', () => {
        expect(kycCSchema.safeParse({ ...valid, iban: 'abc' }).success).toBe(false);
    });
    it('rejette un SWIFT malformé', () => {
        expect(kycCSchema.safeParse({ ...valid, swift_bic: 'x' }).success).toBe(false);
    });
    it('exige cgv_accepted = true', () => {
        expect(kycCSchema.safeParse({ ...valid, cgv_accepted: false }).success).toBe(false);
    });
    it('exige un country_code de 2 lettres', () => {
        expect(kycCSchema.safeParse({ ...valid, billing_country_code: 'SOM' }).success).toBe(false);
    });
});

describe('kycBEditableSchema', () => {
    it('accepte une édition partielle valide', () => {
        expect(kycBEditableSchema.safeParse({ address: '2 Port Ave', preferred_language: 'en' }).success).toBe(true);
    });
    it('rejette un imo_company_no non 7-chiffres', () => {
        expect(kycBEditableSchema.safeParse({ imo_company_no: '123' }).success).toBe(false);
    });
    it('rejette une langue inconnue', () => {
        expect(kycBEditableSchema.safeParse({ preferred_language: 'zz' }).success).toBe(false);
    });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd frontend && npx vitest run src/lib/kyc/kycSchema.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter le schéma partagé**

Créer `frontend/src/lib/kyc/kycSchema.ts` :

```ts
import { z } from 'zod';

export const ALLOWED_DOC_TYPES = ['CERTIFICATE_OF_INCORPORATION', 'BANK_STATEMENT', 'RIB', 'OTHER'] as const;
export const ALLOWED_LANGS = ['en', 'fr', 'so', 'pt', 'ar', 'sw'] as const;

export const kycCSchema = z.object({
    billing_legal_name: z.string().min(2).max(200),
    billing_address_line1: z.string().min(2).max(200),
    billing_address_line2: z.string().max(200).optional(),
    billing_city: z.string().min(2).max(100),
    billing_postal_code: z.string().min(2).max(20),
    billing_country_code: z.string().length(2),
    vat_number: z.string().max(50).optional(),
    iban: z.string().regex(/^[A-Z0-9]{15,34}$/),
    swift_bic: z.string().regex(/^[A-Z0-9]{8,11}$/),
    bank_name: z.string().min(2).max(200),
    cgv_accepted: z.literal(true),
    billing_proof_doc_storage_path: z.string().min(1).optional(),
    billing_proof_doc_type: z.enum(ALLOWED_DOC_TYPES).optional(),
});
export type KycCInput = z.infer<typeof kycCSchema>;

export const kycBEditableSchema = z.object({
    imo_company_no: z.string().regex(/^\d{7}$/).optional(),
    aoc_number: z.string().min(1).max(50).optional(),
    address: z.string().min(5).max(500).optional(),
    phone_e164: z.string().regex(/^\+\d{8,15}$/).optional(),
    preferred_language: z.enum(ALLOWED_LANGS).optional(),
    ops_email: z.string().email().max(254).optional(),
    finance_email: z.string().email().max(254).optional(),
});
export type KycBEditableInput = z.infer<typeof kycBEditableSchema>;
```

- [ ] **Step 4: Refactor `submitKycC.ts`**

Dans `frontend/src/actions/submitKycC.ts` : supprimer le `const schema = z.object({...})` inline et importer `import { kycCSchema } from '@/lib/kyc/kycSchema';` ; remplacer `schema.parse` par `kycCSchema.parse`. Dans l'`update` shipowners, persister aussi (si fournis) `billing_proof_doc_url: data.billing_proof_doc_storage_path ?? null` et `billing_proof_doc_type: data.billing_proof_doc_type ?? null`. Le reste inchangé.

- [ ] **Step 5: Lancer → succès + non-régression**

Run: `cd frontend && npx vitest run src/lib/kyc/kycSchema.test.ts && npx tsc --noEmit && npx eslint src/lib/kyc/kycSchema.ts src/actions/submitKycC.ts`
Expected: tests PASS, tsc/eslint propres.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/kyc/kycSchema.ts frontend/src/lib/kyc/kycSchema.test.ts frontend/src/actions/submitKycC.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(kyc): schéma Zod KYC partagé client/serveur + pièce bancaire dans submitKycC"
```

---

### Task 3: Service `ownerKycService.getOwnerKycProfile`

**Files:**
- Create: `frontend/src/services/ownerKycService.ts`
- Create: `frontend/src/services/ownerKycService.test.ts`

**Interfaces:**
- Consumes: `decryptIban` (`./kycService`), `maskIban` (`./armateurService`).
- Produces: `type OwnerKycProfile`, `getOwnerKycProfile(db, shipownerId): Promise<OwnerKycProfile | null>`.

- [ ] **Step 1: Écrire les tests (échouants)**

Créer `frontend/src/services/ownerKycService.test.ts` :

```ts
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('./kycService', () => ({ decryptIban: vi.fn(async (s: string) => (s === 'ENC' ? 'SO21000000000000000001' : s)) }));

function db(row: Record<string, unknown> | null) {
    const chain: Record<string, unknown> = {
        select: vi.fn(() => chain), eq: vi.fn(() => chain),
        maybeSingle: vi.fn(() => Promise.resolve({ data: row, error: null })),
    };
    return { from: vi.fn(() => chain) } as unknown as SupabaseClient;
}

describe('getOwnerKycProfile', () => {
    it('masque l’IBAN côté serveur et dérive bDone/cDone', async () => {
        const { getOwnerKycProfile } = await import('./ownerKycService');
        const p = await getOwnerKycProfile(db({
            id: 's1', name: 'Acme', imo_company_no: '1234567', aoc_number: null, country_code: 'SO',
            address: 'x', ops_email: null, finance_email: null, phone_e164: null, preferred_language: 'en',
            proof_doc_url: null, proof_doc_type: null,
            billing_legal_name: 'Acme', billing_address_line1: '1', billing_address_line2: null,
            billing_city: 'H', billing_postal_code: '0', billing_country_code: 'SO', vat_number: null,
            iban: 'ENC', swift_bic: 'ABCDSOSX', bank_name: 'B', billing_proof_doc_url: null, billing_proof_doc_type: null,
            kyc_level_b_completed_at: '2026-01-01', kyc_level_c_completed_at: null, imo_company_no_verified_at: '2026-01-01',
        }), 's1');
        expect(p?.iban_masked).toBe('•••• 0001');
        expect(p && 'iban' in p).toBe(false);
        expect(p?.bDone).toBe(true);
        expect(p?.cDone).toBe(false);
    });
    it('renvoie null si introuvable', async () => {
        const { getOwnerKycProfile } = await import('./ownerKycService');
        expect(await getOwnerKycProfile(db(null), 'x')).toBeNull();
    });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd frontend && npx vitest run src/services/ownerKycService.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Créer `frontend/src/services/ownerKycService.ts` :

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptIban } from './kycService';
import { maskIban } from './armateurService';

export interface OwnerKycProfile {
    id: string;
    name: string;
    imo_company_no: string | null;
    aoc_number: string | null;
    country_code: string | null;
    address: string | null;
    ops_email: string | null;
    finance_email: string | null;
    phone_e164: string | null;
    preferred_language: string | null;
    proof_doc_url: string | null;
    proof_doc_type: string | null;
    billing_legal_name: string | null;
    billing_address_line1: string | null;
    billing_address_line2: string | null;
    billing_city: string | null;
    billing_postal_code: string | null;
    billing_country_code: string | null;
    vat_number: string | null;
    iban_masked: string | null;
    swift_bic: string | null;
    bank_name: string | null;
    billing_proof_doc_url: string | null;
    billing_proof_doc_type: string | null;
    kyc_level_b_completed_at: string | null;
    kyc_level_c_completed_at: string | null;
    imo_company_no_verified_at: string | null;
    bDone: boolean;
    cDone: boolean;
}

export async function getOwnerKycProfile(
    db: SupabaseClient,
    shipownerId: string,
): Promise<OwnerKycProfile | null> {
    const { data } = await db.from('shipowners').select('*').eq('id', shipownerId).maybeSingle();
    if (!data) return null;
    const row = data as Record<string, unknown>;
    const str = (k: string) => (row[k] as string | null) ?? null;

    let iban_masked: string | null = null;
    if (typeof row.iban === 'string' && row.iban) {
        try { iban_masked = maskIban(await decryptIban(row.iban)); } catch { iban_masked = null; }
    }

    return {
        id: row.id as string,
        name: row.name as string,
        imo_company_no: str('imo_company_no'),
        aoc_number: str('aoc_number'),
        country_code: str('country_code'),
        address: str('address'),
        ops_email: str('ops_email'),
        finance_email: str('finance_email'),
        phone_e164: str('phone_e164'),
        preferred_language: str('preferred_language'),
        proof_doc_url: str('proof_doc_url'),
        proof_doc_type: str('proof_doc_type'),
        billing_legal_name: str('billing_legal_name'),
        billing_address_line1: str('billing_address_line1'),
        billing_address_line2: str('billing_address_line2'),
        billing_city: str('billing_city'),
        billing_postal_code: str('billing_postal_code'),
        billing_country_code: str('billing_country_code'),
        vat_number: str('vat_number'),
        iban_masked,
        swift_bic: str('swift_bic'),
        bank_name: str('bank_name'),
        billing_proof_doc_url: str('billing_proof_doc_url'),
        billing_proof_doc_type: str('billing_proof_doc_type'),
        kyc_level_b_completed_at: str('kyc_level_b_completed_at'),
        kyc_level_c_completed_at: str('kyc_level_c_completed_at'),
        imo_company_no_verified_at: str('imo_company_no_verified_at'),
        bDone: !!row.kyc_level_b_completed_at,
        cDone: !!row.kyc_level_c_completed_at,
    };
}
```

- [ ] **Step 4: Lancer → succès**

Run: `cd frontend && npx vitest run src/services/ownerKycService.test.ts && npx tsc --noEmit && npx eslint src/services/ownerKycService.ts`
Expected: PASS + propre.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/ownerKycService.ts frontend/src/services/ownerKycService.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(kyc): ownerKycService.getOwnerKycProfile (IBAN masqué serveur)"
```

---

### Task 4: Action `updateOwnerKycProfile`

**Files:**
- Create: `frontend/src/actions/updateOwnerKycProfile.ts`
- Create: `frontend/src/actions/updateOwnerKycProfile.test.ts`

**Interfaces:**
- Consumes: `requireOwner`, `kycBEditableSchema`/`kycCSchema` (partiel), `encryptIban`, `createTenantClient`.
- Produces: `updateOwnerKycProfile(input): Promise<{ ok: true }>`.

- [ ] **Step 1: Écrire le test (échouant)**

Créer `frontend/src/actions/updateOwnerKycProfile.test.ts` (mock `requireOwner`, `createTenantClient`, `encryptIban`) :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateSpy = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }));
const insertSpy = vi.fn(() => Promise.resolve({ error: null }));
vi.mock('@/lib/auth/requireOwner', () => ({
    requireOwner: vi.fn(async () => ({ userId: 'u1', jurisdictionId: 'j1', shipowner: { id: 's1', name: 'Acme', imo_company_no: '1234567' } })),
}));
vi.mock('@/lib/supabase/tenant', () => ({
    createTenantClient: vi.fn(() => ({ from: vi.fn((t: string) => (t === 'audit_logs' ? { insert: insertSpy } : { update: updateSpy })) })),
}));
vi.mock('@/services/kycService', () => ({ encryptIban: vi.fn(async () => 'ENC'), isInsecureStrategy: () => false }));

beforeEach(() => { updateSpy.mockClear(); insertSpy.mockClear(); });

describe('updateOwnerKycProfile', () => {
    it('remet kyc_level_b_completed_at à null si imo_company_no change', async () => {
        const { updateOwnerKycProfile } = await import('./updateOwnerKycProfile');
        await updateOwnerKycProfile({ identity: { imo_company_no: '7654321' } });
        const patch = updateSpy.mock.calls[0][0];
        expect(patch.imo_company_no).toBe('7654321');
        expect(patch.kyc_level_b_completed_at).toBeNull();
        expect(patch.imo_company_no_verified_at).toBeNull();
    });
    it('chiffre l’IBAN si fourni et ne le fait pas si vide', async () => {
        const { updateOwnerKycProfile } = await import('./updateOwnerKycProfile');
        await updateOwnerKycProfile({ billing: { iban: 'SO21000000000000000001' } });
        expect(updateSpy.mock.calls[0][0].iban).toBe('ENC');
        updateSpy.mockClear();
        await updateOwnerKycProfile({ billing: {} });
        expect('iban' in updateSpy.mock.calls[0][0]).toBe(false);
    });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd frontend && npx vitest run src/actions/updateOwnerKycProfile.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Créer `frontend/src/actions/updateOwnerKycProfile.ts` :

```ts
'use server';

import { z } from 'zod';
import { requireOwner } from '@/lib/auth/requireOwner';
import { encryptIban } from '@/services/kycService';
import { createTenantClient } from '@/lib/supabase/tenant';
import { kycBEditableSchema, ALLOWED_DOC_TYPES } from '@/lib/kyc/kycSchema';

// Édition partielle : identité (KYC-B éditable) et/ou billing/banque (KYC-C).
const billingEditSchema = z.object({
    billing_legal_name: z.string().min(2).max(200).optional(),
    billing_address_line1: z.string().min(2).max(200).optional(),
    billing_address_line2: z.string().max(200).optional(),
    billing_city: z.string().min(2).max(100).optional(),
    billing_postal_code: z.string().min(2).max(20).optional(),
    billing_country_code: z.string().length(2).optional(),
    vat_number: z.string().max(50).optional(),
    iban: z.string().regex(/^[A-Z0-9]{15,34}$/).optional(),
    swift_bic: z.string().regex(/^[A-Z0-9]{8,11}$/).optional(),
    bank_name: z.string().min(2).max(200).optional(),
    billing_proof_doc_storage_path: z.string().min(1).optional(),
    billing_proof_doc_type: z.enum(ALLOWED_DOC_TYPES).optional(),
});

const inputSchema = z.object({
    identity: kycBEditableSchema.optional(),
    billing: billingEditSchema.optional(),
});

export async function updateOwnerKycProfile(input: z.infer<typeof inputSchema>): Promise<{ ok: true }> {
    const session = await requireOwner();
    const data = inputSchema.parse(input);
    const admin = createTenantClient(session.jurisdictionId);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const changed: string[] = [];

    if (data.identity) {
        const id = data.identity;
        for (const k of ['address', 'phone_e164', 'preferred_language', 'ops_email', 'finance_email'] as const) {
            if (id[k] !== undefined) { patch[k] = id[k]; changed.push(k); }
        }
        // imo_company_no / aoc_number : modification ⇒ re-vérification (reset des flags B).
        const idChangesVerification =
            (id.imo_company_no !== undefined && id.imo_company_no !== session.shipowner.imo_company_no) ||
            id.aoc_number !== undefined;
        if (id.imo_company_no !== undefined) { patch.imo_company_no = id.imo_company_no; changed.push('imo_company_no'); }
        if (id.aoc_number !== undefined) { patch.aoc_number = id.aoc_number; changed.push('aoc_number'); }
        if (idChangesVerification) {
            patch.kyc_level_b_completed_at = null;
            patch.imo_company_no_verified_at = null;
            changed.push('kyc_b_reverification');
        }
    }

    if (data.billing) {
        const b = data.billing;
        for (const k of ['billing_legal_name', 'billing_address_line1', 'billing_address_line2', 'billing_city',
            'billing_postal_code', 'billing_country_code', 'vat_number', 'swift_bic', 'bank_name'] as const) {
            if (b[k] !== undefined) { patch[k] = b[k]; changed.push(k); }
        }
        if (b.billing_proof_doc_storage_path !== undefined) { patch.billing_proof_doc_url = b.billing_proof_doc_storage_path; changed.push('billing_proof'); }
        if (b.billing_proof_doc_type !== undefined) patch.billing_proof_doc_type = b.billing_proof_doc_type;
        if (b.iban !== undefined && b.iban) { patch.iban = await encryptIban(b.iban); changed.push('iban'); }
    }

    const { error } = await admin.from('shipowners').update(patch).eq('id', session.shipowner.id);
    if (error) throw error;

    const { error: auditError } = await admin.from('audit_logs').insert({
        user_id: session.userId,
        user_full_name: session.shipowner.name,
        action: 'TRANSACTION_UPDATED',
        severity: 'INFO',
        entity_type: 'Shipowner',
        entity_id: session.shipowner.id,
        details_json: { event: 'SHIPOWNER_KYC_UPDATED', changed_fields: changed },
    });
    if (auditError) throw auditError;

    return { ok: true };
}
```

- [ ] **Step 4: Lancer → succès**

Run: `cd frontend && npx vitest run src/actions/updateOwnerKycProfile.test.ts && npx tsc --noEmit && npx eslint src/actions/updateOwnerKycProfile.ts`
Expected: PASS + propre.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/actions/updateOwnerKycProfile.ts frontend/src/actions/updateOwnerKycProfile.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(kyc): action updateOwnerKycProfile (re-vérif KYC-B, IBAN re-chiffré)"
```

---

### Task 5: Composant `KycStatus`

**Files:**
- Create: `frontend/src/components/owner/KycStatus.tsx`
- Create: `frontend/src/components/owner/KycStatus.test.tsx`

**Interfaces:**
- Produces: `KycStatus({ bDone, cDone, bPendingReverif }: { bDone: boolean; cDone: boolean; bPendingReverif?: boolean })`.

- [ ] **Step 1: Écrire le test (échouant)**

Créer `frontend/src/components/owner/KycStatus.test.tsx` :

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KycStatus } from './KycStatus';

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

describe('KycStatus', () => {
    it('montre le CTA billing quand C manque', () => {
        render(<KycStatus bDone={true} cDone={false} />);
        expect(screen.getByRole('link')).toHaveAttribute('href', '/owner/onboarding/billing');
    });
    it('ne montre pas de CTA quand tout est complet', () => {
        render(<KycStatus bDone={true} cDone={true} />);
        expect(screen.queryByRole('link')).toBeNull();
    });
});
```

- [ ] **Step 2: Lancer → échec**

Run: `cd frontend && npx vitest run src/components/owner/KycStatus.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Créer `frontend/src/components/owner/KycStatus.tsx` :

```tsx
'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { OsBadge } from '@/components/ui/OsBadge';

interface Props { bDone: boolean; cDone: boolean; bPendingReverif?: boolean }

export function KycStatus({ bDone, cDone, bPendingReverif = false }: Props) {
    const t = useTranslations('OwnerProfile.status');
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
                <OsBadge variant={bDone ? 'active' : 'warning'} label={`KYC-B: ${bDone ? t('done') : t('pending')}`} />
                <OsBadge variant={cDone ? 'active' : 'warning'} label={`KYC-C: ${cDone ? t('done') : t('pending')}`} />
            </div>
            {bPendingReverif && <p className="text-sm text-[#F59E0B]">{t('reverifNotice')}</p>}
            {!cDone && (
                <Link href="/owner/onboarding/billing" className="text-sm text-emerald-400 hover:underline">
                    {t('completeBilling')}
                </Link>
            )}
        </div>
    );
}
```

- [ ] **Step 4: Lancer → succès**

Run: `cd frontend && npx vitest run src/components/owner/KycStatus.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/owner/KycStatus.tsx frontend/src/components/owner/KycStatus.test.tsx
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(kyc): composant KycStatus (statut B/C + CTA)"
```

---

### Task 6: Page `/owner/profile`

**Files:**
- Create: `frontend/src/app/owner/profile/page.tsx`
- Create: `frontend/src/app/owner/profile/OwnerProfile.tsx`

**Interfaces:**
- Consumes: `requireOwner`, `getOwnerKycProfile`, `OwnerKycProfile`, `updateOwnerKycProfile`, `KycStatus`, composants Os*, `kycBEditableSchema`/schéma billing pour validation client.

- [ ] **Step 1: Écrire `page.tsx`**

```tsx
import { redirect } from 'next/navigation';
import { requireOwner } from '@/lib/auth/requireOwner';
import { createClient } from '@/lib/supabase/server';
import { getOwnerKycProfile } from '@/services/ownerKycService';
import { OwnerProfile } from './OwnerProfile';

export const dynamic = 'force-dynamic';

export default async function OwnerProfilePage() {
    const session = await requireOwner();
    const supabase = await createClient();
    const profile = await getOwnerKycProfile(supabase, session.shipowner.id);
    if (!profile) redirect('/owner/login');
    return <OwnerProfile profile={profile} />;
}
```

- [ ] **Step 2: Écrire `OwnerProfile.tsx`**

Client component (`'use client'`), `useTranslations('OwnerProfile')`, `useRouter`. Structure en `OsCard` :
- **Identité (KYC-B)** : `OsInput` pour `imo_company_no` (avec `hint` = avertissement re-vérif via `t('identity.reverifWarning')`), `aoc_number`, `address`, `phone_e164`, `OsSelect` `preferred_language` (options en/fr/so/pt/ar/sw), `ops_email`, `finance_email`. Bouton `OsButton` « Enregistrer » → validation client (schéma identité importé de `@/lib/kyc/kycSchema` — construire un objet `identity` avec les champs modifiés) → `await updateOwnerKycProfile({ identity })` → `router.refresh()`. Erreurs par champ via prop `error` d'`OsInput`.
- **Facturation & banque (KYC-C)** : `OsInput` billing_* + `vat_number` ; ligne « IBAN actuel » affichant `profile.iban_masked ?? t('billing.noIban')` (lecture) + `OsInput` « Nouvel IBAN (laisser vide pour conserver) » ; `swift_bic` ; `bank_name`. Bouton Enregistrer → construire `billing` (n'inclure `iban` que si le champ nouvel-IBAN est non vide) → `updateOwnerKycProfile({ billing })` → refresh. Validation client (regex IBAN/SWIFT si fournis).
- **Statut KYC** : `<KycStatus bDone={profile.bDone} cDone={profile.cDone} bPendingReverif={!profile.bDone && !!profile.imo_company_no} />`.
- **Documents** : liens `GET /api/admin/kyc-doc?path=<proof_doc_url>` (proof B) et `<billing_proof_doc_url>` (proof C) si présents (ouvrir dans un onglet).
- **IBAN jamais ré-affiché en clair** : n'afficher que `iban_masked` ; ne jamais mettre `profile.iban` (absent du DTO).
- Aucun `any` ; état local des formulaires typé.

- [ ] **Step 3: tsc + lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint "src/app/owner/profile/page.tsx" "src/app/owner/profile/OwnerProfile.tsx"`
Expected: propre. (Les clés i18n `OwnerProfile.*` sont posées en Task 8 — normal qu'elles manquent.)

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/owner/profile/page.tsx" "frontend/src/app/owner/profile/OwnerProfile.tsx"
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(owner): page /owner/profile (consultation + édition KYC, statut, documents)"
```

---

### Task 7: Wizard KYC-C repoli (Os* + Zod client + upload)

**Files:**
- Modify: `frontend/src/app/owner/onboarding/billing/BillingWizard.tsx`

**Interfaces:**
- Consumes: `kycCSchema` (`@/lib/kyc/kycSchema`), `submitKycC`, composants Os*, `createClient` (`@/lib/supabase/client`) pour l'upload.

**Référence :** patron d'upload de `frontend/src/components/auth/operator-register/RegisterForm.tsx` (`supabase.storage.from('shipowner-kyc').upload(path, file)`).

- [ ] **Step 1: Réécrire le wizard**

Remplacer les `<button className="os-button">`/inputs bruts par `OsButton`/`OsInput`/`OsSelect`. Conserver les 3 étapes existantes + **ajouter une étape 3 « pièce bancaire » (optionnelle)** avant la revue (renuméroter : 1 billing, 2 banque, 3 pièce, 4 revue+CGV — ou intégrer l'upload à l'étape banque). Ajouts :
- **Validation Zod client** : à chaque tentative de passage d'étape, valider le sous-ensemble concerné avec `kycCSchema.pick({...}).safeParse(...)` (billing pour l'étape 1, iban/swift/bank pour l'étape banque) ; stocker les erreurs par champ dans un state `errors: Record<string,string>` et les passer à `OsInput error={errors.iban}`. Boutons gatés sur `safeParse().success`.
- **Upload pièce** : `<input type="file">` → au changement, `const supabase = createClient(); const path = \`kyc-c/${shipownerId}/${Date.now()}-${file.name}\`; await supabase.storage.from('shipowner-kyc').upload(path, file);` puis stocker `billing_proof_doc_storage_path = path` + un `OsSelect` `billing_proof_doc_type` (options `ALLOWED_DOC_TYPES`). En cas d'échec upload : message d'erreur, ne bloque pas le submit (pièce optionnelle).
- Au submit final : `submitKycC({ ...form, cgv_accepted: true, billing_proof_doc_storage_path?, billing_proof_doc_type? })`. Le composant reçoit `shipownerId` en prop (l'ajouter à la signature + le passer depuis la page `billing/page.tsx` — vérifier la page et l'ajouter si besoin).

- [ ] **Step 2: Ajuster `billing/page.tsx` si nécessaire**

Si `BillingWizard` a besoin de `shipownerId`, le fournir depuis `frontend/src/app/owner/onboarding/billing/page.tsx` (via `requireOwner().shipowner.id`). Lire la page d'abord ; adapter la prop.

- [ ] **Step 3: tsc + lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint "src/app/owner/onboarding/billing/BillingWizard.tsx" "src/app/owner/onboarding/billing/page.tsx"`
Expected: propre.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/owner/onboarding/billing/BillingWizard.tsx" "frontend/src/app/owner/onboarding/billing/page.tsx"
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(kyc): wizard KYC-C repoli (Os*, validation Zod client, upload pièce bancaire)"
```

---

### Task 8: i18n `OwnerProfile` (6 locales)

**Files:**
- Modify: `frontend/messages/{en,fr,so,pt,ar,sw}.json`

**Interfaces:**
- Consumes: toutes les clés `t('…')` de `OwnerProfile.*` référencées dans `OwnerProfile.tsx`, `KycStatus.tsx`, et les nouveaux libellés du wizard.

- [ ] **Step 1: Recenser les clés**

Run: `cd frontend && grep -rohE "t\('[^']+'\)" "src/app/owner/profile/OwnerProfile.tsx" "src/components/owner/KycStatus.tsx" | sed -E "s/t\('(.+)'\)/\1/" | sort -u`
+ inclure les clés `OwnerProfile.*` éventuellement ajoutées au wizard.

- [ ] **Step 2: Ajouter le namespace `OwnerProfile` dans en.json**

Objet de premier niveau `"OwnerProfile"` couvrant : `title`, `identity.*` (sectionTitle, imoCompanyNo, aocNumber, address, phone, language, opsEmail, financeEmail, reverifWarning, save), `billing.*` (sectionTitle, legalName, addressLine1, addressLine2, city, postalCode, country, vat, currentIban, noIban, newIbanLabel, swift, bankName, proofDoc, proofType, save), `status.*` (done, pending, reverifNotice, completeBilling), `documents.*` (sectionTitle, proofB, proofC, none), messages d'erreur Zod client (`errors.iban`, `errors.swift`, `errors.required`, …). **Toute clé du grep DOIT exister.**

- [ ] **Step 3: Traduire dans fr, so, pt, ar, sw**

Parité stricte des clés. fr : title "Profil & KYC", identity.sectionTitle "Identité", billing.sectionTitle "Facturation & banque", status.done "Complété", status.pending "En attente", identity.reverifWarning "Modifier ces identifiants relance la vérification.". Traduire les autres locales en cohérence.

- [ ] **Step 4: Valider JSON + parité + couverture**

Run: `cd frontend && for f in en fr so pt ar sw; do node -e "JSON.parse(require('fs').readFileSync('messages/'+'$f'+'.json','utf8'));console.log('$f ok')"; done`
+ script node vérifiant la parité des clés `OwnerProfile` (en vs 5 autres) et que chaque clé du grep (Step 1) existe dans en.json.

- [ ] **Step 5: tsc + suite de tests du sous-projet**

Run: `cd frontend && npx tsc --noEmit && npx vitest run src/lib/kyc/kycSchema.test.ts src/services/ownerKycService.test.ts src/actions/updateOwnerKycProfile.test.ts src/components/owner/KycStatus.test.tsx`
Expected: tout vert.

- [ ] **Step 6: Commit**

```bash
git add frontend/messages/en.json frontend/messages/fr.json frontend/messages/so.json frontend/messages/pt.json frontend/messages/ar.json frontend/messages/sw.json
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(owner): i18n OwnerProfile (6 locales)"
```

---

## Notes finales (revue de branche)

- **IBAN jamais en clair** : `getOwnerKycProfile` masque côté serveur, le DTO n'a pas de champ `iban` brut, la page n'affiche que `iban_masked` ; pour changer, l'owner ressaisit un IBAN complet (Task 6/7).
- **Re-vérification KYC-B** : `updateOwnerKycProfile` remet `kyc_level_b_completed_at`/`imo_company_no_verified_at` à NULL si `imo_company_no`/`aoc_number` changent (Task 4).
- **Schéma partagé** : `kycCSchema` unique pour `submitKycC` + wizard + édition (Task 2) — pas de duplication.
- **Migration 098** (097 réservée à l'aviation #95).
- **Storage** : bucket `shipowner-kyc` réutilisé ; signed URLs via la route existante.
- Branche `feat/owner-kyc-profile` depuis `develop`, **PR directe vers `develop`** (pas de stack).
- Test composant : le repo utilise `@testing-library/react` + `vi.mock('next-intl')` (vérifier qu'il est déjà en devDeps ; sinon adapter le test `KycStatus` en test de rendu minimal sans testing-library).
