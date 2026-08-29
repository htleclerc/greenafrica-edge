# Bascule du livre maritime sur le paquet de production du 27/08/2026

> Joué en production le **2026-08-28**. Ce document décrit la procédure et
> l'état obtenu, pour qu'un second environnement puisse être aligné.

## Pourquoi

Les 86 références `PRO-2026-064001…064086` de la campagne de recouvrement
étaient occupées en base par des pro-formas issues du seed d'onboarding de
juillet, portant d'autres navires et d'autres montants. Un armateur qui se
connectait au portail voyait une facture différente de celle qu'il avait reçue.
Aucune des lignes du seed n'avait jamais été distribuée (0 envoi, 0 PDF), ce qui
rendait leur annulation légitime.

## Le dossier source ne suit pas le dépôt

`docs/06_Production_DB/` porte les coordonnées réelles de 74 sociétés et de
leurs contacts (adresses postales, e-mails, téléphones). Il est **volontairement
ignoré par git** et doit être copié à la main sur la machine qui joue l'import.

Conséquence pour les tests : `frontend/src/services/ledgerRebase/prodSeeds.test.ts`
vérifie toute la logique sur un jeu **fabriqué**, aux mêmes dimensions que le
vrai. Une dernière série n'atteste la conformité du dossier réel que là où il
est présent, et se met en sommeil ailleurs.

## Où les données atterrissent

Il n'existe pas de tables `armateurs` / `navires` / `proformas` / `relances` :
le portefeuille vit dans les tables du produit (arbitrage de juillet 2026, pas
de tables parallèles).

| Seed | Table | Clé d'idempotence |
|---|---|---|
| armateurs | `shipowners` | `seed_ref = PRO-CONS-2026-NNN` |
| navires | `vessels` | `imo_number` |
| pro-formas | `transactions` (`document_type = PROFORMA`) | `invoice_ref` + `breakdown_json.source` |
| relances | `collection_reminders` | `seed_ref` |

Le slug `arm-<nom>` du dossier n'est **jamais écrit en base**. La clé reste
`PRO-CONS-2026-NNN` : c'est ce que lit `scripts/provision-owner-accounts.ts`, et
c'est ce qui empêche un second import de créer 74 doublons. Le pont entre les
deux est **déduit** de la feuille de campagne puis vérifié bijectif — un seul
conflit interrompt l'import.

## Prérequis

- Migrations **128** (index unique excluant les annulées) et **146** (échéance
  explicite, agent consignataire) appliquées.
