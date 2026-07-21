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

## 2. CRITICAL (à corriger en priorité)

### C1 — Bucket `documents` public + lecture anonyme
`supabase/migrations/012_storage_documents_bucket.sql:11` (`public=true`) + policy `documents_read_public TO anon` (l.28-31). Le bucket contient des **factures nominatives** (montants, noms) avec URLs partageables/prévisibles → accès sans authentification si l'URL est connue/devinée.
**Fix :** passer le bucket en privé + servir via **signed URLs** (patron déjà utilisé pour `payment-proofs`/`shipowner-kyc`). Art. 32.

### C2 — Chiffrement IBAN factice/non garanti + fallback plaintext non bloquant
`frontend/src/services/kycService.ts` : chaîne `vault → pgsodium → plaintext`. La voie **pgsodium est un placeholder base64** (commentaire l.41,69 ; fonction `056_kyc_iban_helpers.sql`), **trivialement réversible** ; la voie **plaintext** écrit l'IBAN en clair. `isInsecureStrategy()` **ne bloque rien** — `submitKycC.ts:64` écrit quand même et se contente d'un flag `INSECURE_DEBT` dans l'audit.
**Fix :** (1) confirmer que **`supabase_vault` est bien actif en prod** (sinon les IBAN ne sont pas chiffrés au sens Art. 32) ; (2) transformer `isInsecureStrategy()` en **gate bloquant** (refuser l'écriture / alerte) ; (3) retirer le placeholder base64. Art. 32.

### C3 — Fuites cross-tenant RLS sur données sensibles
Trois policies **non scopées par juridiction** (contrairement au reste, mig 073) :
- `audit_logs` SELECT (`004_rls_policies.sql:148`) → tout staff voit les logs (incl. révélations d'IBAN) de **toutes** les juridictions.
- `profiles` "admins read all" (`021_fix_rls_recursion.sql:44-49`) → email/full_name/ip_address de toutes juridictions.
- `collection_reminders` staff (`094_collection_reminders.sql:48-51`) : `USING (is_admin_or_officer())` **sans** filtre juridiction — alors que le commentaire du fichier revendique le pattern mig 073.
**Fix :** ajouter `AND jurisdiction_id = ANY(current_jurisdiction_ids())` (ajouter la colonne si absente sur `audit_logs`) ; auditer toutes les policies utilisant `is_admin_or_officer()` seul. Art. 5(1)(f)/32.

### C4 — Aucun mécanisme d'effacement / anonymisation (Art. 17)
Aucun `delete`/`anonymize`/`deleted_at` pour les shipowners ni leurs données. La politique documente le droit mais **aucun outil technique** (même pseudonymisation des champs non-comptables : `address`, `ops_email`, `phone_e164`). Conflit à arbitrer avec l'immuabilité des `transactions` (mig 089).
**Fix :** définir une procédure d'effacement/anonymisation partielle (champs non fiscaux) + la documenter ; a minima une procédure manuelle DPO. Art. 17.

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
