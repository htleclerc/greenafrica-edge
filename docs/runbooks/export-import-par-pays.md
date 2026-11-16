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
| `scripts/backup/tenant-fingerprint.sql` | Calcule l'empreinte du schéma, de la même façon à l'export et à l'import |
| `scripts/backup/tenant-common.sh` | Contrôles communs aux deux chargements : signature, empreinte des fichiers |

## Ce que contient un export

| Élément | Contenu |
|---|---|
| `tenant/` | Une table par fichier : les lignes du pays, et seulement elles |
| `accounts/` | Les comptes que ces lignes citent (personnel du pays, armateurs, agents) |
| `globals/` | Référentiels et réglages communs à tous les pays, en entier |
| `schema.json` | Chaque table : colonnes, types, clé primaire, clés étrangères |
| `manifest.json` | Pays, date, empreinte du schéma, nombre de lignes et empreinte de chaque fichier |
| `manifest.sig` | Signature du manifeste, si l'export a été lancé avec une clé |

**Le format est neutre.** Chaque fichier de données est en JSON Lines : un objet JSON par ligne, en UTF-8, dates en ISO 8601, booléens `true`/`false`, tableaux en tableaux JSON, valeur absente en `null`. Rien n'y dépend de PostgreSQL ni de Supabase. Avec `schema.json`, n'importe quel système peut créer les tables et les remplir.

**Une exception, pour les colonnes de type JSON.** `null` y est une valeur comme une autre. Pour ces colonnes seulement, l'absence de valeur se note par l'absence du champ, et `null` veut dire « la valeur JSON null ». Un système qui recharge l'export doit faire la différence, comme le font les deux scripts de chargement.

Le format porte le numéro `greengate-tenant-export/3`. Les chargements refusent tout autre numéro : un export fait avec une version antérieure des scripts doit être refait.

## Signature : d'où vient un export

Un export décide de ce qui sera écrit dans une base. Il faut donc pouvoir prouver qui l'a produit.

- L'export **signe le manifeste** avec une clé privée (`EXPORT_SIGNING_KEY`). Le manifeste porte l'empreinte de tous les autres fichiers : le signer, c'est signer l'export entier.
- Les deux chargements **vérifient la signature** avec la clé publique correspondante (`EXPORT_VERIFY_KEY`) avant de lire quoi que ce soit. Sans signature valide, ils s'arrêtent.
- Celui qui reçoit un export n'a besoin que de la clé publique : il peut le contrôler, il ne peut pas en fabriquer un.

Créer la paire de clés, une fois :

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out greengate-export.key
openssl pkey -in greengate-export.key -pubout -out greengate-export.pub
```

La clé privée (`.key`) se garde hors du dépôt et hors des dossiers d'export, là où sont gardés les autres secrets. La clé publique (`.pub`) se remet à qui doit vérifier un export, par un canal distinct de celui de l'export.

`ALLOW_UNSIGNED_EXPORT=1` fait sauter la vérification. C'est prévu pour les essais ; sur une vraie base, rien ne prouve alors l'origine de l'export.

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
- Les deux chargements écrivent dans une seule transaction, vérification comprise : en cas d'échec ou d'écart, rien n'est écrit.

## Exporter

```bash
SUPABASE_DB_URL="postgresql://…" EXPORT_SIGNING_KEY=/chemin/greengate-export.key \
  ./scripts/backup/tenant-export.sh SO
```

`SO` est le code du pays, tel qu'il figure dans la table `jurisdictions`. Le script s'arrête sans rien produire si une table du schéma public n'est ni rattachée à un pays ni classée dans `tenant-tables.conf`. Sans `EXPORT_SIGNING_KEY`, l'export sort non signé et le script le signale : les chargements le refuseront.

## Trois destinations possibles

### 1. Une base qui porte les tables de la plateforme

C'est le cas d'un pays détaché qui continue d'utiliser l'application : sa base est un PostgreSQL où le schéma de la plateforme a été installé. Elle peut être chez Supabase ou hébergée par l'État.

```bash
TARGET_DB_URL="postgresql://…" CONFIRM_TARGET_DB=<nom de la base> \
EXPORT_VERIFY_KEY=/chemin/greengate-export.pub \
  ./scripts/backup/tenant-import.sh backups/tenant-so-<horodatage> SO
