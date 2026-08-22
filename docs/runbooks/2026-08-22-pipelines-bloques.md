# Pipelines bloqués — constat du 2026-08-22

Deux pannes d'infrastructure **distinctes et sans rapport entre elles**, aucune
dans le code. Les deux sont invisibles depuis l'application : les URL publiques
répondent, ce sont les *déploiements* qui n'ont plus lieu.

---

## 1. Staging — `SUPABASE_DB_URL` invalide

**Symptôme.** Le job `Supabase Migrations` de `deploy-staging.yml` échoue :

```
failed to connect to postgres: host=aws-0-eu-west-1.pooler.supabase.com
user=postgres.dyjolepwxxsedwngkfox
FATAL: (ENOTFOUND) tenant/user postgres.dyjolepwxxsedwngkfox not found (SQLSTATE XX000)
```

`tenant/user not found` vient de Supavisor : le pooler interrogé n'héberge pas
ce projet. Ce n'est **pas** un mot de passe erroné — ça donnerait
`password authentication failed`. C'est l'hôte (région du pooler) ou la
référence de projet qui ne correspondent plus.

**Portée.** `backend` et `deploy` déclarent `needs: [ci, migrations]` : ils sont
**sautés**, pas en échec. La staging n'est donc plus déployée depuis le
2026-08-21 — sans que rien ne le dise, puisque `healthcheck` dépendait de
`backend` et sautait à son tour.

**La base, elle, est à jour** : les migrations 129 et 130 ont été appliquées à
la main (`supabase db push` en local). Vérifié le 2026-08-22 contre l'hébergé —
colonne `profiles.can_settle_payments` présente, fonction
`sync_vessel_compliance()` présente.

**Correctif.** Recopier la *Connection string* depuis
Supabase → Project Settings → Database, dans le secret `SUPABASE_DB_URL` de
l'environnement GitHub **`staging`**. Prendre la chaîne **Session pooler** ou
**Direct connection** telle que le dashboard la donne : ne pas reconstruire
l'hôte à la main, c'est précisément ce qui a dérivé.

> Repère : le même secret côté environnement `production` **fonctionne** — le
> job `Supabase Migrations` de la prod passe. Seul celui de `staging` est
> périmé.

---

## 2. Production — déploiement backend bloqué par la facturation Fly

**Symptôme.** Le job `Fly.io Backend` de `deploy-production.yml` échoue depuis
le 2026-08-19, sur cinq exécutions consécutives :

```
Error: failed to fetch an image or build from source: error building:
ensure depot builder failed, please try again (status 403):
Your account has overdue invoices. Please update your payment information:
https://fly.io/dashboard/leclerc-drwintech-com/billing
```

**Portée.** Le reste de la chaîne passe : migrations appliquées, Vercel
Production déployé, `greengate.africa` répond 200. L'application Fly
`greengate-prod` répond elle aussi 200 — elle sert **l'image du 2026-08-19**.
Autrement dit, aucune modification du backend Go n'est arrivée en production
depuis cette date, et rien ne le signale côté produit.

**Correctif.** Régler les factures en souffrance sur le compte Fly
`leclerc-drwintech-com`, puis relancer le dernier run de production.

---

## Durcissements posés le 2026-08-22

Le code ne peut pas réparer un secret ni une facture. Ce qui a été corrigé,
c'est le **temps de diagnostic** — les deux pannes se lisaient comme un
problème de migrations :

1. **Préflight `SUPABASE_DB_URL`** dans les deux workflows : vide ou non-URL →
   message d'erreur nommant le secret ET l'environnement. Sur un échec
   `tenant/user`, un `::error::` explique que le secret ne correspond pas au
   projet, au lieu de laisser la trace brute de pgx.
2. **`set -o pipefail`** sur l'étape de push : sans lui, le statut du pipe est
   celui de `tee` et un push en échec passerait pour un succès — les
   déploiements suivants partiraient sur une base non migrée.
3. **`healthcheck` de la staging en `always()`**, aligné sur le correctif posé
   en production le 2026-08-19, avec un pas qui écrit noir sur blanc dans le
   résumé du run : *déploiement incomplet, les contrôles portent sur la version
   déjà en ligne, pas sur ce commit*.
