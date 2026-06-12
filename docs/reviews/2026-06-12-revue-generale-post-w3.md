# Revue générale GreenGate — post-Wedge 3 (2026-06-12)

> Audit du système **tel que livré en production** (develop `be4d2d8`, prod = main `8e5e439`, hébergé mig 086).
> 4 auditeurs indépendants à regards neufs : A architecture/sécurité · B correction fiscale · C frontend/qualité · D ops/CI/fiabilité.
> Périmètre : Fondation + W1 (Aviation SO) + W2 (Djibouti + tariffs) + W3 (enforcement + settlement), tous en prod.

## Verdict global : **6,1/10** — cœur excellent, périphérie legacy + armure opérationnelle manquante

Le moteur W2/W3 (lookup tarifaire fail-closed, pinning `as_of`, snapshots `tariff_id`/`split_rule_id`, buckets de settlement, isolation RLS staff, discipline service-role lint-enforced) est **réellement bien construit et adossé aux tests**. Le risque est concentré dans ce qui l'ENTOURE : les routes legacy pré-multi-tenant, l'absence d'immutabilité DB sur la table des factures, et l'outillage opérationnel (backup, monitoring, CI bloquant).

## Scorecard

| Domaine | A. Archi/Sécu | B. Fiscal | C. Frontend | D. Ops |
|---|---|---|---|---|
| 1 | Isolation multi-tenant **8** | Résolution tarifaire **7** | Surfaces/cohérence **5** | CI/CD **6** |
| 2 | Frontières auth **8** | Détection→facturation **6** | i18n **5** | Historique runs **7** |
| 3 | Conformité design **7** | Settlement D3 **7** | Qualité code **6** | Observabilité **5** |
| 4 | Surface d'attaque **7** | Immutabilité documents **5** | Posture tests **7** | Deploy/rollback **6** |
| 5 | SPOF/scaling **5** | Enforcement matrice **7** | Conformité DESIGN.md **6** | Backup/DR **2** ⚠️ |
| Moy. | **7,0** | **6,4** | **5,8** | **5,2** |

## Constats critiques (convergences multi-auditeurs = confiance maximale)

