# Handoff : refonte des dashboards AfricGreen

## Overview

Refonte des écrans principaux des trois espaces du produit AfricGreen (perception de la taxe carbone maritime) : **armateur**, **admin / autorité**, **opérateur terrain**. L'objectif fixé par le client était la lisibilité et l'attractivité, à partir de trois problèmes constatés sur l'existant :

1. pas d'action suivante claire sur les écrans,
2. navigation confuse,
3. mauvaise expérience sur mobile.

Trois réponses structurelles, appliquées à tous les écrans de ce bundle :

- **La file de travail passe en tête de page.** L'écran s'ouvre sur « N choses à traiter », une liste ordonnée par urgence où chaque ligne porte son montant et son bouton d'action. Les KPI passent en dessous : ils informent, ils ne déclenchent rien.
- **La navigation est regroupée par intention**, pas par entité. Armateur : Piloter / Payer / Justifier. Admin : Suivre / Encaisser / Arbitrer / Configurer.
- **Le mobile est conçu séparément**, pas dérivé du desktop. L'opérateur terrain est traité mobile d'abord.

## About the Design Files

Les fichiers `.dc.html` de ce bundle sont des **références de design produites en HTML** : des prototypes qui montrent l'apparence et le comportement attendus. Ce n'est pas du code de production à copier.

Le travail attendu est de **recréer ces écrans dans l'environnement existant du dépôt** — Next.js (App Router) + React + TypeScript + Tailwind, avec les primitives `Os*` déjà en place (`OsCard`, `OsBadge`, `OsButton`, `OsStatCard`) et les tokens `--os-*` de `frontend/src/app/globals.css`. Aucun nouveau système de style ne doit être introduit : les valeurs listées plus bas correspondent aux tokens existants, et là où une valeur manque au thème, l'ajouter comme token plutôt qu'en dur dans un composant.

Le HTML des prototypes utilise des styles inline et des `<span>` non interactifs à la place des vrais contrôles (boutons, champs, cases à cocher). C'est une contrainte du support de prototypage, pas une intention de design : en implémentation, chaque élément doit devenir l'élément sémantique correct (`<button>`, `<input>`, `<a>`, `<table>`) avec ses états focus et son accessibilité clavier.

## Fidelity

**High-fidelity.** Couleurs, typographie, échelles d'espacement, rayons et copie sont définitifs et repris des tokens du dépôt. Les écrans doivent être recréés fidèlement.

Deux réserves :

- Les **données sont représentatives, pas réelles** : les noms de navires, IMO, montants et dates sont des exemples cohérents avec les mocks du dépôt (`MV BERBERA PRIDE` / IMO 9348576, format de référence `GG-2026-0418`). Ne pas les coder en dur.
- Les **icônes sont représentées par des pastilles rondes de 6–8 px**. C'est un placeholder. En implémentation, utiliser le jeu d'icônes du dépôt (lucide-react) au même emplacement et à la même taille optique. Ne pas livrer les pastilles.

## Screens / Views

Trois fichiers, dix écrans. Chaque option porte un identifiant visible en badge (`1a`, `2b`, `3f`…) qui sert de référence dans les échanges.

### Fichier 1 — `Dashboard Armateur.dc.html` (exploration, archive)

Les deux directions initialement proposées, conservées comme trace de décision :

- **1a — Cockpit emerald affiné** : thème sombre existant, bande d'action rouge pleine largeur en tête.
- **1b — Back-office clair** : fond clair, dense, file de travail en tête.

**Le client a retenu un mélange : la structure de 1b sur le thème sombre de 1a.** C'est ce que contient le fichier 2. Ce fichier 1 n'est pas à implémenter.

### Fichier 2 — `Dashboard Armateur v2.dc.html` (à implémenter)

#### 2a — Vue d'ensemble armateur

**Route cible** : `frontend/src/app/(dashboard)/dashboard/page.tsx`

**Purpose** : l'armateur ouvre l'application, voit ce qu'il doit payer et le paie.

**Layout** — cadre 1200 px, deux colonnes :

- Sidebar : `212px`, fond `#111C18`, bordure droite `1px solid rgba(255,255,255,0.06)`, padding `16px 12px`, `flex-direction: column`, `gap: 20px`. Le bloc « Agent référent » est poussé en bas par `margin-top: auto`.
- Zone principale : `flex: 1`, topbar de `56px` puis contenu en `padding: 24px`, `flex-direction: column`, `gap: 18px`.

