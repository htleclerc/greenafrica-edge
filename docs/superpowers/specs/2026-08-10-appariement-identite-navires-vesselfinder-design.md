# Appariement de l'identité des navires depuis VesselFinder — design

**Date** : 2026-08-10
**Statut** : validé PO, prêt pour plan d'implémentation
**Branche cible** : à créer depuis `origin/develop`

---

## 1. Problème

Le portefeuille maritime de GreenGate repose sur 100 navires importés du package d'onboarding
(migration 093, `seed_ref`). Leur identité est très largement absente :

| Constat (mesuré sur `docs/onboarding/seeds/02_navires.json`) | Valeur |
| --- | --- |
| Navires sans aucun IMO | 73 / 100 |
| …dont le nom est un remplissage `VESSEL-W4-01`, `VESSEL-W5-01`… | 73 / 73 |
| Navires dont l'IMO est du texte libre | 2 — `nav-018 AL HASNAIN` = « à confirmer », `nav-026 ADEL 2` = « Hors registre Equasis » |
| Navires avec un IMO à 7 chiffres valide | 25 |
| Pro-formas maritimes rattachées à un navire | 100 |

Les deux valeurs en texte libre sont écrites **telles quelles** dans `vessels.imo_number` :
`resolveImoNumber` (`frontend/src/services/onboardingImport/mappers.ts`) ne synthétise un
`UNVERIFIED-<seed-id>` que si `imo` est nul ou `'—'`, et retourne la chaîne d'origine sinon. La
base de production contient donc deux navires dont l'identifiant fiscal est une phrase française.

Ces navires portent un `armateur_id`, mais 83 d'entre eux pointent vers `arm-014`, dont la
raison sociale dans le seed est **« À identifier - IMO lookup en cours »** :

| Armateur | Pro-formas | Encours USD | Navires à IMO réel |
| --- | ---: | ---: | ---: |
| `arm-014` « À identifier » | 83 | 1 625 990,91 | 10 / 83 |
| `arm-001` H&P Ship Management | 11 | 174 021,97 | 11 |
| `arm-002` Overseas Marine / Uniseas | 4 | 55 269,66 | 4 |
| `arm-011` Regional Bulk | 1 | 27 370,37 | 1 |
| `arm-018` Comoros Livestock Traders | 1 | 7 000,43 | 1 |

**Conséquence opérationnelle.** Le pipeline AIS rapproche les navires par MMSI
(`frontend/src/services/aisStreamService.ts`, `upsert(..., { onConflict: 'mmsi' })`). Un navire
sans MMSI ne peut jamais être reconnu : chaque escale future crée une ligne neuve, orpheline
d'armateur, qui part en `GHOST` puis en `UNCLAIMED`. Aucune facture n'est émise vers un débiteur
pourtant déjà connu et déjà pourvu d'une adresse e-mail.

Aucune facture n'est jamais partie sur ce portefeuille : les 100 pro-formas maritimes du seed ont
toutes `sent_at` vide.

## 2. La source

Le PO dispose d'un abonnement VesselFinder « Professionnel ». Deux vérifications ont été faites
et closent des hypothèses coûteuses :

- **Pas d'accès API.** La *Fleet key* du profil sert au service de carte embarquée
  (« If you use the Embed map service, this key helps you to visualise only vessels in your
  fleets »). Testée contre `masterdata`, `vesselslist`, `vessels` et `status` de
  `api.vesselfinder.com`, elle renvoie `{"error":"Invalid Userkey!"}`. La clé *Container Tracking*
  ne vaut que pour `container.vesselfinder.com`. L'API AIS est un produit facturé séparément.
- **La donnée arrive par export de fichier.** Deux formats observés :
  - un export de flotte réduit (`IMO, MMSI, FLAG, NAME, TYPE`) — insuffisant ;
  - un **export d'escales portuaires**, qui est la source retenue.

### Contenu de l'export d'escales

Une ligne = un mouvement (`ENTER_ZONE` / `EXIT_ZONE`) sur `Berbera` ou `Berbera Anch.`
(`LOCODE SOBBO`), horodaté UTC, accompagné de la fiche complète du navire et de ses sociétés.

Mesures sur l'export du 1er mai au 3 août 2026 :

