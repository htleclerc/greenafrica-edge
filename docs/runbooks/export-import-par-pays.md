# Exporter et importer les données d'un pays

Tous les pays partagent aujourd'hui une seule base. Ces deux scripts sortent les données d'**un** pays et les rechargent ailleurs. Ils servent à trois choses :

- **détacher un pays** dans son propre projet, le jour où un État l'exige ;
- **remettre à un État une copie** de ses données, dans un format ouvert ;
- **vérifier**, à chaque exécution, que chaque table est bien rattachée à un pays ou classée comme commune.

Scripts : `scripts/backup/tenant-export.sh`, `tenant-import.sh`, `tenant-roundtrip-test.sh`. Classement des tables : `scripts/backup/tenant-tables.conf`.

## Ce que contient un export

| Dossier | Contenu |
|---|---|
| `tenant/` | Une table par fichier CSV : les lignes du pays, et seulement elles |
| `auth/` | Les comptes que ces lignes citent (personnel du pays, armateurs, agents) |
| `globals/` | Référentiels et réglages communs à tous les pays, en entier |
| `manifest.json` | Pays, date, version de migration, nombre de lignes et empreinte de chaque fichier |

Le format est du CSV avec une ligne d'en-tête, lisible par n'importe quel tableur ou outil de base de données.

## Ce qu'un export ne contient pas

- **Les fichiers du stockage** : PDF de pro-formas, justificatifs de paiement, pièces d'identité. Ils se copient à part, dossier par dossier.
- **Les positions des navires et des aéronefs** : c'est un suivi mondial, pas la donnée d'un État.
- **Les caches et files d'attente** : ils se reconstruisent.
- **Les entrées du journal d'audit sans pays** : elles concernent la plateforme entière.

## Précautions

- Un export porte des **données personnelles** et des **empreintes de mots de passe**. Le dossier par défaut, `backups/`, est ignoré par git : un export ne se committe jamais.
- **Chiffrer avant tout transfert.** Les scripts ne chiffrent pas.
- L'export est en lecture seule sur la base source.
- L'import écrit dans la base cible, dans une seule transaction : en cas d'échec, rien n'est écrit.

## Exporter

```bash
SUPABASE_DB_URL="postgresql://…" ./scripts/backup/tenant-export.sh SO
```

`SO` est le code du pays, tel qu'il figure dans la table `jurisdictions`. Le script affiche le dossier produit et le nombre de lignes.

Il s'arrête sans rien produire si une table du schéma public n'est ni rattachée à un pays ni classée dans `tenant-tables.conf`. Dans ce cas, classer la table, puis relancer.

## Importer

La base cible doit avoir **le même schéma** : les mêmes migrations, jouées jusqu'à la même version que la source au moment de l'export. Le script le vérifie et refuse sinon.

```bash
TARGET_DB_URL="postgresql://…" CONFIRM_TARGET_DB=postgres \
  ./scripts/backup/tenant-import.sh backups/tenant-so-<horodatage>
```

- La cible se passe par `TARGET_DB_URL`, jamais par `SUPABASE_DB_URL`, pour qu'un export et un import lancés dans le même terminal ne visent pas la même base.
- `CONFIRM_TARGET_DB` doit répéter le nom de la base cible.
- Avant d'écrire, le script vérifie l'empreinte de chaque fichier : un export modifié ou tronqué est refusé.
- L'import se rejoue sans dommage : une ligne déjà présente est laissée telle quelle.

Après l'import, il reste à faire à la main : copier les fichiers du stockage, régler l'authentification du nouveau projet (adresses de redirection, envoi d'e-mails), et pointer l'application vers lui.

## Détacher un pays, dans l'ordre

1. Créer le projet du pays et y jouer toutes les migrations.
2. Vérifier que les deux bases sont à la même version de migration.
3. Geler les écritures du pays dans la base partagée (fenêtre de maintenance).
4. Exporter le pays depuis la base partagée.
5. Importer dans le nouveau projet.
6. Copier les fichiers du stockage.
7. Pointer le sous-domaine du pays vers le nouveau projet et vérifier un parcours complet.
8. Seulement ensuite, retirer les données du pays de la base partagée. **Aucun script ne le fait** : c'est une suppression, à décider et à écrire au cas par cas.

Les étapes 3, 7 et 8 ne sont pas outillées aujourd'hui.

## Tester l'aller-retour

```bash
./scripts/backup/tenant-roundtrip-test.sh
```

Le test ne tourne que sur la base locale. Il crée deux bases de travail, y pose deux pays fictifs, exporte le premier, l'importe dans la seconde, puis compare le contenu table par table. Il vérifie aussi qu'aucune ligne du second pays ne passe, qu'un second import ne duplique rien, qu'un export altéré est refusé et qu'une table non classée bloque l'export.

Pour copier la base locale, il coupe les sessions qui y sont ouvertes ; une application de développement branchée dessus se reconnecte d'elle-même.

## Limites connues

- **Ajouter une table** : si elle porte `jurisdiction_id`, elle est exportée d'office ; sinon elle doit être classée dans `tenant-tables.conf`, faute de quoi l'export s'arrête.
- **Demandes d'inscription** : leur pays est un texte libre. L'export retient celles qui nomment le pays par son code ou par son nom ; une saisie approximative lui échappe.
- **Comptes partagés** : un compte cité par deux pays est exporté avec chacun. Il existera donc dans les deux projets après un détachement.
- **Volume** : chaque table est écrite d'un bloc. Rien n'a été mesuré sur une base de taille réelle.