Ordre vertical du contenu, qui est le cœur de la refonte :

1. **En-tête de page** — `justify-content: space-between`, `align-items: flex-end`. À gauche le titre-verdict (`22px/600`, `#F1F5F9`) et son sous-titre (`13.5px`, `#8A9BB0`). À droite les actions de page : secondaire fantôme + primaire pleine.
2. **File de travail** — 3 cartes empilées, `gap: 10px`.
3. **Bandeau KPI** — une seule carte en `grid-template-columns: repeat(4, 1fr)`, séparateurs internes en `border-right`. Pas quatre cartes détachées : le bandeau doit lire comme une ligne de contexte, pas comme quatre appels à l'action.
4. **Tableau flotte** — onglets de filtre puis lignes en grille.

**Composants**

*Ligne de file de travail* — `background: #111C18`, `border: 1px solid <accent-28>`, `border-left: 3px solid <accent>`, `border-radius: 11px`, `padding: 16px 18px`, `display: flex`, `justify-content: space-between`, `gap: 20px`. Structure : `[pastille de délai] [titre + méta]` à gauche, `[montant mono 19px] [bouton 40px]` à droite. Les trois accents portent les trois niveaux d'urgence :

| Niveau | Accent | Pastille | Bouton |
|---|---|---|---|
| En retard | `#EF4444` | `En retard · 4 j` | primaire plein `#10B981` |
| Échéance proche | `#EAB308` | `Dans 9 j` | secondaire bordé emerald |
| À vérifier | `#3B82F6` | `À vérifier` | fantôme blanc |

Une seule action primaire pleine par écran, sur la ligne la plus urgente. C'est la règle qui rend l'action suivante lisible ; ne pas la casser en mettant des boutons pleins partout.

*Pastille de délai* — `font-size: 11px`, `font-weight: 600`, `text-transform: uppercase`, `letter-spacing: 0.06em`, `padding: 4px 10px`, `border-radius: 6px`, fond accent à 12 % d'alpha, texte accent, `white-space: nowrap`.

*Cellule KPI* — libellé en IBM Plex Mono `10px`, `letter-spacing: 0.14em`, uppercase, `#8A9BB0` ; valeur en Mono `24px/600`, `#F1F5F9` ; note en `12px`, `#B8C5D4` (ou `#34D399` pour une variation positive).

*Ligne de tableau* — `display: grid`, `grid-template-columns: 1.4fr 1fr 1fr 0.9fr 0.8fr 100px`, `gap: 12px`, `padding: 12px 18px`, `border-bottom: 1px solid rgba(255,255,255,0.05)`. Nom du navire `13.5px/600` + IMO en Mono `11px` `#8A9BB0` en dessous. Montants en Mono, `text-align: right`. Badge de statut `justify-self: start`, action `justify-self: end`.

*Onglets de filtre* — `gap: 6px`, `padding: 6px 12px`, `border-radius: 7px`. Actif : fond `#34D399`, texte `#06120d`, `font-weight: 600`. Inactif : fond `#13231D`, texte `#B8C5D4`. Chaque onglet porte son compte (`Toutes · 6`).

*Élément de nav* — `padding: 9px 10px`, `border-radius: 9px`, `13.5px`. Actif : fond `rgba(16,185,129,0.12)`, texte `#34D399`, `font-weight: 600`, `border-left: 2px solid #10B981`. Les compteurs d'attente sont des pastilles `#EF4444` (bloquant) ou `#EAB308` (à traiter) en Mono `10.5px`.

**Copie exacte** : titre « 3 choses à traiter aujourd'hui », sous-titre « Mis à jour il y a 2 minutes · période fiscale août 2026 », primaire « Payer tout · $100 300 ».

**Mobile (390 px)** : même hiérarchie, une colonne. Carte urgente avec le montant en Mono `26px` et un bouton pleine largeur de `48px`. KPI réduits à deux (Encours, Solde) dans une carte scindée. Barre d'onglets basse à 4 entrées, `padding: 10px 8px 22px` (la marge basse absorbe la zone home). Le bloc simulateur en bas est poussé par `margin-top: auto`.

#### 2b — Ma flotte

**Route cible** : `.../dashboard/vessels/page.tsx`