1. **🔴 Les factures n'ont aucune immutabilité DB** (B-C1). `tariffs` et `revenue_split_rule` sont trigger-gardées, mais `transactions` — le document fiscal lui-même — ne l'est pas : un FINANCE_ADMIN peut réécrire `tax_amount_usd`/`tariff_id`/`jurisdiction_id` d'une facture PAYÉE, et la vue de settlement lit ces valeurs en live → réécriture d'historique silencieusement propagée au rapport souverain.
2. **🔴 PDF : le mauvais souverain + lignes inventées** (B-I4 ∩ C-Critique). 4 routes legacy + ProFormaModal hardcodent « Republic of Somaliland » (une facture DJ porte le mauvais État), `invoices/generate` ré-écrase `content_hash`/`verify_signature` à chaque appel (les PDF distribués cessent de vérifier), et rend une ventilation 75/20/5 « Port Call Fee / Security Surcharge » **fictive** sur un document fiscal.
3. **🔴 Webhook paiement unifié dangereux** (B-C2, chantier déjà ouvert dans le working tree). Matching par préfixe `ilike` UUID, **aucune validation de montant**, valeur de retour ignorée (toujours `{success:true}`). Mitigé par accident par l'invariant 022 — tout « fix » naïf ouvrirait le trou en grand. Le rail Stripe (payments-row + recompute) est, lui, sain : c'est le modèle à suivre.
4. **🔴 Aucune preuve de backup/DR** (D 2/10). Pour une concession fiscale de 10 ans : pas de PITR confirmé, pas de test de restore, pas de staging (les e2e écrivent dans la DB de prod), réplique souveraine D7 jamais commencée.
5. **🟠 Le stamp corridor provisoire DEVIENT la facture** (B-I3). La ré-résolution promise n'existe pas ; une proforma pré-arrivée peut porter la mauvaise juridiction et le reconcile peut émettre le FINAL sous l'autre État (voyage éclaté entre deux livres souverains). **Masqué uniquement par la symétrie actuelle 40 USD / escrow 100%** — à fermer avant toute divergence de tarif ou de split.
6. **🟠 Rail argent sans filet RLS** (A-I1). `wallets`/`wallet_ledger`/`refunds`/`owner_notifications` : RLS activée mais **zéro policy juridiction** — le wrapper applicatif est l'unique garde ; un `createPlatformClient()` oublié = fuite inter-États sans backstop DB.
7. **🟠 Immutabilité tarifaire contournable** (B-I1/I2). ACTIVE→DRAFT→éditer→ACTIVE en 3 UPDATEs ; INSERT rétroactif direct via PostgREST (la règle strictement-futur ne vit que dans la RPC) ; pas de garde DELETE/TRUNCATE sur tariffs.
8. **🟠 CI : le déploiement ignore les tests Go** (`continue-on-error: true` — le backend a déjà déployé tests rouges au run #57) ; tests pg jamais en CI ; `fly.toml` : conflit `memory='1gb'` vs `memory_mb=256` → **le Go tourne probablement à 256 MB** ; deadline GitHub Actions 2026-06-16 (bump versions).
9. **🟠 Observabilité aveugle sur le fiscal**. Les 4 vues invariantes « IMMEDIATE-ALARM » n'ont aucun consommateur automatisé ; un spike de `422 no_active_tariff` (= génération de proformas stoppée) n'alerterait personne ; runbook canary périmé sur 3 affirmations ; queue proforma plafonnée à ~1 msg/min sans alarme de profondeur.
10. **🟡 i18n : triangle « so » + 620 clés manquantes**. La locale Somali est offerte dans Settings, typée dans SecureUser, mais `so.json` n'existe pas (fallback EN silencieux + valeur orpheline en DB) ; pt/sw/ar : ~19% des clés manquantes (tout OwnerPortal !) ; FR : section Disputes entière manquante.
11. **🟡 Surfaces périmées** : simulateur sur table morte avec fallback mock (taux 20 hardcodé dans ProFormaModal), Settings = stubs qui « sauvent » dans le vide, signup staff = Somaliland uniquement, invite-armateur DJ → site BERBERA_PORT/timezone Mogadishu, enum OperationalSite sans site DJ, 8 hex hors-tokens dans AdminJurisdictions (`#00D97E` pré-système).
12. **🟡 Divers sécurité** : comparaisons HMAC non constant-time (3 providers), 2 routes POST publiques sans rate-limit (partnership-request, simulator/estimate), `ais/poll` sans auth « dev use » présent en prod.

## Backlog priorisé

### P0 — « Wedge 4 : blindage fiscal & continuité » (à faire avant toute divergence SO/DJ)
| # | Action | Source | Effort CC |
|---|---|---|---|
| 1 | Trigger append-only sur `transactions` (colonnes fiscales gelées post-INSERT, whitelist opérationnelle) | B-C1 | S |
| 2 | Helper `jurisdictionName` dans les 4 routes PDF legacy + ProFormaModal ; supprimer la ventilation 75/20/5 fictive ; `content_hash` first-write-only | B-I4/C | S |
| 3 | Refonte webhook paiement sur le rail payments-row + recompute (montant validé, ref exacte) — chantier working-tree à finir | B-C2 | M |
| 4 | Policies RLS juridiction sur wallets/wallet_ledger/refunds/owner_notifications (pattern mig 073) | A-I1 | S |
| 5 | Backup/DR : confirmer tier Supabase, activer PITR, test de restore documenté au runbook | D | S |
| 6 | Invariants tarifaires in-table (anti ACTIVE→DRAFT→ACTIVE, anti rétro-INSERT, garde DELETE/TRUNCATE) | B-I1/I2 | S |
| 7 | Corridor : flag `jurisdiction_provisional` + garde reconcile (mismatch → VOID + ré-émission sous la bonne juridiction) | B-I3 | M |

**Statut Wedge 4 (2026-06-12, branche `feat/greengate-wedge4-fiscal-hardening`) — 7/7 livrés :**

1. ✅ Mig 089 (`b4dac7f` + revue `8fc8ece` : 42/42 colonnes classées gelées/opérationnelles, hatch `app.transactions_allow_backfill` resserré NULL→valeur) + mig 090 VOID terminal (`17c9384`).
2. ✅ T1 `4f0efc0` : lib `jurisdictionName` (4 routes PDF legacy + ProFormaModal), ventilation 75/20/5 supprimée (taxe carbone = une seule ligne), `content_hash` first-write-only ; + `52b0b82` (garde hash symétrique, assertions fiscales sur `invoices/generate`).
3. ✅ T2 `b1434bb` : refonte multi-provider sur le rail payments-row + recompute (ref exacte, montant validé) ; revues `6e1aec8`/`064fbd8`/`e784eb5` (ref canonique à l'initiation, juridiction stampée, refs namespacées, Wave désactivé) ; index unique provider:ref = mig 087.
4. ✅ Mig 087 (`232b6c0`) : policies juridiction sur wallets/wallet_ledger/refunds/owner_notifications, pattern mig 073.
5. ✅ Runbook `docs/runbooks/2026-backup-dr.md` + `scripts/backup/restore-test.sh` (exécuté, tip hébergé=086) + refresh runbook canary (`613519d`).
6. ✅ Mig 088 (`16e486e`) : anti rétro-activation, anti round-trip ACTIVE→DRAFT→ACTIVE, gardes DELETE/TRUNCATE ; hatch `app.tariffs_allow_retro` honoré par les fixtures Go (`4b874d8`).
7. ✅ T6 `b9f4b32` : stamp `jurisdiction_provisional` + garde reconcile (mismatch → VOID + ré-émission) ; `17c9384` (ré-émission idempotente, VOID terminal mig 090, void optimiste, plafond dead-letter pgmq) ; `93ba102` (lookups fail-closed, wrappers pgmq verrouillés service_role). Proforma PAYÉE mismatchée : FINAL sous la juridiction réelle + flag jsonb + log.error (correction inter-États manuelle).

### P1 — Fiabilité & CI
8. CI : tests Go bloquants (1 ligne), bump actions (deadline 16/06), fly.toml memory 1 GB, tests pg en CI (job Docker). · 9. Queue : drain par batch + alarme profondeur. · 10. Monitoring automatisé des vues invariantes (pg_cron → alerte) + alerte 422. · 11. timingSafeEqual + rate-limit des routes publiques + statut ais/poll. · 12. initiatePayment : vérifier ownership/status/document_type (ferme le double-comptage REFUND B-I5).

### P2 — Qualité & UX
13. Triangle locale « so » + 156 clés OwnerPortal pt/sw/ar + Disputes FR. · 14. Simulateur → tariffs (tuer mock + taux 20). · 15. Settings réels ou gated + Select-in-render + hex AdminJurisdictions. · 16. Runbook refresh + e2e 03 unskip + tests ProFormaModal/calculate. · 17. Sites opérationnels DJ (enum + invite) + signup staff multi-juridictions. · 18. Nettoyage : transactionService dead helpers, getActiveProvider legacy, secret SUPABASE_PROJECT_REF orphelin.

### Notes
- Le working tree porte déjà le chantier webhook/auditService (améliorations à conserver — P0-3).
- `distance_m` (mig 071) : colonne canonique jamais lue/écrite — décider : câbler ou retirer du design.
- Settlement : la vue restate les mois passés (bucket par `created_at` vs `settlement_effective_at` ignoré — B-I6) ; à trancher quand le décaissement réel arrivera.
