# Environnements — Staging & Production

Mise en place de **deux projets Supabase** et d'un pipeline CI/CD par environnement.

## Topologie

| Branche Git | Environnement | Supabase | Frontend (Vercel) | Backend (Fly.io) | Workflow |
|---|---|---|---|---|---|
| `develop` | **Staging** | projet **existant** (`dyjolepwxxsedwngkfox`) | Preview / staging | app `africgreen` | `deploy-staging.yml` |
| `main` | **Production** | **nouveau** projet (à créer) | Production (`greengate.africa`) | app `greengate-prod` | `deploy-production.yml` |

Le flux de promotion reste `develop → main`. Un push sur `develop` déploie le staging ; un push sur `main` (via PR) déploie la prod.

### Modèle de livraison — repo chez le Prestataire, prod sur le compte du Client
Le **repo GitHub reste sur le compte dev/staging** (source unique de vérité) ; la **prod tourne sur un autre compte** (Supabase / Fly / Vercel du Client). Rien n'est dupliqué sauf les services qui tournent : le CI (dans ce repo) déploie vers l'infra prod de l'autre compte grâce aux **tokens scopés** portés par le GitHub Environment `production`. Aucun transfert ni miroir de repo n'est nécessaire ; le propriétaire prod peut être ajouté en **collaborateur** GitHub pour l'audit. Le déploiement Vercel cross-compte passe par `VERCEL_TOKEN` + `VERCEL_ORG_ID` + `VERCEL_PROJECT_ID` (pas d'intégration Git native requise). Migrer/transférer le repo plus tard reste possible sans toucher à cette mécanique.

## Principe CI/CD

Les deux workflows sont **identiques à l'`environment:` près**. On utilise deux **GitHub Environments** (`staging`, `production`) qui portent les **mêmes noms de secrets** avec des valeurs différentes. Le YAML ne connaît donc que `secrets.SUPABASE_DB_URL`, `secrets.FLY_API_TOKEN`, etc. — c'est l'environnement du job qui résout la bonne valeur. Aucun secret suffixé `_PROD` à disperser dans les workflows.

Chaque workflow : **gate CI** (`ci.yml`) → **migrations Supabase** (`supabase db push --db-url`) → **deploy backend Fly** → **deploy frontend Vercel** (opt-in) → **health checks**.

---

## Setup — une seule fois (actions manuelles requises)

> ⚠️ Ces étapes touchent des consoles externes (Supabase, Fly.io, Vercel, GitHub) et ne peuvent pas être automatisées depuis le repo.

### 1. Créer le nouveau projet Supabase (production)

1. Dashboard Supabase → **New project** (même organisation, région proche de la prod actuelle).
2. Récupérer, depuis **Project Settings** :
   - **Connection string** → onglet *Connection pooling* (mode *Session*), format
     `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`
     → ce sera le secret **`SUPABASE_DB_URL`** de l'environnement `production`.
   - **Project URL** (`https://<ref>.supabase.co`) → `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`.
   - **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ secret, jamais côté client).
3. **Activer le PITR** sur ce projet (plan Pro requis) — la prod doit avoir un filet de restauration.
4. Répliquer la config non-migrée nécessaire : Auth (URL de redirection, SMTP/expéditeur), Storage buckets (`payment-proofs`, `documents`, `reports`, `settlement-reports`), et les extensions (`pgmq`, `pg_cron`, `pg_net`, `pgsodium`) si elles ne sont pas créées par les migrations. Les jobs `pg_cron` applicatifs sont posés par les migrations.

### 2. Appliquer les migrations au nouveau projet

Le premier push sur `main` les appliquera automatiquement, mais pour amorcer proprement **avant** la bascule :

```bash
supabase db push --db-url "<SUPABASE_DB_URL de prod>" --yes
```

