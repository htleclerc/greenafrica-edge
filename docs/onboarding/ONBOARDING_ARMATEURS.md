# 📋 Plan d'Onboarding Armateurs — Green-Gate Platform

**Auteur :** Noël KPATCHAVI · Directeur Green-Gate Programme
**Date :** 12 juillet 2026
**Version :** v1.0
**Statut :** Prêt pour intégration développeur

---

## 🎯 Objectif

Intégrer les 90+ armateurs identifiés (100 navires) dans la plateforme Green-Gate afin d'automatiser le cycle complet : détection escale → calcul contribution carbone → facturation pro-forma → relances → recouvrement → adhésion ASCR.

---

## 📐 Architecture applicative cible

```
┌─────────────────────────────────────────────────────────────┐
│                    GREEN-GATE PLATFORM                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │
│  │  ARMATEURS   │◄──┤   NAVIRES    │◄──┤   VOYAGES    │    │
│  │  (owner)     │   │  (vessel)    │   │  (voyage)    │    │
│  └──────┬───────┘   └──────────────┘   └──────┬───────┘    │
│         │                                       │            │
│         │           ┌──────────────┐            │            │
│         └──────────►│  PRO-FORMAS  │◄───────────┘            │
│                     │  (invoice)   │                         │
│                     └──────┬───────┘                         │
│                            │                                  │
│                     ┌──────▼───────┐   ┌──────────────┐     │
│                     │  RELANCES    │   │  PAIEMENTS   │     │
│                     │  (reminder)  │   │  (payment)   │     │
│                     └──────────────┘   └──────────────┘     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 🗂️ Modèle de données (6 entités principales)

### 1. `armateurs` (Shipowners)
Entité racine — l'organisation propriétaire ou gestionnaire ISM du navire.

| Champ | Type | Description |
|---|---|---|
| `id` | UUID | Identifiant unique |
| `nom_legal` | string | Raison sociale légale |
| `alias` | string[] | Noms commerciaux/alternatifs |
| `pays_hq` | string ISO2 | Pays du siège social |
| `adresse_hq` | text | Adresse complète HQ |
| `email_principal` | email | Contact commercial principal |
| `email_ops` | email | Contact opérations |
| `telephone` | string | Ligne téléphonique |
| `is_ofac_sdn` | boolean | Statut sanctions OFAC |
| `is_un_prohibited` | boolean | Statut pavillon UN |
| `verification_status` | enum | `PENDING` / `VERIFIED` / `BLOCKED` |
| `onboarding_stage` | enum | `INVITED` / `KYC` / `SIGNED` / `ACTIVE` |
| `equasis_id` | string | ID Equasis si disponible |
| `imo_manager_id` | string | ID IMO Manager si disponible |
| `notes` | text | Observations Green-Gate |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |

### 2. `navires` (Vessels)
Chaque navire physique, rattaché à un armateur.

| Champ | Type | Description |
|---|---|---|
| `id` | UUID | |
| `armateur_id` | UUID FK | Référence armateur |
| `nom` | string | Nom du navire |
| `imo` | string(7) | Numéro IMO officiel |
| `mmsi` | string(9) | MMSI radio |
| `pavillon` | string ISO2 | Pavillon actuel |
| `type_navire` | enum | Bulk/Container/General Cargo/Chemical/Livestock |
| `gt` | integer | Gross Tonnage |
| `dwt` | integer | Deadweight |
| `annee_construction` | integer | |
| `status` | enum | `ACTIVE` / `SCRAPPED` / `RENAMED` |
| `previous_names` | string[] | Anciens noms |
| `created_at` | timestamp | |

### 3. `voyages` (Escales)
Chaque passage/escale d'un navire à Berbera.

| Champ | Type | Description |
|---|---|---|
| `id` | UUID | |
| `navire_id` | UUID FK | Référence navire |
| `port_origine` | string | Ex. "Dubai" |
| `port_destination` | string | Ex. "Berbera" |
| `date_arrivee` | date | ETA/ATA |
| `date_depart` | date | ETD/ATD |
| `distance_nm` | integer | Distance parcourue (nm) |
| `vitesse_kn` | float | Vitesse moyenne (nœuds) |
| `carburant_type` | enum | HFO / MDO / LNG |
| `co2_voyage_tco2` | float | CO₂ voyage total |
| `co2_facturable_tco2` | float | CO₂ × 50% (v11 HYBRID) |
| `contribution_usd` | float | co2_facturable × USD 40 |
| `wave_tag` | string | W1-3, W4, W5, ... |
| `status` | enum | `ARRIVED` / `AT_PORT` / `DEPARTED` |
| `created_at` | timestamp | |

### 4. `proformas` (Factures pro-forma)
Facture émise à un armateur — peut concerner plusieurs voyages.

| Champ | Type | Description |
|---|---|---|
| `id` | UUID | |
| `reference` | string | Ex. "PRO-2026-064037" |
| `armateur_id` | UUID FK | Destinataire |
| `voyage_ids` | UUID[] | Voyages concernés |
| `total_usd` | decimal | Montant total dû |
| `total_paye_usd` | decimal | Montant encaissé |
| `outstanding_usd` | decimal | Reste dû |
| `date_emission` | date | |
| `date_echeance` | date | +30 jours |
| `payment_status` | enum | `PENDING` / `PARTIAL` / `PAID` / `OVERDUE` / `DISPUTED` |
| `pdf_url` | url | Lien PDF signé |
| `sent_at` | timestamp | Envoi initial |
| `sent_method` | enum | `EMAIL` / `POSTAL` / `IN_REM` |
| `is_erratum` | boolean | Si erratum (rectification) |
| `original_proforma_id` | UUID | Si erratum, référence à l'originale |
| `created_at` | timestamp | |

### 5. `relances` (Reminders)
Trace de chaque relance envoyée (J+15, J+30, J+45).

| Champ | Type | Description |
|---|---|---|
| `id` | UUID | |
| `proforma_id` | UUID FK | |
| `tier` | enum | `J15` / `J30` / `J45` |
| `sent_at` | timestamp | |
| `sent_email` | email | Destinataire |
| `cc_emails` | email[] | ex. Eidle Advocats à J+45 |
| `template_used` | string | ex. `J45_bailiff_notice.html` |
| `armateur_response_at` | timestamp | Réponse reçue |
| `armateur_response_type` | enum | `ACKNOWLEDGE` / `DISPUTE` / `PAYMENT_PROMISE` / `SILENT` |
| `escalated_bailiff` | boolean | Escaladé à Eidle Advocats |
| `created_at` | timestamp | |

### 6. `paiements` (Payments)
Enregistrement des encaissements.

| Champ | Type | Description |
|---|---|---|
| `id` | UUID | |
| `proforma_id` | UUID FK | |
| `montant_usd` | decimal | |
| `date_recu` | date | |
| `methode` | enum | `SWIFT` / `WIRE` / `CHECK` / `ASCR_TOKEN` |
| `reference_bancaire` | string | |
| `banque_emettrice` | string | |
| `confirmation_pdf` | url | Reçu bancaire signé |
| `notes` | text | |
| `created_at` | timestamp | |

---

## 🔄 Workflow d'onboarding (5 étapes)

### Étape 1 — DÉTECTION (automatique)
- Ingestion quotidienne VesselFinder + Marine Traffic + Port de Berbera
- Créer entrée `navires` si nouveau IMO
- Créer entrée `voyages` avec calcul CO₂ automatique
- Générer `proformas` en statut `DRAFT`

### Étape 2 — LOOKUP ARMATEUR (semi-automatique)
- Équipe Green-Gate : Equasis lookup + TrustedDocks + IMO Manager DB
- Créer/mettre à jour `armateurs`
- Renseigner `verification_status = VERIFIED` si armateur trouvé
- Vérifier OFAC SDN + UN prohibited flag → si vrai, `verification_status = BLOCKED`

### Étape 3 — INVITATION (email initial)
- Passer `armateur.onboarding_stage = INVITED`
- Envoyer pro-forma initiale + kit onboarding (guide, formule, FAQ)
- Programmer relance J+15 auto

### Étape 4 — KYC / SIGNATURE
- Armateur remplit formulaire onboarding (KYC light)
- Signature électronique conditions Green-Gate
- Passer `armateur.onboarding_stage = SIGNED`

### Étape 5 — ACTIVATION
- Armateur devient client Green-Gate actif
- Facturations futures automatiques dès détection escale
- Passer `armateur.onboarding_stage = ACTIVE`
- Accès portail self-service (historique, factures, paiements)

---

## 🚦 Règles métier critiques

### Blocages absolus
- **OFAC SDN** : `is_ofac_sdn = true` → jamais de contact direct, procédure in rem uniquement (Bailiff Eidle Omer)
- **UN pavillon prohibé** : `is_un_prohibited = true` → NE PAS envoyer d'email, notification consulaire seulement

### Formule contribution
- **Maritime v11 HYBRID** : `contribution_usd = co2_voyage_tco2 × 0.50 × 40`
- **Aviation (nouvelle) NEW** : `contribution_usd = co2_voyage_tco2 × 2.0 (RFI) × 40`
- Facteur émission HFO = 3.114 tCO₂/t fuel (IMO MEPC.346(78))

### Cycle relances
- **J+0** : Envoi pro-forma
- **J+15** : Relance amicale (rappel)
- **J+30** : Relance formelle (mise en demeure)
- **J+45** : Notice Bailiff (CC Eidle Advocats Hargeisa) — escalade
- **J+60** : Procédure judiciaire ou saisie in rem

### CC obligatoires
- Tous mails : CC `n.kpatchavi@solidetechnology.com`
- J+45 uniquement : CC `eidle@eidle-advocats.so`

---

## 🌱 Seeds fournis (13 armateurs · 100 navires · 458 pro-formas)

Le dossier `seeds/` contient :
- `01_armateurs.json` : 13 armateurs identifiés (Wave 1-8)
- `02_navires.json` : 100 navires (90 réalisés + 10 anticipés)
- `03_voyages.json` : voyages avec CO₂ calculé
- `04_proformas.json` : 458 pro-formas (100 maritime + 358 aviation)
- `05_relances.json` : historique relances J+15/J+30/J+45
- `06_paiements.json` : paiements enregistrés (échantillon)
- `07_compagnies_aeriennes.json` : 6 opérateurs aviation

---

## 🛠️ Intégration technique

### Ordre d'import des seeds
```bash
# Ordre critique — respecter les dépendances FK
npm run seed:armateurs        # 1. Armateurs (racine)
npm run seed:compagnies       # 2. Compagnies aviation
npm run seed:navires          # 3. Navires (FK armateurs)
npm run seed:voyages          # 4. Voyages (FK navires)
npm run seed:proformas        # 5. Pro-formas (FK armateurs + voyages)
npm run seed:relances         # 6. Relances (FK proformas)
npm run seed:paiements        # 7. Paiements (FK proformas)
```

### Endpoints API prioritaires
| Endpoint | Méthode | Description |
|---|---|---|
| `/api/armateurs` | GET/POST | Liste + création armateur |
| `/api/armateurs/:id/onboard` | POST | Passer à INVITED |
| `/api/armateurs/:id/kyc` | POST | Soumettre KYC |
| `/api/navires` | GET | Liste navires |
| `/api/voyages` | GET/POST | Escales |
| `/api/proformas` | GET/POST | Émission facture |
| `/api/proformas/:id/send` | POST | Envoi mail avec PDF |
| `/api/relances/tick` | POST | Cron J+15/J+30/J+45 |
| `/api/paiements` | POST | Enregistrement encaissement |
| `/api/dashboard/kpi` | GET | Métriques temps réel |

### Cron jobs
- **Toutes les 6h** : sync VesselFinder → détection nouveaux voyages
- **Quotidien 08:00** : `/api/relances/tick` → envoi J+15/J+30/J+45 dûs
- **Quotidien 09:00** : recalcul KPI dashboard
- **Hebdo lundi** : rapport de recouvrement envoyé Direction

---

## 🔐 Sécurité & compliance

- **Authentification** : SSO Google Workspace (comptes @solidetechnology.com)
- **Rôles** : `ADMIN` (Noël), `OPS` (équipe Berbera), `FINANCE` (trésorerie), `READONLY` (Comité SOLIDE)
- **Audit trail** : toutes les mutations sur `armateurs` / `proformas` doivent être logguées avec user_id + timestamp
- **PII** : emails armateurs = données sensibles → chiffrement au repos (AES-256)
- **OFAC screening** : appel API OFAC-SDN à chaque création armateur (obligation légale)
- **RGPD-like** : durée de rétention 10 ans (compliance fiscale), purge automatique après

---

## 📊 KPI dashboard temps réel

- Total USD facturé (life-to-date)
- Total USD encaissé (life-to-date)
- Taux recouvrement (% payé / facturé)
- Nb armateurs par onboarding_stage
- Nb pro-formas par payment_status
- Trajectoire annualisée USD/an
- Pipeline Wave suivante (anticipation 7 jours)

---

## 🎨 UI armateur (portail self-service)

Après activation (stage = ACTIVE) :
- Historique escales de tous ses navires
- Liste pro-formas + statuts paiement
- Détails calcul CO₂ (transparence formule)
- Téléchargement PDFs signés
- Enregistrement paiement + upload preuve
- FAQ + contact support

---

## 📞 Contacts opérationnels

- **Direction Green-Gate** : Noël KPATCHAVI · n.kpatchavi@solidetechnology.com · +33 7 58 66 67 75
- **Bailiff Hargeisa** : Eidle Omer (Eidle Advocats) · eidle@eidle-advocats.so
- **Ministère MOE&CC** : Direction générale · direction@moe.gov.so
- **Partenaire ASCR** : Ahmed Araita Ali (AGADEV) · ahmed.araita@agadev.dj

---

## ✅ Definition of Done (MVP application)

1. Import complet des 7 seeds sans erreur
2. Dashboard KPI affiche les chiffres du bilan 12 juillet ($2,60M)
3. Endpoint `/api/proformas/:id/send` envoie mail + tracker
4. Cron `/api/relances/tick` fonctionnel en environnement staging
5. Bloc OFAC/UN empêche création email vers armateurs marqués BLOCKED
6. Portail armateur accessible en lecture seule (activation stage manuel)
7. Rapport hebdo envoyé automatiquement à Direction

---

*Document technique de référence pour l'équipe développement.
Toute modification à valider par le Comité SOLIDE avant merge.*
