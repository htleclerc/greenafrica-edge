# ✈️ Module Aviation — Onboarding des compagnies aériennes

**Complément au dossier `ONBOARDING_ARMATEURS.md`** (volet aviation)

**Date** : 13 juillet 2026
**Auteur** : Noël KPATCHAVI · Green-Gate Programme
**Formule active** : v2 (CO₂ × RFI 2.0 × USD 40 — sans composante par passager)

---

## 🎯 Périmètre

L'aviation a été intégrée au Green-Gate Programme depuis **le 1er mai 2026** (préparation) et **opérationnellement à partir du 1er juin 2026**. Six opérateurs sont actifs sur les aéroports somalilandais (Hargeisa HGA et Berbera BBO).

À date du 12 juillet 2026 :
- **358 vols** enregistrés
- **6 compagnies** identifiées
- **USD 715 233** facturables (100 % impayé à ce jour)

---

## 🔄 Formule appliquée (mise à jour juin 2026)

### Ancienne formule (mai 2026) — **retirée**
```
Contribution = (Pax × USD 20) + (CO₂ voyage × 50% × USD 40)
```

### Nouvelle formule v2 (depuis juin 2026)
```
Contribution USD = CO₂ voyage × RFI 2.0 × USD 40
```

**Justification du changement** :
- Suppression de la composante per-passenger (critique politique — perçue comme touchant les voyageurs individuels)
- La contribution s'applique désormais uniquement à l'aéronef (pollueur-payeur strict)
- Ajout du coefficient RFI 2.0 (Radiative Forcing Index) recommandé par l'IPCC et l'ICAO
- Alignement avec la trajectoire CORSIA (mandatoire 2027)

**Composantes** :
- **CO₂ voyage** = LTO (Landing & Take-Off) + Cruise CO₂
- **RFI 2.0** = multiplicateur aviation (effet altitude sur climat)
- **USD 40** = tarif unifié maritime/aviation

**Exemple** : Vol FlyDubai FZ-501 (B737-800, DXB→HGA) — 13 tCO₂ × 2.0 × USD 40 = **USD 1 040 par vol**

---

## ✈️ Les 6 compagnies opérationnelles

| ID Seed | Compagnie | Code IATA | Hub | Pays HQ | Vols/mois |
|---|---|:---:|---|---|:---:|
| avi-001 | Ethiopian Airlines | ET | ADD | Éthiopie | ~28 |
| avi-002 | FlyDubai | FZ | DXB | UAE | ~30 |
| avi-003 | Air Arabia | G9 | SHJ | UAE | ~15 |
| avi-004 | Daallo Airlines | D3 | DXB/JED | Somalie | ~18 |
| avi-005 | Jubba Airways | JR | MGQ | Somalie | ~19 |
| avi-006 | Charter divers | — | Divers | Divers | ~8 |

Les données complètes se trouvent dans `seeds/07_compagnies_aeriennes.json`.

---

## 🗂️ Modèle de données spécifique aviation

Le schéma Prisma (`schema.prisma`) inclut déjà les entités nécessaires :

- **`CompagnieAerienne`** — Compagnie (nom, IATA, ICAO, hub, contacts, statut onboarding)
- **`Proforma` (type = AVIATION)** — Pro-forma vol avec `vol_details` JSON contenant :
  - `flight_no` (ex: "FZ-501")
  - `route` (ex: "DXB-HGA")
  - `aircraft` (ex: "B737-800")
  - `pax` (nombre de passagers)
  - `co2_voyage_tco2` (CO₂ voyage brut)
  - `rfi` (2.0 depuis juin 2026)

---

## 🔄 Workflow d'onboarding (identique au maritime, adapté)

### Étape 1 — DÉTECTION (automatique)
- Ingestion quotidienne : plans de vol de la Somaliland Civil Aviation Authority (SCAA)
- Cross-check avec FlightRadar24 / ADS-B pour vols effectifs
- Création `proforma` (type AVIATION) automatique dès qu'un vol est confirmé

### Étape 2 — CALCUL AUTOMATIQUE CO₂
- **LTO CO₂** : table par type d'aéronef (B737-800 = 2.5 t · Q400 = 1.0 t · ATR-72 = 0.7 t...)
- **Cruise CO₂** : durée route × facteur horaire par type d'aéronef
- **Total × RFI 2.0** = CO₂eq facturable
- **Contribution USD** = CO₂eq × 40

### Étape 3 — INVITATION (email initial)
- Passer `compagnie.onboarding_stage = INVITED`
- Envoyer pro-forma initiale + kit d'onboarding aviation
- Programmer relance J+15 automatique

### Étape 4 — KYC LIGHT (compagnie aérienne)
- Compagnie confirme : coordonnées facturation, contact ops, contact finance
- Signature électronique des conditions Green-Gate aviation
- Passer `compagnie.onboarding_stage = SIGNED`

### Étape 5 — ACTIVATION
- Facturations automatiques dès détection de vol
- Portail self-service (historique vols, factures, paiements)
- Passer `compagnie.onboarding_stage = ACTIVE`

---

## 🚦 Règles métier aviation

### Types de vols facturables
- **Passagers** : vols réguliers (Ethiopian, FlyDubai, Air Arabia, Daallo, Jubba)
- **Cargo** : vol FZ-301 FlyDubai cargo (B737-F)
- **Charter** : cas par cas (opérateurs multiples)

### Vols exclus
- Vols militaires / diplomatiques (accord spécifique)
- Vols humanitaires (croix-rouge, ONU) — sur justificatif
- Escales techniques sans embarquement/débarquement (< 2h)
- Vols VIP tête d'État (immunité)