- `SUPABASE_URL` — l'URL **HTTPS** du projet, pas la chaîne `postgresql://`
  (celle-ci, c'est `SUPABASE_DB_URL`).
- `SUPABASE_SERVICE_ROLE_KEY`.

> ### N'appliquez pas une migration hors ordre
>
> Le 28/08, la **146** a été appliquée à la production **seule**, alors que son
> fichier ne vivait que sur `develop` et que les 138 à 145 n'étaient pas encore
> passées. Ce raccourci a bloqué la chaîne de déploiement **deux fois de suite** :
>
> 1. `Remote migration versions not found in local migrations directory` — la
>    base connaît une version absente de la branche qui la déploie. Corrigé en
>    portant le fichier sur `main`.
> 2. `Found local migration files to be inserted before the last migration on
>    remote database` — le CLI refuse d'insérer des versions **sous** la dernière
>    appliquée. Corrigé par un `supabase db push --include-all` unique, qui a
>    rebouché le trou 138→145.
>
> Si un raccourci est malgré tout nécessaire : porter le fichier sur la branche
> qui déploie l'environnement **dans le même mouvement**, et reboucher le trou
> avant le déploiement suivant.
>
> Vérifier aussi que l'environnement ne porte pas déjà les vues en avance sur son
> journal : sur staging, `v_navire_recouvrement` existait au format de la mig 145
> alors que le journal était à 142, et la 143 échouait sur
> `cannot drop columns from view`. Remède : `DROP VIEW` (sans `CASCADE`, après
> avoir vérifié qu'aucun objet n'en dépend), les migrations la reconstruisent.

## Séquence

```bash
npx tsx scripts/rebase-maritime-ledger.ts                          # simulation
npx tsx scripts/rebase-maritime-ledger.ts --execute --clean-ghosts # application
npx tsx scripts/provision-owner-accounts.ts                        # simulation
npx tsx scripts/provision-owner-accounts.ts --execute              # aucun e-mail envoyé
```

L'ordre est imposé : **annuler avant d'insérer**. L'inverse bute sur l'index
unique, puisque les références visées sont précisément celles que détiennent les
pro-formas à remplacer.

`--clean-ghosts` neutralise en plus ce que le seed de juillet a laissé sur le
rail maritime : pro-formas jamais distribuées, relances et paiements fictifs.
Les deux scripts sont **idempotents** — un second passage n'écrit rien.

## Vérifications après bascule

```sql
-- 86 pro-formas vivantes, 1 316 124,00 USD
SELECT breakdown_json->>'source' AS src, status, count(*), sum(tax_amount_usd)
  FROM public.transactions GROUP BY 1, 2;

-- exactement une ligne vivante par référence
SELECT invoice_ref FROM public.transactions
 WHERE invoice_ref LIKE 'PRO-2026-064%'
 GROUP BY 1 HAVING count(*) FILTER (WHERE status <> 'VOID') <> 1;

-- aucun profil posé sur deux armateurs
SELECT count(*), count(DISTINCT profile_id)
  FROM public.shipowners WHERE profile_id IS NOT NULL;
```

Contrôle fonctionnel : IMO `9161182` ou l'adresse du dossier `PRO-CONS-2026-004`
sur `/login` → le portail liste `PRO-2026-064003`, 44 244 USD, échéance
10/09/2026.

## Pièges rencontrés

- **La simulation doit rejouer les effets des étapes précédentes.** Deux bugs de
  la même famille : sans mémoriser les lignes annulées à l'étape 1, la
  simulation annonçait « 0 pro-forma à créer » ; et la requête de nettoyage,
  filtrée sur `status <> 'VOID'`, ne voyait plus après exécution les lignes
  qu'elle venait d'annuler — elle ratait les relances et paiements fictifs
  qu'elles portent. Ce second cas est **invisible en simulation**, qui n'annule
  rien : elle comptait juste, l'exécution comptait zéro.
- **`debtor_response_type` n'a pas de valeur `PENDING`** — le dossier l'emploie
  au sens de « sans réponse », ce que le schéma nomme `SILENT`. La traduction
  est close : une valeur inconnue interrompt l'import plutôt que de retomber
  silencieusement sur le défaut de la colonne.
- **`reminder_tier` n'a pas `FINAL_15D`** : le palier du dossier décrit le terme
  accordé, pas le rang dans la rampe J3→J45. `MANUAL` est le seul libellé
  honnête, le nom du gabarit garde la trace exacte.
- **Les armateurs sous sanctions ne reçoivent aucune adresse.**
  `billing_cc_emails` *est* la liste d'autorisation du lien magique : y verser
  les adresses du dossier ouvrirait le portail à une partie visée par l'OFAC ou
  les Nations unies. Le dossier les porte — c'est le filtrage qui les retire.

## Points laissés ouverts

- La **pénalité forfaitaire de 20 000 USD** annoncée sur les 86 pro-formas
  (754 % sur celle à 2 653 USD) est conservée en note dans `breakdown_json`,
  **jamais appliquée** : aucune colonne fiscale ne la porte et la règle n'est
  pas tranchée.
- Le `pdf_url` du dossier pointe sur `greengate.africa/proformas/*.pdf`, une
  route qui n'existe pas — les documents passent par des liens signés de
  storage. Les 86 PDF officiels ne sont pas en base.
