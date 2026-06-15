# GreenGate — Runbook de smoke post-déploiement

> Validation manuelle **après chaque promotion `develop → main`** (déploiement prod).
>
> **Owner** : Loïc Leclerc (`admin@drwintech.com`)
> **Créé** : 2026-06-15 (après promotion [PR #71](https://github.com/htleclerc/africgreen/pull/71), main `2b6d876`)
> **Prod frontend** : https://greengate.africa
> **Prod backend (Go/Fly)** : app Fly `africgreen` — URL dans le secret GH `BACKEND_URL`
> **DB hébergée** : Supabase `dyjolepwxxsedwngkfox` (eu-north-1, PostgreSQL 17.x)
> **Compagnons** : [`2026-backup-dr.md`](2026-backup-dr.md), [`2026-canary-rollout-shipowner-portal-v1.md`](2026-canary-rollout-shipowner-portal-v1.md)

GreenGate est une **plateforme fiscale**. Un smoke raté = soit le registre souverain est mal servi, soit une porte publique (signup) est ouverte sans filet. Exécuter dans l'ordre ; au premier ❌ bloquant, voir §9 (leviers de retour arrière) avant de continuer.

---

## 0. Pré-requis & contexte du déploiement à valider

Ce qui vient d'être promu en prod (à garder en tête pendant le smoke) :

| Lot | Effet prod à vérifier |
|---|---|
| Wedge 4 (#64) | Invariants fiscaux DB actifs, backend Go fail-closed tarifaire |
| Simplification (#66) | Un login / un shell ; cron quotidien **inerte** (flag OFF) |
| Inscription (#67) | `/signup` self-service ; invitations staff via `/admin/staff` → `/auth/setup-password` |
| Qualité P2 (#68/#69/#70) | Simulateur sur tarif réel (fail-closed), i18n, sites DJ |
| **Mig 091** | ⚠️ **Inscription publique self-service OUVERTE** (maritime + aérien) |

**Outils** : un terminal (`curl`, `psql`), un navigateur, accès SQL hébergé
(`psql "$SUPABASE_DB_URL"`, mot de passe dans `frontend/.env.local`).

> ⚠️ Toute écriture de test (signup, paiement) atterrit dans la **DB de prod réelle** (pas de staging). Préfixer les données de test (`SMOKE-<date>`) et **nettoyer** en §8.

---

## 1. Santé backend (Go / Fly)

```bash
# Remplacer par la valeur réelle du secret BACKEND_URL (app Fly `africgreen`)
BACKEND_URL="https://africgreen.fly.dev"

curl -sf "$BACKEND_URL/health"
# Attendu : {"status":"ok","service":"africgreen-api","version":"0.2.0"}
```

- ✅ HTTP 200 + JSON `status:ok`.
- ❌ 000/5xx → le déploiement Fly n'a pas pris ou la machine redémarre encore.
  `flyctl status -a africgreen` ; `flyctl logs -a africgreen`. **Bloquant.**

---

## 2. Santé frontend (Vercel / greengate.africa)

```bash
curl -s -L -o /dev/null -w "%{http_code}\n" https://greengate.africa/login   # 200
curl -s -L -o /dev/null -w "%{http_code}\n" https://greengate.africa/signup  # 200
```

- Dans le navigateur : `/login` rend l'écran de connexion unifié ; `/signup` rend
  le **sélecteur de mode** (Maritime / Aérien) — c'est la preuve que la mig 091 a
  ouvert le self-service.
- ❌ `/signup` redirige vers `/login` ou affiche « inscription fermée » → les flags
  `feature.*_self_service_enabled` ne sont pas à `true` (voir §4).

---

## 3. Migrations & flags appliqués sur l'hébergé

```bash
psql "$SUPABASE_DB_URL" -c \
  "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3;"
# Attendu : 091, 090, 089  (tip = 091)

psql "$SUPABASE_DB_URL" -c \
  "SELECT key, value FROM app_config
   WHERE key IN ('feature.shipowner_self_service_enabled',
                 'feature.air_self_service_enabled',
                 'feature.daily_precompute_enabled');"
# Attendu : les 2 *_self_service_enabled = true ; daily_precompute = false (ou absent)
```

- ❌ tip < 091 → le job `Supabase Migrations` du pipeline n'a pas tout appliqué.
  Relancer le job ou `supabase db push` manuel (voir backup-dr §2 pour l'URL pooler).

---

## 4. Smoke inscription publique (la nouvelle exposition — mig 091)

> C'est le risque le plus frais. Vérifier que ça **marche** ET que la donnée
> atterrit dans le bon État.

### 4.1 Opérateur maritime
1. `/signup` → onglet **Maritime** → remplir avec `SMOKE-MAR-<date>` (IMO bidon ok).
2. Soumettre → écran de confirmation / e-mail de validation attendu.
3. Vérifier en DB :
   ```bash
   psql "$SUPABASE_DB_URL" -c \
     "SELECT id, account_state, jurisdiction_id, created_at
      FROM shipowners WHERE name ILIKE 'SMOKE-MAR-%' ORDER BY created_at DESC LIMIT 1;"
   ```
   - ✅ ligne créée, `jurisdiction_id` non nul.

### 4.2 Opérateur aérien
1. `/signup` → onglet **Aérien** → `SMOKE-AIR-<date>` + un numéro AOC bidon.
2. Soumettre.
3. ✅ ligne opérateur aérien créée (auto-claim par AOC le cas échéant).

- ❌ formulaire absent / 403 → flags pas à true (§3). Si on **ne voulait pas**
  ouvrir le signup : §9 (refermer immédiatement).

---

## 5. Smoke invitation staff (#67) — ⚠️ dépend de l'allowlist Supabase

> **Pré-requis bloquant** : `/auth/setup-password` doit être dans
> **Supabase → Auth → URL Configuration → Redirect URLs** (avec le domaine prod).
> Sans ça, le magic link d'invitation casse à l'arrivée.

1. Se connecter en **SUPERADMIN** → `/admin/staff`.
2. Inviter `smoke-staff-<date>@example.com` avec un rôle + une juridiction.
3. ✅ ligne `profiles` + `user_jurisdictions` créées ; magic link envoyé.
4. Ouvrir le lien (boîte de test) → doit arriver sur **`/auth/setup-password`**
   (et non une page d'erreur de redirection).
   - ✅ pose du mot de passe OK → session établie.
   - ❌ « redirect not allowed » / retour `/login` → **allowlist manquante**.
     Ajouter `/auth/setup-password` dans Supabase puis rejouer.

---

## 6. Smoke simulateur tarif réel (#68)

1. Console staff → page **Simulateur de taxe**.
2. Choisir une juridiction **avec tarif actif** (ex. Somaliland / Djibouti).
   - ✅ bannière **« Tarif officiel : {taux} {devise}/tCO₂ »** + calcul cohérent
     (taxe = CO₂ total × taux unique, plus de taux 20 hardcodé).
3. Choisir une juridiction **sans tarif publié**.
   - ✅ bannière **« tarif non publié »** + calcul/PDF désactivés (**fail-closed**).

Sonde backend équivalente (fail-closed tarifaire) :
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BACKEND_URL/api/v1/tax/calculate" \
  -H 'Content-Type: application/json' -d '{}'
# Juridiction/mode sans tarif → 422 (jamais un 200 à 0 USD silencieux)
```

---

## 7. Smoke invariants fiscaux (Wedge 4)

```bash
# 7.1 Vues invariantes "IMMEDIATE-ALARM" — toutes doivent être VIDES (0 ligne)
psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM v_wallet_balance_drift;"        -- 0
psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM v_transaction_payment_drift;"   -- 0

# 7.2 Immutabilité transactions (mig 089) — DOIT échouer
psql "$SUPABASE_DB_URL" -c \
  "UPDATE transactions SET tax_amount_usd = tax_amount_usd + 1
   WHERE id = (SELECT id FROM transactions LIMIT 1);"
# ✅ Attendu : ERROR (colonne fiscale gelée). Un succès = invariant non actif → BLOQUANT.
```

- ❌ une vue de drift non vide → incident money-correctness, voir backup-dr.
- ❌ l'UPDATE passe → le trigger d'immutabilité n'est pas en place (mig 089 absente).

---

## 8. Nettoyage des données de smoke

```bash
psql "$SUPABASE_DB_URL" <<'SQL'
-- Adapter aux ids relevés ci-dessus. Ordre = respecter les FK.
DELETE FROM wallets       WHERE shipowner_id IN (SELECT id FROM shipowners WHERE name ILIKE 'SMOKE-%');
DELETE FROM shipowners    WHERE name ILIKE 'SMOKE-%';
DELETE FROM user_jurisdictions WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'smoke-staff-%@example.com');
DELETE FROM profiles      WHERE id        IN (SELECT id FROM auth.users WHERE email LIKE 'smoke-staff-%@example.com');
-- auth.users : supprimer via dashboard Auth ou admin API (pas de FK cascade garantie).
SQL
```

Vérifier ensuite que les vues §7.1 sont toujours à 0.

---

## 9. Leviers de retour arrière

| Situation | Levier (du plus doux au plus dur) |
|---|---|
| On veut **refermer le signup public** | `UPDATE app_config SET value='false'::jsonb WHERE key IN ('feature.shipowner_self_service_enabled','feature.air_self_service_enabled');` (effet ≤ 60 s, cache middleware). C'est le DOWN de la mig 091. |
| Backend Go cassé | `flyctl releases -a africgreen` puis `flyctl deploy --image <release-précédente>` / `flyctl rollback`. |
| Frontend cassé | Vercel → Deployments → **Promote** le déploiement précédent. |
| Régression DB d'une migration | **Ne pas** rollback une migration appliquée sur un registre fiscal sans lire backup-dr §3 (blocs DOWN + risque perte de données). PITR si dispo. |

---

## 10. Feuille de sign-off

- [ ] §1 backend `/health` 200 ok
- [ ] §2 `/login` + `/signup` 200, sélecteur de mode visible
- [ ] §3 tip migrations = 091, flags self-service = true
- [ ] §4 signup maritime + aérien créent une ligne (bonne juridiction)
- [ ] §5 invitation staff → `/auth/setup-password` atteignable (**dépend allowlist**)
- [ ] §6 simulateur : tarif officiel affiché + fail-closed sans tarif
- [ ] §7 vues de drift à 0 + UPDATE transactions rejeté
- [ ] §8 données de smoke nettoyées
- [ ] Dette connue notée : **PITR non activé** (backup-dr §2), `supabase-cli@v1` warning Node20 (deadline 16/06)

**Signé** : __________  **Date/heure** : __________  **main SHA** : __________