| | Valeur |
| --- | ---: |
| Navires distincts identifiés (IMO ≠ 0) | 86 |
| IMO à somme de contrôle invalide | 0 |
| Engins sans IMO (boutres, MSV, caboteurs) | 13 MMSI distincts |
| Adresses e-mail distinctes | 44 |
| Navires du seed (IMO valide) retrouvés | 19 / 25 |

Joignabilité selon la règle de destinataire retenue (§3) :

| Résolu par | Navires |
| --- | ---: |
| `MANAGER_EMAIL` | 32 |
| `OWNER_EMAIL` | 1 |
| `ISM_MANAGER_EMAIL` | 14 |
| aucun e-mail | 39 |
| **joignables** | **47 / 86 (55 %)** |

Le motif est constant : l'`OWNER` est une société mono-navire domiciliée chez un trust
(Majuro, `80 Broad Street` Monrovia) sans adresse électronique ; le `MANAGER` porte le contact réel.

## 3. Décisions du PO

| # | Décision |
| --- | --- |
| D1 | Ingestion par **import de fichier** + **formulaire unitaire**. Pas de connecteur API. |
| D2 | **Table de propositions dédiée** avec colonne `source`. Pas de refonte de la file Equasis. |
| D3 | Application **automatique quand la colonne cible est vide**, **revue humaine en cas de conflit**. |
| D4 | Destinataire de facturation : **`MANAGER_EMAIL`, à défaut `OWNER_EMAIL`, à défaut `ISM_MANAGER_EMAIL`**. |
| D5 | **Aucune facturation des escales** du fichier. Le chantier porte sur l'identité seule. |
| D6 | Les 73 pro-formas à IMO synthétique seront **réémises après appariement** — chantier distinct (§10). |

## 4. Périmètre

**Dans le périmètre**

1. Import et normalisation de l'export d'escales VesselFinder.
2. Écran d'appariement `placeholder ↔ navire réel`, chaque appariement étant une assertion humaine.
3. Application de l'identité (`imo_number`, `mmsi`, `call_sign`, `name`, `flag_code`, `category`,
   `vessel_subtype`, `gross_tonnage_dwt`, `dwt`, `build_year`) au navire apparié.
4. Proposition et application du contact de facturation sur `shipowners`, via la chaîne de confiance.
5. Garde sanctions **à l'import**.

**Hors périmètre**

- Création d'`arrival_alerts` ou de pro-formas à partir des escales du fichier (D5).
- Réémission des 73 pro-formas existantes (D6).
- Écran de fusion de doublons : le cas est détecté et bloqué, pas résolu (§7.4).
- Résolution de `arm-014` en armateurs réels : conséquence attendue du chantier, mais l'écriture
  reste manuelle via l'existant (`/admin/armateurs`).

## 5. Architecture

Quatre unités, chacune testable isolément.

```
export CSV VesselFinder
        │
        ▼
┌───────────────────────┐   parsing positionnel, normalisation,
│ vesselFinderParser.ts │   déduplication par IMO, contrôles de vraisemblance
└───────────┬───────────┘
            ▼
┌────────────────────────────┐   1 ligne = 1 navire distinct
│ vessel_identity_candidates │   (identité + 3 contacts + statut)
└───────────┬────────────────┘
            ▼
┌──────────────────────────┐   écran /admin/vessel-identity
│ appariement humain       │   placeholder VESSEL-* ↔ candidat
└───────────┬──────────────┘
            ▼
┌──────────────────────────┐   applyVesselIdentity (server action)
│ 5 gardes → écriture      │   vessels + shipowners + audit_logs
└──────────────────────────┘
```

## 6. Modèle de données

### 6.1 Migration — nouvelle table

`vessel_identity_candidates` : une ligne par **navire distinct** d'un lot d'import, jamais par
mouvement. La déduplication retient la ligne dont `DATE TIME (UTC)` est la plus récente.

