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

### Mise à jour du 2026-08-24 — le blocage touche aussi la staging

Le même 403 Depot fait maintenant échouer `flyctl deploy -a africgreen` :

```
ensure depot builder failed, please try again (status 403):
Your account has overdue invoices.
```

Ce n'est **pas** un problème de Dockerfile, contrairement à ce qu'affiche le
tableau de bord Fly (« Your repo Dockerfile build failed », bouton « I've fixed
this on GitHub, retry »). Le build n'a jamais démarré : le 403 tombe pendant
`Waiting for depot builder...`, avant toute lecture du Dockerfile. Modifier le
Dockerfile ou relancer le job ne changera rien tant que la facture n'est pas
réglée.

**Portée réelle.** Les deux environnements sont gelés côté backend Go. Les
machines tournent (`africgreen.fly.dev` et `greengate-prod.fly.dev` répondent
200) mais servent des images anciennes : staging tourne sur
`deployment-01KXV5T8W8D7E60VWYRC3HRJNN`, dernière mise à jour le **2026-07-18**.
Aucun correctif du backend Go ne peut être livré d'ici là.

**Le blocage est au niveau du compte, pas de Depot.** Mesuré le 2026-08-24 :
`fly deploy --remote-only --depot=false --build-only`, qui passe par le builder
distant historique et non par Depot, se fait refuser de la même façon.

```
WARN Failed to start remote builder heartbeat: Your account has overdue invoices.
Error: failed to fetch an image or build from source: Your account has overdue invoices.
```

Aucune option de `flyctl` ne contourne cela : Fly ferme **toute** construction
côté serveur. Ne pas perdre de temps à chercher un drapeau.

**Ce qui reste possible sans build.** Les opérations Machines ne sont pas
concernées : `fly scale count`, `fly machine stop/restart`, `fly secrets set`
fonctionnent (quatre machines détruites le 2026-08-24 sans encombre). La seule
voie de livraison restante est `fly deploy --local-only`, qui construit sur le
poste — exige un démon Docker local en marche, et le push vers le registre reste
à vérifier.

### Le jeton Fly expire aussi — et masque la vraie cause

Le 2026-08-24, une fois la porte CI et les migrations enfin vertes, le job
`Fly.io Backend` a échoué en 8 s sur une **autre** erreur :

```
Error: Authenticate: token validation error
```

Les secrets `FLY_API_TOKEN` des environnements `staging` et `production`
dataient des 18 et 19 juillet et n'étaient plus acceptés. Régénérés le
2026-08-24 avec `fly tokens create deploy -a <app>` — un jeton distinct par
app, pour qu'une fuite sur la staging ne donne pas la prod — puis installés via
`gh secret set FLY_API_TOKEN --env <staging|production>`.

Après quoi le déploiement atteint le builder et retombe sur le 403 ci-dessus.
Retenir l'ordre des couches, il a coûté trois diagnostics successifs :
**porte CI → migrations → jeton → facturation**. Chaque étage masquait le
suivant, et le job en échec ne disait jamais qu'il y en avait un autre derrière.

### Secrets morts à supprimer

Un `SUPABASE_DB_URL` (2026-06-11) et un `FLY_API_TOKEN` (2026-04-17) existent au
niveau **dépôt**. Ils sont invisibles pour les jobs qui déclarent
`environment:`, donc inertes — mais ils apparaissent dans `gh secret list` et
font croire que le secret est à jour alors que c'est la version d'environnement
qui compte. À supprimer une fois la chaîne verte.

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
