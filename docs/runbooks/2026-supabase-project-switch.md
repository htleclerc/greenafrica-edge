# GreenGate — Runbook de bascule de projet Supabase

> Procédure de mise en production **avec changement de projet Supabase** (livrable L11).
>
> **Owner** : Loïc Leclerc (`admin@drwintech.com`)
> **Créé** : 2026-07-06
> **Projet hébergé actuel** : `dyjolepwxxsedwngkfox` (eu-north-1, PostgreSQL 17.x)
> **Prod frontend** : https://greengate.africa (Vercel) · **backend** : app Fly `africgreen`
> **Compagnons** : [`2026-post-deploy-smoke.md`](2026-post-deploy-smoke.md), [`2026-backup-dr.md`](2026-backup-dr.md)

Changer de projet Supabase n'est **pas** qu'un changement d'URL : les jobs `pg_cron`,
les buckets Storage, les secrets applicatifs stockés en base (`app_config`) et la
configuration Auth vivent **dans le projet**. Cette procédure couvre les deux cas :
**démarrage vierge** (nouveau registre) et **migration à chaud** (reprise des données
de `dyjolepwxxsedwngkfox`). Exécuter dans l'ordre ; au premier ❌ bloquant, ne pas
poursuivre le cutover.

---

## 0. Prérequis (côté Client — art. 8.2 du contrat)

- [ ] Nouveau projet Supabase créé, **plan Pro** (requis pour PITR).
- [ ] **Même version majeure Postgres = 17** (cf `supabase/config.toml` `major_version = 17`).
- [ ] Région choisie (souveraineté des données).
- [ ] Extensions activées (Dashboard → Database → Extensions) : **`pg_cron`, `pg_net`,
      `pgmq`, `btree_gist`**. Les migrations font `CREATE EXTENSION IF NOT EXISTS`, mais
      `pg_cron`/`pg_net` demandent souvent une activation manuelle préalable.
- [ ] Récupérer les nouvelles clés : `Project URL`, `anon key`, `service_role key`, et
      l'URL du **pooler** (Settings → Database → Connection pooling, port 5432).

> ⚠️ Aucun accès aux fonds/comptes tiers pour le Prestataire : le Client détient et
> configure le projet ; le Prestataire fournit la procédure et exécute avec les accès
> techniques temporaires (art. 12, révoqués en fin de mission).

---

## 1. Schéma + migrations

Appliquer les 91 migrations sur le nouveau projet via le pooler (le `supabase link`
échoue en CI/403 → `db push --db-url` est le chemin prouvé depuis mai 2026) :

```bash
supabase db push \
  --db-url "postgresql://postgres.<NEW_REF>:<PWD>@<POOLER_HOST>:5432/postgres" --yes
```

Vérifier le tip :

```bash
psql "$NEW_DB_URL" -c \
  "SELECT max(version) FROM supabase_migrations.schema_migrations;"   # attendu : 091 (ou +)
```

- ❌ partial-apply → inspecter le schéma avant retry ; `supabase migration repair
  --status applied <N>` puis relancer (cf backup-dr).

---

## 2. Données — **uniquement en migration à chaud** (sauter pour un démarrage vierge)

Dump de `dyjolepwxxsedwngkfox` → restore dans le nouveau projet. Inclure le schéma
`auth` (comptes + mots de passe hashés) pour ne pas perdre les logins.

```bash
# Dump data-only des schémas public + auth
pg_dump "$OLD_DB_URL" --data-only --schema=public --schema=auth \
  --no-owner --disable-triggers -f settlement_dump.sql
```

⚠️ Les triggers d'immutabilité (ledger, audit_logs, transactions Wedge 4) **bloquent
même `service_role`**. Charger en désactivant les triggers le temps du restore :

```bash
psql "$NEW_DB_URL" -c "SET session_replication_role = replica;" -f settlement_dump.sql
```

**Contrôle d'intégrité** (registre fiscal — non négociable) : comparer les counts
avant/après sur les tables critiques :

```bash
for t in transactions payments wallets wallet_ledger audit_logs shipowners; do
  echo -n "$t : "; psql "$NEW_DB_URL" -tAc "SELECT count(*) FROM $t";
done
```

- ❌ écart de count sur `transactions`/`payments`/`wallet_ledger` → **STOP**, ne pas
  basculer (voir backup-dr §3).

---

## 3. Storage buckets (⚠️ hors dump SQL)

Les **policies** des buckets sont recréées par les migrations (012 `documents`,
017 invoice-security, 055 `shipowner-kyc`, 059). Les buckets et **fichiers** ne sont
pas dans un dump Postgres.

- **Démarrage vierge** : s'assurer que les buckets existent (`documents`,
  `payment-proofs`, `shipowner-kyc`). Les migrations qui insèrent dans
  `storage.buckets` les créent ; sinon les créer via Dashboard → Storage.
- **Migration à chaud** : copier les objets existants (factures PDF, preuves MT103,
  KYC, `settlement-reports/`) via S3-compatible (`rclone`) ou l'API Storage :

```bash
# Exemple rclone (endpoints S3 des deux projets configurés dans rclone.conf)
rclone copy old-supabase:documents new-supabase:documents -P
rclone copy old-supabase:payment-proofs new-supabase:payment-proofs -P
rclone copy old-supabase:shipowner-kyc new-supabase:shipowner-kyc -P
```

---

## 4. `app_config` — secrets & URLs (CRITIQUE : les crons DB en dépendent)

Les jobs `pg_cron` lisent l'URL de l'app et le secret **depuis la table `app_config`**
(pas de hardcode). Sur le nouveau projet :