(Il n'y a **rien à purger** : le projet est vierge. La « table rase » demandée est remplacée par ce projet neuf.)

### 3. Créer l'app Fly.io de production

```bash
fly apps create greengate-prod
# Secrets backend prod (valeurs de PROD) :
fly secrets set -a greengate-prod \
  SUPABASE_DB_URL="<prod pooler url>" \
  SUPABASE_URL="https://<ref>.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="<prod service_role>" \
  API_SECRET="<nouveau secret prod>" \
  AISSTREAM_API_KEY="<clé>" \
  APP_URL="https://greengate.africa" \
  SENTRY_DSN="<dsn>" SENTRY_ENVIRONMENT="production"
# Provisionner 1 machine api (scraper à 0 par défaut) :
fly scale count -a greengate-prod api=1 scraper=0
```

L'app `africgreen` existante devient de fait le **staging** — vérifier que ses secrets pointent bien sur le projet Supabase existant (staging).

**Defense-in-depth — tokens Fly scopés par app.** L'isolation staging/prod repose sur le flag `--app` dans les workflows. Pour qu'un token ne puisse pas déployer sur la mauvaise app même en cas d'erreur de flag, créer un **token de déploiement par app** plutôt qu'un token org réutilisé, et les stocker comme `FLY_API_TOKEN` de chaque environnement (étape 4) :

```bash
fly tokens create deploy -a africgreen       # → FLY_API_TOKEN de l'env staging
fly tokens create deploy -a greengate-prod  # → FLY_API_TOKEN de l'env production
```

### 4. Créer les GitHub Environments + secrets

Deux environnements, chacun avec le même jeu de secrets/variable :

```bash
REPO=htleclerc/africgreen

# --- STAGING (projet Supabase existant, app Fly africgreen) ---
gh api -X PUT repos/$REPO/environments/staging
gh secret set SUPABASE_DB_URL   -e staging -R $REPO --body "<staging pooler url>"
gh secret set FLY_API_TOKEN      -e staging -R $REPO --body "<fly token>"
gh secret set BACKEND_URL        -e staging -R $REPO --body "https://africgreen.fly.dev"
gh secret set PRODUCTION_URL     -e staging -R $REPO --body "<url frontend staging>"
gh secret set VERCEL_TOKEN       -e staging -R $REPO --body "<vercel token>"   # si Vercel via CI
gh secret set VERCEL_ORG_ID      -e staging -R $REPO --body "<vercel org/team id>"
gh secret set VERCEL_PROJECT_ID  -e staging -R $REPO --body "<vercel project id>"
gh variable set VERCEL_ENABLED   -e staging -R $REPO --body "false"            # frontend via intégration Git Vercel

# --- PRODUCTION (nouveau projet Supabase, app Fly greengate-prod) ---
gh api -X PUT repos/$REPO/environments/production
gh secret set SUPABASE_DB_URL   -e production -R $REPO --body "<prod pooler url>"
gh secret set FLY_API_TOKEN      -e production -R $REPO --body "<fly token>"
gh secret set BACKEND_URL        -e production -R $REPO --body "https://greengate-prod.fly.dev"
gh secret set PRODUCTION_URL     -e production -R $REPO --body "https://greengate.africa"
gh secret set VERCEL_TOKEN       -e production -R $REPO --body "<vercel token du compte prod>"
gh secret set VERCEL_ORG_ID      -e production -R $REPO --body "<vercel org/team id du compte prod>"
gh secret set VERCEL_PROJECT_ID  -e production -R $REPO --body "<vercel project id du compte prod>"
gh variable set VERCEL_ENABLED   -e production -R $REPO --body "true"          # ou false si Vercel via intégration Git
```

> Note : `BACKEND_URL` est aussi lu au niveau repo par d'autres jobs. Les valeurs d'environnement (ci-dessus) priment quand un job déclare `environment:`. On peut laisser les anciens secrets repo-level en secours, ou les retirer une fois les deux environnements en place.
>
> Le **CI Gate** (`ci.yml`, appelé par les deux workflows) n'a **pas** d'`environment:` : il n'utilise que les secrets repo-level `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (build front) et un Supabase local éphémère pour les tests d'intégration — inchangé par cette bascule, rien à dupliquer par environnement.
>
> Après avoir posé `VERCEL_ENABLED` par environnement, faire une **vérification ponctuelle** : activer la variable dans un seul environnement et confirmer que seul le job Vercel de cet environnement tourne (les `vars` scopés par environnement sont résolus après la déclaration `environment:` du job).
>
> Optionnel mais recommandé : ajouter une **protection rule** sur l'environnement `production` (required reviewers) pour un contrôle humain avant tout déploiement prod (Settings → Environments → production → Required reviewers, via l'UI GitHub).

### 5. Configurer Vercel par environnement

Dans le projet Vercel (Settings → Environment Variables), scoper les variables :

- **Production** (branche `main`) → toutes les `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `AFRICGREEN_API_URL` (= `https://greengate-prod.fly.dev`), `NEXT_PUBLIC_BACKEND_URL`, `CRON_SECRET`, `QUEUE_WORKER_SECRET`, `INVOICE_SIGNING_SECRET`, `RESEND_API_KEY`, `STRIPE_*`, `NEXT_PUBLIC_SENTRY_ENV=production`, etc. → pointant sur le **nouveau** projet Supabase + backend prod.
- **Preview** (branches, dont `develop`) → mêmes clés → pointant sur le projet Supabase **existant** (staging) + `https://africgreen.fly.dev`.

Le domaine `greengate.africa` reste assigné à la Production Vercel.

