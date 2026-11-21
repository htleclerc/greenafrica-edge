# Plan de refonte — « Agbé » Togo (mono-pays, clés en main, duplicable)

**Date** : 2026-11-21 · **Statut** : proposition à valider · **Nom « Agbé »** : provisoire

Maquette de démonstration : canvas « Agbé Togo — maquette » (5 écrans), sources dans
[`maquette/`](maquette/).

---

## 0. Préalable juridique (à traiter avant tout envoi à un client)

Le moteur a été développé dans le cadre du projet Green Gate. Avant de livrer un dérivé au Togo :

1. **Relire le contrat avec Green Gate / Solide Tech** : à qui appartient le code (cession, licence,
   co-propriété) ? Y a-t-il une clause d'exclusivité, de non-concurrence ou de confidentialité
   (zones géographiques, durée) ? Les méthodes et paramètres fournis par eux sont-ils confidentiels ?
2. **Ne rien reprendre de leur matière** : ni textes, ni dossiers de présentation
   (`AfricGreen_Dossier_*.docx`, `Rapport_Activite_*`, communiqué Berbera), ni logos (`brand/`),
   ni captures, ni maquettes (`design_handoff_dashboard_redesign/`). Ces fichiers sont retirés du dépôt
   Togo (cf. §6.1).
3. **Recherche d'antériorité** sur le nom retenu (OAPI pour le Togo) et réservation du domaine.

Ce plan rend la ressemblance *visuelle et éditoriale* nulle ; il ne remplace pas un avis juridique
sur la *propriété du moteur*.

---

## 1. Principe : un moteur, des habillages pays

```
┌──────────────────────────── MOTEUR (commun, privé) ────────────────────────────┐
│ calcul d'émissions · barèmes versionnés · détection d'escales/vols · avis ·    │
│ encaissements & rapprochement · relances · réclamations · quittances scellées · │
│ audit · rôles & RLS · API                                                      │
└────────────────────────────────────────────────────────────────────────────────┘
          ▲ lit un « kit pays » (config + contenus + marque) au démarrage
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ countries/tg│  │ countries/bj│  │ countries/xx│   ← un dossier par pays
└─────────────┘  └─────────────┘  └─────────────┘
          ▼ un déploiement isolé par pays
   agbe.tg (Vercel) · api.agbe.tg (Fly) · Supabase dédié · domaine, clés, données séparés
```

- **Mono-pays par déploiement** : une instance = un pays = une base. Pas de sélecteur de pays,
  pas de données mélangées, souveraineté et hébergement négociables pays par pays.
- **Dupliquer = créer un dossier `countries/<iso>`** + provisionner l'infra, sans toucher au moteur.
- Le moteur reste un seul code, versionné ; chaque pays épingle une version.

---

## 2. Ce qu'on garde (le moteur)

