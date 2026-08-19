# Owner — Profil & KYC (Sprint 2, sous-projet 4)

**Date :** 2026-07-20
**Statut :** Design approuvé — prêt pour writing-plans

## Objectif

Compléter l'expérience KYC **côté owner** : une page `/owner/profile` (Profil & KYC) pour **consulter et éditer** ses données KYC-B (identité société) et KYC-C (facturation/banque), un **statut KYC détaillé**, l'ajout d'une **pièce justificative bancaire** au KYC-C, et le **polissage du wizard KYC-C** (composants `Os*` + validation Zod côté client via un schéma partagé). Extension stricte de l'existant.

Contexte existant (à réutiliser, NE PAS reconstruire) :
- **KYC-B** collecté à l'inscription (`registerShipowner`/`registerAirOperator`) : `imo_company_no`/AOC, pays, adresse, pièce justificative (bucket `shipowner-kyc`, `proof_doc_url`/`proof_doc_type`), `kyc_level_b_completed_at`.
- **KYC-C** via wizard `/owner/onboarding/billing` → `submitKycC` (Zod serveur, IBAN chiffré par `kycService.encryptIban`, `kyc_level_c_completed_at`, audit).
- `kycService` : `encryptIban`/`decryptIban`. `requireOwner()` → `{ userId, shipowner, jurisdictionId }`.

## Décisions de conception (approuvées PO 2026-07-20)