```

Le second argument est le code du pays que l'opérateur attend. Si l'export en porte un autre, l'import s'arrête.

L'import ne croit pas l'export sur parole. Il commence par en prendre une **copie privée** et ne travaille que sur elle : le dossier reçu n'est ni modifié ni relu, et un lien ou un fichier spécial fait refuser l'export. Puis, dans l'ordre et avant d'écrire :

1. **Signature** du manifeste, puis empreinte de chaque fichier.
2. **Tables visées.** C'est la base d'arrivée qui dit où une table se range, par son propre `tenant-tables.conf` et par la colonne `jurisdiction_id`. Un export qui présente un référentiel commun comme une donnée de pays, ou qui vise une table hors classement, est refusé.
3. **Schéma.** L'empreinte couvre les colonnes, les clés primaires, les index uniques, les contraintes `CHECK` et les clés étrangères entre tables de la plateforme. Elle est calculée sur les tables elles-mêmes, sans lire de journal de migrations, et ne dépend pas des réglages de la session. En cas d'écart, le script nomme les tables qui diffèrent.
4. **Lignes.** Chaque fichier est lu dans une zone d'attente. Le nombre de lignes doit être celui du manifeste, et chaque ligne doit appartenir au pays annoncé : par sa colonne `jurisdiction_id`, ou par le filtre de `tenant-tables.conf` pour les tables qui n'ont pas la colonne. Un profil ou un compte n'est accepté que s'il est cité par une ligne du pays.

Puis il écrit, et **relit chaque ligne dans la cible, valeur pour valeur**, avant de valider la transaction.

- Il faut un compte autorisé à suspendre les contrôles pendant le chargement : `postgres` chez Supabase, un superutilisateur sur un PostgreSQL auto-hébergé.
- Les comptes ne sont chargés que si la cible a les tables d'authentification correspondantes. Sinon ils restent dans `accounts/`.
- L'import se rejoue sans dommage : une ligne déjà présente **et identique** est laissée telle quelle.
- Une ligne déjà présente avec un **contenu différent arrête l'import**, référentiels communs compris. L'export et la cible ne disent pas la même chose, et ce n'est pas au script de choisir. Conséquence pratique : dans une base neuve où l'installation du schéma a déjà posé des référentiels (facteurs d'émission, réglages), il faut les aligner sur ceux de la source, ou les vider, avant d'importer.
- Exception : un **compte** déjà présent est conservé tel qu'il est dans la cible, et le script indique combien sont dans ce cas.
- **Un export ne distribue pas de pouvoirs.** Il n'ajoute pas de moyen de connexion à un compte qui existait avant lui (ces lignes sont écartées et comptées). Il ne crée pas de profil d'administrateur général, sauf si l'opérateur le demande avec `ALLOW_GENERAL_ADMIN_IMPORT=1`. Il ne crée jamais de compte marqué super-administrateur du service d'authentification.
- Si la cible porte déjà, pour ce pays, des lignes que l'export ne connaît pas, l'import aboutit et le signale.

### 2. Un PostgreSQL nu

C'est le cas d'un État qui veut ses données dans sa propre base, pour les consulter ou les reprendre dans son système, sans installer la plateforme.

```bash
TARGET_DB_URL="postgresql://…" CONFIRM_TARGET_DB=<nom de la base> \
EXPORT_VERIFY_KEY=/chemin/greengate-export.pub \
  ./scripts/backup/tenant-load-plain.sh backups/tenant-so-<horodatage> [schéma]