**Prod sur un compte Vercel distinct (livraison Client).** Le repo reste sur le compte dev ; la prod tourne sur le compte du Client via déploiement par token (pas d'intégration Git native requise). Récupérer les IDs du **projet prod du Client** :
```bash
vercel login                 # se connecter au compte Vercel prod
cd frontend && vercel link   # crée .vercel/project.json → orgId + projectId
```
(ou Dashboard : Project Settings → General = `PROJECT_ID` ; Account/Team Settings = `ORG_ID`). Les mettre dans les secrets `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` de l'env `production` (étape 4), avec `VERCEL_ENABLED=true`. Le domaine `greengate.africa` s'attache au projet prod du Client (un domaine = un seul projet à la fois ; re-vérification TXT si cross-compte).

---

## Ce qui se passe ensuite (automatique)

- **Push `develop`** → `deploy-staging.yml` : migrations sur le projet existant, backend sur `africgreen`, health checks staging.
- **Merge PR → `main`** → `deploy-production.yml` : migrations sur le nouveau projet prod, backend sur `greengate-prod`, frontend Vercel prod, health checks prod.

Le CI (`ci.yml`) continue de tourner sur toute PR/commit `main`/`develop` (lint, tsc, tests, build, migrations locales éphémères) — inchangé.

---

## Import du portefeuille réel (item 3 de la checklist)

Le script `scripts/seed-onboarding.ts` (branche `feat/onboarding-fondations-db` / PR #85) importe les 8 seeds `docs/onboarding/seeds/` dans le projet cible. Il est **idempotent** (pré-filtrage) et **vérifie** les totaux en fin de run (exit 1 si écart).

### Prérequis
1. Migrations appliquées sur le projet cible (checklist §2).
2. Un **profil SUPERADMIN** existe (utilisé pour les 3 paiements historiques) — récupérer son UUID :
   ```sql
   SELECT id, email, role FROM profiles WHERE role = 'SUPERADMIN' LIMIT 1;
   ```
   Si le projet est vierge : créer le compte admin (`/signup` puis `UPDATE profiles SET role='SUPERADMIN' WHERE email='…'`) et reprendre son `id`.
3. Dépendances — ⚠️ `@supabase/supabase-js` et `zod` doivent être dans le `node_modules` **de la racine** (la résolution Node ne remonte pas latéralement vers `frontend/node_modules` depuis `scripts/`) :
   ```bash
   npm install @supabase/supabase-js zod   # à la RACINE du repo
   cd frontend && npm ci && cd ..           # imports relatifs des mappers
   ```

### 1) Dry-run (aucune écriture — toujours en premier)
```bash
SUPABASE_URL="https://<ref-prod>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service_role prod>" \
SEED_ADMIN_PROFILE_ID="<uuid superadmin>" \
npx tsx scripts/seed-onboarding.ts
```
PowerShell : poser d'abord `$env:SUPABASE_URL=…`, `$env:SUPABASE_SERVICE_ROLE_KEY=…`, `$env:SEED_ADMIN_PROFILE_ID=…` puis `npx tsx scripts/seed-onboarding.ts`.

Attendu :
```
Seeds OK : 20 armateurs, 6 compagnies, 100 navires, 100 voyages, 656 pro-formas, 40 relances, 3 paiements — total USD 2750890.34
Dry-run : aucun write. Relancer avec --execute.
```

### 2) Import réel
Même commande **+ `--execute`**. `verify()` attendu (exit 0) : **26 shipowners · 100 vessels · 656 transactions PROFORMA** (100 MARITIME + 556 AIR) · somme `tax_amount_usd` = **2 750 890,34** · 40 collection_reminders · 3 payments (12 055,57) · 3 débiteurs sanctionnés. Relancer une 2ᵉ fois = 0 insert (idempotent).

- **Projet prod neuf = pas de `--purge`** (base vierge). Ne jamais poser `PURGE_CONFIRM=TABLE_RASE` sur la prod.
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` : Dashboard du projet → Settings → API. Ne pas laisser la `service_role` traîner dans l'historique shell.

---

## Checklist de bascule prod (jour J)

1. [ ] Nouveau projet Supabase créé, PITR activé, buckets/extensions/Auth configurés.
2. [ ] Migrations appliquées au nouveau projet (`supabase db push --db-url`).
3. [ ] Import du portefeuille réel (procédure complète ci-dessus) : dry-run → `--execute` → `verify()` = 656 pro-formas / 2 750 890,34 USD.
4. [ ] App Fly `greengate-prod` créée + secrets + 1 machine api.
5. [ ] GitHub Environments `staging` + `production` avec leurs secrets.
6. [ ] Vercel : variables Production → nouveau projet ; Preview → projet existant.
7. [ ] PR `develop → main` mergée → `deploy-production` vert (migrations + Fly + Vercel + health checks).
8. [ ] Domaine `greengate.africa` sert bien la Production pointant sur le nouveau backend.