### Cadre légal
- **Convention Chicago 1944** — Article 15 (traitement égal des compagnies) et Article 24 (exemption fuel, mais taxes environnementales autorisées)
- **CORSIA (ICAO Annex 16 Vol. IV)** — mandatoire 2027
- **UNCLOS Art. 211** — extension du principe à l'espace aérien somalilandais

---

## 💰 Recouvrement — spécificités aviation

L'ensemble des modules de recouvrement automatique décrits dans `RECOUVREMENT_AUTOMATIQUE.md` s'applique à l'aviation, avec ces particularités :

### Références de pro-forma aviation
- Format : `AVI-2026-XXXX` (au lieu de `PRO-2026-064XXX` pour le maritime)
- Consolidé : `CONS-AVI-2026-YYYYMMDD-{COMPAGNIE}`

### Regroupement mensuel possible
Les compagnies aériennes préfèrent généralement recevoir une **facturation mensuelle groupée** plutôt qu'une pro-forma par vol. Le système doit permettre :
- Émission automatique d'une pro-forma consolidée le 1er du mois (pour tous les vols du mois précédent)
- Envoi email unique par compagnie
- Support du regroupement multi-mois si demandé

### Contacts stratégiques

| Compagnie | Interlocuteur type | Enjeu |
|---|---|---|
| Ethiopian Airlines | Regional VP Africa | Compagnie pivot Est-Afrique — RDV Direction août 2026 |
| FlyDubai | Head of Africa Operations | Plus gros contributeur ($238k) |
| Air Arabia | Country Manager UAE | Low-cost — sensibilité prix |
| Daallo Airlines | Direction générale | Compagnie somalienne — enjeu diplomatique |
| Jubba Airways | Direction générale | Compagnie somalienne — enjeu diplomatique |
| Charters | Cas par cas | Traitement individuel |

---

## 📊 Package pro-formas aviation généré

À date du 13 juillet 2026, le package complet a été produit :

- **358 pro-formas individuelles** (une par vol) — au format Green Gate OS
- **6 pro-formas consolidées** (une par compagnie) — avec annexe multi-pages
- **1 index PDF** récapitulatif
- **Archive ZIP** : `GreenGate_ProFormas_AVIATION_FINAL.zip` (25 MB)

Structure des consolidées :
- **FlyDubai** : 97 vols · 6 pages · USD 238 340 (plus gros)
- **Ethiopian Airlines** : 84 vols · 5 pages · USD 185 920
- **Air Arabia** : 42 vols · 3 pages · USD 112 560
- **Daallo Airlines** : 50 vols · 4 pages · USD 100 445
- **Jubba Airways** : 60 vols · 4 pages · USD 58 720
- **Charter** : 25 vols · 3 pages · USD 19 248

---

## 🔧 Endpoints API additionnels (spécifiques aviation)

Ajouts au `API_ENDPOINTS.md` :

```http
# Compagnies aériennes (déjà présent v1)
GET    /api/compagnies                       Liste des 6 compagnies
POST   /api/compagnies                       Créer une nouvelle compagnie
GET    /api/compagnies/:id/vols              Historique vols
GET    /api/compagnies/:id/proformas         Historique pro-formas
POST   /api/compagnies/:id/invite            Passer à INVITED

# Vols
GET    /api/vols                             Liste des vols avec filtres (compagnie, période)
POST   /api/vols                             Créer un vol (auto-calcul CO₂ + RFI)
GET    /api/vols/:id                         Détail vol

# Facturation mensuelle
POST   /api/aviation/monthly-billing         Cron 1er du mois — génère les 6 consolidées mensuelles
GET    /api/aviation/monthly-report/:month   Rapport mensuel aviation

# Sync automatique
POST   /api/cron/aviation-sync               Cron 6h — sync avec plans de vol SCAA
```

---

## 📈 KPI dashboard aviation

Ajouts au dashboard existant :

- **Total vols mois courant / mois précédent**
- **Répartition par compagnie** (pie chart)
- **Répartition par route** (bar chart : DXB-HGA · ADD-HGA · SHJ-HGA · MGQ-HGA · DXB-BBO...)
- **CO₂ moyen par vol** (indicateur qualité formule)
- **Taux recouvrement aviation** (vs maritime)

---

## ✅ Checklist d'intégration aviation

- [ ] Import du seed `07_compagnies_aeriennes.json` (6 compagnies)
- [ ] Import des 358 pro-formas aviation depuis `seeds/04_proformas.json` (filtrer type=AVIATION)
- [ ] Endpoint `POST /api/vols` avec auto-calcul CO₂ + RFI 2.0
- [ ] Endpoint `POST /api/aviation/monthly-billing` (cron 1er du mois)
- [ ] Template mail d'invitation aviation (adapté aux compagnies)
- [ ] Portail self-service compagnie (historique vols par mois)
- [ ] Screen admin `/admin/aviation/dashboard`
- [ ] Coordination avec Ethiopian Airlines (RDV Direction planifié août 2026)

---

## 📞 Support intégration

- **Direction Green-Gate** : Noël KPATCHAVI · +33 7 51 42 23 84
- **Documentation formule** : cf. `PJ3_Etat_Art_Mondial_Taxes_Carbone.docx` (méthodologie détaillée)
- **Package pro-formas prêt** : `GreenGate_ProFormas_AVIATION_FINAL.zip`

---

*Ce document complète `ONBOARDING_ARMATEURS.md` et s'inscrit dans le dossier d'intégration global. Les modules de recouvrement automatique (`RECOUVREMENT_AUTOMATIQUE.md`, `RECONCILIATION_BANCAIRE.md`, `BILAN_AUTO_GENERATION.md`) sont réutilisés à l'identique pour l'aviation.*
