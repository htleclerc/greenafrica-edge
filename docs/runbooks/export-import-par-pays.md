# Exporter et importer les données d'un pays

Tous les pays partagent aujourd'hui une seule base. Ces scripts sortent les données d'**un** pays et les rechargent ailleurs, **sans supposer que la base d'arrivée est chez Supabase**. Ils servent à :

- **détacher un pays** dans sa propre base, le jour où un État l'exige ;
- **remettre à un État une copie** de ses données, dans un format qu'il peut lire sans nous ;
- **vérifier**, à chaque exécution, que chaque table est bien rattachée à un pays ou classée comme commune.

| Script | Rôle |
|---|---|
| `scripts/backup/tenant-export.sh` | Sort les données d'un pays |
| `scripts/backup/tenant-import.sh` | Les recharge dans une base PostgreSQL qui porte les tables de la plateforme |
| `scripts/backup/tenant-load-plain.sh` | Les charge dans un PostgreSQL nu, sans la plateforme |
| `scripts/backup/tenant-roundtrip-test.sh` | Fait l'aller-retour complet sur deux pays fictifs |
| `scripts/backup/tenant-tables.conf` | Classe les tables qui ne portent pas de pays |

## Ce que contient un export

| Élément | Contenu |
|---|---|
| `tenant/` | Une table par fichier : les lignes du pays, et seulement elles |
| `accounts/` | Les comptes que ces lignes citent (personnel du pays, armateurs, agents) |
| `globals/` | Référentiels et réglages communs à tous les pays, en entier |
| `schema.json` | Chaque table : colonnes, types, clé primaire, clés étrangères |
| `manifest.json` | Pays, date, empreinte du schéma, nombre de lignes et empreinte de chaque fichier |

**Le format est neutre.** Chaque fichier de données est en JSON Lines : un objet JSON par ligne, en UTF-8, dates en ISO 8601, booléens `true`/`false`, tableaux en tableaux JSON, valeur absente en `null`. Rien n'y dépend de PostgreSQL ni de Supabase. Avec `schema.json`, n'importe quel système peut créer les tables et les remplir.

## Ce qu'un export ne contient pas

- **Les fichiers du stockage** : PDF de pro-formas, justificatifs de paiement, pièces d'identité. Ils se copient à part.
- **Les positions des navires et des aéronefs** : c'est un suivi mondial, pas la donnée d'un État.
- **Les caches et files d'attente** : ils se reconstruisent.
- **Les entrées du journal d'audit sans pays** : elles concernent la plateforme entière.
- **Les jetons de connexion à usage unique** : ils sortent vides.

## Précautions

- Un export porte des **données personnelles** et des **empreintes de mots de passe**. Le dossier par défaut, `backups/`, est ignoré par git : un export ne se committe jamais.
- **Chiffrer avant tout transfert.** Les scripts ne chiffrent pas.
- L'export est en lecture seule sur la base source.
- Les deux chargements écrivent dans une seule transaction : en cas d'échec, rien n'est écrit.

## Exporter

```bash
SUPABASE_DB_URL="postgresql://…" ./scripts/backup/tenant-export.sh SO
```

`SO` est le code du pays, tel qu'il figure dans la table `jurisdictions`. Le script s'arrête sans rien produire si une table du schéma public n'est ni rattachée à un pays ni classée dans `tenant-tables.conf`.

## Trois destinations possibles

### 1. Une base qui porte les tables de la plateforme

C'est le cas d'un pays détaché qui continue d'utiliser l'application : sa base est un PostgreSQL où le schéma de la plateforme a été installé. Elle peut être chez Supabase ou hébergée par l'État.

```bash
TARGET_DB_URL="postgresql://…" CONFIRM_TARGET_DB=<nom de la base> \
  ./scripts/backup/tenant-import.sh backups/tenant-so-<horodatage>
```

- Le script compare l'**empreinte du schéma** de l'export à celle de la cible, calculée sur les tables elles-mêmes. Il ne lit aucun journal de migrations propre à un hébergeur.
- Il faut un compte autorisé à suspendre les contrôles pendant le chargement : `postgres` chez Supabase, un superutilisateur sur un PostgreSQL auto-hébergé.
- Les comptes ne sont chargés que si la cible a les tables d'authentification correspondantes. Sinon ils restent dans `accounts/`.
- L'import se rejoue sans dommage : une ligne déjà présente est laissée telle quelle.