```sql
-- URL publique du frontend prod (appelée par pg_net depuis les crons)
UPDATE app_config SET value = '"https://greengate.africa"' WHERE key = 'queue.worker_url';

-- DOIT être identique à l'env QUEUE_WORKER_SECRET du frontend Vercel (§7)
UPDATE app_config SET value = '"<QUEUE_WORKER_SECRET>"' WHERE key = 'queue.worker_secret';
```

Vérifier les feature flags à l'état voulu :

```sql
SELECT key, value FROM app_config WHERE key IN (
  'feature.shipowner_self_service_enabled',
  'feature.air_self_service_enabled',
  'feature.daily_precompute_enabled',
  'feature.equasis_scraper_enabled'
);
```

---

## 5. pg_cron

Les migrations recréent les jobs (`cron.schedule(...)` : proforma-worker, agent-match,
reconciliation, escalations, equasis-enqueue, proforma-reminders…). Vérifier :

```sql
SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
```

- Les jobs appellent l'app via `pg_net` en lisant l'URL depuis `app_config` (§4).
- ❌ table `cron.job` vide → l'extension `pg_cron` n'était pas active avant les
  migrations (§0) : réactiver puis rejouer les migrations concernées.

---

## 6. Auth (Dashboard — hors migrations)

- [ ] **Site URL** = `https://greengate.africa`.
- [ ] **Redirect URLs allowlist** : ajouter impérativement **`/auth/setup-password`**
      (sinon les magic-links d'invitation staff cassent — cf post-deploy-smoke §5),
      + les redirections `/owner/*`.
- [ ] **SMTP Resend** configuré (sinon rate-limit email Supabase par défaut = 2/h).
- [ ] Toggles signup, password policy, JWT expiry conformes à `config.toml`.

---

## 7. Variables d'environnement — le vrai « changement de projet »

| Cible | Variables à mettre à jour |
|---|---|
| **Vercel** (frontend, env Production) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` — **rebuild obligatoire** (les `NEXT_PUBLIC_*` sont inlinés au build). |
| **Fly.io** (backend Go) — `fly secrets set` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` |
| **GitHub Actions secrets** | `SUPABASE_DB_URL` (nouveau pooler), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — pour que `deploy-production.yml` pousse les migrations sur le **bon** projet. |

> Profiter de la bascule pour **régénérer tous les secrets applicatifs** (rotation L13) :
> `QUEUE_WORKER_SECRET`, `INVOICE_SIGNING_SECRET`, `CRON_SECRET`, `AFRICGREEN_API_SECRET`,
> `AIS_INGEST_SECRET`, `SETUP_SECRET`. Le `queue.worker_secret` d'`app_config` (§4) doit
> suivre `QUEUE_WORKER_SECRET`.

---

## 8. Stripe (si bascule live en parallèle — indépendant de Supabase)

Recréer le webhook dans le Dashboard Stripe **live** → nouveau `STRIPE_WEBHOOK_SECRET`
dans Vercel. Passer `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY` en `sk_live_`/`pk_live_`
(conditionné à l'entité juridique + KYC du Client).

---

## 9. Vérification post-bascule

Dérouler intégralement [`2026-post-deploy-smoke.md`](2026-post-deploy-smoke.md). En plus,
spécifique à la bascule :

```bash
# tip migrations
psql "$NEW_DB_URL" -c "SELECT max(version) FROM supabase_migrations.schema_migrations;"   # 091+

# invariants fiscaux (doivent être VIDES)
psql "$NEW_DB_URL" -c "SELECT count(*) FROM v_wallet_balance_drift;"        # 0
psql "$NEW_DB_URL" -c "SELECT count(*) FROM v_transaction_payment_drift;"   # 0

# immutabilité (DOIT échouer)
psql "$NEW_DB_URL" -c "UPDATE transactions SET tax_amount_usd = tax_amount_usd + 1
  WHERE id = (SELECT id FROM transactions LIMIT 1);"                        # ERROR attendu

# crons en place
psql "$NEW_DB_URL" -c "SELECT count(*) FROM cron.job WHERE active;"         # > 0

# rapport settlement (L8) lisible
psql "$NEW_DB_URL" -c "SELECT count(*) FROM v_revenue_split_settlement;"
```

- [ ] `/login` + `/signup` → 200, sélecteur de mode visible.
- [ ] Invitation staff → `/auth/setup-password` atteignable (dépend allowlist §6).
- [ ] Backend `/health` → 200 + `status:ok`.

---

## 10. PITR, backups, cutover

- [ ] Activer **PITR** (plan Pro) + configurer la rétention.
- [ ] Premier **drill de restauration** (backup-dr §5).
- [ ] **Cutover DNS** : en migration à chaud, prévoir une **fenêtre de gel des écritures**
      (dump final → restore → switch env → smoke). Sinon perte des écritures entre le dump
      et la bascule.
- [ ] Révoquer les accès techniques temporaires du Prestataire (art. 12) une fois validé.

---

## 11. Feuille de sign-off

- [ ] §1 migrations tip = 091+
- [ ] §2 counts intègres (si migration à chaud)
- [ ] §3 buckets + objets présents
- [ ] §4 `app_config` (worker_url + worker_secret) alignés
- [ ] §5 `cron.job` actifs
- [ ] §6 Auth (site URL + allowlist `/auth/setup-password` + SMTP)
- [ ] §7 env Vercel / Fly / GH mis à jour, secrets régénérés
- [ ] §9 smoke post-deploy vert
- [ ] §10 PITR activé + cutover réalisé

**Signé** : __________  **Date/heure** : __________  **Nouveau projet ref** : __________