| Colonne | Type | Note |
| --- | --- | --- |
| `id` | UUID PK | |
| `batch_label` | TEXT NOT NULL | nom du fichier + horodatage d'import |
| `source` | TEXT NOT NULL | `VESSELFINDER_PORTCALLS` \| `MANUAL` |
| `imo_number` | TEXT NOT NULL | 7 chiffres, somme de contrôle validée |
| `mmsi` | TEXT | volatil, cf. §9 |
| `call_sign` | TEXT | |
| `vessel_name` | TEXT NOT NULL | normalisé (trim, espaces internes réduits) |
| `flag_code` | CHAR(2) | déjà ISO-3166-1 alpha-2 dans la source |
| `type_raw` | TEXT | `TYPENAME`, ex. « Livestock Carrier » |
| `category` | `public.vessel_category` | dérivée de `type_raw` |
| `gross_tonnage` | INTEGER | colonne `GT` |
| `deadweight` | INTEGER | colonne `DWT` |
| `build_year` | INTEGER | |
| `manager_name` / `manager_country` / `manager_email` | TEXT | |
| `owner_name` / `owner_country` / `owner_email` | TEXT | |
| `ism_manager_name` / `ism_manager_email` | TEXT | |
| `contact_blocked` | BOOLEAN NOT NULL DEFAULT FALSE | posé par la garde sanctions |
| `contact_blocked_reason` | TEXT | |
| `status` | TEXT NOT NULL | `PENDING` \| `MATCHED` \| `CONFLICT` \| `REJECTED` |
| `matched_vessel_id` | UUID REFERENCES vessels(id) | |
| `matched_by` / `matched_at` | UUID / TIMESTAMPTZ | |
| `imported_by` / `imported_at` | UUID / TIMESTAMPTZ NOT NULL | |

Index : `(batch_label, status)`, unique partiel sur `(batch_label, imo_number)`.

RLS : lecture et écriture réservées au personnel (`PORT_OFFICER`, `FINANCE_ADMIN`, `SUPERADMIN`),
sur le modèle de `equasis_scrape_proposals` (migration 040). Table non scopée par juridiction : elle
ne porte aucune créance.

### 6.2 Migration — extension de la chaîne de confiance

`shipowners.official_email_source` est aujourd'hui contraint à
`AGENT_CLAIM | PORT_OFFICER | EQUASIS_VERIFIED`. Ajouter **`VESSELFINDER_VERIFIED`**, au même
niveau de confiance qu'Equasis :

```
AGENT_CLAIM (1) < EQUASIS_VERIFIED (2) = VESSELFINDER_VERIFIED (2) < PORT_OFFICER (3)
```

Effet : une adresse VesselFinder remplace une revendication d'agent, mais **jamais** une saisie
d'officier de port. Le tableau `TRUST` de `frontend/src/services/shipownerService.ts` est étendu en
conséquence.

## 7. Règles de traitement

### 7.1 Parsing — par position, jamais par en-tête