```

Le script vérifie la signature, crée les tables à partir de `schema.json` dans un schéma à part (`greengate_export` par défaut, qui ne doit pas exister), puis les remplit. Avant de valider, il vérifie le nombre de lignes de chaque table et le pays de chaque ligne qui en porte un. Les tables arrivent avec leurs colonnes, leurs types et leur clé primaire, sans règles d'accès ni déclencheurs. Un type propre à la plateforme devient du texte.

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
- après import, le contenu est identique table par table, y compris une valeur JSON `null` et une absence de valeur dans la même colonne ;
- un second import ne duplique rien, même lancé avec d'autres réglages de session ;
- l'export se charge dans une base PostgreSQL entièrement nue, valeurs délicates comprises ;
- l'import de la plateforme refuse une base qui n'a pas ses tables ;
- un export non signé, ou signé par une autre clé, est refusé ;
- un export forgé est refusé même quand on saute la signature : ligne d'un autre pays, fichier renvoyé vers une autre table, nom de table piégé ;
- une ligne déjà présente avec un autre contenu arrête l'import, et rien de ce qu'il avait commencé à écrire ne reste ;
- une contrainte en plus dans la cible fait refuser l'import, qui nomme la table ;
- un export altéré est refusé ;
- une table non classée bloque l'export.

Pour copier la base locale, il coupe les sessions qui y sont ouvertes ; une application de développement branchée dessus se reconnecte d'elle-même.

## Limites connues

- **Ajouter une table** : si elle porte `jurisdiction_id`, elle est exportée d'office ; sinon elle doit être classée dans `tenant-tables.conf`, faute de quoi l'export s'arrête.
- **Demandes d'inscription** : leur pays est un texte libre. L'export retient celles qui nomment le pays par son code ou par son nom ; une saisie approximative lui échappe.
- **Comptes partagés** : un compte cité par deux pays est exporté avec chacun.
- **Comptes** : ils sortent tels que le service d'authentification de la source les range. Les mots de passe y sont des empreintes bcrypt ; un autre système d'identité devra les reprendre ou faire redéfinir les mots de passe.
- **Volume** : chaque table est écrite d'un bloc, et relue ligne à ligne. Rien n'a été mesuré sur une base de taille réelle.
- **Ce qu'un export signé peut écrire** : les référentiels communs (réglages de paiement et de taxe compris, qui valent pour tous les pays), toute table qui porte un pays (rattachements du personnel, paiements, journal), les profils et les comptes. Pendant le chargement, les clés étrangères et les déclencheurs sont suspendus. La signature est donc la protection principale : **n'importer que des exports dont on connaît l'émetteur**, et garder la clé privée comme un secret de production.
- **Références dans le vide** : l'import ne vérifie pas qu'une ligne pointe vers une ligne existante. Une table mère absente de l'export laisserait des références sans cible.
- **Chargement dans une base nue** : il vérifie la signature, les nombres et le pays des lignes qui en portent un, mais ne relit pas les valeurs une à une comme le fait l'import.
- **Rejeu d'un ancien export** : rien ne lie un export à une date ou à une cible. Un export signé reste importable indéfiniment.
- **Empreinte du schéma** : elle ne couvre ni les règles d'accès ni les déclencheurs, ni les contraintes d'exclusion, ni les collations. Deux bases de même empreinte acceptent les mêmes données ; elles ne protègent pas forcément ces données de la même façon.
- **Clés étrangères vers les comptes** : elles sont hors empreinte, pour qu'une base sans le service d'authentification de Supabase puisse recevoir l'export.
- **Tableaux de valeurs JSON** : la distinction entre « pas de valeur » et « JSON null » vaut pour une colonne JSON, pas pour les éléments d'un tableau de JSON. La plateforme n'a pas de telle colonne aujourd'hui.
- **Autre système que PostgreSQL** : le format le permet, aucun chargement n'a été essayé.