### 2. Un PostgreSQL nu

C'est le cas d'un État qui veut ses données dans sa propre base, pour les consulter ou les reprendre dans son système, sans installer la plateforme.

```bash
TARGET_DB_URL="postgresql://…" CONFIRM_TARGET_DB=<nom de la base> \
  ./scripts/backup/tenant-load-plain.sh backups/tenant-so-<horodatage> [schéma]
```

Le script crée les tables à partir de `schema.json`, dans un schéma à part (`greengate_export` par défaut, qui ne doit pas exister), puis les remplit et vérifie les nombres. Les tables arrivent avec leurs colonnes, leurs types et leur clé primaire, sans règles d'accès ni déclencheurs. Un type propre à la plateforme devient du texte.

### 3. Un autre système

Pour une base qui n'est pas PostgreSQL, il n'y a pas de script. L'export suffit : `schema.json` décrit les tables, les fichiers `.jsonl` portent les lignes. `tenant-load-plain.sh` sert de modèle.

## Souveraineté : ce qui est indépendant, ce qui ne l'est pas

| | État |
|---|---|
| Les **données** d'un pays | Indépendantes : format neutre, description des tables fournie, chargement testé hors de la plateforme |
| La **base** d'un pays détaché | PostgreSQL, hébergé où l'État le décide |
| L'**application** | Elle dépend aujourd'hui des composants de Supabase pour la connexion des utilisateurs, la lecture des données et le stockage des fichiers |

Conséquence : un État peut dès maintenant **détenir et héberger ses données**. Pour qu'il fasse aussi **tourner l'application** chez lui, deux voies :

- **Installer chez lui la pile Supabase**, qui est un logiciel libre installable sur ses propres serveurs. L'application fonctionne alors sans modification. Cette voie n'a pas été essayée.
- **Remplacer ces composants** par d'autres. C'est un chantier de réécriture de la couche d'accès aux données, non engagé.

## Détacher un pays, dans l'ordre

1. Préparer la base du pays et y installer le schéma de la plateforme.
2. Geler les écritures du pays dans la base partagée (fenêtre de maintenance).
3. Exporter le pays depuis la base partagée.
4. Importer dans la base du pays ; le script vérifie que les schémas concordent.
5. Copier les fichiers du stockage.
6. Pointer le sous-domaine du pays vers sa base et vérifier un parcours complet.
7. Seulement ensuite, retirer les données du pays de la base partagée. **Aucun script ne le fait** : c'est une suppression, à décider et à écrire au cas par cas.

Les étapes 1, 2, 6 et 7 ne sont pas outillées aujourd'hui. L'application ne sait pas encore s'adresser à une base différente selon le pays.

## Tester l'aller-retour

```bash
./scripts/backup/tenant-roundtrip-test.sh
```

Le test ne tourne que sur la base locale. Il crée des bases de travail, y pose deux pays fictifs, exporte le premier, puis vérifie que :

- l'export ne contient aucune ligne de l'autre pays ;
- après import, le contenu est identique table par table ;
- un second import ne duplique rien ;
- l'export se charge dans une base PostgreSQL entièrement nue, valeurs délicates comprises ;
- l'import de la plateforme refuse une base qui n'a pas ses tables ;
- un export altéré est refusé ;
- une table non classée bloque l'export.

Pour copier la base locale, il coupe les sessions qui y sont ouvertes ; une application de développement branchée dessus se reconnecte d'elle-même.

## Limites connues

- **Ajouter une table** : si elle porte `jurisdiction_id`, elle est exportée d'office ; sinon elle doit être classée dans `tenant-tables.conf`, faute de quoi l'export s'arrête.
- **Demandes d'inscription** : leur pays est un texte libre. L'export retient celles qui nomment le pays par son code ou par son nom ; une saisie approximative lui échappe.
- **Comptes partagés** : un compte cité par deux pays est exporté avec chacun.
- **Comptes** : ils sortent tels que le service d'authentification de la source les range. Les mots de passe y sont des empreintes bcrypt ; un autre système d'identité devra les reprendre ou faire redéfinir les mots de passe.
- **Volume** : chaque table est écrite d'un bloc. Rien n'a été mesuré sur une base de taille réelle.
- **Autre système que PostgreSQL** : le format le permet, aucun chargement n'a été essayé.
