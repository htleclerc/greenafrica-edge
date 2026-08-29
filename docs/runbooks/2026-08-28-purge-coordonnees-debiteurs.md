# Purge des coordonnées des débiteurs — 28-29/08/2026

> Fait. Ce document dit ce qui a été retiré, comment ça a été vérifié, et ce
> qui subsiste. Il sert de pièce au registre RGPD et de mode d'emploi si
> l'opération doit être refaite.

## Ce qui était exposé

Le dépôt portait les coordonnées réelles des **74 sociétés** relancées :
**41 adresses électroniques** et **59 numéros de téléphone**, plus des adresses
postales et des noms de contacts. La source unique était
`docs/onboarding/campagne-19aout/` (classeur de suivi + détail navires), entrée
dans le dépôt le 20/08 ; les 18 autres fichiers touchés n'en étaient que des
copies — fixtures de test, plans, commentaires de code.

**Hors périmètre** : les 26 adresses de `docs/onboarding/seeds/01_armateurs.json`
sont **fabriquées** (le seed de juillet inventait ses contacts). Les écarter a
ramené le plancher de réécriture du 17/07 au 20/08, soit de 414 à 90 commits.

> **Méthode qui a permis de le voir** : croiser le dépôt avec la **liste faisant
> foi** extraite des jeux réels, jamais avec une expression régulière. Le
> filtrage heuristique donnait 224 faux positifs — paquets npm scopés,
> identifiants d'erreur Stripe, numéros IMO pris pour des téléphones.

## Phase 1 — le code courant

Commits `2ad0510`, `3332c10` (avant réécriture ; empreintes changées depuis).

- `docs/onboarding/campagne-19aout/` **sorti du dépôt** et gitignoré, comme
  `docs/06_Production_DB` avant lui. Il reste sur les postes qui rejouent
  l'import.
- Les fichiers qui le lisaient s'en affranchissent (voir le piège ci-dessous).
- Les copies passent sur des valeurs manifestement fictives : `.example` pour
  les adresses, `+99 1 NNNN` pour les téléphones, par correspondance **uniforme**
  d'un fichier à l'autre — plusieurs tests se recoupent sur la même valeur.

### Piège : `describe.skipIf` n'empêche pas la lecture

Vitest **exécute le corps d'un `describe.skipIf`** pour collecter les tests ; il
se contente de les marquer sautés. Un `readFileSync` posé là s'exécute malgré le
saut et échoue en `ENOENT` partout où le fichier manque — c'est-à-dire en
intégration continue. **La dérivation entière doit être conditionnelle**, pas
seulement le bloc :

```ts
const AVEC_CLASSEUR = existsSync(CLASSEUR);

function lireDossiers(): ReturnType<typeof parseSuiviArmateurs> {
    if (!AVEC_CLASSEUR) return [];
    return parseSuiviArmateurs(JSON.parse(readFileSync(CLASSEUR, 'utf8')) as unknown[][]);
}

describe.skipIf(!AVEC_CLASSEUR)('…', () => {
    const dossiers = lireDossiers();
    // …
});
```

Et un test qui affirmait une adresse précise tout en lisant le classeur réel
n'affirme plus que sa **forme** — combien, et sur quels dossiers.

## Phase 2 — l'historique

**Deux passes ont été nécessaires.** La première a laissé deux résidus :

1. **`--replace-text` ne touche pas les messages de commit.** Trois messages
   portaient encore une adresse ⇒ ajouter **`--replace-message`**, avec le même
   fichier d'expressions.
2. **`--replace-text` est sensible à la casse.** Cinq variantes
   (`FAROS@FAROSSHIPPING.COM`, `CORAL@Nets.CO.JO`…) avaient survécu ⇒ les
   énumérer explicitement dans le fichier d'expressions.

```bash
git clone --mirror <url> africgreen-backup.git      # sauvegarde, à garder hors ligne
git clone --mirror <url> africgreen-purge.git
cd africgreen-purge.git
git filter-repo --replace-text expressions.txt \
                --replace-message expressions.txt \
                --path docs/onboarding/campagne-19aout --invert-paths
git remote add origin <url>
git push --force origin 'refs/heads/*:refs/heads/*'
```