1. **KYC-B éditable avec re-vérification** : l'owner peut modifier `imo_company_no`/`aoc_number` depuis la page profil ; toute modification de ces identifiants **remet `kyc_level_b_completed_at` à NULL** (re-vérification requise) et `imo_company_no_verified_at` à NULL. Les autres champs identité (adresse, phone, langue, emails ops/finance) sont éditables sans reset.
2. **IBAN toujours masqué** pour l'owner : jamais le numéro complet re-affiché, même à son propriétaire (`•••• 1234`). Le chiffré ne quitte jamais le serveur. Pour changer d'IBAN, l'owner ressaisit un IBAN complet.
3. **Branche depuis `develop`, PR directe vers `develop`** (pas de PR stackée — leçon #94).
4. **Migration `098`** (097 réservée à l'aviation #95, non encore sur develop).

## Périmètre

**Inclus :** migration `098` (pièce bancaire KYC-C), schéma Zod partagé, `ownerKycService` (lecture profil), page `/owner/profile` + composants, wizard KYC-C repoli, actions `submitKycC` (étendue) + `updateOwnerKycProfile`, composant statut KYC, i18n, tests.
**Exclus :** refonte du KYC-B d'inscription, re-vérification automatique de l'`imo_company_no` (on remet juste le flag à NULL — la re-vérif reste un process admin existant), workflow d'approbation admin des éditions (audit seulement), toute modification admin-side.

## Architecture & fichiers

### Migration
- `supabase/migrations/098_shipowner_billing_proof.sql` — ADDITIVE :
  - `ALTER TABLE public.shipowners ADD COLUMN IF NOT EXISTS billing_proof_doc_url text;`
  - `ALTER TABLE public.shipowners ADD COLUMN IF NOT EXISTS billing_proof_doc_type text;`
  - Commentaires de colonne. `-- DOWN:` (`DROP COLUMN` des deux).

### Schéma Zod partagé — `frontend/src/lib/kyc/kycSchema.ts`
- `kycCSchema` (billing_legal_name, billing_address_line1/2, billing_city, billing_postal_code, billing_country_code length 2, vat_number optional, iban `^[A-Z0-9]{15,34}$`, swift_bic `^[A-Z0-9]{8,11}$`, bank_name, cgv_accepted `literal(true)`, `billing_proof_doc_storage_path` optional, `billing_proof_doc_type` optional enum) — **importé par `submitKycC` (serveur), le wizard (client) et l'action d'édition**. Source unique.
- `kycBEditableSchema` (identité éditable : address, phone_e164 optional, preferred_language enum, ops_email/finance_email optional email ; + `imo_company_no` `^\d{7}$` optional / `aoc_number` optional) — pour l'édition.
- Aucun `any`.

### Service — `frontend/src/services/ownerKycService.ts`
- `import { decryptIban } from './kycService'; import { maskIban } from './armateurService';` (réutilise le masque existant).
- `type OwnerKycProfile` = identité (name, imo_company_no, aoc_number, country_code, address, ops_email, finance_email, phone_e164, preferred_language, proof_doc_url, proof_doc_type) + billing/banque (billing_legal_name, billing_address_line1/2, billing_city, billing_postal_code, billing_country_code, vat_number, **iban_masked: string | null**, swift_bic, bank_name, billing_proof_doc_url, billing_proof_doc_type) + statut (kyc_level_b_completed_at, kyc_level_c_completed_at, imo_company_no_verified_at, bDone: boolean, cDone: boolean).
- `getOwnerKycProfile(db, shipownerId): Promise<OwnerKycProfile | null>` — lit `shipowners`, calcule `iban_masked` **côté serveur** (`maskIban(await decryptIban(iban))` si iban présent, try/catch → null), n'expose jamais `iban` brut. `bDone = !!kyc_level_b_completed_at`, `cDone = !!kyc_level_c_completed_at`.

### Actions
- `frontend/src/actions/submitKycC.ts` (MODIF) : importer `kycCSchema` du module partagé (retirer le schéma inline dupliqué) ; persister aussi `billing_proof_doc_url`/`billing_proof_doc_type` si fournis. Comportement inchangé sinon.
- `frontend/src/actions/updateOwnerKycProfile.ts` (CRÉÉ) : `requireOwner` ; deux sous-opérations validées Zod (`kycBEditableSchema` + `kycCSchema` partiel selon ce qui est soumis) ; si `imo_company_no`/`aoc_number` changent vs la valeur actuelle → set `kyc_level_b_completed_at = null`, `imo_company_no_verified_at = null` ; si `iban` fourni (non vide) → `encryptIban` et update, sinon conserver l'existant ; `updated_at` ; audit log (`SHIPOWNER_KYC_UPDATED`, severity INFO, détail des champs modifiés sans valeurs sensibles). Scope `createTenantClient(jurisdictionId)` + `.eq('id', session.shipowner.id)` (comme `submitKycC`).

### Page owner — `/owner/profile`
- `frontend/src/app/owner/profile/page.tsx` (server) : `requireOwner()` ; `getOwnerKycProfile` ; rend `<OwnerProfile profile={...} />`.
- `frontend/src/app/owner/profile/OwnerProfile.tsx` (client, `Os*`) : sections
  - **Identité (KYC-B)** : name (lecture), `imo_company_no`/`aoc_number` **éditables** (avec avertissement « toute modification relance la vérification »), adresse/phone/langue/ops_email/finance_email éditables ; bouton Enregistrer → `updateOwnerKycProfile`.
  - **Facturation & banque (KYC-C)** : billing_* + vat + **iban_masked** (lecture ; champ « nouvel IBAN » vide pour remplacement) + swift + bank ; bouton Enregistrer.
  - **Statut KYC** : `<KycStatus/>`.
  - **Documents** : liens signés proof B / proof C (via route API existante de la famille kyc-doc) si présents.
  - Validation Zod côté client (schémas partagés), erreurs par champ, IBAN jamais ré-affiché en clair.

### Wizard KYC-C repoli — `frontend/src/app/owner/onboarding/billing/BillingWizard.tsx` (MODIF)
- Remplacer les `<button className="os-button">`/inputs bruts par `OsButton`/`OsInput`/`OsSelect`.
- **Validation Zod côté client** via `kycCSchema` (par étape : étape 1 billing, étape 2 banque) — boutons Next/Submit gatés sur la validité réelle du sous-ensemble, messages d'erreur par champ.
- **Nouvelle étape upload pièce bancaire** (facultative mais recommandée) : upload vers bucket `shipowner-kyc` via la route API existante (même famille que l'upload KYC-B d'inscription) → `billing_proof_doc_storage_path` passé à `submitKycC`.
- Toujours `submitKycC` au submit final.

### Statut KYC — `frontend/src/components/owner/KycStatus.tsx` (CRÉÉ)
- Props : `{ bDone, cDone, bPendingReverif }`. Affiche B ✓/✗, C ✓/✗, la prochaine action (CTA vers `/owner/onboarding/billing` si C manquant, message de re-vérif si B en attente), dates. Remplace l'usage binaire de `KycCBanner` sur le dashboard owner (garder `KycCBanner` ou le rediriger vers `KycStatus`).

### i18n
- Namespace `OwnerProfile` dans les 6 locales (titres sections, labels champs, statut, actions, messages d'erreur Zod côté client, avertissement re-vérif). Réutiliser `OwnerOnboarding` quand pertinent.

## Tests
- **`kycSchema`** (Vitest, pur) : `kycCSchema` accepte un cas valide, rejette IBAN/SWIFT malformés, cgv≠true, country_code≠2 ; `kycBEditableSchema` valide/invalide.
- **`getOwnerKycProfile`** (mock query builder, patron sous-projet 3) : `iban_masked` = `•••• xxxx` si iban présent, `null` sinon / sans erreur ; `bDone`/`cDone` dérivés.
- **`updateOwnerKycProfile`** (mock) : changement d'`imo_company_no` → `kyc_level_b_completed_at` mis à null ; IBAN fourni → `encryptIban` appelé ; IBAN vide → pas de champ iban dans l'update ; garde `requireOwner`.
- **`KycStatus`** (composant) : rend les bons états B/C et la bonne CTA.
- Couverture > 80 % sur le nouveau code. `tsc --noEmit` + `lint` clean. IBAN jamais en clair côté client (vérifié : le DTO n'a pas de champ `iban` brut).

## Contraintes globales (rappel)
- TypeScript strict, **jamais `any`** (sauf patron `SupabaseClient` si requête sur table hors types générés — ici `shipowners` est typée, donc pas nécessaire).
- Validation **Zod** de tout input externe (schéma partagé client/serveur).
- Composants **`Os*`** uniquement.
- **IBAN jamais en clair** : masqué côté serveur, jamais ré-affiché au client (leçon #92).
- Migration additive `098`, `-- DOWN:` final.
- Commits : auteur `Loïc Leclerc <leclerc@drwintech.com>`, messages humanisés, **jamais** de trailer IA, staging explicite. Branche `feat/owner-kyc-profile` (base `develop`), PR vers `develop`.

## Non-objectifs
- Pas de refonte du parcours d'inscription (KYC-B initial).
- Pas de re-vérification automatique de l'`imo_company_no` (remise à NULL du flag seulement).
- Pas de workflow d'approbation admin des éditions (audit seulement).
- Pas d'affichage de l'IBAN en clair, même au propriétaire.