| Domaine | Code actuel | Devenir |
|---|---|---|
| Calcul maritime / aérien | `backend/internal/tax`, `emissions`, `methodologies`, `tariff`, `greengate` (calc) | Gardé. `greengate` renommé `engine/calc`. |
| Détection | `eez`, `geofence`, `fir`, `corridor`, `ais`, `geo` | Gardé, paramétré par le kit pays (zones, FIR, points d'entrée). |
| Cycle de l'avis | proformas, échéances net-30, relances, réclamations (`alerts`, `reconcile`) | Gardé, vocabulaire renommé (§5). |
| Encaissements | rails de paiement, portefeuilles, rapprochement, remboursements | Gardé ; ajout d'un rail **Mobile Money** (§7). |
| Intégrité | chaîne de hash / ancrage (ADR-001), journal d'audit inviolable (mig. 018) | Gardé tel quel. |
| Rôles, RLS, MFA, sessions | migrations 001-004, 020-021, 166 | Gardé. |
| Config par juridiction / mode | `modeconfig`, `appconfig`, `jurisdiction_mode_config` | Gardé ; une seule juridiction active par instance. |

Le schéma Supabase est **consolidé** (160 migrations → une migration de base `0001_engine.sql`
+ seeds du kit pays), pour qu'une nouvelle instance démarre propre et sans trace Somaliland.

---

## 3. Ce qu'on refait entièrement (la forme)

Tout ce qu'un usager, un ministère ou un concurrent peut voir :

- **Design system** : nouveau jeu de jetons, nouvelles polices, nouveaux composants (les `Os*` sont
  remplacés, pas re-skinnés) — cf. charte dans la maquette.
- **Architecture d'information** et navigation (§6.2).
- **Tous les contenus publics** : accueil, pages explicatives, FAQ, textes légaux, e-mails, SMS,
  PDF d'avis et de quittance, pages d'erreur, métadonnées, images de partage, favicon.
- **Vocabulaire métier** (§5) et ton éditorial.
- **Identité** : nom, logo, domaines, adresses d'expédition des e-mails.
- **Positionnement** : service public de contribution, pas « plateforme souveraine de surveillance ».

---

## 4. Différenciation, point par point

| Dimension | Green Gate (existant) | Agbé (Togo) |
|---|---|---|
| Thème | Sombre, vert émeraude vif `#10B981` (vert bleuté, lumineux, sur fond noir) | Clair « papier » `#FBFAF7`, **vert palme `#23703A`** et vert forêt `#154A26` (verts profonds, tirant sur le jaune), safran `#F2A900` |
| Typo | IBM Plex Sans / Arabic, Plex Mono | Bricolage Grotesque (titres) + Public Sans (texte) |
| Libellés | Petites capitales espacées | Casse normale, phrases courtes |
| Navigation app | Barre latérale icônes 56 px | Onglets horizontaux (opérateur) ; menu texte clair (pilotage) |
| Formes | Cartes sombres, bordures 6 % | Cartes blanches, boutons pilule 48 px, champs bordure encre |
| Métaphore | Centre de commandement, radar « The Eye », dark fleet | Guichet unique : escale → avis → paiement → quittance |
| Écran d'entrée public | Hero « Sovereign carbon intelligence » + simulateur de revenus État | « Vérifier et payer un avis », sans compte |
| Vocabulaire | Carbon tax, proforma, armateur, navire, command center | Contribution climatique, avis, quittance, opérateur, escale, pilotage |
| Langues | EN, SO, AR, FR, PT, SW | FR (référence), EN ; éwé/kabiyè en option pour les pages publiques |
| Paiement | Carte, virement, Flutterwave, Payoneer | T-Money, Flooz, carte, virement — montants en FCFA sans décimales |
| Cible du discours | Gouvernements (vente B2G) | Usagers (agents, compagnies) d'abord ; l'État a son espace « Pilotage » |
| Couverture | Multi-pays (sélecteur de juridiction) | Un seul pays, aucune mention d'autres pays |

---

## 5. Lexique (code + interface)

| Concept moteur | Interface Agbé | Nom de code (nouveau) |
|---|---|---|
| proforma / invoice | Avis de contribution | `notice` |
| receipt | Quittance | `receipt` |
| armateur / owner | Opérateur (armateur, compagnie aérienne) | `operator` |
| agent local | Agent / consignataire | `agent` |
| voyage / passage ZEE | Escale (maritime) / Vol (aérien) | `call` / `flight` |
| dispute | Réclamation | `claim` |
| exemption | Exonération | `exemption` |
| dashboard staff | Pilotage | `console` |

Le renommage côté code se fait **dans la couche d'exposition** (API, types front, i18n) ; les tables
internes peuvent garder leurs noms au début, puis migrer quand le moteur est stabilisé.

---

## 6. Refactoring du dépôt

### 6.1 Nettoyage (semaine 1)

- Supprimer du dépôt Togo : `*.docx`, `*.pdf` de racine, `brand/`, `design_handoff_dashboard_redesign/`,
  `qa-screenshots/`, `docs/*GreenGate*`, `docs/prd_*`, `AfricGreen*`, `schema_dump.sql`, `push_all.bat`.
- Renommer le module Go `github.com/htleclerc/africgreen/backend` → `github.com/htleclerc/greenafrica-edge/engine`,
  `cmd/greengate-calc` → `cmd/calc`, package `internal/greengate` → `internal/calc`.
- Retirer les migrations et seeds spécifiques (ex. `150_local_bank_account_somaliland.sql`) au profit des seeds du kit pays.
- **Garde-fou CI** : un job échoue si le build (front, PDF, e-mails, API) contient `Green Gate`, `GreenGate`,
  `Green-Gate`, `Africgreen`, `Somaliland`, `Berbera`, `Solide`, ou les anciennes couleurs `#10B981` / `#34D399` / `#0A1110` (le vert Agbé est volontairement plus sombre et plus chaud que l'émeraude Green Gate).

### 6.2 Arborescence cible

```
greenafrica-edge/
├── engine/                 # ex-backend Go (moteur, API, workers)
├── supabase/               # migration de base consolidée + tests RLS
├── apps/web/               # Next.js générique (lit le kit pays)
│   └── src/
│       ├── design/         # jetons Agbé + composants (Button, Field, Notice, StatusChip…)
│       ├── features/public/      # accueil, vérifier & payer, contrôle quittance, textes
│       ├── features/operator/    # espace opérateur
│       └── features/console/     # pilotage autorité
├── countries/
│   ├── _schema/country.schema.ts # schéma Zod du kit pays (validé au build et au démarrage)
│   └── tg/
│       ├── country.json    # ISO, devise, fuseau, langues, points d'entrée, modes actifs
│       ├── brand.json      # nom affiché, logo, jetons de couleur éventuels (même charte, nuance pays)
│       ├── tariffs/        # barème versionné + texte de référence
│       ├── geo/            # ZEE, zones portuaires, FIR (GeoJSON)
│       ├── payments.json   # rails actifs et comptes officiels (sans secret)
│       ├── content/fr/*.md # pages publiques, FAQ, mentions légales
│       ├── content/en/*.md
│       └── templates/      # e-mails, SMS, PDF avis/quittance
├── scripts/new-country.ts  # génère countries/<iso> + check-list d'infra
└── docs/adr/
```

### 6.3 Carte des routes (ancien → nouveau)

| Ancien | Nouveau | Note |
|---|---|---|
| `/` (landing multi-pays) | `/` | Refait : « Vérifier et payer un avis » |
| `/pay`, `/pay/claim`, `/verify/[ref]` | `/avis`, `/avis/[ref]`, `/quittance/[ref]` | Parcours sans compte (écran 2 de la maquette) |
| `/carbon-tax`, `/how-to-pay`, `/legal-basis` | `/comprendre`, `/bareme` | Contenus du kit pays |
| `/owner/*`, `/dashboard/my-fleet`, `/dashboard/invoices`, `/dashboard/wallet` | `/espace/*` | Espace opérateur (écran 3) |
| `/admin/*`, `/dashboard/*` staff | `/pilotage/*` | Console autorité (écran 4), menu réduit à 9 entrées |
| `/radar`, `/dashboard/vision`, `/dashboard/tco`, `/ascr` | — | Retirés de la V1 Togo |
| `/carbon-credits`, `/projects`, `/partnership`, `/jurisdictions/[slug]` | — | Retirés (multi-pays / phase 2) |
| `/reports` | `/transparence` | Rapports publics trimestriels |

### 6.4 Fonctionnalités retirées ou différées (V1 Togo)

Radar AIS temps réel et « dark fleet », scraping Equasis (risque juridique), crédits carbone et projets,
simulateur de revenus État, sélecteur de juridiction et de mode, langues SO/AR/PT/SW.
Le moteur garde le code ; il est simplement désactivé par le kit pays.

---

## 7. Spécificités Togo

- **Points d'entrée** : port de Lomé (escales maritimes) et aéroport international de Lomé (vols au départ).
  Zones, FIR et points de mesure à confirmer avec les autorités portuaires et aéronautiques.
- **Devise** : FCFA (XOF), **0 décimale** — vérifier tout le moteur (arrondis, PDF, rapprochement).
- **Paiement** : rail Mobile Money (T-Money, Flooz) via un agrégateur agréé à sélectionner
  (appel d'offres court : frais, délais de reversement, API, conformité BCEAO). Carte et virement conservés.
- **Langues** : français de référence, anglais pour les compagnies étrangères.
- **Données personnelles** : vérifier la loi togolaise applicable et les obligations de déclaration ;
  choisir l'hébergement (local, régional ou UE + réplique) avec l'autorité.
- **Base légale** : l'avis doit citer le texte qui crée la contribution et le barème — à obtenir
  de l'autorité ; sans texte publié, pas de mise en production.

---

## 8. Phasage proposé

| Phase | Durée | Livrable |
|---|---|---|
| 0 | J+1 | Maquette 5 écrans (fait) + ce plan |
| 1. Socle | S1-S2 | Nettoyage §6.1, renommage moteur, kit pays `tg`, schéma Zod, garde-fou CI, migration consolidée |
| 2. Design system | S2-S3 | Jetons et composants Agbé, tests visuels, accessibilité AA |
| 3. Public + opérateur | S3-S5 | Accueil, vérifier & payer, contrôle quittance, espace opérateur, PDF/e-mails/SMS |
| 4. Pilotage | S5-S6 | Console autorité, rapports, exonérations, relances groupées |
| 5. Paiement & recette | S7-S8 | Rail Mobile Money, recette avec l'autorité, tests de charge, audit sécurité |
| 6. Mise en service | S9 | Bascule, assistance, rapport public du 1er trimestre |

**Duplication vers un nouveau pays** après la V1 : `scripts/new-country.ts <iso>`, remplissage du kit,
provisioning (Supabase, Fly, Vercel, domaine) — objectif 2 à 3 semaines, essentiellement du contenu
et de la recette.

---

## 9. Décisions à prendre

1. Nom définitif (Agbé ou autre) et domaine.
2. Autorité contractante au Togo et texte de référence.
3. Modes en V1 : maritime seul, ou maritime + aérien dès le départ.
4. Agrégateur Mobile Money.
5. Hébergement des données.
6. Garde-t-on le moteur dans ce dépôt (mono-repo) ou le sort-on en dépôt privé distinct consommé
   par les pays ? (Recommandation : mono-repo tant qu'il y a moins de 3 pays.)
