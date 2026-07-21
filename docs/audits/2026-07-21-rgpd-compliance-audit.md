# Audit de conformité RGPD — Green-Gate

**Date :** 2026-07-21
**Périmètre :** ensemble du dépôt (frontend Next.js, migrations Supabase, backend Go, sous-traitants). Audit en lecture seule, 5 axes en parallèle : inventaire données/chiffrement, droits des personnes, fuites/minimisation, contrôle d'accès/RLS/rétention, sous-traitants/transferts.
**Statut Sprint 2 :** les 4 sous-projets (armateurs #92, factures #93, aviation #95, owner KYC #97) + hotfix i18n #96 sont mergés sur `develop` et sains (build OK, migrations 095→098). Le travail Sprint 2 lui-même est propre côté données (IBAN masqué serveur, aucune nouvelle fuite) — les constats ci-dessous sont pour l'essentiel **pré-existants**.

---

## 0. Applicabilité RGPD (nuance essentielle)

Le projet cible **Somaliland / Djibouti** (hors UE). Le RGPD ne s'impose **de plein droit** que si (a) des personnes physiques situées dans l'UE sont concernées, ou (b) le responsable/sous-traitant est établi dans l'UE. Ici, l'hébergement est en région EU (Fly `primary_region='ams'`, Supabase probablement EU) mais **l'hébergement seul ne crée pas l'applicabilité**. Deux points nuancent :
- Les sous-traitants techniques (Supabase, Vercel, Resend, Stripe, Sentry) sont eux-mêmes soumis au RGPD.
- Le projet **implémente déjà un cadre RGPD-like** : politique de confidentialité formelle (12 sections, 6 langues, droits Art. 15-21, DPO `dpo@smca.gov.sl`).

**Conclusion :** traiter le RGPD comme un **référentiel cible volontaire** (bonnes pratiques + crédibilité vis-à-vis de clients/partenaires UE), l'obligation stricte relevant du droit local. Les constats ci-dessous valent qu'on vise l'alignement RGPD.

---

## 1. Points CONFORMES (à préserver)

- **Politique de confidentialité** complète et traduite 6 langues (`PrivacyPolicyContent.tsx`), finalités, base légale, conservation par catégorie, droits Art. 15-21, DPO.
- **IBAN masqué côté serveur** (`•••• 1234`) partout dans les cockpits (`getOwnerKycProfile`, `getArmateurDetail`, `getAirlineDetail`), gate `canViewBilling` (SUPERADMIN/FINANCE_ADMIN). Le chiffré ne traverse jamais vers le client.
- **RLS avec scoping juridiction** correct sur `shipowners`, `transactions`, `payments`, `vessels`, `wallets`/`wallet_ledger`/`refunds`, `arrival_alerts` (migs 058/073/087). Owner limité à ses propres lignes.
- **Vues `security_invoker`** (`v_armateur_recouvrement`, `v_invoice_admin`, `v_compagnie_recouvrement`) → héritent des RLS, pas de bypass.
- **`audit_logs` append-only** (trigger mig 018) : même le service-role ne peut UPDATE/DELETE.
- **Révélation d'IBAN** (`revealOwnerRefundIban`) gatée SUPERADMIN/FINANCE_ADMIN, confinée juridiction, auditée, jamais persistée en clair.
- **Sentry** `sendDefaultPii: false`. **En-têtes sécurité** HSTS/CSP/X-Frame-Options + rate-limiting. **Aucun secret en dur**. **`logger.ts`** interdit explicitement le log d'IBAN/emails/JWT.

---

> **Mise à jour post-vérification (2026-07-21) :** après investigation du rayon d'impact, **C1 est un FAUX POSITIF** et **C3a est corrigé**. Voir les notes de statut ci-dessous. C2 a reçu un premier durcissement non bloquant.

## 2. CRITICAL (à corriger en priorité)

### ~~C1 — Bucket `documents` public + lecture anonyme~~ → FAUX POSITIF (résolu depuis mig 017)
L'agent d'audit avait lu `012_storage_documents_bucket.sql` isolément. La migration **`017_invoice_security.sql`** (postérieure) fait déjà `UPDATE storage.buckets SET public=false WHERE id='documents'` + `DROP POLICY documents_read_public`. Le bucket **est privé aujourd'hui** ; factures/reçus servis via **signed URLs** (`api/invoices/[ref]/download` HMAC 300s, `api/receipts/[ref]/download` rôle/ownership). **Aucune action requise.**
- Résidu **Minor** : le chemin legacy `generateAndStoreReceipt()` (via `mark-paid`) appelle encore `getPublicUrl()` → lien « Download Receipt Online » **mort (403)** dans l'email de confirmation. Atténué (le PDF est aussi en pièce jointe). Fix : faire pointer `receiptUrl` vers `/api/receipts/[ref]/download` (`invoiceService.ts`, `mark-paid/route.ts`, `emailService.ts`).

### C2 — Chiffrement IBAN factice/non garanti + fallback plaintext non bloquant
`frontend/src/services/kycService.ts` : chaîne `vault → pgsodium → plaintext`. La voie **pgsodium est un placeholder base64** (commentaire l.41,69 ; fonction `056_kyc_iban_helpers.sql`), **trivialement réversible** ; la voie **plaintext** écrit l'IBAN en clair. `isInsecureStrategy()` **ne bloque rien** — `submitKycC.ts:64` écrit quand même et se contente d'un flag `INSECURE_DEBT` dans l'audit.
**Fix :** (1) confirmer que **`supabase_vault` est bien actif en prod** (sinon les IBAN ne sont pas chiffrés au sens Art. 32 — vérifier via `select * from pg_extension where extname in ('supabase_vault','pgsodium')` sur le projet prod) ; (2) transformer `isInsecureStrategy()` en **gate bloquant** ; (3) retirer le placeholder base64. Art. 32.
> **Statut : RÉSOLU.** (1) Alerte non bloquante : flag d'audit `iban_encryption` + log ops `[KYC][INSECURE]` ajoutés dans les deux writers (`updateOwnerKycProfile` ne signalait rien — gap Sprint 2). (2) **Vault confirmé actif en prod** (`supabase_vault` 0.3.1, 2026-07-21) → **gate fail-closed** ajouté dans `encryptIban` : refuse d'écrire un IBAN si la stratégie n'est pas `vault` **en production** (`NODE_ENV==='production'`, override `KYC_ALLOW_INSECURE_IBAN`), inerte en dev/CI/test. Reste (Important, non bloquant) : `pgsodium` = base64 à retirer du code.

### C3 — Fuites cross-tenant RLS sur données sensibles
Trois policies **non scopées par juridiction** (contrairement au reste, mig 073). `current_jurisdiction_ids()` (mig 071) exempte déjà SUPERADMIN (renvoie toutes les juridictions) → pas de cas spécial à écrire.

- **C3a — `collection_reminders`** staff (`094:48-51`) : `USING (is_admin_or_officer())` sans filtre — le commentaire du fichier revendiquait pourtant le pattern mig 073. → **CORRIGÉ : `mig 099_collection_reminders_jurisdiction_rls.sql`** (scoping par jointure `transaction_id → transactions.jurisdiction_id`, aucun changement de schéma). ✅
- **C3b — `audit_logs`** SELECT (`004:148`) → tout staff voit les logs (incl. révélations d'IBAN) de toutes juridictions. → **CORRIGÉ (quick win) : `mig 100`** — colonne `jurisdiction_id` nullable + backfill best-effort (Shipowner/Transaction/Refund/Payment) + policy **tolérante au NULL** ; **5 writers sensibles tagués** (`revealOwnerRefundIban`, `submitKycC`, `updateOwnerKycProfile`, `confirmPayment`, `rejectPayment`) → leurs logs sont désormais scopés. **→ ENTIÈREMENT FERMÉ** : les ~25 autres writers (+ les call sites `writeAuditLog` : webhooks paiement, endpoint `api/audit`) taguent désormais `jurisdiction_id` (commit `bdcce17`). Restent en `null` **par nature légitime** : `admin/reports/settlement` + `cron/monthly-settlement-export` (roll-up ministériel cross-juridiction). Un seul **TODO** : `api/audit` (endpoint télémétrie générique sans contexte tenant — laissé `null`, décision humaine). ✅
- **C3c — `profiles`** "admins read all" (`021:44-49`) → email/full_name/ip_address de toutes juridictions. → **CORRIGÉ : `mig 101`**. Vérification faite : **les owners (SHIPPING_AGENT/SHIPOWNER) n'ont PAS de ligne `user_jurisdictions`** → policy conçue avec deux branches (staff via `user_jurisdictions`, owner via `shipowners.profile_id`+`jurisdiction_id`), SUPERADMIN inconditionnel, self-read préservé, ensemble de rôles inchangé. Résidu : un profil owner sans `shipowners` lié reste invisible au staff scopé (pas au SUPERADMIN). ✅

### C4 — Aucun mécanisme d'effacement / anonymisation (Art. 17)
→ **CORRIGÉ** : `mig 103` (`shipowners.anonymized_at`) + action `anonymizeOwner` (SUPERADMIN, auditée CRITICAL, idempotente) — efface contact + bancaire (`iban/swift/bank, emails, phone, address, billing_*, proof docs, notes, aliases`) + anonymise le profil lié (placeholders), **conserve l'identité légale/fiscale** (`name, billing_legal_name, imo/iata/aoc, country`) et **les flags sanctions** (exception Art. 17(3)(b) ; un sanctionné ne peut s'effacer de la liste). Revue sécurité : Ready, 0 Critical. Résidus (follow-up) : secret Vault IBAN non supprimé (pas de RPC confirmée) ; câblage UI (bouton+confirmation) différé ; valeur d'enum audit `SHIPOWNER_ANONYMIZED` dédiée à ajouter.

---

## 3. IMPORTANT

- **I1 — Données bancaires/contacts en clair** : `swift_bic`, `bank_name`, adresses, emails restent en clair alors que l'IBAN vise le chiffrement (`047_shipowner_kyc_extensions.sql:33-34`). Chiffrer a minima `swift_bic`/`bank_name`.
- **I2 — Aucune politique de rétention** : `transactions` (immuables), `collection_reminders`, KYC docs, IBAN, `audit_logs.ip_address`, `sanction_notes` → aucune durée de conservation ni purge. Le runbook backup/DR couvre le RPO/RTO, pas la rétention. Définir et documenter (durées + justification légale de conservation fiscale).
- **I3 — Consentement non versionné** : `cgv_accepted` tracé uniquement dans `audit_logs.details_json` (`submitKycC.ts:65`), pas de colonne `cgv_accepted_at`/`cgv_version` sur `shipowners` → impossible de prouver quelle version des CGV a été acceptée.
- **I4 — Partage tiers & DPA non documentés** : le flux de recouvrement prévoit un CC à un cabinet externe (**Eidle Advocats**, J+45 — `docs/onboarding/ONBOARDING_ARMATEURS.md`, colonne `collection_reminders.cc_emails`) **absent de la section « partage » de la politique**. (NB : le code d'envoi actif `emailService.ts` n'ajoute pas encore de CC externe — le flux relance email est Sprint 3.) Par ailleurs **aucun DPA** (Supabase/Resend/Stripe/Sentry) n'est tracé dans le repo. Documenter le partage + les sous-traitants + base légale avant la mise en service des relances.
- **I5 — `revealOwnerRefundIban` : traçabilité fragile + fuites d'erreur** : l'insert `audit_logs` est **fire-and-forget** (échec → `console.error` seulement, `revealOwnerRefundIban.ts:74-89`) ; les messages d'erreur renvoient le détail Postgres brut au client (l.53,71) ; côté UI l'IBAN en clair reste en `useState` non nettoyé à la fermeture du drawer (`RefundDetailDrawer.tsx`). Rendre l'audit bloquant/alerté, généraliser les messages d'erreur, nettoyer le state.
- **I6 — Pas d'export self-service (portabilité Art. 20)** : la consultation existe (`/owner/profile`) mais pas d'export JSON/PDF ; portabilité seulement par requête manuelle au DPO.

---

## 4. MINOR

- **M1** — `inviteShipowner.ts:90` loggue la **valeur** de l'email dans l'audit (vs convention « noms de champs seulement ») ; à documenter comme exception « preuve conformité sanctions » ou aligner.
- **M2** — Pattern `select('*')` sur `shipowners` puis reprojection (`ownerKycService.ts:41`, `armateurService.ts:125`) : pas de fuite actuelle, mais discipline de revue à chaque nouvelle colonne sensible.
- **M3** — `console.error('[Email] Resend error', …)` (`emailService.ts:76`) peut logger l'adresse destinataire en cas de rejet.
- **M4** — CSP conserve `unsafe-inline`/`unsafe-eval` (`next.config.ts:44-45`, dette assumée) → passer par nonce.
- **M5** — Pas d'opt-in/opt-out tracé pour les notifications email non essentielles (hors relances obligatoires).
- **M6** — Confirmer/documenter la région Supabase (EU vs autre) pour trancher l'applicabilité + les transferts.

---

## 5. Plan d'action recommandé (ordre)

1. **C1** (bucket documents privé + signed URLs) — rapide, fort impact.
2. **C2** (confirmer Vault prod + gate bloquant plaintext) — vérif config + petit code.
3. **C3** (RLS juridiction sur audit_logs/profiles/collection_reminders) — migration.
4. **I3** (colonnes consentement versionné) + **I2** (politique de rétention) — migration + doc.
5. **C4 / I4 / I6** (effacement, partage tiers/DPA, export) — procédures + doc DPO, éventuellement outillage.
6. **I1 / I5 / Minors** — durcissements.

> Les items **C1, C2, C3** touchent l'infrastructure/données existante hors périmètre Sprint 2 — à traiter comme un lot « durcissement RGPD/sécurité » dédié (chacun est une PR ciblée).