> **Ne pas utiliser `--mirror` pour la poussée** : GitHub refuse l'écriture sur
> `refs/pull/*` et la commande échoue. Pousser explicitement `refs/heads/*`.

### Vérifier autrement que par `git grep`

Les deux outils réflexes **mentent** ici :

- `git log -S` butait sur un blob PDF corrompu (`._help3.pdf`), abandonnait le
  diff et rendait des **faux négatifs**.
- `git grep` ne voit que les arbres des refs interrogées, pas l'historique.

La seule vérification qui tient est un balayage **blob par blob** :

```bash
git rev-list --objects --branches            # puis filtrer les blobs
git cat-file blob <oid>                      # et chercher dedans, casse comprise
```

**Résultat final : 4 819 blobs lus un par un, zéro donnée réelle**, messages de
commit compris. 57 branches et 1 191 commits préservés, aucune ref perdue.

### Dégât collatéral à anticiper

La réécriture est **mécanique** : elle ignore que du code dépend du fichier
supprimé et des variantes de casse. `develop` avait reçu les correctifs de la
phase 1, **`main` non** ⇒ trois fichiers de test rouges sur `main`, porte CI
bloquée, plus aucun déploiement possible. Réparé par la PR #125.

**Avant de pousser une réécriture, vérifier chaque branche vivante**, pas
seulement celle où le travail a été fait.

## Ce qui subsiste

**22 refs de pull requests** gardent l'ancienne histoire : `refs/pull/102/head`,
puis `refs/pull/104/head` à `refs/pull/124/head` (série contiguë). Quatre
d'entre elles — 121 à 124 — contiennent le classeur entier ; les 18 autres, les
adresses recopiées. Toutes correspondent à des PR fusionnées.

Ces refs sont en **lecture seule côté GitHub** : la réécriture ne peut pas les
atteindre, et elles restent récupérables par
`git fetch origin 'refs/pull/*:refs/pull/*'`.

### Portée réelle du résidu

| | |
|---|---|
| Visibilité du dépôt | privé |
| Forks | 0 |
| Comptes ayant accès | 2 — `htleclerc` (admin), `greengate-st` (write) |
| Clés de déploiement | 0 |

Les deux comptes concernés ont par ailleurs accès à la base de production
entière. Le résidu n'élargit donc l'exposition pour personne.

### Demande au support GitHub

Seul le support peut purger ces refs. À poster sur
https://support.github.com/contact :

> **Repository:** `htleclerc/africgreen` (private)
>
> We completed a history rewrite with `git filter-repo` and force-pushed all 57
> branches, to remove personal contact data under GDPR. Branch history is clean
> and verified — 4 819 blobs checked individually, zero remaining occurrences.
>
> The pull-request refs still point at pre-rewrite commits containing that data.
> These 22 refs are affected: `refs/pull/102/head`, and `refs/pull/104/head`
> through `refs/pull/124/head` (contiguous).
>
> Four of them — `refs/pull/121/head`, `122`, `123`, `124` — still contain
> `docs/onboarding/campagne-19aout/suivi-armateurs.json`, a file holding names,
> email addresses, phone numbers and postal addresses of 74 companies and their
> contacts. The other 18 contain the same addresses copied into test fixtures
> and design documents.
>
> Could you please garbage-collect the unreachable objects and remove these
> pull-request refs, so the data is no longer retrievable via
> `git fetch origin 'refs/pull/*:refs/pull/*'`?
>
> All affected pull requests are merged; none is open.

### L'option qui ne dépend de personne

Repousser le miroir nettoyé dans un dépôt neuf et supprimer l'ancien : efficace
immédiatement, sans support. Coût : perte des 127 PR, des issues, de
l'historique des Actions, des réglages, et surtout des **GitHub Environments
`staging` / `production` et de leurs secrets** (`SUPABASE_DB_URL`,
`FLY_API_TOKEN`, `VERCEL_*`). Disproportionné tant que le dépôt reste privé à
deux comptes — à reconsidérer s'il doit s'ouvrir ou changer de titulaire.

## Copies hors dépôt

Le classeur, les 86 PDF officiels et le dossier de production du 27/08 vivent
sur des postes et des partages. La purge du dépôt ne les concerne pas : c'est
une question de politique de conservation.