L'en-tête du fichier contient **des noms de colonnes en double** : `TYPE` apparaît en position 4
(code AIS numérique) *et* 14 (`TYPENAME`), `DRAUGHT` en position 5 (tirant d'eau du mouvement)
*et* 22 (tirant d'eau maximal). Un parseur indexé par nom écraserait silencieusement la première
valeur. Le parseur lit **par index**, et échoue bruyamment si l'en-tête ne correspond pas au
gabarit attendu.

| Index | Colonne | Usage |
| ---: | --- | --- |
| 0 | `MMSI` | identité (volatile) |
| 1 | `IMO` | identité (stable) — `0` ⇒ ligne rejetée |
| 2 | `SHIP NAME` | affichage |
| 6 | `EVENT` | `ENTER_ZONE` / `EXIT_ZONE` — non exploité (D5) |
| 5 | `DATE TIME (UTC)` | tri pour la déduplication |
| 9 | `CALLSIGN` | identité |
| 10 | `BUILT` | `build_year` |
| 11 | `FLAG` | `flag_code` (ISO-2) |
| 14 | `TYPENAME` | `type_raw` → `category` |
| 16 | `GT` | → `vessels.gross_tonnage_dwt` |
| 17 | `DWT` | → `vessels.dwt` |
| 24–30 | `MANAGER_*` | contact |
| 31–37 | `OWNER_*` | contact |
| 38–44 | `ISM_MANAGER_*` | contact |

**Le mapping GT/DWT est critique.** `frontend/src/services/proformaPipelineService.ts` transmet
`vessels.gross_tonnage_dwt` à l'API fiscale sous le nom `gross_tonnage` : cette colonne détermine
le montant de la taxe. Confondre GT et DWT fausserait toutes les factures ultérieures. Le mapping
est explicite et couvert par un test dédié.

### 7.2 Contrôles à l'import

Une ligne est **rejetée avec motif** (jamais ignorée silencieusement) si :

| Contrôle | Motif |
| --- | --- |
| `IMO = 0` ou non numérique | engin non identifiable (13 MMSI dans l'export observé) |
| Somme de contrôle IMO invalide | `Σ dᵢ × (7−i) mod 10 ≠ d₇` |
| `FLAG` absent ou hors ISO-2 | `flag_code` est `CHAR(2) NOT NULL` |
| `TYPENAME` inconnu de la table de correspondance | catégorie fiscale indéterminable |
| `LOA < LPP` | incohérence dimensionnelle (observée sur TRUST 1 : LOA 55, LPP 74) |

Le compte rendu d'import affiche le nombre de lignes lues, de navires distincts retenus et de
lignes rejetées par motif.

### 7.3 Appariement

L'appariement est **toujours une assertion humaine**. Le système ne devine pas.

- La cible doit être un navire **non identifié**. Le prédicat n'est **pas** `imo_number LIKE
  'UNVERIFIED-%'` : ce test laisserait de côté `nav-018` (« à confirmer ») et `nav-026`
  (« Hors registre Equasis »), qui sont précisément des navires à identifier. Le prédicat retenu
  est **« l'IMO courant n'est pas un IMO valide »** — sept chiffres et somme de contrôle correcte.
  Il couvre les trois formes de non-identité et refuse tout navire réellement identifié.
- Le gain est immédiat sur l'un des deux : `ADEL 2` figure dans l'export d'escales sous l'IMO
  **7304912**, avec `GULF COAST SHIPPING & TRADING` / `gulf.coastshpg@mail.example` comme manager.
  `AL HASNAIN`, en revanche, n'y apparaît qu'avec `IMO = 0` et reste non résoluble.
- Le nom n'est **jamais** une clé de rapprochement : la source elle-même porte des noms sales
  (`" ELREEDY STAR"` avec espace initial, `ABU YASSER II` / `ABU YASSERII`).
- L'écran propose un tri et une recherche pour aider l'opérateur, sans pré-cocher.

### 7.4 Conflits

| Situation | Comportement |
| --- | --- |
| L'IMO ou le MMSI est déjà porté par une autre ligne `vessels` | statut `CONFLICT`, **aucune écriture**, message explicite |
| La valeur cible est déjà renseignée et diffère du candidat | statut `CONFLICT`, arbitrage humain |
| La valeur cible est `NULL` | application immédiate (D3) |

`vessels.imo_number` est `NOT NULL UNIQUE` : la promotion d'un `UNVERIFIED-nav-042` vers un IMO
réel déjà présent échouerait au niveau base. Le conflit est donc détecté **avant** l'écriture.
Aucun écran de fusion n'est construit : le cas reste théorique tant qu'aucune ingestion AIS réelle
n'a eu lieu sur l'hébergé, et l'inventer serait de la généralisation spéculative.

### 7.5 Contact de facturation et sanctions

Ordre de résolution (D4) : `manager_email` → `owner_email` → `ism_manager_email`.
Écriture via `upsertShipownerEmail(..., 'VESSELFINDER_VERIFIED')`.

**Garde sanctions, appliquée à l'import et non à l'invitation.** L'export contient les coordonnées
d'entités du référentiel sous sanctions :

| Entité | Statut | Apparition dans l'export |
| --- | --- | --- |
| `MORGAN NAVIGATION CO SA` (`arm-013`) | UN | ISM manager de MAYAR, HAJH GHSN J, LILY J — `morgan.navigation@mail.example` |
| `PETROFLEET ENERGY TRADING LLC` (`arm-012`) | OFAC | manager et ISM de MT SAHIL — `info@petrofleetenergy.example` ; owner de BERBERA STAR 7 domicilié « C/O Petrofleet » |

Un candidat dont l'une des trois sociétés correspond à une entité sanctionnée est **importé mais
marqué `contact_blocked`**, avec le motif. Son e-mail n'est jamais proposé comme destinataire ;
l'appariement reste possible (l'identité du navire est licite), l'écriture du contact est refusée,
et une entrée `audit_logs` de sévérité `CRITICAL` est produite.

Le rapprochement d'entité se fait **par jetons significatifs** et non par égalité stricte : le
référentiel porte des raisons sociales approximatives (`Petrofleet Shipping` contre
`PETROFLEET ENERGY TRADING LLC`, `Morgan Navigation SA` contre `MORGAN NAVIGATION CO SA`), et
l'égalité stricte ne trouve **aucune** des deux. La garde s'appuie sur
`frontend/src/domain/sanctions/contactGuard.ts`, étendu d'une fonction de rapprochement par jetons.

## 8. Interface

Route `/admin/vessel-identity`, réservée à `PORT_OFFICER`, `FINANCE_ADMIN`, `SUPERADMIN`
(entrée `DashboardSidebar.tsx` + `NAV_PERMISSIONS` dans `lib/rbac.ts`).

- **Dépôt** : zone de dépôt du CSV, puis compte rendu d'import (lues / retenues / rejetées par motif).
- **Appariement** : deux colonnes — à gauche les navires `UNVERIFIED-%` avec leur armateur et leur
  encours, à droite les candidats non appariés avec identité, tonnage et contact résolu. Un bandeau
  rouge signale les candidats `contact_blocked`.
- **Formulaire unitaire** : saisie manuelle d'un candidat (`source = MANUAL`) pour les navires
  absents de l'export, avec les mêmes contrôles, dont la somme de contrôle IMO.
- Conventions : composant serveur pour la garde RBAC, panneau client `*Panel.tsx` avec
  `ModalOverlay` (pas de Radix Dialog), i18n `AdminVesselIdentity` sur les 6 locales.

## 9. Risques identifiés

**Le MMSI n'est pas un identifiant stable.** L'export le démontre : `PEARL1` (IMO 9166948) porte
le MMSI `341809001` en juin puis `671594100` au 25 juillet, après changement de pavillon. Or
`aisStreamService.ts` fait son upsert `onConflict: 'mmsi'` : au changement de pavillon d'un navire
connu, le pipeline crée une **seconde ligne** pour le même navire, orpheline d'armateur. Ce défaut
préexiste au présent chantier et n'y est pas corrigé ; il est consigné ici parce que l'export l'a
rendu visible et qu'il annule, à terme, le bénéfice de l'appariement.

**La source se contredit elle-même.** `MUSTANG-1` (IMO 9170107) est donné sous pavillon *Comoros*
dans l'export de flotte et *Tanzania* dans l'export d'escales. La règle « revue humaine en cas de
conflit » (D3) est ce qui protège de ce type de divergence.

**39 navires sur 86 restent sans e-mail.** L'appariement ne les rendra pas joignables. Leur
qualification relève d'une recherche manuelle, hors périmètre.

## 10. Suites

| Chantier | Déclenchement |
| --- | --- |
| Réémission des 73 pro-formas à IMO synthétique (D6) | après appariement — `transactions.vessel_imo` est gelé par la migration 089, seul un document rectificatif corrige l'identité affichée |
| Facturation des escales réelles observées | décision PO ultérieure ; l'export contient les faits générateurs `ENTER_ZONE` |
| Correction de la clé d'upsert AIS (`mmsi` → `imo_number`) | dette technique, §9 |
| Résolution de `arm-014` en armateurs réels | conséquence attendue de l'appariement |

## 11. Tests

| Niveau | Couverture |
| --- | --- |
| Parseur | colonnes en double lues par position ; en-tête non conforme rejeté ; déduplication par IMO retenant la ligne la plus récente ; `IMO = 0` rejeté ; somme de contrôle (les 86 IMO valides de l'export + une valeur fautive) ; `LOA < LPP` rejeté |
| Normalisation | `TYPENAME` → `vessel_category` + `vessel_subtype` ; nom avec espace initial ; `flag_code` inconnu rejeté ; **`GT → gross_tonnage_dwt` et `DWT → dwt`**, test dédié |
| Chaîne de confiance | `VESSELFINDER_VERIFIED` écrase `AGENT_CLAIM`, n'écrase pas `PORT_OFFICER`, égalité avec `EQUASIS_VERIFIED` |
| Garde sanctions | Morgan Navigation et Petrofleet reconnus par jetons malgré des raisons sociales divergentes ; `contact_blocked` posé ; e-mail jamais proposé ; `audit_logs` `CRITICAL` écrit |
| Action serveur | garde « navire non identifié » sur les trois formes (`UNVERIFIED-nav-042`, « à confirmer », « Hors registre Equasis ») et refus sur un IMO valide ; somme de contrôle ; conflit IMO et conflit MMSI sans écriture ; écriture complète avec audit ; rôle insuffisant refusé |
| Migration | contrainte `official_email_source` étendue ; RLS de `vessel_identity_candidates` (runner `./supabase/tests/run.sh`) |