Deux niveaux de lecture : les navires qui exigent une action sont des **cartes** (grille 3 colonnes, `gap: 14px`, bordure teintée par l'urgence), les navires conformes sont des **lignes de tableau**. Un navire ne demandant rien n'a pas besoin d'une carte.

Carte navire : en-tête nom + badge de statut, puis 4 paires libellé/valeur en `justify-content: space-between` (`12.5px`, libellé `#8A9BB0`, valeur `#B8C5D4`, montants en Mono `#F1F5F9`), puis un bouton pleine largeur de `40px` dont le libellé porte l'échéance (« Payer avant le 31 août »).

En-tête de page : « 6 navires · 2 exigent une action ». Onglets : Tous · 6 / Action requise · 2 / En escale · 2 / Conformes · 3 / Exonérés · 1.

#### 2c — Factures & paiements

**Route cible** : `.../dashboard/invoices/page.tsx`

Deux colonnes : `grid-template-columns: 1fr 380px`, `gap: 16px`, `align-items: start`.

- **Gauche** — liste. Onglets (Ouvertes · 3 / Payées · 12 / Contestées · 1 / Brouillons · 2), puis grille `30px 1.2fr 1.1fr 1fr 0.9fr` : case à cocher, référence + statut, navire, échéance, montant. La ligne sélectionnée porte `background: rgba(16,185,129,0.06)` et `border-left: 2px solid #10B981`. Les factures payées sont à `opacity: 0.72`.
- **Droite** — détail. Décomposition du calcul en paires libellé/valeur séparées par des filets `rgba(255,255,255,0.06)` : émissions retenues, tarif souverain, frais de dossier, pénalité de retard. Puis le total en Mono `28px`, le bouton primaire `46px` portant le montant (« Payer $48 200 »), et deux actions secondaires côte à côte (`flex: 1` chacune). En dessous, le sélecteur de moyen de paiement : trois options radio de `12px 14px`, celle sélectionnée bordée emerald sur fond `rgba(16,185,129,0.06)`. L'option Portefeuille affiche son solde et l'avertit s'il est insuffisant, en `#EAB308`.

Ne pas afficher le montant seul : la décomposition émissions × tarif est ce qui rend la facture contestable ou acceptable, c'est le contenu principal du panneau.

**Mobile** : le panneau de détail devient un écran plein avec les actions ancrées en bas (`margin-top: auto`), primaire `52px` + secondaire `46px`.

#### 2d — Portefeuille

**Route cible** : `.../dashboard/wallet/page.tsx`

Deux cartes en `grid-template-columns: 1.1fr 1fr`, puis le tableau des mouvements.

- **Solde** — Mono `48px/600`, `line-height: 1`. Deux actions : Alimenter (primaire `44px`) et Demander un remboursement (fantôme).
- **Provision recommandée** — carte accent `#EAB308`, `border-left: 3px solid`. Elle énonce le manque en une phrase (« Il manque $116 650 pour couvrir les échéances des 30 prochains jours. », `16px/600`), puis le calcul en trois lignes, puis un bouton dont le libellé porte le montant exact (« Provisionner $116 650 »). C'est le seul endroit du produit où on anticipe au lieu de constater.
- **Mouvements** — grille `1fr 1.4fr 1fr 0.8fr 0.8fr` : date, libellé, référence, montant signé (`+` en `#10B981`, `−` en `#EF4444`), solde courant après opération.

### Fichier 3 — `Dashboard Admin & Opérateur.dc.html` (à implémenter)

Cadres de **1280 px** (l'admin travaille sur écran large), sidebar `216px`.

#### 3a — Admin, cockpit armateurs

**Route cible** : `.../admin/shipowners/page.tsx`

En-tête « 7 armateurs en défaut de paiement » + « $684 300 d'encours · 38 armateurs enregistrés ». Bandeau KPI à **5 colonnes** : Encours total, En retard > 30 j (valeur en `#EF4444`), Encaissé ce mois, Délai moyen, Taux de recouvrement.

Tableau : `grid-template-columns: 1.5fr 0.7fr 0.9fr 1fr 0.9fr 0.9fr 180px`. Chaque ligne porte un `border-left: 2px solid` de la couleur de son niveau d'escalade — c'est ce qui donne l'ancienneté de la dette au premier balayage vertical, avant lecture. La colonne d'actions contient l'action d'escalade appropriée à l'état du dossier (Mise en demeure / Relancer / Arbitrer / Vérifier KYC) plus un lien « Fiche ». Tri par défaut : ancienneté de la dette.

La sidebar admin est marquée par un bandeau « Console autorité » (`#13231D`, pastille `#EAB308`) sous le logo : elle évite qu'un agent confonde son espace avec celui d'un armateur.

#### 3b — Admin, recouvrement

**Route cible** : `.../admin/collections/page.tsx`

Quatre colonnes de file (`repeat(4, 1fr)`, `gap: 14px`), une par étape de la procédure, chacune marquée par un `border-top: 2px solid` : Relance 1 J+3 (`#EAB308`), Mise en demeure J+15 (`#F97316`), Escalade autorité J+45 (`#EF4444`), Réglés cette semaine (`#10B981`). Chaque colonne affiche son compte, son montant cumulé, deux ou trois dossiers en aperçu, un « +N autres », et une action de lot en pied (« Envoyer les 5 relances »).

Le sous-titre de page énonce la règle appliquée : « relance à J+3, mise en demeure à J+15, escalade autorité à J+45 ». L'agent doit voir la règle, pas la deviner.

En dessous, le dossier prioritaire en trois panneaux séparés par des `border-right` : **Historique** (timeline à pastilles), **Exposition** (encours, navires, prochaine escale, historique de paiement), **Action suivante** (une phrase qui dit la conséquence concrète — blocage de l'appareillage — puis les deux boutons : escalader, ou accorder un échéancier).

#### 3c — Admin, validations

**Route cible** : `.../admin/validations/page.tsx`

Une carte par élément à arbitrer. Pour un conflit de données, le corps est une **grille de comparaison à trois colonnes** (`180px 1fr 1fr`) : nom du champ, valeur déclarée par l'armateur, valeur de la source officielle. Les valeurs qui divergent sont colorées (`#EAB308` pour le déclaré, `#10B981` pour la source) ; les valeurs identiques restent neutres, pour que l'œil aille droit à l'écart. Un pied de carte sur `#0d1714` chiffre la conséquence : « Impact sur la facture : $26 100 → $28 590 (+$2 490) ».

Actions par carte : Rejeter (bordé `#EF4444`) et Approuver (primaire plein), toutes deux en `white-space: nowrap`. Action de page : « Approuver les 7 conformes » — le traitement en lot est l'usage normal, l'arbitrage à l'unité l'exception.

#### 3d — Opérateur terrain (mobile d'abord)

**Routes cibles** : `.../operator/arrivals/page.tsx` et `.../operator/collect/page.tsx`

Conçu pour une main, debout, réseau intermittent. Deux écrans de 390 px.

**Navires entrants** — l'en-tête porte un état réseau explicite : « Hors ligne · 2 en attente » (`#EAB308`, pastille). Les navires sont triés par imminence d'accostage, pas par ordre alphabétique. La carte du navire imminent porte l'alerte de solvabilité de l'armateur en clair (« Armateur en défaut — $128 400 impayés. Appareillage soumis à autorisation. ») et deux actions de `50px` et `44px` : encaisser, ou signaler à l'autorité.

**Encaissement** — identification du navire (avec l'heure de scan), décomposition taxe + arriérés, total en Mono `28px`. Sélecteur de moyen en grille `1fr 1fr` de tuiles de **56px** (espèces, mobile money, chèque, virement) : au guichet on tape vite et large. Montant reçu avec vérification du reliquat. Action finale « Valider et imprimer le reçu » (`54px`), et sous elle la règle hors ligne énoncée : « le reçu est numéroté localement et synchronisé au retour du réseau ».

Aucune cible tactile sous 44 px sur ces deux écrans.

#### 3f — Thème clair

Le même écran que 3a, en thème clair, pour comparaison. Le mapping est direct et vaut pour tous les écrans (voir la table des tokens). Rien d'autre ne change : mêmes grilles, mêmes tailles, mêmes composants. La bascule doit donc être une affaire de tokens, pas de variantes de composants.

## Interactions & Behavior

**Navigation** — sidebar persistante, section active marquée par le fond emerald à 12 % et le liseré gauche de 2 px. Les compteurs de la nav sont des états réels (factures ouvertes, dossiers en recouvrement, validations en attente), à rafraîchir avec les données.

**Actions de ligne** — un clic sur une ligne de file ou de tableau ouvre le détail ; le bouton de la ligne déclenche l'action directement sans passer par le détail. Séparer les deux zones de clic proprement (`stopPropagation` sur le bouton).

**Sélection multiple (factures)** — les cases à cocher pilotent le libellé du bouton primaire de page, qui affiche le total sélectionné. Sans sélection, il retombe sur « Payer tout · $<total ouvert> ».

**États d'attente** — chaque tableau et chaque file a besoin de trois états en plus du nominal :
- *chargement* : squelettes aux dimensions des lignes réelles, pas de spinner centré ;
- *vide* : et c'est un bon état pour l'armateur — « Rien à traiter. Toutes vos taxes sont à jour. » plutôt qu'une illustration neutre ;
- *erreur* : message + action de réessai, jamais un tableau vide silencieux.

**Hors ligne (opérateur)** — le bandeau de la topbar indique l'état et le nombre d'opérations en attente de synchronisation. Les reçus émis hors ligne sont numérotés localement puis réconciliés. Le comportement doit être visible dans l'UI, pas seulement géré côté données.

**Transitions** — sobres : `150ms ease-out` sur les fonds de survol et les changements d'onglet. Pas de mouvement sur les chiffres ni sur les lignes de tableau ; ces écrans se lisent, ils ne s'animent pas.

**Responsive** — trois paliers. ≥1280 px : sidebar déployée, grilles pleines. 768–1280 px : sidebar en icônes seules, KPI en `repeat(2, 1fr)`, colonnes de tableau secondaires masquées (position, type). <768 px : maquettes mobiles de ce bundle — file de travail en cartes, barre d'onglets basse, panneaux de détail en écrans pleins.

## State Management

Par écran, ce dont l'implémentation a besoin :

- **Vue d'ensemble** : file d'actions (dérivée des factures ouvertes triées par urgence), agrégats KPI, flotte résumée. Un seul appel agrégé de préférence, la page ne doit pas se peupler par morceaux.
- **Ma flotte** : liste des navires + filtre actif (`tous | action | escale | conformes | exonérés`). Le filtre est dans l'URL pour rester partageable.
- **Factures** : liste + filtre + `selectedInvoiceId` (pilote le panneau de détail) + `selectedIds[]` (pilote le paiement groupé) + moyen de paiement retenu.
- **Portefeuille** : solde, provision recommandée (calculée : échéances 30 j − solde), mouvements paginés.
- **Admin cockpit / recouvrement** : liste d'armateurs, filtre, tri, dossier ouvert. Les actions d'escalade sont mutantes et doivent invalider la liste et les compteurs de nav.
- **Validations** : file d'éléments par type, avec pour chacun le couple valeur déclarée / valeur source et l'impact chiffré. Approbation unitaire et en lot.
- **Opérateur** : arrivées du quart, encaissement en cours (navire, moyen, montant), file de synchronisation hors ligne persistée localement.

## Design Tokens

Tous repris de `frontend/src/app/globals.css`. Le thème clair est un remplacement 1:1.

### Couleurs

| Rôle | Sombre | Clair |
|---|---|---|
| Fond application | `#0A1110` | `#F0FAF4` |
| Surface carte / sidebar | `#111C18` | `#FFFFFF` |
| Surface enfoncée (topbar, en-tête tableau) | `#0d1714` | `#F5FBF8` |
| Surface secondaire (onglet inactif, champ) | `#13231D` | `#F5FBF8` |
| Bordure | `rgba(255,255,255,0.06)` | `rgba(5,150,105,0.14)` |
| Bordure de ligne | `rgba(255,255,255,0.05)` | `rgba(5,150,105,0.10)` |
| Texte principal | `#F1F5F9` | `#1A2E25` |
| Texte secondaire | `#B8C5D4` | `#2D4F3E` |
| Texte tertiaire / libellés | `#8A9BB0` | `#6B8F7D` |
| Libellé de section (nav) | `#5c7267` | `#8aa79a` |
| Accent primaire | `#10B981` | `#059669` |
| Accent clair / lien | `#34D399` | `#04674a` |
| Texte sur primaire | `#06120d` | `#FFFFFF` |
| Danger | `#EF4444` | `#DC2626` |
| Avertissement | `#EAB308` | `#CA8A04` |
| Intermédiaire (mise en demeure) | `#F97316` | `#EA580C` |
| Information | `#3B82F6` | `#2563EB` |
| Pastille inactive | `#3d5148` | `#cbdfd5` |

Règle de fond teinté : accent à **12 %** d'alpha en sombre, **8–10 %** en clair. Bordure teintée : **28 %** en sombre, **30 %** en clair.

### Typographie

`IBM Plex Sans` pour le texte, `IBM Plex Mono` pour tout ce qui est chiffre, référence, IMO ou libellé technique en capitales. Le monospace n'est pas décoratif : il aligne les montants en colonne et rend les IMO comparables.

| Usage | Taille / graisse | Détail |
|---|---|---|
| Titre de page | 22 px / 600 | `letter-spacing: -0.01em` |
| Sous-titre de page | 13.5 px / 400 | texte tertiaire |
| Titre de carte / section | 14–15 px / 600 | |
| Corps | 13 px / 400 | |
| Méta, note | 11.5–12.5 px / 400 | |
| Libellé technique (Mono) | 10 px / 400 | uppercase, `letter-spacing: 0.14em` |
| En-tête de tableau (Mono) | 10 px / 400 | uppercase, `letter-spacing: 0.12em` |
| Valeur KPI (Mono) | 23–24 px / 600 | |
| Montant en ligne (Mono) | 13–13.5 px | aligné à droite |
| Montant de détail (Mono) | 19 px / 600 | file de travail |
| Total (Mono) | 28 px / 600 | panneau facture, encaissement |
| Solde (Mono) | 48 px / 600 | portefeuille, `line-height: 1` |
| Pastille de statut | 11 px / 600 | uppercase, `letter-spacing: 0.04–0.06em` |

### Espacement

Échelle `4px`. Valeurs utilisées : `gap` 3 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 px ; padding de contenu `24px` ; padding de carte `16–22px` ; padding de ligne de tableau `12–13px 18px` ; padding de sidebar `16px 12px`.

### Rayons

`5px` badge d'option · `6px` pastille de délai · `7px` onglet · `8px` bouton de ligne, champ · `9px` élément de nav, bouton `38px` · `10–11px` bouton, carte de file · `11–13px` carte · `14px` cadre de fenêtre · `20px` pastille de statut · `26px` cadre mobile · `50%` avatar, pastille de nav.

### Hauteurs de contrôle

`38px` action tertiaire · `40px` bouton de page et de ligne · `44px` action mobile secondaire, tuile de moyen de paiement · `46px` action mobile de confirmation · `48–50px` action mobile primaire · `54–56px` action opérateur (guichet) et tuile de moyen. Jamais moins de `44px` sur mobile.

### Ombres

Une seule, pour poser les cadres de maquette : `0 30px 80px rgba(0,0,0,0.45)` en sombre, `0 30px 80px rgba(0,0,0,0.35)` en clair. Les cartes internes n'ont pas d'ombre — elles se distinguent par la surface et la bordure. Ne pas ajouter d'élévation en implémentation.

## Assets

- **Logos** : `brand/logo/png/logo-on-dark-alpha.png` et `logo-on-light-alpha.png`, hauteur de rendu `20–24px`. Ce sont les logos officiels du dépôt, détourés (fond rendu transparent) pour ce bundle. En implémentation, utiliser les assets de marque du dépôt ; le SVG est préférable au PNG s'il existe.
- **Icônes** : aucune fournie. Les pastilles rondes des maquettes sont des placeholders, à remplacer par lucide-react (déjà présent dans le dépôt).
- **Polices** : IBM Plex Sans et IBM Plex Mono, chargées ici depuis Google Fonts. À auto-héberger via `next/font` en production.
- **Aucune image** n'est utilisée : ces écrans sont du texte, des chiffres et de la structure.

## Files

| Fichier | Contenu | À implémenter |
|---|---|---|
| `Dashboard Armateur v2.dc.html` | 2a vue d'ensemble, 2b ma flotte, 2c factures, 2d portefeuille (+ mobiles 2a, 2c) | oui |
| `Dashboard Admin & Opérateur.dc.html` | 3a cockpit, 3b recouvrement, 3c validations, 3d opérateur mobile ×2, 3f thème clair | oui |
| `Dashboard Armateur.dc.html` | 1a et 1b, les deux directions initiales | non — trace de décision |
| `brand/logo/png/logo-on-dark-alpha.png` | logo, thème sombre | asset |
| `brand/logo/png/logo-on-light-alpha.png` | logo, thème clair | asset |

Les `.dc.html` s'ouvrent directement dans un navigateur. Chaque écran porte son badge d'identifiant en haut à gauche.

### Sources lues dans le dépôt

`htleclerc/africgreen@main` — `frontend/src/app/globals.css` (tokens), `components/dashboard/layout/DashboardShell.tsx` (structure et nav), `components/dashboard/overview/{ArmateurKpiRow,NextPaymentCard,PendingActionsPanel}.tsx` (widgets remplacés), `components/ui/{OsCard,OsBadge,OsButton,OsStatCard}.tsx` (primitives à réutiliser), `mock/datas/` (conventions de données).
